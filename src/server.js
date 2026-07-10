import express from 'express';
import { spawn, exec } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import * as cheerio from 'cheerio';
import { getDashboardStatus } from './dashboard.js';

const app = express();
const port = 8080;
const userDataDir = path.resolve('./user_data');
const ytdlpPath = path.resolve('yt-dlp.exe');

app.use(express.static('public'));
app.use(express.json());

// Global state for active downloads
const activeDownloads = new Map();

function updateProgress(id, percent, status, filePath = '') {
  const download = activeDownloads.get(id);
  if (!download) return;
  download.percent = percent;
  download.status = status;
  if (filePath) download.filePath = filePath;
  
  // Notify all SSE listeners
  download.listeners.forEach(res => {
    res.write(`data: ${JSON.stringify({ percent, status })}\n\n`);
  });
}

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

// API: Downloader - Start Download Process
app.post('/api/downloader/start-download', async (req, res) => {
  const { platform, url, itag } = req.body;
  console.log(`API Request: /api/downloader/start-download (Platform: ${platform})`);

  try {
    if (platform === 'instagram') {
      // Instagram is a direct redirect link, no background task needed
      res.json({ status: 'redirect', url: `/api/downloader/file?platform=instagram&url=${encodeURIComponent(url)}` });
      return;
    }

    const info = await getYtDlpInfo(url);
    const title = info.title.replace(/[^a-zA-Z0-9]/g, '_');
    
    const downloadId = 'dl_' + Date.now();
    
    // Initialize active download structure
    activeDownloads.set(downloadId, {
      percent: 0,
      status: 'downloading',
      filePath: '',
      listeners: []
    });

    res.json({ status: 'started', downloadId });

    // Execute yt-dlp in the background
    const tempDir = path.resolve('./temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }
    const mergedOut = path.join(tempDir, `m_${itag}_${Date.now()}_${title}.mp4`);

    console.log(`[${downloadId}] Starting background download for format ${itag}...`);

    const ytDlpProcess = spawn(ytdlpPath, [
      '-f', `${itag}+bestaudio/best`,
      '--merge-output-format', 'mp4',
      url,
      '-o', mergedOut
    ]);

    ytDlpProcess.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        // Parse download percentage from yt-dlp (e.g. "[download]  23.4% of...")
        const match = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(line);
        if (match) {
          const percent = parseFloat(match[1]);
          updateProgress(downloadId, percent, 'downloading');
        }
        if (line.includes('[Merger]') || line.includes('Merging formats')) {
          updateProgress(downloadId, 100, 'merging');
        }
      });
    });

    ytDlpProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`[${downloadId}] Download completed and merged successfully.`);
        updateProgress(downloadId, 100, 'finished', mergedOut);
      } else {
        console.error(`[${downloadId}] Download failed with exit code ${code}`);
        updateProgress(downloadId, 0, 'error');
      }
    });

    ytDlpProcess.on('error', (err) => {
      console.error(`[${downloadId}] Download process crashed:`, err.message);
      updateProgress(downloadId, 0, 'error');
    });

  } catch (error) {
    console.error('Failed to initiate download:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: Downloader - Progress Stream (SSE)
app.get('/api/downloader/progress', (req, res) => {
  const { id } = req.query;
  const download = activeDownloads.get(id);
  
  if (!download) {
    res.status(404).end();
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Add client to listeners
  download.listeners.push(res);

  // Send initial state immediately
  res.write(`data: ${JSON.stringify({ percent: download.percent, status: download.status })}\n\n`);

  req.on('close', () => {
    const d = activeDownloads.get(id);
    if (d) {
      d.listeners = d.listeners.filter(l => l !== res);
    }
  });
});

// API: Downloader - Fetch compiled File (or trigger instagram redirects)
app.get('/api/downloader/file', (req, res) => {
  const { id, platform, url } = req.query;
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');

  if (platform === 'instagram') {
    console.log('Redirecting client to Instagram source...');
    res.redirect(url);
    return;
  }

  const download = activeDownloads.get(id);
  if (!download || download.status !== 'finished') {
    res.status(400).send('File is not ready or has expired.');
    return;
  }

  console.log(`Serving file for download ID ${id}...`);
  const originalTitle = path.basename(download.filePath).replace(/^m_\w+_\d+_\d+__?/, '');

  res.download(download.filePath, originalTitle, (err) => {
    // Delete temp file after transfer completes
    try {
      if (fs.existsSync(download.filePath)) {
        fs.unlinkSync(download.filePath);
      }
      activeDownloads.delete(id);
      console.log(`Cleaned up temporary download ID ${id}`);
    } catch (cleanupErr) {
      console.error('Failed to clean up temp file:', cleanupErr.message);
    }
  });
});

// API: Loot - Fetch Telegram channel updates
app.get('/api/loot/updates', async (req, res) => {
  console.log('API Request: /api/loot/updates (Native fetch + Cheerio)');
  try {
    const response = await fetch('https://t.me/s/subho9239', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Telegram returned status ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    
    const messages = [];

    $('.tgme_widget_message').each((i, el) => {
      const textEl = $(el).find('.tgme_widget_message_text');
      const dateEl = $(el).find('.tgme_widget_message_date time');
      const photoEl = $(el).find('.tgme_widget_message_photo_wrap');
      const linkEl = $(el).find('.tgme_widget_message_date');
      
      let imageUrl = '';
      if (photoEl.length > 0) {
        const style = photoEl.attr('style') || '';
        const match = /url\(['"]?(.+?)['"]?\)/.exec(style);
        if (match) {
          imageUrl = match[1];
        }
      }

      let postLink = '';
      if (linkEl.length > 0) {
        postLink = linkEl.attr('href') || '';
      }

      if (textEl.length > 0) {
        messages.push({
          text: textEl.html(), // Keep HTML formatting
          date: dateEl.text() || 'Recent',
          datetime: dateEl.attr('datetime') || null,
          image: imageUrl,
          link: postLink
        });
      }
    });

    // Return latest 15 posts, newest first
    const latestMessages = messages.slice(-15).reverse();

    res.json({ messages: latestMessages });
  } catch (error) {
    console.error('Loot updates fetch failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// API: PC Health - Retrieve system specs, storage, and CPU thermal zone status
app.get('/api/health/stats', async (req, res) => {
  console.log('API Request: /api/health/stats');
  
  const runPowerShell = (cmd) => new Promise((resolve) => {
    exec(cmd, { shell: 'powershell.exe' }, (error, stdout, stderr) => {
      if (error) {
        resolve(null);
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (err) {
          // If not valid JSON, return as string
          resolve(stdout.trim());
        }
      }
    });
  });

  try {
    // 1. Fetch drives
    const diskData = await runPowerShell('Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object DeviceID, Size, FreeSpace | ConvertTo-Json -Compress');
    
    // 2. Fetch CPU
    const cpuData = await runPowerShell('Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores | ConvertTo-Json -Compress');
    
    // 3. Fetch OS
    const osData = await runPowerShell('Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, OSArchitecture | ConvertTo-Json -Compress');
    
    // 4. Fetch Temperature (requires admin, returns null/empty if blocked)
    const tempData = await runPowerShell('Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object CurrentTemperature | ConvertTo-Json -Compress');

    // Format CPU Name
    let cpuName = 'Unknown Processor';
    let cpuCores = 'N/A';
    if (cpuData) {
      const cpuObj = Array.isArray(cpuData) ? cpuData[0] : cpuData;
      cpuName = cpuObj.Name || cpuName;
      cpuCores = cpuObj.NumberOfCores ? `${cpuObj.NumberOfCores} Cores` : cpuCores;
    }

    // Format OS Name
    let osName = 'Windows OS';
    if (osData) {
      const osObj = Array.isArray(osData) ? osData[0] : osData;
      osName = `${osObj.Caption || 'Windows'} (${osObj.OSArchitecture || '64-bit'})`;
    }

    // Format CPU Temperature
    let temperature = 'N/A';
    if (tempData) {
      const tempK = Array.isArray(tempData) ? tempData[0]?.CurrentTemperature : tempData.CurrentTemperature;
      if (tempK) {
        // Kelvin to Celsius conversion
        const tempC = (tempK / 10) - 273.15;
        temperature = `${tempC.toFixed(1)}°C`;
      }
    }

    // Format Uptime
    const uptimeSec = os.uptime();
    const days = Math.floor(uptimeSec / (3600 * 24));
    const hours = Math.floor((uptimeSec % (3600 * 24)) / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const uptimeStr = `${days}d ${hours}h ${mins}m`;

    // RAM stats
    const totalRam = os.totalmem();
    const freeRam = os.freemem();

    // Map disks cleanly
    let disks = [];
    if (diskData) {
      const list = Array.isArray(diskData) ? diskData : [diskData];
      disks = list.map(d => ({
        drive: d.DeviceID,
        sizeBytes: d.Size,
        freeBytes: d.FreeSpace
      }));
    }

    res.json({
      os: osName,
      cpu: cpuName,
      cores: cpuCores,
      uptime: uptimeStr,
      temp: temperature,
      ram: {
        total: totalRam,
        free: freeRam
      },
      disks
    });
  } catch (error) {
    console.error('Failed to retrieve health stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`========================================================`);
  console.log(`Microsoft Rewards Assistant Dashboard Server Running`);
  console.log(`Navigate to: http://localhost:${port}`);
  console.log(`========================================================`);
});
