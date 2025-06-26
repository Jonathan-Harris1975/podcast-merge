// server.js - FFmpeg Merge Webhook for Render Hosting

const express = require('express'); const fetch = require('node-fetch'); const fs = require('fs'); const { exec } = require('child_process'); const path = require('path');

const app = express(); app.use(express.json());

app.post('/merge', async (req, res) => { try { const { intro_url, narration_url, outro_url } = req.body; const timestamp = Date.now(); const files = { intro: intro_${timestamp}.mp3, narration: narration_${timestamp}.mp3, outro: outro_${timestamp}.mp3, final: final_${timestamp}.mp3 };

// Download all three files
await Promise.all([
  downloadFile(intro_url, files.intro),
  downloadFile(narration_url, files.narration),
  downloadFile(outro_url, files.outro)
]);

// Merge using FFmpeg
const mergeCmd = `ffmpeg -i concat:"${files.intro}|${files.narration}|${files.outro}" -acodec copy ${files.final}`;
exec(mergeCmd, (error) => {
  if (error) {
    res.status(500).send({ error: error.message });
  } else {
    res.sendFile(path.resolve(files.final), {}, () => cleanup(files));
  }
});

} catch (err) { res.status(500).send({ error: err.message }); } });

function downloadFile(url, filename) { return fetch(url) .then(res => new Promise((resolve, reject) => { const stream = fs.createWriteStream(filename); res.body.pipe(stream); res.body.on('error', reject); stream.on('finish', resolve); })); }

function cleanup(files) { Object.values(files).forEach(f => fs.unlink(f, () => {})); }

app.listen(process.env.PORT || 3000, () => console.log('FFmpeg webhook running'));

                                                                                                                                                      
