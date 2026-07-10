import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const userDataDir = path.resolve('./user_data');
// This is the Option C href from the dumped HTML
const q2Url = 'https://www.bing.com/search?q=L%C3%A0o+Cai&filters=mgzv3configlist%3A%22BingQA_Quiz_layout%22+dw_answerstobesuppressed%3A%22ConversationalSearch%22+IsConversation%3A%22True%22+WQOskey%3A%22HPQuiz_20260709_SapaVietnam%22+WQId%3A%221%22+WQQI%3A%221%22+WQCI%3A%220%22+ShowTimesTaskPaneTrigger%3A%22false%22+WQSCORE%3A%221%22&FORM=CWQHYL&rnoreward=1&skipopalnative=true';

async function testQ2() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true
  });

  const page = await context.newPage();
  console.log(`Navigating to Q2 URL: ${q2Url}`);
  await page.goto(q2Url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Take screenshot
  await page.screenshot({ path: path.resolve('./q2_screenshot.png') });
  console.log('Saved Q2 screenshot.');

  // Dump text
  const text = await page.innerText('body');
  fs.writeFileSync(path.resolve('./q2_text.txt'), text, 'utf-8');
  console.log('Saved Q2 body text to q2_text.txt');

  // Let's dump all class names on the page that contain 'btq' or 'quiz'
  const classes = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    const matched = [];
    els.forEach(el => {
      const cls = el.className || '';
      if (typeof cls === 'string' && (cls.includes('btq') || cls.includes('quiz'))) {
        matched.push({
          tagName: el.tagName,
          className: cls,
          text: el.innerText ? el.innerText.trim().slice(0, 50) : ''
        });
      }
    });
    return matched;
  });
  console.log('Matched classes on Q2 page:', classes);

  await context.close();
}

testQ2().catch(console.error);
