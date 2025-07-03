import express from 'express';
import axios from 'axios';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { exec as _exec } from 'child_process';
import { promisify } from 'util';

dotenv.config();
const exec = promisify(_exec);
const app = express();
app.use(express.json({ limit: '10mb' }));

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
});

app.post('/merge-files', async (req, res) => {
  const { files, output, bucket = 'podcast-raw-merged' } = req.body;

  if (!files || !Array.isArray(files) || files.length === 0 || !output) {
    return res.status(400).json({ error: 'Missing files or output name' });
  }

  try {
    const tempDir = '/tmp/merge-temp';
    fs.mkdirSync(tempDir, { recursive: true });

    const downloadedPaths = [];

    for (const url of files) {
      const filename = path.basename(url.split('?')[0]);
      const filepath = path.join(tempDir, filename);
      const writer = fs.createWriteStream(filepath);
      const response = await axios({ url, method: 'GET', responseType: 'stream' });

      await new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });

      downloadedPaths.push(filepath);
    }

    const listFilePath = path.join(tempDir, 'merge.txt');
    const concatList = downloadedPaths.map(file => `file '${file}'`).join('\n');
    fs.writeFileSync(listFilePath, concatList);

    const mergedOutput = path.join(tempDir, output);
    await exec(`ffmpeg -f concat -safe 0 -i ${listFilePath} -c copy ${mergedOutput}`);

    const buffer = fs.readFileSync(mergedOutput);
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: output,
      Body: buffer,
      ContentType: 'audio/mpeg'
    }));

    const publicUrl = `${process.env.R2_ENDPOINT}/${bucket}/${output}`;
    res.json({ uploaded: true, filename: output, url: publicUrl });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/status', (req, res) => {
  res.send('Merge service is live');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
