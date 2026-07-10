// Dashboard Frontend Controller

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const btnRefresh = document.getElementById('btn-refresh-status');
  const btnStart = document.getElementById('btn-start-assistant');
  const btnClearConsole = document.getElementById('btn-clear-console');
  
  const pointsVal = document.getElementById('points-val');
  const streakVal = document.getElementById('streak-val');
  const searchVal = document.getElementById('search-val');
  const activitiesVal = document.getElementById('activities-val');
  
  const consoleOutput = document.getElementById('console-output');
  const tasksList = document.getElementById('tasks-list');
  const navMsRewards = document.getElementById('nav-ms-rewards');

  // Helper: Log to console panel
  function logToConsole(message, type = '') {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.innerText = message;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  // Action: Clear console
  btnClearConsole.addEventListener('click', () => {
    consoleOutput.innerHTML = '';
    logToConsole('Console cleared.', 'system');
  });

  // Action: Get dashboard status
  async function fetchStatus() {
    // Disable control buttons
    btnRefresh.disabled = true;
    btnStart.disabled = true;
    
    logToConsole('Requesting Rewards status from Edge browser session...', 'system');
    
    try {
      const response = await fetch('/api/status');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.loggedIn === false) {
        logToConsole('⚠️ ERROR: Not logged in. Please log in in Edge browser first.', 'error');
        pointsVal.innerText = 'Login Required';
        return;
      }
      
      // Update Overview Cards
      pointsVal.innerText = data.points !== null ? data.points.toLocaleString() : '---';
      streakVal.innerText = data.streak !== undefined ? `${data.streak} Days` : '0 Days';
      
      if (data.searchProgress) {
        searchVal.innerText = `${data.searchProgress.current}/${data.searchProgress.limit}`;
      } else {
        searchVal.innerText = '30/30'; // fallback standard limit
      }
      
      activitiesVal.innerText = data.activities ? data.activities.length : '0';

      // Render Activities Checklists
      tasksList.innerHTML = '';
      if (data.activities && data.activities.length > 0) {
        data.activities.forEach(task => {
          const item = document.createElement('div');
          item.className = 'task-item';
          
          item.innerHTML = `
            <div class="task-details">
              <span class="task-title">${task.title}</span>
              <span class="task-points">+${task.points} pts</span>
            </div>
            <span class="task-badge ${task.isQuiz ? 'quiz' : 'click'}">${task.isQuiz ? 'Quiz' : 'Click'}</span>
          `;
          tasksList.appendChild(item);
        });
        logToConsole(`Successfully loaded ${data.activities.length} daily activities.`, 'success');
      } else {
        tasksList.innerHTML = '<div class="empty-state">🎉 All daily activities are fully completed!</div>';
        logToConsole('No available daily activities found (fully completed).', 'success');
      }
      
    } catch (err) {
      logToConsole(`❌ Error fetching dashboard data: ${err.message}`, 'error');
      logToConsole('Make sure Edge is not locked by another running task and try refreshing.', 'error');
    } finally {
      // Re-enable control buttons
      btnRefresh.disabled = false;
      btnStart.disabled = false;
    }
  }

  // Action: Start Daily Assistant Run
  function startAssistant() {
    // Disable control buttons
    btnRefresh.disabled = true;
    btnStart.disabled = true;

    logToConsole('Starting Microsoft Rewards Assistant run...', 'system');
    logToConsole('An Edge browser window will open on your screen shortly to perform searches...', 'system');

    // Create EventSource stream
    const eventSource = new EventSource('/api/start');

    eventSource.onmessage = (event) => {
      const line = event.data;
      
      if (line.startsWith('[ERROR]')) {
        logToConsole(line.replace('[ERROR]', ''), 'error');
      } else if (line.startsWith('[FINISHED]')) {
        logToConsole(line.replace('[FINISHED]', ''), 'success');
        eventSource.close();
        
        // Auto-refresh stats once finished
        logToConsole('Execution completed. Refreshing points balance...', 'system');
        fetchStatus();
      } else {
        // Standard logs
        if (line.includes('Points INCREASED')) {
          logToConsole(line, 'success');
        } else if (line.includes('Error')) {
          logToConsole(line, 'error');
        } else {
          logToConsole(line);
        }
      }
    };

    eventSource.onerror = (err) => {
      logToConsole('⚠️ Log connection lost or process closed.', 'error');
      eventSource.close();
      btnRefresh.disabled = false;
      btnStart.disabled = false;
    };
  }

  // Bind Listeners
  btnRefresh.addEventListener('click', fetchStatus);
  btnStart.addEventListener('click', startAssistant);
  navMsRewards.addEventListener('click', fetchStatus);

  // Auto-fetch status on initial load
  fetchStatus();
});
