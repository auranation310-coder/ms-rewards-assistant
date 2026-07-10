import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { getDashboardStatus } from './dashboard.js';
import { sendTelegramNotification } from './telegram.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const userDataDir = path.resolve('./user_data');
const configPath = path.resolve('config.json');

async function getTelegramConfig() {
  if (!fs.existsSync(configPath)) {
    throw new Error('config.json not found');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

async function handlePointsCommand(chatId, token) {
  await sendTelegramNotification('🔍 Fetching points balance from Microsoft Rewards... please wait.');

  // Launch browser silently to check status
  let context;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'msedge',
      headless: true,
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled']
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    const status = await getDashboardStatus(context);
    await context.close();

    if (status.loggedIn) {
      const responseMsg = [
        `*💰 Microsoft Rewards Balance*`,
        `• Current Points: *${status.points} pts*`,
        `• Daily Streak: \`${status.streak} days\``,
        `• Available Activities: \`${status.activities.length}\``
      ].join('\n');
      await sendTelegramNotification(responseMsg);
    } else {
      await sendTelegramNotification('⚠️ Bot is not logged in. Please run `npm run login` on your computer.');
    }
  } catch (error) {
    if (context) await context.close();
    if (error.message.includes('locked') || error.message.includes('lock')) {
      await sendTelegramNotification('⚠️ Browser is currently busy running searches or tasks. Please try again in a moment.');
    } else {
      await sendTelegramNotification(`❌ Failed to fetch points: ${error.message}`);
    }
  }
}

async function handleRunCommand(chatId, token) {
  await sendTelegramNotification('🚀 Triggering daily rewards execution... You will receive the summary once completed.');
  
  // Start the index.js orchestrator script
  exec('npm start', (error, stdout, stderr) => {
    if (error) {
      sendTelegramNotification(`❌ Failed to execute run: ${error.message}`);
    }
  });
}

async function handleVerifyCommand(chatId, token) {
  await sendTelegramNotification('🔍 Running points verification & self-check... please wait.');
  
  // Execute the verify script
  exec('npm run verify', async (error, stdout, stderr) => {
    try {
      const resultPath = path.resolve('verify_result.json');
      if (fs.existsSync(resultPath)) {
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        
        const msg = [
          `📊 *Microsoft Rewards Verification*`,
          `📅 Date: \`${new Date().toLocaleDateString()}\``,
          ``,
          `💰 *Points Balance*: \`${result.balanceAfter} pts\``,
          result.searchProgressAfter 
            ? `📈 *Search Progress*: \`${result.searchProgressAfter.current}/${result.searchProgressAfter.limit} pts\`` 
            : `📈 *Search Progress*: \`N/A\``,
          ``,
          result.isLimitReached
            ? `🎉 *Daily search limit is completed!* No more points can be earned today.`
            : (result.success 
                ? `✅ *Verification Successful!* Points successfully increased (+${result.balanceAfter - result.balanceBefore} pts).`
                : `❌ *Verification Failed*: Points did not increase.\n_${result.message}_`)
        ].join('\n');
        
        await sendTelegramNotification(msg);
      } else {
        const cleanOutput = stdout.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
        await sendTelegramNotification(`📊 *Verification Output:*\n\`\`\`\n${cleanOutput}\n\`\`\``);
      }
    } catch (err) {
      console.error('Failed to parse verify results JSON:', err.message);
      const cleanOutput = stdout.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
      await sendTelegramNotification(`📊 *Verification Output:*\n\`\`\`\n${cleanOutput}\n\`\`\``);
    }
  });
}

async function botLoop() {
  const config = await getTelegramConfig();
  const token = config.telegramToken;
  const targetChatId = config.telegramChatId;

  console.log('========================================================');
  console.log('Telegram Bot Command Listener Active');
  console.log('Listening for: /points, /run, and /?');
  console.log('========================================================');

  let offset = 0;
  
  while (true) {
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`);
      if (!response.ok) {
        throw new Error(`Telegram API returned ${response.status}`);
      }
      
      const data = await response.json();
      if (data.ok && data.result) {
        for (const update of data.result) {
          offset = update.update_id + 1;

          if (update.message && update.message.text) {
            const chatId = String(update.message.chat.id);
            const text = update.message.text.trim();

            // Verify the message comes from the authorized user
            if (chatId !== targetChatId) {
              console.log(`Ignored unauthorized message from chat: ${chatId}`);
              continue;
            }

            console.log(`Received command: ${text}`);

            if (text === '/points') {
              await handlePointsCommand(chatId, token);
            } else if (text === '/run') {
              await handleRunCommand(chatId, token);
            } else if (text === '/?' || text === '/verify') {
              await handleVerifyCommand(chatId, token);
            } else if (text === '/start') {
              await sendTelegramNotification('👋 Hello! Commands:\n• `/points`: Show points balance\n• `/run`: Start daily tasks\n• `/?` or `/verify`: Run verification/self-check');
            }
          }
        }
      }
    } catch (err) {
      console.error('Error in bot loop:', err.message);
      // Wait before retrying on network error
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    // Short pause between polling cycles
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

botLoop().catch(console.error);
