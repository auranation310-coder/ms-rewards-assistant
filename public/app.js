// Dashboard Frontend Controller

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements - General
  const navMsRewards = document.getElementById('nav-ms-rewards');
  const navDownloader = document.getElementById('nav-downloader');
  const dashboardContent = document.getElementById('dashboard-content');
  const downloaderContent = document.getElementById('downloader-content');

  // DOM Elements - MS Rewards
  const btnRefresh = document.getElementById('btn-refresh-status');
  const btnStart = document.getElementById('btn-start-assistant');
  const btnClearConsole = document.getElementById('btn-clear-console');
  
  const pointsVal = document.getElementById('points-val');
  const streakVal = document.getElementById('streak-val');
  const searchVal = document.getElementById('search-val');
  const activitiesVal = document.getElementById('activities-val');
  
  const consoleOutput = document.getElementById('console-output');
  const tasksList = document.getElementById('tasks-list');

  // DOM Elements - Downloader
  const tabYt = document.getElementById('tab-yt');
  const tabIg = document.getElementById('tab-ig');
  const inputUrl = document.getElementById('video-url');
  const btnAnalyze = document.getElementById('btn-analyze');
  const dlStatus = document.getElementById('dl-status');
  const analysisContainer = document.getElementById('analysis-container');
  const videoThumb = document.getElementById('video-thumb');
  const videoTitle = document.getElementById('video-title');
  const videoDuration = document.getElementById('video-duration');
  const qualitySelect = document.getElementById('quality-select');
  const btnDownload = document.getElementById('btn-download');

  // State Variables
  let currentPlatform = 'youtube';
  let analyzedUrl = '';
  let analyzedData = null;

  // View Switcher Logic
  navMsRewards.addEventListener('click', () => {
    navMsRewards.classList.add('active');
    navDownloader.classList.remove('active');
    dashboardContent.classList.remove('hidden');
    downloaderContent.classList.add('hidden');
    fetchStatus();
  });

  navDownloader.addEventListener('click', () => {
    navDownloader.classList.add('active');
    navMsRewards.classList.remove('active');
    downloaderContent.classList.remove('hidden');
    dashboardContent.classList.add('hidden');
  });

  // Downloader Tab Switcher
  tabYt.addEventListener('click', () => {
    currentPlatform = 'youtube';
    tabYt.classList.add('active');
    tabIg.classList.remove('active');
    inputUrl.placeholder = 'Paste YouTube link here...';
    analysisContainer.classList.add('hidden');
    dlStatus.innerText = '';
    inputUrl.value = '';
  });

  tabIg.addEventListener('click', () => {
    currentPlatform = 'instagram';
    tabIg.classList.add('active');
    tabYt.classList.remove('active');
    inputUrl.placeholder = 'Paste Instagram Reels link here...';
    analysisContainer.classList.add('hidden');
    dlStatus.innerText = '';
    inputUrl.value = '';
  });

  // Downloader Analysis Logic
  btnAnalyze.addEventListener('click', async () => {
    const url = inputUrl.value.trim();
    if (!url) {
      dlStatus.innerText = 'Please paste a valid video URL.';
      dlStatus.className = 'downloader-status error';
      return;
    }

    dlStatus.innerText = 'Analyzing video link... (Instagram may take up to 10 seconds)';
    dlStatus.className = 'downloader-status';
    analysisContainer.classList.add('hidden');
    btnAnalyze.disabled = true;

    try {
      const response = await fetch('/api/downloader/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: currentPlatform, url })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Server failed to analyze URL');
      }

      const data = await response.json();
      analyzedData = data;
      analyzedUrl = url;

      // Populate elements
      videoThumb.src = data.thumbnail;
      videoTitle.innerText = data.title;
      videoDuration.innerText = `Duration: ${data.duration}`;

      // Populate qualities select
      qualitySelect.innerHTML = '';
      data.formats.forEach(f => {
        const option = document.createElement('option');
        if (currentPlatform === 'youtube') {
          option.value = f.itag;
          option.innerText = `${f.quality} - ${f.container.toUpperCase()} (${f.mimeType})`;
        } else {
          // Instagram: value is direct CDN URL
          option.value = f.url;
          option.innerText = f.quality;
        }
        qualitySelect.appendChild(option);
      });

      analysisContainer.classList.remove('hidden');
      updateSelectedSize(); // Show initial size selection
      dlStatus.innerText = 'Analysis completed successfully!';
      dlStatus.className = 'downloader-status success';
    } catch (error) {
      dlStatus.innerText = `Error: ${error.message}`;
      dlStatus.className = 'downloader-status error';
    } finally {
      btnAnalyze.disabled = false;
    }
  });

  // Helper: Format bytes to human-readable string
  function formatBytes(bytes) {
    if (bytes === 0 || !bytes) return 'Unknown Size';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Helper: Update duration and size text based on selected option
  function updateSelectedSize() {
    if (!analyzedData) return;
    
    if (currentPlatform === 'instagram') {
      videoDuration.innerText = `Duration: N/A | Size: Variable`;
      return;
    }

    const selectedItag = qualitySelect.value;
    const selectedFormat = analyzedData.formats.find(f => f.itag == selectedItag);
    
    if (selectedFormat && selectedFormat.sizeBytes) {
      const sizeStr = formatBytes(selectedFormat.sizeBytes);
      videoDuration.innerText = `Duration: ${analyzedData.duration} | Size: ${sizeStr}`;
    } else {
      videoDuration.innerText = `Duration: ${analyzedData.duration} | Size: Unknown`;
    }
  }

  // Listen for dropdown changes to update size indicator dynamically
  qualitySelect.addEventListener('change', updateSelectedSize);

  // Downloader Download Trigger
  btnDownload.addEventListener('click', async () => {
    const selectedVal = qualitySelect.value;
    if (!selectedVal) return;

    btnDownload.disabled = true;
    const originalText = btnDownload.innerHTML;
    btnDownload.innerHTML = `<span class="btn-icon">⏳</span> <span class="btn-text">Initializing...</span>`;
    
    try {
      // 1. Call backend to start the background download
      const response = await fetch('/api/downloader/start-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: currentPlatform,
          url: analyzedUrl,
          itag: selectedVal
        })
      });

      if (!response.ok) {
        throw new Error('Failed to initialize download.');
      }

      const data = await response.json();

      if (data.status === 'redirect') {
        // Direct redirect for Instagram
        window.location.href = data.url;
        btnDownload.disabled = false;
        btnDownload.innerHTML = originalText;
        return;
      }

      // 2. Open EventSource for YouTube download progress
      const downloadId = data.downloadId;
      const eventSource = new EventSource(`/api/downloader/progress?id=${downloadId}`);

      eventSource.onmessage = (event) => {
        const update = JSON.parse(event.data);
        
        if (update.status === 'downloading') {
          btnDownload.innerHTML = `<span class="btn-icon">📥</span> <span class="btn-text">Downloading: ${update.percent}%</span>`;
        } else if (update.status === 'merging') {
          btnDownload.innerHTML = `<span class="btn-icon">⚙️</span> <span class="btn-text">Merging Tracks...</span>`;
        } else if (update.status === 'finished') {
          eventSource.close();
          btnDownload.innerHTML = `<span class="btn-icon">✅</span> <span class="btn-text">Finalizing...</span>`;
          
          // Trigger actual file download in browser
          window.location.href = `/api/downloader/file?id=${downloadId}`;
          
          // Restore button state
          setTimeout(() => {
            btnDownload.disabled = false;
            btnDownload.innerHTML = originalText;
          }, 2000);
        } else if (update.status === 'error') {
          eventSource.close();
          btnDownload.disabled = false;
          btnDownload.innerHTML = originalText;
          alert('Download task failed on the server.');
        }
      };

      eventSource.onerror = () => {
        eventSource.close();
        btnDownload.disabled = false;
        btnDownload.innerHTML = originalText;
      };

    } catch (err) {
      alert('Download failed: ' + err.message);
      btnDownload.disabled = false;
      btnDownload.innerHTML = originalText;
    }
  });

  // MS Rewards helper: Log to console panel
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
      
      pointsVal.innerText = data.points !== null ? data.points.toLocaleString() : '---';
      streakVal.innerText = data.streak !== undefined ? `${data.streak} Days` : '0 Days';
      
      if (data.searchProgress) {
        searchVal.innerText = `${data.searchProgress.current}/${data.searchProgress.limit}`;
      } else {
        searchVal.innerText = '30/30';
      }
      
      activitiesVal.innerText = data.activities ? data.activities.length : '0';

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
      btnRefresh.disabled = false;
      btnStart.disabled = false;
    }
  }

  // Action: Start Daily Assistant Run
  function startAssistant() {
    btnRefresh.disabled = true;
    btnStart.disabled = true;

    logToConsole('Starting Microsoft Rewards Assistant run...', 'system');
    logToConsole('An Edge browser window will open on your screen shortly to perform searches...', 'system');

    const eventSource = new EventSource('/api/start');

    eventSource.onmessage = (event) => {
      const line = event.data;
      
      if (line.startsWith('[ERROR]')) {
        logToConsole(line.replace('[ERROR]', ''), 'error');
      } else if (line.startsWith('[FINISHED]')) {
        logToConsole(line.replace('[FINISHED]', ''), 'success');
        eventSource.close();
        
        logToConsole('Execution completed. Refreshing points balance...', 'system');
        fetchStatus();
      } else {
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

  // Auto-fetch status on initial load
  fetchStatus();
});
