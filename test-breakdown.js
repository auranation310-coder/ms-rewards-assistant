import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const userDataDir = path.resolve('./user_data');

async function testBreakdown() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true
  });

  const page = await context.newPage();
  console.log('Navigating to Points Breakdown...');
  await page.goto('https://rewards.bing.com/pointsbreakdown', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  const url = page.url();
  console.log(`Current URL: ${url}`);

  // Dump text
  const text = await page.innerText('body');
  fs.writeFileSync(path.resolve('./breakdown_text.txt'), text, 'utf-8');
  console.log('Saved breakdown text to breakdown_text.txt');

  // Let's also search for JSON data on the page
  const pageContent = await page.content();
  const jsonMatches = pageContent.match(/var\s+(?:dashboard|userStatus|pointsBreakdown)\s*=\s*(\{.*?\});/s) || 
                      pageContent.match(/dashboardData\s*:\s*(\{.*?\})/s);
  
  if (jsonMatches) {
    console.log('Found embedded JSON data!');
    fs.writeFileSync(path.resolve('./embedded_data.json'), jsonMatches[1], 'utf-8');
  } else {
    console.log('No direct embedded JSON found via simple regex.');
  }

  // Dump all div/span elements with numbers
  const divs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('div, span, p')).map(el => {
      const text = el.innerText ? el.innerText.trim() : '';
      if (text.includes('/') && text.length < 50) {
        return text;
      }
      return null;
    }).filter(Boolean);
  });
  console.log('Fraction-like elements on page (potential counters):', divs);

  await context.close();
}

testBreakdown().catch(console.error);
