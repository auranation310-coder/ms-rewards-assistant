const token = '8735294362:AAGglVchwQ2EFJTLZfk3uiRPIpuxEpJ7OpU';

async function getChatId() {
  console.log('Fetching updates from Telegram API...');
  const url = `https://api.telegram.org/bot${token}/getUpdates`;
  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (data.ok && data.result && data.result.length > 0) {
      // Find the last chat ID
      const latestUpdate = data.result[data.result.length - 1];
      const chat = latestUpdate.message ? latestUpdate.message.chat : (latestUpdate.callback_query ? latestUpdate.callback_query.message.chat : null);
      if (chat) {
        console.log(`\nFound Chat ID: ${chat.id} (${chat.first_name || ''} ${chat.username || ''})`);
      } else {
        console.log('\nCould not parse chat info from latest update.');
      }
    } else {
      console.log('\nNo updates found. Please open your Telegram bot and click Start or send a message first, then try again!');
    }
  } catch (error) {
    console.error('API Error:', error.message);
  }
}

getChatId();
