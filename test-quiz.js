import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const userDataDir = path.resolve('./user_data');
const quizUrl = 'https://www.bing.com/search?q=Bing%20Homepage%20quiz&form=ML2BF1&OCID=ML2BF1&PUBL=RewardsDO&PROGRAMNAME=BingDailyOfferIN&CREA=ML2BF1';

async function testQuiz() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true
  });

  const page = await context.newPage();
  console.log(`Navigating to Quiz URL: ${quizUrl}`);
  await page.goto(quizUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Save screenshot of the quiz area
  await page.screenshot({ path: path.resolve('./quiz_screenshot.png'), fullPage: false });
  console.log('Saved quiz screenshot.');

  // Dump text of potential quiz elements
  const text = await page.innerText('body');
  fs.writeFileSync(path.resolve('./quiz_text.txt'), text, 'utf-8');
  console.log('Saved quiz body text to quiz_text.txt');

  // Let's find any buttons, radio choices, or clickable options
  const elements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, button, a, div')).map(el => {
      const txt = el.innerText ? el.innerText.trim() : '';
      if (el.tagName === 'INPUT' || el.tagName === 'BUTTON' || (txt.length > 0 && txt.length < 100 && (txt.includes('?') || el.className.includes('quiz') || el.id.includes('quiz') || el.className.includes('option')))) {
        return {
          tagName: el.tagName,
          text: txt,
          id: el.id,
          className: el.className
        };
      }
      return null;
    }).filter(Boolean);
  });

  console.log('--- Potential Quiz Selectors/Elements ---');
  console.log(JSON.stringify(elements.slice(0, 50), null, 2));

  await context.close();
}

testQuiz().catch(console.error);
