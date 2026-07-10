import { chromium } from 'playwright';
import path from 'path';
import { getDashboardStatus } from './src/dashboard.js';
import { completeActivities } from './src/activities.js';

const userDataDir = path.resolve('./user_data');

async function testHeadful() {
  console.log('Launching Edge in HEADFUL mode...');
  // Force headful mode to emulate a real user session
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false, // Show browser GUI
    viewport: null
  });

  try {
    const initial = await getDashboardStatus(context);
    console.log(`Starting Balance: ${initial.points} pts`);
    console.log(`Available Activities: ${initial.activities.length}`);

    if (initial.activities.length > 0) {
      console.log('Completing activities in headful window...');
      const completed = await completeActivities(context, initial.activities);
      console.log('Completed:', completed);

      console.log('Waiting 5 seconds to sync...');
      await context.pages()[0].waitForTimeout(5000);

      // Check final status
      const final = await getDashboardStatus(context);
      console.log(`Ending Balance  : ${final.points} pts`);
      console.log(`Points Gained   : ${final.points - initial.points} pts`);
    } else {
      console.log('No activities available to test.');
    }
  } catch (err) {
    console.error('Error during headful test:', err);
  } finally {
    console.log('Closing browser...');
    await context.close();
  }
}

testHeadful();
