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
    console.log('Fetching random search topics from Wikipedia API...');
    const url = 'https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=60';
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.query && data.query.random) {
        data.query.random.forEach(item => {
          let title = item.title;
          
          // Clean parenthetical annotations: "Ian Irvine (writer)" -> "Ian Irvine"
          title = title.replace(/\s*\(.*?\)\s*/g, '').trim();
          
          // Filter lists and special pages
          const words = title.split(' ');
          const isClean = !title.includes('List of') && 
                          !title.includes('Category:') && 
                          !title.includes('Template:') && 
                          !title.includes('Wikipedia:') &&
                          words.length >= 1 && 
                          words.length <= 5;
          
          if (isClean && !queries.includes(title)) {
            queries.push(title);
          }
        });
      }
    }
  } catch (err) {
    console.warn('Wikipedia API fetch failed:', err.message);
  }

  // Prepend conversational search prefixes
  const prefixes = [
    '', '', '', // 30% no prefix
    'what is ', 'who is ', 'about ', 'history of ', 'definition of ', 
    'meaning of ', 'information on ', 'details about ', 'news on '
  ];

  const processedQueries = queries.map(q => {
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    return `${prefix}${q}`.toLowerCase().trim();
  });

  console.log(`Generated ${processedQueries.length} unique natural search queries.`);

  // If we didn't fetch enough, pad with shuffled fallbacks
  if (processedQueries.length < 50) {
    const shuffleFallbacks = [...fallbackQueries].sort(() => Math.random() - 0.5);
    processedQueries.push(...shuffleFallbacks);
  }

  return processedQueries.sort(() => Math.random() - 0.5);
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

async function searchLoop(context, queries, count, isMobile = false) {
  let successfulSearches = 0;
  let lastPoints = null;
  let queryIndex = 0;
  let consecutiveNoIncrease = 0; // Track consecutive search failures to detect cap limit

  for (let i = 0; i < count; i++) {
    let pointsIncreasedForThisStep = false;
    let retries = 0;
    const maxRetriesPerStep = 3;

    // Stop searching if we hit the daily cap (5 consecutive failed searches)
    if (consecutiveNoIncrease >= 5) {
      console.log(`\n[Limit Reached] Detected 5 consecutive searches with no point increase. Daily search limit is likely reached.`);
      break;
    }

    while (retries < maxRetriesPerStep && !pointsIncreasedForThisStep) {
      const query = queries[queryIndex % queries.length];
      queryIndex++;
      
      console.log(`Searching (${i + 1}/${count}) [Try ${retries + 1}/${maxRetriesPerStep}]: "${query}"`);

      // Open a fresh tab for each search query
      const page = await context.newPage();
      if (isMobile) {
        await page.setViewportSize({ width: 390, height: 844 });
      } else {
        await page.setViewportSize({ width: 1366, height: 768 });
      }

      try {
        // Navigate to Bing homepage
        await page.goto('https://www.bing.com', { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(1500);

        if (lastPoints === null) {
          lastPoints = await getPointsFromSearchPage(page);
          if (lastPoints !== null) {
            console.log(`Starting Points Balance detected on Bing: ${lastPoints} pts`);
          }
        }

        // Locate and click search box
        const searchBox = page.locator('#sb_form_q');
        await searchBox.waitFor({ state: 'visible', timeout: 10000 });
        await searchBox.click();
        await page.waitForTimeout(200);
        
        // Type the query manually with random character intervals
        for (const char of query) {
          await page.keyboard.type(char, { delay: Math.random() * 80 + 40 });
        }
        await page.waitForTimeout(400);
        
        // Execute search
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => {}),
          page.keyboard.press('Enter')
        ]);

        // Human scrolling simulation
        await page.waitForTimeout(2000);
        await page.evaluate(() => {
          window.scrollBy(0, window.innerHeight * (Math.random() * 0.4 + 0.2));
        });
        await page.waitForTimeout(1000);

        // Verify points
        const currentPoints = await getPointsFromSearchPage(page);
        if (currentPoints !== null) {
          if (lastPoints !== null) {
            const diff = currentPoints - lastPoints;
            if (diff > 0) {
              console.log(` -> Points INCREASED: ${currentPoints} pts (+${diff})`);
              lastPoints = currentPoints;
              pointsIncreasedForThisStep = true;
              consecutiveNoIncrease = 0; // Reset counter on success
              successfulSearches++;
            } else {
              console.log(` -> Points remained at: ${currentPoints} pts (No increase)`);
              retries++;
            }
          } else {
            console.log(` -> Current Points: ${currentPoints} pts`);
            lastPoints = currentPoints;
            pointsIncreasedForThisStep = true; // Count first baseline query
            successfulSearches++;
          }
        } else {
          console.log(` -> Could not read points from page.`);
          retries++;
        }
      } catch (err) {
        console.error(`Error searching:`, err.message);
        retries++;
      } finally {
        // Close browser tab immediately
        await page.close();
      }

      // If search failed to award points, wait out search cooldown before retry
      if (!pointsIncreasedForThisStep && retries < maxRetriesPerStep) {
        const retryDelay = 8000 + Math.random() * 4000; // 8 to 12 seconds cooldown buffer
        console.log(`Waiting ${(retryDelay/1000).toFixed(1)} seconds cooldown before retry...`);
        await new Promise(r => setTimeout(r, retryDelay));
      }
    }

    if (!pointsIncreasedForThisStep) {
      consecutiveNoIncrease++;
      console.log(`[Warning] No points awarded for step ${i + 1}. Consecutive fails: ${consecutiveNoIncrease}`);
    }

    // Standard interval delay between successful search steps (6-9 seconds)
    const delay = Math.floor(Math.random() * 3000) + 6000;
    console.log(`Waiting ${(delay/1000).toFixed(1)} seconds before next search step...`);
    await new Promise(r => setTimeout(r, delay));
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
  
  try {
    desktopDone = await searchLoop(desktopContext, queries, desktopCount, false);
  } finally {
    console.log('Closing Desktop session...');
    await desktopContext.close();
  }

  // 2. Run Mobile Searches
  console.log('\n[Phase 2] Launching Edge in Mobile Emulation Mode...');
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

  try {
    mobileDone = await searchLoop(mobileContext, queries.slice(desktopCount), mobileCount, true);
  } finally {
    console.log('Closing Mobile session...');
    await mobileContext.close();
  }

  console.log(`\nBing Searches completed. Desktop: ${desktopDone}/${desktopCount}, Mobile: ${mobileDone}/${mobileCount}`);
  return { desktopDone, mobileDone };
}
