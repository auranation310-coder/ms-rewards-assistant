import { getDashboardStatus } from './dashboard.js';
import { completeActivities } from './activities.js';
import { runAllSearches } from './search.js';
import { sendTelegramNotification } from './telegram.js';
import { chromium } from 'playwright';
import path from 'path';

const userDataDir = path.resolve('./user_data');

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const noSearch = args.includes('--no-search');
  const noActivities = args.includes('--no-activities');
  const visible = args.includes('--visible');
  const headless = !visible;

  console.log('========================================================');
  console.log('Microsoft Rewards Assistant - Execution Started');
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log('========================================================');

  if (dryRun) console.log('[Mode: DRY-RUN (Read-only dashboard check)]');

  // 1. Initial Dashboard Check
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: headless,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled']
  });

  // Remove webdriver property from navigator object
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  let initialStatus;
  try {
    initialStatus = await getDashboardStatus(context);
  } catch (err) {
    console.error('Failed to get initial status:', err.message);
    await context.close();
    process.exit(1);
  }

  if (!initialStatus.loggedIn) {
    console.error('\n[ERROR] Not logged in to Microsoft Rewards.');
    console.error('Please run "npm run login" to log in interactively in Edge first.');
    await context.close();
    process.exit(1);
  }

  console.log(`\n[Initial Status]`);
  console.log(`Current Balance: ${initialStatus.points} pts`);
  console.log(`Daily Streak   : ${initialStatus.streak} days`);
  console.log(`Available Activities: ${initialStatus.activities.length}`);
  
  initialStatus.activities.forEach((act, idx) => {
    console.log(` - [${idx + 1}] ${act.title} (${act.points} pts) [Quiz: ${act.isQuiz}]`);
  });

  if (dryRun) {
    console.log('\nDry run complete. Exiting without changes.');
    await context.close();
    return;
  }

  // 2. Complete Activities (Quizzes, Clicks)
  let completedTasks = [];
  if (!noActivities && initialStatus.activities.length > 0) {
    try {
      completedTasks = await completeActivities(context, initialStatus.activities);
    } catch (err) {
      console.error('Error during activity execution:', err.message);
    }
  } else {
    console.log('\nSkipping activities section.');
  }

  // Close context before starting searches to avoid lock conflict
  await context.close();

  // 3. Run Searches
  let searchReport = { desktopDone: 0, mobileDone: 0 };
  if (!noSearch) {
    try {
      // Only run desktop searches (35 searches)
      searchReport = await runAllSearches(35, 0, headless);
    } catch (err) {
      console.error('Error during searches:', err.message);
    }
  } else {
    console.log('\nSkipping search loops.');
  }

  // 4. Final Status Scrape
  console.log('\n[Phase 4] Fetching final points balance...');
  const finalContext = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: headless,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled']
  });

  // Remove webdriver property from navigator object
  await finalContext.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  let finalStatus;
  try {
    finalStatus = await getDashboardStatus(finalContext);
  } catch (err) {
    console.error('Failed to get final status:', err.message);
  } finally {
    await finalContext.close();
  }

  // 5. Print Execution Summary
  console.log('\n========================================================');
  console.log('Microsoft Rewards Assistant - Execution Summary');
  console.log('========================================================');
  if (finalStatus && initialStatus) {
    const earned = finalStatus.points - initialStatus.points;
    console.log(`Starting Points  : ${initialStatus.points}`);
    console.log(`Current Balance  : ${finalStatus.points}`);
    console.log(`Points Earned    : +${earned} today`);
    console.log(`Daily Streak     : ${finalStatus.streak} days`);
  } else {
    console.log('Unable to calculate points difference (dashboard fetch failed).');
  }
  
  console.log(`\nActivities Completed (${completedTasks.length}):`);
  if (completedTasks.length > 0) {
    completedTasks.forEach(task => console.log(` - ${task}`));
  } else {
    console.log(' - None');
  }

  console.log(`\nSearches Completed:`);
  console.log(` - Desktop searches: ${searchReport.desktopDone}`);
  console.log(` - Mobile searches : ${searchReport.mobileDone}`);
  
  if (finalStatus && finalStatus.points) {
    console.log(`\nNext Goal Info:`);
    console.log(` - Goal target: ₹500 PVR Cinemas Gift Card`);
    console.log(` - Current balance is ${finalStatus.points} pts.`);
  }

  console.log('========================================================');

  // 6. Send Telegram Notification
  if (finalStatus && initialStatus) {
    const earned = finalStatus.points - initialStatus.points;
    const msg = [
      `*🤖 Microsoft Rewards Assistant Summary*`,
      `📅 Date: ${new Date().toLocaleDateString()}`,
      ``,
      `💰 *Points Summary:*`,
      `• Starting Points: \`${initialStatus.points}\``,
      `• Current Balance: \`${finalStatus.points}\``,
      `• Points Earned Today: *+${earned} pts*`,
      `• Daily Streak: \`${finalStatus.streak} days\``,
      ``,
      `✅ *Activities Completed (${completedTasks.length}):*`,
      completedTasks.length > 0 
        ? completedTasks.map(t => `• ${t}`).join('\n') 
        : `• None`,
      ``,
      `🔍 *Searches Completed:*`,
      `• Desktop searches: \`${searchReport.desktopDone}/35\``,
      `• Mobile searches : \`${searchReport.mobileDone}/0\``,
      ``,
      `🎯 *Goal Progress:*`,
      `• Target: ₹500 PVR Cinemas Gift Card`,
      `• Current balance is \`${finalStatus.points}\` pts.`
    ].join('\n');

    await sendTelegramNotification(msg);
  }
}

main().catch(err => {
  console.error('Unhandled script error:', err);
  process.exit(1);
});
