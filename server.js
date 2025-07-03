import express from 'express';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
import { Buffer } from 'buffer';

dotenv.config();
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

app.post('/upload-audio', async (req, res) => {
  try {
    const { filename, base64 } = req.body;

    if (!filename || !base64) {
      return res.status(400).json({ error: 'Missing filename or base64 data' });
    }

    const buffer = Buffer.from(base64, 'base64');

    await s3.send(new PutObjectCommand({
      Bucket: 'podcast-raw-merged',
      Key: filename,
      Body: buffer,
      ContentType: 'audio/mpeg'
    }))

    const url = `${process.env.R2_ENDPOINT}/${filename}`;
    res.json({ uploaded: true, filename, url });

  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/status', (req, res) => {
  res.send('Uploader is live.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
