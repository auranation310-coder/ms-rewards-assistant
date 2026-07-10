import { chromium } from 'playwright';
import path from 'path';
import readline from 'readline';

const userDataDir = path.resolve('./user_data');

async function login() {
  console.log('========================================================');
  console.log('Microsoft Rewards Assistant - One-Time Login');
  console.log('========================================================');
  console.log('1. A Microsoft Edge browser window will open shortly.');
  console.log('2. Please sign in to your Microsoft account.');
  console.log('3. Complete any MFA, CAPTCHA, or verification steps if prompted.');
  console.log('4. Once you see the Rewards dashboard with your points, return');
  console.log('   here and press [ENTER] to save your session.');
  console.log('========================================================\n');

  console.log(`Starting Edge with profile directory: ${userDataDir}`);

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'msedge',
    headless: false,
    viewport: null, // Open with default size
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  // Remove webdriver property from navigator object
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  const page = await context.newPage();
  
  try {
    await page.goto('https://rewards.bing.com/', { waitUntil: 'load', timeout: 60000 });
  } catch (error) {
    console.log('Failed to navigate to Rewards dashboard, but browser is open. Please navigate manually.');
  }

  // Set up console readline
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise((resolve) => {
    rl.question('Press [ENTER] when you have successfully logged in and the dashboard is displayed...', () => {
      rl.close();
      resolve();
    });
  });

  console.log('Saving session and closing browser...');
  await context.close();
  console.log('Session saved successfully! You can now run the automated assistant.');
}

login().catch(err => {
  console.error('An error occurred during login setup:', err);
  process.exit(1);
});
