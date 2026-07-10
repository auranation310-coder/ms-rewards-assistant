import fs from 'fs';
import path from 'path';

export async function sendTelegramNotification(message) {
  try {
    const configPath = path.resolve('config.json');
    if (!fs.existsSync(configPath)) {
      return;
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const { telegramToken, telegramChatId } = config;

    if (!telegramToken || !telegramChatId || telegramToken.includes('YOUR_') || telegramChatId.includes('YOUR_')) {
      console.log('\nTelegram Bot Token or Chat ID not configured. Skipping notification.');
      return;
    }

    console.log('\nSending Telegram notification...');
    const url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram API error: ${response.status} - ${errText}`);
    } else {
      console.log('Telegram notification sent successfully!');
    }
  } catch (error) {
    console.error('Failed to send Telegram notification:', error.message);
  }
}
