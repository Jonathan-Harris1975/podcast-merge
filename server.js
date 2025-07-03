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
// Basic setup
// -----------------------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '20mb' }));          // handle chunky bodies

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
});

// Helpers ---------------------------------------------------------------------
const downloadTo = async (url, dir) => {
  const filename = path.basename(url.split('?')[0]);
  const dest = path.join(dir, filename);
  const writer = fs.createWriteStream(dest);

  const resp = await axios({ url, method: 'GET', responseType: 'stream' });
  await new Promise((res, rej) => {
    resp.data.pipe(writer);
    writer.on('finish', res);
    writer.on('error', rej);
  });

  return dest;
};

const uploadToR2 = async (bucket, key, buffer) => {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'audio/mpeg'
    })
  );
  return `${process.env.R2_ENDPOINT}/${bucket}/${key}`;
};

// -----------------------------------------------------------------------------
// POST /upload-audio  – single file straight into R2
// -----------------------------------------------------------------------------
app.post('/upload-audio', async (req, res) => {
  const { filename, url, bucket = 'podcast-raw' } = req.body;
  if (!filename || !url) return res.status(400).json({ error: 'filename & url required' });

  try {
    const tmpDir = '/tmp/upload-temp';
    fs.mkdirSync(tmpDir, { recursive: true });

    const localPath = await downloadTo(url, tmpDir);
    const buffer = fs.readFileSync(localPath);

    const publicUrl = await uploadToR2(bucket, filename, buffer);
    res.json({ uploaded: true, filename, url: publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /merge-files  – concat multiple audio URLs, push merged result to R2
// -----------------------------------------------------------------------------
app.post('/merge-files', async (req, res) => {
  const { files, output, bucket = 'podcast-raw-merged' } = req.body;
  if (!Array.isArray(files) || files.length === 0 || !output) {
    return res.status(400).json({ error: 'files[] and output are required' });
  }

  try {
    const tmpDir = '/tmp/merge-temp';
    fs.mkdirSync(tmpDir, { recursive: true });

    // download all sources
    const localFiles = [];
    for (const u of files) localFiles.push(await downloadTo(u, tmpDir));

    // build concat list for ffmpeg
    const listFile = path.join(tmpDir, 'list.txt');
    fs.writeFileSync(listFile, localFiles.map(f => `file '${f}'`).join('\n'));

    const mergedOut = path.join(tmpDir, output);
    await exec(`"${ffmpegPath}" -f concat -safe 0 -i ${listFile} -c copy ${mergedOut}`);

    const buffer = fs.readFileSync(mergedOut);
    const publicUrl = await uploadToR2(bucket, output, buffer);

    res.json({ uploaded: true, filename: output, url: publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// health check
// -----------------------------------------------------------------------------
app.get('/status', (_, res) => res.send('Podcast merge service live 🎙️'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
