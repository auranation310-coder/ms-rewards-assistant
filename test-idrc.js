import { chromium } from 'playwright';
import path from 'path';

const userDataDir = path.resolve('./user_data');

async function testIdRc() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true
  });

  const page = await context.newPage();
  console.log('Navigating to Bing search page...');
  await page.goto('https://www.bing.com/search?q=weather+today', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Find all elements containing current points or matching selectors
  const matchedElements = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    return els.map(el => {
      const text = el.innerText ? el.innerText.trim() : '';
      const cls = el.className;
      const isClsString = typeof cls === 'string';
      
      if (text.includes('6,7') || text.includes('67') || el.id === 'id_rc' || (isClsString && cls.includes('id_rc'))) {
        return {
          tagName: el.tagName,
          id: el.id,
          className: isClsString ? cls : 'non-string-class',
          text: text.slice(0, 100)
        };
      }
      return null;
    }).filter(Boolean);
  });

  console.log('--- Matched Elements for Points Balance ---');
  console.log(JSON.stringify(matchedElements, null, 2));

  await context.close();
}

testIdRc().catch(console.error);
