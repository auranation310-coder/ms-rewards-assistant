import { chromium } from 'playwright';
import path from 'path';

const userDataDir = path.resolve('./user_data');

async function dumpFlyoutLinks() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true
  });

  const page = await context.newPage();
  console.log('Navigating to Bing Rewards Panel Flyout...');
  await page.goto('https://www.bing.com/rewards/panelflyout', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Scrape all links inside the flyout
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => {
      // Find the closest text container or title
      let parentText = a.parentElement ? a.parentElement.innerText.trim() : '';
      return {
        text: a.innerText.trim(),
        href: a.href,
        parentText: parentText.slice(0, 200), // Limit length
        className: a.className
      };
    });
  });

  console.log('--- Links in Flyout ---');
  console.log(JSON.stringify(links, null, 2));

  await context.close();
}

dumpFlyoutLinks().catch(console.error);
