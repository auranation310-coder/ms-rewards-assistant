import { getDashboardStatus } from './dashboard.js';
import { runAllSearches } from './search.js';
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const userDataDir = path.resolve('./user_data');

async function testSingleSearch(headless = true, delayMultiplier = 1) {
  console.log(`[Verify] Performing 1 verification search...`);
  // We run a single desktop search
  await runAllSearches(1, 0, headless);
}

async function verifyAndCorrect() {
  console.log('========================================================');
  console.log('Microsoft Rewards - Autonomous Self-Correction & Verification');
  console.log('========================================================');

  let attempts = 3;
  let currentAttempt = 1;

  while (currentAttempt <= attempts) {
    console.log(`\n[Attempt ${currentAttempt}/${attempts}] Starting verification...`);

    // 1. Check current points and search progress
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'msedge',
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled']
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    let statusBefore;
    try {
      statusBefore = await getDashboardStatus(context);
    } catch (err) {
      console.error('Failed to get status:', err.message);
      await context.close();
      return;
    } finally {
      await context.close();
    }

    if (!statusBefore.loggedIn) {
      console.error('⚠️ Not logged in to Microsoft Rewards. Please run "npm run login" first.');
      return;
    }

    console.log(`Current Balance: ${statusBefore.points} pts`);
    if (statusBefore.searchProgress) {
      console.log(`Search Progress: ${statusBefore.searchProgress.current}/${statusBefore.searchProgress.limit} pts`);
      if (statusBefore.searchProgress.current >= statusBefore.searchProgress.limit) {
        console.log('🎉 Your daily search limit is already fully completed! Points cannot increase further today.');
        console.log('The verification script confirmed everything is fully loaded and complete.');
        fs.writeFileSync('verify_result.json', JSON.stringify({
          success: true,
          balanceBefore: statusBefore.points,
          balanceAfter: statusBefore.points,
          searchProgressBefore: statusBefore.searchProgress,
          searchProgressAfter: statusBefore.searchProgress,
          isLimitReached: true,
          message: 'Your daily search limit is already fully completed! Points cannot increase further today.'
        }, null, 2));
        return;
      }
    } else {
      console.log('Could not retrieve search progress ratio (likely already completed or pending reset).');
    }

    // 2. Perform a test search
    try {
      await testSingleSearch(true);
    } catch (err) {
      console.error('Test search failed:', err.message);
    }

    // Wait 5 seconds for points to sync
    console.log('Waiting 5 seconds for points to sync on Microsoft servers...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 3. Check points again
    const finalContext = await chromium.launchPersistentContext(userDataDir, {
      channel: 'msedge',
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled']
    });

    await finalContext.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    let statusAfter;
    try {
      statusAfter = await getDashboardStatus(finalContext);
    } catch (err) {
      console.error('Failed to get final status:', err.message);
    } finally {
      await finalContext.close();
    }

    if (statusAfter && statusBefore) {
      const diff = statusAfter.points - statusBefore.points;
      const progressDiff = (statusAfter.searchProgress && statusBefore.searchProgress) 
        ? (statusAfter.searchProgress.current - statusBefore.searchProgress.current) 
        : 0;

      if (diff > 0 || progressDiff > 0) {
        console.log(`\n✅ SUCCESS: Points increased! (${statusBefore.points} -> ${statusAfter.points} pts)`);
        console.log('The rewards automation is fully functional and successfully earning points!');
        fs.writeFileSync('verify_result.json', JSON.stringify({
          success: true,
          balanceBefore: statusBefore.points,
          balanceAfter: statusAfter.points,
          searchProgressBefore: statusBefore.searchProgress,
          searchProgressAfter: statusAfter.searchProgress,
          isLimitReached: false,
          message: 'SUCCESS: Points increased successfully!'
        }, null, 2));
        return;
      } else {
        console.log(`\n❌ Verification failed: Points remained at ${statusAfter.points} pts.`);
        console.log('Applying automated corrections to bypass bot blocks...');
        
        // Apply code corrections
        await applyCorrection(currentAttempt);
        currentAttempt++;
      }
    }
  }

  console.log('\n⚠️ Reached maximum correction attempts. Please ensure your search reset time (2:30 PM IST) has passed so Microsoft allows earning search points.');
  fs.writeFileSync('verify_result.json', JSON.stringify({
    success: false,
    isLimitReached: false,
    message: 'Verification failed: Points did not increase after maximum attempts. Check reset time.'
  }, null, 2));
}

async function applyCorrection(attempt) {
  const searchFilePath = path.resolve('src/search.js');
  let searchCode = fs.readFileSync(searchFilePath, 'utf8');

  if (attempt === 1) {
    console.log('Correction 1: Adding a real-user desktop User-Agent string to bypass User-Agent checks...');
    // Replace launch desktop persistent context code to include a premium user agent
    searchCode = searchCode.replace(
      "headless: headless,",
      `headless: headless,\n    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',`
    );
    fs.writeFileSync(searchFilePath, searchCode, 'utf8');
    console.log('Stealth User-Agent applied to src/search.js.');
  } else if (attempt === 2) {
    console.log('Correction 2: Injecting full human-like mouse gestures and slower typing delays...');
    // Increase delay in search.js typing speed
    searchCode = searchCode.replace(
      "await searchBox.fill(query);",
      "await page.locator('#sb_form_q').click();\n      for (const char of query) {\n        await page.keyboard.type(char, { delay: Math.random() * 80 + 40 });\n      }"
    );
    fs.writeFileSync(searchFilePath, searchCode, 'utf8');
    console.log('Human typing keyboard delay injection applied to src/search.js.');
  }
}

verifyAndCorrect().catch(console.error);
