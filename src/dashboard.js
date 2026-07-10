import { chromium } from 'playwright';
import path from 'path';

const userDataDir = path.resolve('./user_data');

export async function getDashboardStatus(context = null) {
  let createdContext = false;
  if (!context) {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'msedge',
      headless: true
    });
    createdContext = true;
  }

  const page = await context.newPage();
  
  try {
    console.log('Fetching Microsoft Rewards status...');
    await page.goto('https://www.bing.com/rewards/panelflyout', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    const url = page.url();
    if (url.includes('login.live.com') || url.includes('signup')) {
      return { loggedIn: false };
    }

    // Parse points balance
    const pointsText = await page.locator('.points-value, #balance, body').evaluate(body => {
      // Find the first numbers block which is usually the points
      const bodyText = body.innerText || '';
      const match = bodyText.match(/^([\d,]+)\s*(?:Rewards points|points|pts)/i) || bodyText.match(/([\d,]+)\s+Rewards points/i);
      return match ? match[1].replace(/,/g, '') : null;
    });

    const points = pointsText ? parseInt(pointsText, 10) : null;

    // Parse streak
    const streakText = await page.evaluate(() => {
      const match = document.body.innerText.match(/(\d+)\s*DAYS?\s*DAILY STREAKS/i) || 
                    document.body.innerText.match(/(\d+)\s*DAYS?\s*streak/i) ||
                    document.body.innerText.match(/DAILY STREAKS\s*\|\s*(\d+)\s*DAYS/i);
      return match ? parseInt(match[1], 10) : 0;
    });

    // Parse activities
    const activities = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      const found = [];
      const validPoints = [5, 10, 15, 20, 30, 50, 100];
      
      links.forEach(a => {
        const href = a.href || '';
        const text = a.innerText || '';
        const parentText = a.parentElement ? a.parentElement.innerText : '';
        
        // Skip basic search/appstore downloads
        const isAppStore = href.includes('adjust=') || href.includes('play.google.com') || href.includes('apps.apple.com');
        const isPromoLink = href.includes('form=ML') || href.includes('form=RW') || href.includes('form=CW') || href.includes('spotlight') || href.includes('imagepuzzle') || href.includes('panelflyout') || href.includes('PROGRAMNAME=');
        
        if (isAppStore || !isPromoLink) return;

        // Try to parse points
        let points = 5; // Default fallback points
        const plusMatch = parentText.match(/\+(\d+)/) || text.match(/\+(\d+)/);
        if (plusMatch) {
          points = parseInt(plusMatch[1], 10);
        } else {
          const endMatch = parentText.match(/(?:\n|^)(\d+)$/) || text.match(/(?:\n|^)(\d+)$/);
          if (endMatch) {
            const val = parseInt(endMatch[1], 10);
            if (validPoints.includes(val)) {
              points = val;
            }
          }
        }
        
        // Avoid duplicate links
        if (!found.some(item => item.href === href)) {
          found.push({
            title: text.split('\n')[0] || parentText.split('\n')[0] || 'Reward Activity',
            href: href,
            points: points,
            isQuiz: href.toLowerCase().includes('quiz') || text.toLowerCase().includes('quiz')
          });
        }
      });

      return found;
    });

    const searchProgress = await page.evaluate(() => {
      const bodyText = document.body.innerText || '';
      const alreadyMatch = bodyText.match(/You earned (\d+) points already/i) || bodyText.match(/(\d+) points already/i);
      if (alreadyMatch) {
        return {
          current: parseInt(alreadyMatch[1], 10),
          limit: 30
        };
      }
      const ratioMatch = bodyText.match(/(\d+)\s*\/\s*(\d+)\s*(?:PC Search|search|points)/i) || bodyText.match(/PC Search[^\n]*(\d+)\s*\/\s*(\d+)/i);
      if (ratioMatch) {
        return {
          current: parseInt(ratioMatch[1], 10),
          limit: parseInt(ratioMatch[2], 10)
        };
      }
      return null;
    });

    return {
      loggedIn: true,
      points,
      streak: streakText,
      activities,
      searchProgress
    };

  } catch (error) {
    console.error('Error fetching dashboard status:', error);
    throw error;
  } finally {
    await page.close();
    if (createdContext) {
      await context.close();
    }
  }
}
