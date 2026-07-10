import { sendTelegramNotification } from './src/telegram.js';

async function testMsg() {
  console.log('Sending test message to Telegram bot...');
  await sendTelegramNotification("🎉 *Microsoft Rewards Assistant is linked!* \nYou will now receive points and activity summaries here daily.");
  console.log('Test completed.');
}

testMsg();
