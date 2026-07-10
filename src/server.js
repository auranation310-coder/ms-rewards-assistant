import express from 'express';
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import ytdl from '@distube/ytdl-core';
import { getDashboardStatus } from './dashboard.js';

const app = express();
const port = 8080;
const userDataDir = path.resolve('./user_data');

app.use(express.static('public'));
app.use(express.json());

// API: Get current status
app.get('/api/status', async (req, res) => {
  console.log('API Request: /api/status');
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'msedge',
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled']
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const status = await getDashboardStatus(context);
    await context.close();
    res.json(status);
  } catch (error) {
    if (context) await context.close();
    console.error('Failed to get status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Start execution and stream logs
app.get('/api/start', (req, res) => {
  console.log('API Request: /api/start (Streaming logs)');
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Spawn node src/index.js --visible (visible Edge browser window)
  const child = spawn('node', ['src/index.js', '--visible'], {
    cwd: process.cwd()
  });

  child.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        res.write(`data: ${line}\n\n`);
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        res.write(`data: [ERROR] ${line}\n\n`);
      }
    });
  });

  child.on('close', (code) => {
    res.write(`data: [FINISHED] Execution completed with code ${code}\n\n`);
    res.end();
  });

  req.on('close', () => {
    console.log('Client closed connection. Killing runner process...');
    child.kill();
  });
});

// API: Downloader - Analyze URL
app.post('/api/downloader/analyze', async (req, res) => {
  const { platform, url } = req.body;
  console.log(`API Request: /api/downloader/analyze (Platform: ${platform})`);

  try {
    if (platform === 'youtube') {
      const info = await ytdl.getInfo(url);
      
      // Grab all formats that contain video
      const videoFormats = info.formats.filter(f => f.hasVideo);

      const formats = videoFormats.map(f => {
        const resolution = f.qualityLabel || 'Default';
        const hasAudio = f.hasAudio;
        const container = f.container || 'mp4';
        
        return {
          quality: `${resolution} ${hasAudio ? '(With Sound)' : '(HD - Audio Merged)'}`,
          itag: f.itag,
          mimeType: f.mimeType.split(';')[0],
          container,
          resolution: f.height || 0
        };
      });

      // Sort formats by resolution (height) in descending order
      formats.sort((a, b) => b.resolution - a.resolution);

      const durationSec = parseInt(info.videoDetails.lengthSeconds, 10);
      const minutes = Math.floor(durationSec / 60);
      const seconds = durationSec % 60;

      res.json({
        title: info.videoDetails.title,
        thumbnail: info.videoDetails.thumbnails[0]?.url,
        duration: `${minutes}m ${seconds}s`,
        formats
      });
    } else if (platform === 'instagram') {
      console.log('Launching browser to scrape Instagram reel...');
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForSelector('video', { timeout: 10000 });
        
        const data = await page.evaluate(() => {
          const video = document.querySelector('video');
          const poster = video ? video.getAttribute('poster') : null;
          return {
            src: video ? video.src : null,
            poster
          };
        });

        await browser.close();

        if (!data.src) {
          throw new Error('Video source URL could not be found.');
        }

        res.json({
          title: 'Instagram Reels Video',
          thumbnail: data.poster || 'https://instagram-brand.com/wp-content/uploads/2016/11/Instagram_AppIcon_Aug2017.png',
          duration: 'N/A',
          formats: [
            { quality: 'Default HD', itag: 'ig-video', url: data.src }
          ]
        });
      } catch (err) {
        if (browser) await browser.close();
        throw err;
      }
    } else {
      res.status(400).json({ error: 'Unsupported platform' });
    }
  } catch (error) {
    console.error('Downloader analysis failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Downloader - Download Stream / Redirect
app.get('/api/downloader/download', async (req, res) => {
  const { platform, url, itag } = req.query;
  console.log(`API Request: /api/downloader/download (Platform: ${platform})`);

  try {
    if (platform === 'youtube') {
      const info = await ytdl.getInfo(url);
      const format = info.formats.find(f => f.itag == itag);
      const title = info.videoDetails.title.replace(/[^a-zA-Z0-9]/g, '_');
      
      // If muxed format (has both audio and video), pipe directly
      if (format.hasAudio && format.hasVideo) {
        res.setHeader('Content-Disposition', `attachment; filename="${title}.mp4"`);
        res.setHeader('Content-Type', 'video/mp4');
        ytdl(url, { format: itag }).pipe(res);
        return;
      }

      // If video-only adaptive format (e.g. 1080p, 4K), merge it with highestaudio
      console.log(`Piping high-quality video (itag ${itag}) and merging with audio...`);
      res.setHeader('Content-Disposition', `attachment; filename="${title}.mp4"`);
      res.setHeader('Content-Type', 'video/mp4');

      const audioFormat = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
      const videoUrl = format.url;
      const audioUrl = audioFormat.url;

      // Spawn FFmpeg and stream directly to response
      const ffmpegProcess = spawn('ffmpeg', [
        '-loglevel', 'error',
        '-i', videoUrl,
        '-i', audioUrl,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov',
        'pipe:1'
      ]);

      ffmpegProcess.stdout.pipe(res);

      ffmpegProcess.stderr.on('data', (data) => {
        console.error(`ffmpeg stderr: ${data.toString()}`);
      });

      req.on('close', () => {
        console.log('Client cancelled download. Killing FFmpeg process...');
        ffmpegProcess.kill();
      });
    } else if (platform === 'instagram') {
      res.redirect(url);
    } else {
      res.status(400).send('Unsupported platform');
    }
  } catch (error) {
    console.error('Download trigger failed:', error.message);
    res.status(500).send(`Download failed: ${error.message}`);
  }
});

app.listen(port, () => {
  console.log(`========================================================`);
  console.log(`Microsoft Rewards Assistant Dashboard Server Running`);
  console.log(`Navigate to: http://localhost:${port}`);
  console.log(`========================================================`);
});
