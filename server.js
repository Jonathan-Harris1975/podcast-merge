/* ===========================================================================
   podcast-merge/server.js
   Full server with single‐file upload, full merge, and batch merge endpoints
   ========================================================================== */

import express from 'express';
import axios from 'axios';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

dotenv.config();
const exec = promisify(_exec);

// -----------------------------------------------------------------------------
// Resolving __dirname in ES-module context
// -----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// -----------------------------------------------------------------------------
// Express & AWS R2 setup
// -----------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '20mb' }));           // accept chunky bodies

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
});

// -----------------------------------------------------------------------------
// Helper functions
// -----------------------------------------------------------------------------
const downloadTo = async (url, dir) => {
  const filename = path.basename(url.split('?')[0]);
  const dest     = path.join(dir, filename);

  fs.mkdirSync(dir, { recursive: true });
  const writer = fs.createWriteStream(dest);

  const resp = await axios({ url, method: 'GET', responseType: 'stream' });
  await new Promise((res, rej) => {
    resp.data.pipe(writer);
    writer.on('finish', res);
    writer.on('error',  rej);
  });

  return dest;
};

const uploadToR2 = async (bucket, key, buffer) => {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key:    key,
      Body:   buffer,
      ContentType: 'audio/mpeg'
    })
  );
  return `${process.env.R2_ENDPOINT}/${bucket}/${key}`;
};

// -----------------------------------------------------------------------------
// ROUTES
// -----------------------------------------------------------------------------

/*  POST /upload-audio
    ──────────────────
    Accepts a single file URL, uploads it to the target bucket unchanged.
    Body:
      { "filename": "episode-raw.mp3",
        "url": "https://…/file.mp3",
        "bucket": "optional-bucket" }
*/
app.post('/upload-audio', async (req, res) => {
  const { filename, url, bucket = 'podcast-raw-merged' } = req.body;
  if (!filename || !url) {
    return res.status(400).json({ error: 'filename & url required' });
  }

  try {
    const local = await downloadTo(url, '/tmp/upload-temp');
    const buf   = fs.readFileSync(local);
    const pub   = await uploadToR2(bucket, filename, buf);

    res.json({ uploaded: true, filename, url: pub });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/*  POST /merge-files
    ─────────────────
    Concatenates an arbitrary list of audio URLs into one MP3.
    Body:
      { "files":  ["https://…1.mp3","https://…2.mp3"],
        "output": "full-episode.mp3",
        "bucket": "optional-bucket" }
*/
app.post('/merge-files', async (req, res) => {
  const { files, output, bucket = 'podcast-raw-merged' } = req.body;
  if (!Array.isArray(files) || files.length === 0 || !output) {
    return res.status(400).json({ error: 'files[] and output are required' });
  }

  try {
    const tmpDir = '/tmp/merge-temp';
    fs.mkdirSync(tmpDir, { recursive: true });

    const localFiles = [];
    for (const u of files) localFiles.push(await downloadTo(u, tmpDir));

    const listFile = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(listFile, localFiles.map(f => `file '${f}'`).join('\n'));

    const mergedOut = path.join(tmpDir, output);
    await exec(`"${ffmpegPath}" -f concat -safe 0 -i ${listFile} -c copy ${mergedOut}`);

    const buf = fs.readFileSync(mergedOut);
    const pub = await uploadToR2(bucket, output, buf);

    res.json({ uploaded: true, filename: output, url: pub });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

/*  POST /merge-batch
    ─────────────────
    Designed for Make.com workflows: merge small groups (3-5) of chunks,
    producing intermediate batches that can later be merged again.
    Body identical to /merge-files but defaults to a temp bucket.
*/
app.post('/merge-batch', async (req, res) => {
  const { files, output, bucket = 'podcast-temp-batches' } = req.body;
  if (!Array.isArray(files) || files.length === 0 || !output) {
    return res.status(400).json({ error: 'files[] and output are required' });
  }

  try {
    const tmpDir = '/tmp/merge-batch';
    fs.mkdirSync(tmpDir, { recursive: true });

    const localFiles = [];
    for (const u of files) localFiles.push(await downloadTo(u, tmpDir));

    const listFile = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(listFile, localFiles.map(f => `file '${f}'`).join('\n'));

    const mergedOut = path.join(tmpDir, output);
    await exec(`"${ffmpegPath}" -f concat -safe 0 -i ${listFile} -c copy ${mergedOut}`);

    const buf = fs.readFileSync(mergedOut);
    const pub = await uploadToR2(bucket, output, buf);

    res.json({ uploaded: true, filename: output, url: pub });
  } catch (err) {
    console.error('Merge batch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// health check
app.get('/status', (_, res) => res.send('Podcast merge service live 🎙️'));

// listen
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
