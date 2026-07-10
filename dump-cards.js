import { chromium } from 'playwright';
import path from 'path';

const userDataDir = path.resolve('./user_data');

async function dumpCards() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: true
  });

  const page = await context.newPage();
  await page.goto('https://rewards.bing.com/', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  // Scrape all anchor elements with class, text, and href
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.innerText.trim(),
      href: a.href,
      className: a.className,
      id: a.id,
      parentClass: a.parentElement ? a.parentElement.className : ''
    }));
  });

  console.log('All Links on Page:');
  const rewardLinks = links.filter(l => l.text.includes('+') || l.href.includes('rewards') || l.text.toLowerCase().includes('point') || l.text.toLowerCase().includes('pts'));
  console.log(JSON.stringify(rewardLinks, null, 2));

  // Let's also look for buttons or div cards
  const cards = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.promo-control, .daily-set-card, [data-bi-id], div')).map(el => {
      const text = el.innerText ? el.innerText.trim() : '';
      if ((text.includes('+') && text.length < 100) || el.getAttribute('data-bi-id')) {
        return {
          tagName: el.tagName,
          text: text,
          id: el.id,
          className: el.className,
          biId: el.getAttribute('data-bi-id')
        };
      }
      return null;
    }).filter(Boolean);
  });

  console.log('\nPotential Activity Cards/Elements:');
  console.log(JSON.stringify(cards.slice(0, 50), null, 2));

  await context.close();
}

dumpCards().catch(console.error);
