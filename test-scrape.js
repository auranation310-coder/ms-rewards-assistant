import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const userDataDir = path.resolve('./user_data');

async function testScrape() {
  console.log('Launching browser...');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true // Run headless to test automated execution
  });

  const page = await context.newPage();
  
  console.log('Navigating to Microsoft Rewards...');
  await page.goto('https://rewards.bing.com/', { waitUntil: 'networkidle', timeout: 60000 });

  // Wait a bit for dynamic content
  await page.waitForTimeout(5000);

  // Check if we are redirected to login
  const url = page.url();
  console.log(`Current URL: ${url}`);

  if (url.includes('login.live.com')) {
    console.log('WARNING: Session not logged in. Redirected to login page.');
  } else {
    console.log('Successfully reached Microsoft Rewards dashboard!');
    
    // Save screenshot
    const screenshotPath = path.resolve('./screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Saved screenshot to: ${screenshotPath}`);

    // Dump page text
    const text = await page.innerText('body');
    fs.writeFileSync(path.resolve('./body_text.txt'), text, 'utf-8');
    console.log('Saved page text content to body_text.txt');
  }

  await context.close();
}

testScrape().catch(console.error);
