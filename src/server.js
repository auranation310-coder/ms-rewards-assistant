import express from 'express';
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
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

app.listen(port, () => {
  console.log(`========================================================`);
  console.log(`Microsoft Rewards Assistant Dashboard Server Running`);
  console.log(`Navigate to: http://localhost:${port}`);
  console.log(`========================================================`);
});
