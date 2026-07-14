import path from 'path';

export async function completeQuests(context, headless = true) {
  console.log('\n=========================================');
  console.log('Checking Microsoft Rewards Punch Cards / Quests...');
  console.log('=========================================');

  const page = await context.newPage();
  const completedQuests = [];

  try {
    // 1. Navigate to Earn page
    await page.goto('https://rewards.bing.com/earn', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);

    // 2. Find all active quest links and progress
    const activeQuests = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a'));
      const list = [];
      
      anchors.forEach(a => {
        const href = a.href || '';
        const text = a.innerText || '';
        const parentText = a.parentElement ? a.parentElement.innerText || '' : '';
        
        if (href.includes('/earn/quest/')) {
          // Parse progress (e.g. "4/4 tasks" or "0/5 tasks")
          const progressMatch = parentText.match(/(\d+)\s*\/\s*(\d+)\s*tasks/i) || text.match(/(\d+)\s*\/\s*(\d+)\s*tasks/i);
          let isCompleted = false;
          
          if (progressMatch) {
            const current = parseInt(progressMatch[1], 10);
            const total = parseInt(progressMatch[2], 10);
            if (current === total) {
              isCompleted = true;
            }
          }
          
          const title = text.split('\n')[0] || parentText.split('\n')[0] || 'Punch Card';
          
          if (!list.some(item => item.href === href)) {
            list.push({
              title: title.replace(/\s+/g, ' ').trim(),
              href,
              isCompleted
            });
          }
        }
      });
      return list;
    });

    console.log(`Found ${activeQuests.length} total punch cards on dashboard.`);
    
    const pendingQuests = activeQuests.filter(q => !q.isCompleted);
    console.log(`${pendingQuests.length} punch cards are pending completion.`);

    if (pendingQuests.length === 0) {
      console.log('All punch cards are already completed!');
      await page.close();
      return [];
    }

    // 3. Complete each pending quest
    for (let i = 0; i < pendingQuests.length; i++) {
      const quest = pendingQuests[i];
      console.log(`\n[Quest ${i+1}/${pendingQuests.length}] Processing: "${quest.title}"`);
      
      try {
        await page.goto(quest.href, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Find all task links on the quest page
        // Task links are links whose href contains form=, spotlight, imagepuzzle, etc.
        const taskLinks = await page.evaluate(() => {
          const anchors = Array.from(document.querySelectorAll('a'));
          return anchors
            .map(a => ({
              text: a.innerText.replace(/\s+/g, ' ').trim(),
              href: a.href
            }))
            .filter(item => {
              const isPromo = item.href.includes('form=') || item.href.includes('Form=') || item.href.includes('spotlight') || item.href.includes('imagepuzzle') || item.href.includes('rewards');
              // Exclude header/footer navigation links
              const isNav = item.href === 'https://rewards.bing.com/' || item.href.endsWith('/dashboard') || item.href.endsWith('/earn') || item.href.endsWith('/redeem');
              return isPromo && !isNav;
            });
        });

        console.log(`Found ${taskLinks.length} uncompleted tasks on this punch card.`);

        for (let j = 0; j < taskLinks.length; j++) {
          const task = taskLinks[j];
          console.log(` -> Clicking task (${j+1}/${taskLinks.length}): "${task.text || 'Promo Link'}"`);

          try {
            // Open link in a new page to simulate clicking and not lose our place
            const taskPage = await context.newPage();
            await taskPage.goto(task.href, { waitUntil: 'load', timeout: 30000 });
            console.log('    Waiting 8 seconds for task registration...');
            await taskPage.waitForTimeout(8000);
            await taskPage.close();
          } catch (taskErr) {
            console.error(`    Failed task click:`, taskErr.message);
          }
        }

        completedQuests.push(quest.title);
        console.log(`Completed Quest: "${quest.title}"`);

      } catch (questErr) {
        console.error(`Failed to process quest "${quest.title}":`, questErr.message);
      }
    }

  } catch (err) {
    console.error('Error during quest execution:', err.message);
  } finally {
    await page.close();
  }

  return completedQuests;
}
