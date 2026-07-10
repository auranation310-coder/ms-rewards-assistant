import express from 'express';
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { getDashboardStatus } from './dashboard.js';

const app = express();
const port = 8080;
const userDataDir = path.resolve('./user_data');
const ytdlpPath = path.resolve('yt-dlp.exe');

app.use(express.static('public'));
app.use(express.json());

// Helper: Query yt-dlp metadata using spawn to prevent buffer overflows
const getYtDlpInfo = (url) => new Promise((resolve, reject) => {
  const child = spawn(ytdlpPath, ['-J', url]);
  let stdout = '';
  let stderr = '';
  
  child.stdout.on('data', data => stdout += data);
  child.stderr.on('data', data => stderr += data);
  
  child.on('close', (code) => {
    if (code === 0) {
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new Error('Failed to parse yt-dlp metadata JSON'));
      }
    } else {
      reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`));
    }
  });
});

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
        res.write('data: ' + line + '\n\n');
      }
    });
  });

  child.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        res.write('data: [ERROR] ' + line + '\n\n');
      }
    });
  });

  child.on('close', (code) => {
    res.write('data: [FINISHED] Execution completed with code ' + code + '\n\n');
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
      const info = await getYtDlpInfo(url);
      
      // Get best audio size to add to video-only sizes
      const audioFormats = info.formats.filter(f => f.vcodec === 'none' && f.acodec !== 'none');
      audioFormats.sort((a, b) => (b.abr || 0) - (a.abr || 0));
      const bestAudio = audioFormats[0];
      const audioSize = bestAudio ? (bestAudio.filesize || bestAudio.filesize_approx || 0) : 0;

      // Filter formats containing video
      const videoFormats = info.formats.filter(f => f.vcodec !== 'none');

      const formats = videoFormats.map(f => {
        const resolution = f.format_note || `${f.height}p`;
        const hasAudio = f.acodec !== 'none';
        const container = f.ext || 'mp4';
        
        const videoSize = f.filesize || f.filesize_approx || 0;
        const totalSize = hasAudio ? videoSize : (videoSize > 0 ? videoSize + audioSize : 0);

        return {
          quality: `${resolution} ${hasAudio ? '(With Sound)' : '(HD - Audio Merged)'}`,
          itag: f.format_id,
          mimeType: f.vcodec,
          container,
          resolution: f.height || 0,
          sizeBytes: totalSize
        };
      });

      // Filter duplicates by resolution and audio status
      const uniqueFormats = [];
      const seen = new Set();
      formats.forEach(f => {
        const key = `${f.resolution}_${f.quality.includes('With Sound')}`;
        if (!seen.has(key) && f.resolution > 0) {
          seen.add(key);
          uniqueFormats.push(f);
        }
      });

      // Sort formats by resolution in descending order
      uniqueFormats.sort((a, b) => b.resolution - a.resolution);

      const durationSec = parseInt(info.duration || 0, 10);
      const minutes = Math.floor(durationSec / 60);
      const seconds = durationSec % 60;

      res.json({
        title: info.title,
        thumbnail: info.thumbnail,
        duration: `${minutes}m ${seconds}s`,
        formats: uniqueFormats
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
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    if (platform === 'youtube') {
      const info = await getYtDlpInfo(url);
      const title = info.title.replace(/[^a-zA-Z0-9]/g, '_');
      
      const tempDir = path.resolve('./temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir);
      }

      const mergedOut = path.join(tempDir, `m_${itag}_${Date.now()}.mp4`);
      
      console.log(`Running yt-dlp download for format ${itag}...`);
      
      // Spawn yt-dlp to download selected video format and merge with best audio
      const ytDlpProcess = spawn(ytdlpPath, [
        '-f', `${itag}+bestaudio/best`,
        '--merge-output-format', 'mp4',
        url,
        '-o', mergedOut
      ]);

      await new Promise((resolve, reject) => {
        ytDlpProcess.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`yt-dlp download exited with code ${code}`));
        });
        ytDlpProcess.on('error', reject);
      });

      console.log('Sending merged file to client...');
      res.download(mergedOut, `${title}.mp4`, (err) => {
        try {
          if (fs.existsSync(mergedOut)) fs.unlinkSync(mergedOut);
          console.log('Temporary files cleaned up successfully.');
        } catch (cleanupErr) {
          console.error('Failed to clean up temp files:', cleanupErr.message);
        }
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
