import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const userDataDir = path.resolve('./user_data');

async function testFlyout() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true
  });

  const page = await context.newPage();
  console.log('Navigating to Bing Rewards Panel Flyout...');
  await page.goto('https://www.bing.com/rewards/panelflyout', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const text = await page.innerText('body');
  fs.writeFileSync(path.resolve('./flyout_text.txt'), text, 'utf-8');
  console.log('Saved flyout text to flyout_text.txt');

  // Let's print any text that looks like numbers or categories
  console.log('--- Flyout Body Text (Excerpt) ---');
  console.log(text.slice(0, 1000));

  await context.close();
}

testFlyout().catch(console.error);
