import { chromium } from 'playwright';
import path from 'path';

const userDataDir = path.resolve('./user_data');

// List of fallback search terms in case the RSS feed fails
const fallbackQueries = [
  'weather today', 'world news', 'best movies on netflix', 'healthy dinner recipes',
  'how to learn python', 'cricket match score', 'latest mobile phones 2026',
  'how to meditate for beginners', 'stock market today', 'diy home improvement ideas',
  'top travel destinations', 'space exploration news', 'history of ancient rome',
  'easy breakfast options', 'benefits of drinking water', 'how to repair a leaky faucet',
  'artificial intelligence trends', 'best books to read', 'workout routines at home',
  'electric vehicles comparison', 'local restaurants near me', 'how to grow tomatoes',
  'mindfulness meditation steps', 'interesting history facts', 'simple guitar chords',
  'best video editing software', 'how to bake chocolate cake', 'natural home remedies for cold',
  'climate change solutions', 'cryptocurrency news today', 'web design inspiration',
  'photography tips for beginners', 'yoga poses for flexibility', 'best budget laptops 2026',
  'how to save money daily', 'popular board games', 'science facts about space',
  'world cup qualifiers', 'gardening tools list', 'healthy snack options'
];

async function fetchTrendingQueries() {
  const queries = [];
  try {
    console.log('Fetching daily trending queries from Google Trends...');
    const response = await fetch('https://trends.google.com/trends/trendingsearches/daily/rss?geo=IN');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const text = await response.text();
    
    // Parse titles using regex (avoiding XML parse dependencies)
    const matches = text.matchAll(/<title>(.*?)<\/title>/g);
    for (const match of matches) {
      const title = match[1].trim();
      if (title && title !== 'Daily Trending Searches' && !title.includes('Google Trends') && !queries.includes(title)) {
        // Decode HTML entities
        const decoded = title
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        queries.push(decoded);
      }
    }
    console.log(`Successfully fetched ${queries.length} trending queries.`);
  } catch (error) {
    console.warn('Could not fetch Google Trends RSS, using local fallback queries:', error.message);
  }

  // Combine and shuffle queries
  const finalPool = [...queries, ...fallbackQueries];
  return finalPool.sort(() => Math.random() - 0.5);
}

async function getPointsFromSearchPage(page) {
  try {
    const pointsText = await page.evaluate(() => {
      const el = document.getElementById('id_rc') || document.getElementById('id_rh_w') || document.querySelector('.points-container');
      return el ? el.innerText.trim().replace(/,/g, '') : null;
    });
    return pointsText ? parseInt(pointsText, 10) : null;
  } catch (e) {
    return null;
  }
}

async function searchLoop(page, queries, count) {
  let successfulSearches = 0;
  
  // Navigate to Bing homepage first to establish referrer context
  try {
    console.log('Navigating to Bing homepage...');
    await page.goto('https://www.bing.com', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
  } catch (err) {
    console.warn('Initial homepage load failed, will try direct search:', err.message);
  }

  // Get initial points from current page if any
  let lastPoints = await getPointsFromSearchPage(page);
  if (lastPoints !== null) {
    console.log(`Starting Points Balance detected on Bing: ${lastPoints} pts`);
  }
  
  for (let i = 0; i < count; i++) {
    const query = queries[i % queries.length];
    console.log(`Searching (${i + 1}/${count}): "${query}"`);

    try {
      // Find search box
      const searchBox = page.locator('#sb_form_q');
      
      // If search box is not found or not visible, go back to homepage
      if (!(await searchBox.isVisible())) {
        await page.goto('https://www.bing.com', { waitUntil: 'load', timeout: 60000 });
        await page.waitForTimeout(2000);
      }
      
      // Focus, clear, and type the query
      await searchBox.click();
      await searchBox.fill('');
      await page.waitForTimeout(300);
      await page.locator('#sb_form_q').click();
      for (const char of query) {
        await page.keyboard.type(char, { delay: Math.random() * 80 + 40 });
      }
      await page.waitForTimeout(500);
      
      // Press Enter to trigger search
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'load', timeout: 60000 }).catch(() => {}),
        page.keyboard.press('Enter')
      ]);

      // Random human-like scrolling behavior
      await page.waitForTimeout(2000);
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight * (Math.random() * 0.5 + 0.2));
      });
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        window.scrollBy(0, -window.innerHeight * (Math.random() * 0.2));
      });

      successfulSearches++;

      // Check points update
      const currentPoints = await getPointsFromSearchPage(page);
      if (currentPoints !== null) {
        if (lastPoints !== null) {
          const diff = currentPoints - lastPoints;
          if (diff > 0) {
            console.log(` -> Points INCREASED: ${currentPoints} pts (+${diff})`);
            lastPoints = currentPoints;
          } else {
            console.log(` -> Points remained at: ${currentPoints} pts (No increase - limit may be reached or pending sync)`);
          }
        } else {
          console.log(` -> Current Points: ${currentPoints} pts`);
          lastPoints = currentPoints;
        }
      }
    } catch (err) {
      console.error(`Error searching for "${query}":`, err.message);
    }

    // Wait a random duration between 4 and 8 seconds to look human
    const delay = Math.floor(Math.random() * 4000) + 4000;
    console.log(`Waiting ${Math.round(delay/1000)} seconds before next search...`);
    await page.waitForTimeout(delay);
  }

  return successfulSearches;
}

export async function runAllSearches(desktopCount = 35, mobileCount = 25, headless = true) {
  const queries = await fetchTrendingQueries();
  
  console.log(`=========================================`);
  console.log(`Starting Daily Bing Searches`);
  console.log(`Desktop: ${desktopCount} | Mobile: ${mobileCount}`);
  console.log(`=========================================`);

  let desktopDone = 0;
  let mobileDone = 0;

  // 1. Run Desktop Searches
  console.log('\n[Phase 1] Launching Edge in Desktop Mode...');
  const desktopContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: headless,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled']
  });

  // Remove webdriver property from navigator object
  await desktopContext.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });
  
  const desktopPage = await desktopContext.newPage();
  // Set window size
  await desktopPage.setViewportSize({ width: 1366, height: 768 });
  
  try {
    desktopDone = await searchLoop(desktopPage, queries, desktopCount);
  } finally {
    console.log('Closing Desktop session...');
    await desktopContext.close();
  }

  // 2. Run Mobile Searches
  console.log('\n[Phase 2] Launching Edge in Mobile Emulation Mode...');
  // Launch with Mobile User Agent and viewport
  const mobileContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: headless,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    viewport: { width: 390, height: 844 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled']
  });

  // Remove webdriver property from navigator object
  await mobileContext.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const mobilePage = await mobileContext.newPage();

  try {
    mobileDone = await searchLoop(mobilePage, queries.slice(desktopCount), mobileCount);
  } finally {
    console.log('Closing Mobile session...');
    await mobileContext.close();
  }

  console.log(`\nBing Searches completed. Desktop: ${desktopDone}/${desktopCount}, Mobile: ${mobileDone}/${mobileCount}`);
  return { desktopDone, mobileDone };
}
