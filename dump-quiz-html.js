import { chromium } from 'playwright';
import path from 'path';

const userDataDir = path.resolve('./user_data');
const quizUrl = 'https://www.bing.com/search?q=Bing%20Homepage%20quiz&form=ML2BF1&OCID=ML2BF1&PUBL=RewardsDO&PROGRAMNAME=BingDailyOfferIN&CREA=ML2BF1';

async function dumpQuizHtml() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true
  });

  const page = await context.newPage();
  await page.goto(quizUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Get the HTML of the main container holding the quiz
  // Usually the quiz container has classes starting with btq or similar
  const html = await page.evaluate(() => {
    const el = document.querySelector('.btq_hdr')?.parentElement || document.querySelector('[class*="btq"]');
    return el ? el.outerHTML : 'Quiz container not found';
  });

  console.log('--- Quiz Container HTML ---');
  console.log(html);

  await context.close();
}

dumpQuizHtml().catch(console.error);
