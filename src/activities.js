import path from 'path';

export async function completeActivities(context, activities) {
  if (!activities || activities.length === 0) {
    console.log('No activities found to complete.');
    return [];
  }

  console.log(`Starting completion of ${activities.length} activities...`);
  const completed = [];

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    console.log(`\n[Activity ${i + 1}/${activities.length}] Processing: "${activity.title}" (${activity.points} pts)`);
    
    const page = await context.newPage();
    try {
      if (activity.isQuiz) {
        console.log(`Activity is a Quiz. Solving quiz...`);
        const quizSuccess = await solveQuiz(page, activity.href);
        if (quizSuccess) {
          completed.push(activity.title);
        }
      } else {
        console.log(`Activity is a click task. Navigating to: ${activity.href}`);
        await page.goto(activity.href, { waitUntil: 'load', timeout: 60000 });
        console.log('Waiting 10 seconds to register points...');
        await page.waitForTimeout(10000);
        completed.push(activity.title);
        console.log('Done.');
      }
    } catch (err) {
      console.error(`Failed to complete activity "${activity.title}":`, err.message);
    } finally {
      await page.close();
    }
  }

  return completed;
}

async function solveQuiz(page, url) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    let questionNum = 1;
    let maxRetries = 10; // Avoid infinite loops

    while (maxRetries > 0) {
      maxRetries--;

      // Check if the quiz is finished
      const bodyText = await page.innerText('body');
      if (bodyText.includes('Quiz completed') || bodyText.includes('Keep playing') || bodyText.includes('Daily streak') || bodyText.includes('Check mark')) {
        // Double check if there are any options left
        const optionsCount = await page.locator('.btq_opt a').count();
        if (optionsCount === 0) {
          console.log('Quiz completed successfully!');
          return true;
        }
      }

      // Check if there is a visible "Next" button to proceed
      const nextBtnVisible = await page.evaluate(() => {
        const btn = document.querySelector('.btq_nxtQues a, .btq_nxtQues') || Array.from(document.querySelectorAll('button, a, div')).find(el => el.innerText.trim() === 'Next');
        if (btn) {
          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        }
        return false;
      });

      if (nextBtnVisible) {
        console.log('Found visible "Next" button. Clicking to proceed to the next question...');
        await page.evaluate(() => {
          const btn = document.querySelector('.btq_nxtQues a, .btq_nxtQues') || Array.from(document.querySelectorAll('button, a, div')).find(el => el.innerText.trim() === 'Next');
          if (btn) btn.click();
        });
        await page.waitForTimeout(3000);
        continue;
      }

      console.log(`Solving Question ${questionNum}...`);

      // Find all visible option links
      const options = await page.evaluate(() => {
        const elements = Array.from(document.querySelectorAll('.btq_opt a'));
        const visibleElements = elements.filter(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        });
        return visibleElements.map((a, idx) => ({
          index: idx,
          href: a.href,
          text: a.innerText.trim()
        }));
      });

      if (options.length === 0) {
        // Check if there is a start or next button
        const startBtn = page.locator('#rqStartQuiz, .btq_start, button:has-text("Start"), button:has-text("Take the quiz")');
        if (await startBtn.isVisible()) {
          console.log('Found Start Quiz button. Clicking...');
          await startBtn.click();
          await page.waitForTimeout(3000);
          continue;
        }
        
        console.log('No visible options or start button found. Waiting...');
        await page.waitForTimeout(4000);
        continue;
      }

      // Find the correct option using the WQSCORE="1" trick
      let correctIndex = -1;
      for (let j = 0; j < options.length; j++) {
        const href = options[j].href;
        if (href.includes('WQSCORE%3A%221%22') || href.includes('WQSCORE%3D1') || href.includes('WQSCORE=1')) {
          correctIndex = j;
          break;
        }
      }

      const indexToClick = correctIndex !== -1 ? correctIndex : 0;
      const textToClick = options[indexToClick].text;

      console.log(correctIndex !== -1 
        ? `Found correct answer: "${textToClick}" (index ${correctIndex}). Clicking...`
        : `Correct answer code not found. Clicking first visible option: "${textToClick}" as fallback.`);

      try {
        await page.evaluate((txt) => {
          const elements = Array.from(document.querySelectorAll('.btq_opt a'));
          const target = elements.find(el => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const isVisible = rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
            return isVisible && el.innerText.trim() === txt;
          });
          if (target) {
            target.scrollIntoView({ block: 'center' });
            target.click();
          } else {
            throw new Error(`Element with text "${txt}" not found in DOM`);
          }
        }, textToClick);
      } catch (clickErr) {
        console.warn(`Click failed: ${clickErr.message}. Retrying in next loop...`);
        await page.waitForTimeout(2000);
        continue;
      }

      questionNum++;
      // Wait for the next question to load
      await page.waitForTimeout(4000);
    }

    return true;
  } catch (error) {
    console.error('Error solving quiz:', error);
    return false;
  }
}
