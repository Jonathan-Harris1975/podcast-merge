const express = require('express');
const fs = require('fs');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const { v4: uuidv4 } = require('uuid');
const app = express();

app.use(express.json());

app.post('/merge', async (req, res) => {
  try {
    const { intro_url, narration_url, outro_url } = req.body;
    const timestamp = Date.now();
    const files = {
      intro: `intro_${timestamp}.mp3`,
      narration: `narration_${timestamp}.mp3`,
      outro: `outro_${timestamp}.mp3`,
      final: `final_${timestamp}.mp3`
    };

    const download = async (url, path) => {
      const response = await axios({ url, method: 'GET', responseType: 'stream' });
      return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(path);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    };

    await Promise.all([
      download(intro_url, files.intro),
      download(narration_url, files.narration),
      download(outro_url, files.outro)
    ]);

    ffmpeg()
      .input(files.intro)
      .input(files.narration)
      .input(files.outro)
      .on('end', () => {
        res.sendFile(`${__dirname}/${files.final}`, {}, (err) => {
          Object.values(files).forEach(f => fs.unlinkSync(f));
          if (err) console.error('Send error:', err);
        });
      })
      .on('error', err => {
        console.error('FFmpeg error:', err);
        res.status(500).send('Error processing audio');
      })
      .mergeToFile(files.final, './temp');
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).send('Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
