/*
  renderer.js
  This is the "frontend" logic for the timer.
  It manages state, display, and handles configuration for the new structured kill list,
  including keyboard navigation for the app list modal.
*/

// --- DOM Elements ---
const timerDisplay = document.getElementById('timer');
const statusDisplay = document.getElementById('status');
const startStopBtn = document.getElementById('startStopBtn');
const resetBtn = document.getElementById('resetBtn');
// Configuration inputs
const focusTimeInput = document.getElementById('focusTimeInput');
const breakTimeInput = document.getElementById('breakTimeInput');
const relaunchOptionalCheckbox = document.getElementById('relaunchOptional');

// Kill List Elements
const appKillListHidden = document.getElementById('appKillListHidden'); 
const killListDisplayUL = document.getElementById('killListDisplay');

// App List Modal Elements
const showAppListBtn = document.getElementById('showAppListBtn');
const appListModal = document.getElementById('appListModal');
const closeAppListBtn = document.getElementById('closeAppListBtn');
const appListUL = document.getElementById('appList');
const appListSearchInput = document.getElementById('appListSearchInput');

// *** NEW: Modal close button in footer ***
const closeAppListBtnFooter = document.getElementById('closeAppListBtnFooter');


// --- State Variables ---
let timerInterval = null;
let isRunning = false;
let isFocus = true;
let timeLeft; 
let appKillList = []; // List of apps configured to be killed
let killedAppsList = []; // List of structured app objects that were actually killed
let fullAppList = []; 
let focusedAppIndex = -1; 
let renderedAppElements = []; 

// --- Event Listeners ---
startStopBtn.addEventListener('click', toggleTimer); // <-- MODIFIED
resetBtn.addEventListener('click', resetTimer);

focusTimeInput.addEventListener('change', () => { resetTimer(); saveSettings(); });
breakTimeInput.addEventListener('change', () => { resetTimer(); saveSettings(); });
relaunchOptionalCheckbox.addEventListener('change', saveSettings);

showAppListBtn.addEventListener('click', showRunningAppsModal);
closeAppListBtn.addEventListener('click', hideRunningAppsModal);
closeAppListBtnFooter.addEventListener('click', hideRunningAppsModal); // *** NEW ***
appListModal.addEventListener('click', (e) => {
    // Check for overlay click
    if (e.target.classList.contains('modal-overlay')) { 
        hideRunningAppsModal();
    }
});

appListSearchInput.addEventListener('input', filterAppList);
killListDisplayUL.addEventListener('click', handleRemoveFromKillList);
appListSearchInput.addEventListener('keydown', handleKeydown);


// --- Kill List Management Functions ---

function renderKillList() {
    killListDisplayUL.innerHTML = ''; 
    
    if (appKillList.length === 0) {
        killListDisplayUL.innerHTML = '<li style="text-align: center; color: #777; font-style: italic;">No apps selected</li>';
        return;
    }
    
    appKillList.forEach((app, index) => {
        const li = document.createElement('li');
        li.setAttribute('data-index', index); 
        
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'content-wrapper';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = app.display;
        
        const detailSpan = document.createElement('small');
        detailSpan.className = 'detail'; // Use class from index.html
        detailSpan.textContent = app.detail;
        
        contentWrapper.appendChild(nameSpan);
        contentWrapper.appendChild(detailSpan);
        
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-app-btn';
        removeBtn.textContent = '×'; 
        removeBtn.title = `Remove ${app.display}`;
        
        li.appendChild(contentWrapper);
        li.appendChild(removeBtn);
        
        killListDisplayUL.appendChild(li);
    });
}

function saveKillListAndRender() {
    appKillListHidden.value = JSON.stringify(appKillList);
    renderKillList();
    saveSettings();
}

function handleRemoveFromKillList(event) {
    const removeBtn = event.target.closest('.remove-app-btn');
    if (!removeBtn) return;
    
    const li = removeBtn.closest('li');
    if (!li) return;

    const index = parseInt(li.getAttribute('data-index'), 10);
    
    if (index >= 0 && index < appKillList.length) {
        appKillList.splice(index, 1);
        saveKillListAndRender();
        
        if (appListModal.style.display === 'flex') {
            renderAppList(fullAppList); 
        }
    }
}

function handleAppSelection(event) {
    const target = event.target.closest('li');
    if (!target) return;
    
    const id = target.getAttribute('data-app-id');
    const display = target.getAttribute('data-app-display');
    const detail = target.getAttribute('data-app-detail');
    
    const uniqueKey = `${id}|${detail}`; 

    const existingIndex = appKillList.findIndex(app => `${app.id}|${app.detail}` === uniqueKey);

    if (existingIndex === -1) {
        appKillList.push({ id, display, detail });
        target.classList.add('selected');
    } else {
        appKillList.splice(existingIndex, 1);
        target.classList.remove('selected');
    }
    
    appKillList.sort((a, b) => a.display.localeCompare(b.display));
    
    saveKillListAndRender();
}


// --- Running App List Modal Functions & Keyboard Navigation ---

async function showRunningAppsModal() {
    appListModal.style.display = 'flex';
    appListUL.innerHTML = '<li style="text-align: center; color: #aaa;">Fetching list of running apps...</li>';
    appListSearchInput.value = ''; 
    focusedAppIndex = -1;

    setTimeout(() => {
        appListSearchInput.focus();
    }, 100); 

    try {
        if (typeof window.pomo.listApps !== 'function') {
            throw new Error("API Bridge Error: window.pomo.listApps is not available. Check preload.js.");
        }
        
        const apps = await window.pomo.listApps();
        
        fullAppList = apps;
        renderAppList(fullAppList); 
    } catch (error) {
        appListUL.innerHTML = `<li style="color: var(--primary);">Failed to load apps: ${error.message}</li>`;
        console.error("Failed to list apps:", error);
    }
}

function hideRunningAppsModal() {
    appListModal.style.display = 'none';
    focusedAppIndex = -1;
}

function filterAppList() {
    const searchTerm = appListSearchInput.value.toLowerCase().trim();
    
    if (!Array.isArray(fullAppList) || fullAppList.length === 0) return;

    const filteredApps = fullAppList.filter(app => 
        app.display.toLowerCase().includes(searchTerm) || app.detail.toLowerCase().includes(searchTerm)
    );
    
    renderAppList(filteredApps);
}

function focusApp(index) {
    if (focusedAppIndex >= 0 && renderedAppElements[focusedAppIndex]) {
        renderedAppElements[focusedAppIndex].classList.remove('focused');
    }

    focusedAppIndex = index;
    if (renderedAppElements[focusedAppIndex]) {
        renderedAppElements[focusedAppIndex].classList.add('focused');
        renderedAppElements[focusedAppIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function handleKeydown(event) {
    if (appListModal.style.display !== 'flex') return;
    
    const maxIndex = renderedAppElements.length - 1;

    switch (event.key) {
        case 'ArrowDown':
            if (maxIndex < 0) return;
            event.preventDefault(); 
            const nextIndex = (focusedAppIndex < maxIndex) ? focusedAppIndex + 1 : 0;
            focusApp(nextIndex);
            break;
            
        case 'ArrowUp':
            if (maxIndex < 0) return;
            event.preventDefault(); 
            const prevIndex = (focusedAppIndex <= 0) ? maxIndex : focusedAppIndex - 1;
            focusApp(prevIndex);
            break;
            
        case 'Enter':
            if (focusedAppIndex >= 0 && renderedAppElements[focusedAppIndex]) {
                event.preventDefault();
                handleAppSelection({ target: renderedAppElements[focusedAppIndex] });
            }
            break;
            
        case 'Escape':
            hideRunningAppsModal();
            break;
    }
}

function renderAppList(apps) {
    appListUL.innerHTML = ''; 
    renderedAppElements = [];
    focusedAppIndex = -1;

    if (!Array.isArray(apps) || apps.length === 0 || (apps[0].id === 'Error')) {
        const errorMsg = apps.length > 0 ? apps[0].display : 'No running apps found.';
        appListUL.innerHTML = `<li style="text-align: center; color: var(--primary);">${errorMsg}</li>`;
        return;
    }

    const killListKeys = appKillList.map(app => `${app.id}|${app.detail}`);

    apps.forEach((app) => { 
        const li = document.createElement('li');
        li.setAttribute('data-app-id', app.id);
        li.setAttribute('data-app-display', app.display);
        li.setAttribute('data-app-detail', app.detail);
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = app.display;
        
        const detailSpan = document.createElement('small');
        detailSpan.className = 'detail';
        detailSpan.textContent = app.detail;
        
        li.appendChild(nameSpan);
        li.appendChild(detailSpan);

        const appKey = `${app.id}|${app.detail}`;
        if (killListKeys.includes(appKey)) {
             li.classList.add('selected');
        }

        li.addEventListener('click', handleAppSelection);
        
        appListUL.appendChild(li);
        renderedAppElements.push(li);
    });
    
    if (renderedAppElements.length > 0) {
        focusApp(0);
    }
}


// --- Core Timer & Persistence Functions ---

function getSettingsFromDOM() {
    return {
        focusTime: parseInt(focusTimeInput.value) || 25,
        breakTime: parseInt(breakTimeInput.value) || 5,
        appKillList: appKillListHidden.value, 
        relaunchOptional: relaunchOptionalCheckbox.checked,
    };
}

function saveSettings() {
    const settings = getSettingsFromDOM();
    window.pomo.saveSettings(settings);
}

async function initializeSettings() {
    const settings = await window.pomo.loadSettings();
    
    focusTimeInput.value = settings.focusTime;
    breakTimeInput.value = settings.breakTime;
    relaunchOptionalCheckbox.checked = settings.relaunchOptional;
    
    try {
        appKillList = JSON.parse(settings.appKillList || '[]');
    } catch (e) {
        console.error("Failed to parse appKillList JSON, resetting to empty list.", e);
        appKillList = [];
    }

    saveKillListAndRender();
    readConfig();
    updateDisplay();
    
    // *** NEW: Set initial tray icon to focus (red) ***
    window.pomo.setMode('focus'); 
}

function killAppsAndReport() {
    return new Promise((resolve) => {
        // Get the list of IDs to send to the kill command
        const appIdsToKill = appKillList.map(app => app.id);

        const removeListener = window.pomo.onKilledApps((killedAppIds) => {
            // Store the full structured app object for only those confirmed as killed
            const confirmedKilledApps = appKillList.filter(app => 
                killedAppIds.includes(app.id)
            );
            console.log(`Renderer: ${confirmedKilledApps.length} apps confirmed for relaunch.`);
            resolve(confirmedKilledApps); // Resolve with the full structured objects
            removeListener();
        });
        window.pomo.killApps(appIdsToKill); 
        console.log(`Renderer: Sent kill command for ${appIdsToKill.length} configured apps.`);
    });
}

function readConfig() {
    const focusMin = parseInt(focusTimeInput.value, 10) * 60;
    const breakMin = parseInt(breakTimeInput.value, 10) * 60;
    
    let newTime = isFocus ? focusMin : breakMin;

    if (isNaN(newTime) || newTime <= 0) {
        focusTimeInput.value = 25; 
        breakTimeInput.value = 5;
        newTime = (isFocus ? 25 : 5) * 60;
    }
    
    timeLeft = newTime; // Always set to full duration
}

// *** MODIFIED: This function now handles both START and RESUME ***
async function toggleTimer() {
  if (isRunning) {
    // --- PAUSING ---
    stopTimer(); // stopTimer is now just "Pause"
  } else {
    // --- STARTING or RESUMING ---
    
    // Check if this is a fresh start (timer is at max)
    const focusMin = parseInt(focusTimeInput.value, 10) * 60;
    const breakMin = parseInt(breakTimeInput.value, 10) * 60;
    // Use readConfig's logic to determine the *intended* full duration
    const fullDuration = isFocus ? (isNaN(focusMin) ? 25 * 60 : focusMin) : (isNaN(breakMin) ? 5 * 60 : breakMin);

    // Only kill apps if it's a new FOCUS session starting from the beginning
    if (isFocus && timeLeft === fullDuration) {
        console.log("Beginning new focus session, killing apps...");
        killedAppsList = await killAppsAndReport();
    }
    
    // Now, resume the timer
    isRunning = true;
    startStopBtn.textContent = 'Pause';
    startStopBtn.classList.add('running');
    
    // *** NEW: Set icon to current mode (focus or break) when resuming ***
    window.pomo.setMode(isFocus ? 'focus' : 'break');

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
  }
}

// This function is now ONLY for starting a new session (called by switchMode)
async function startTimer() {
  isRunning = true;
  startStopBtn.textContent = 'Pause';
  startStopBtn.classList.add('running');
  
  if (isFocus) {
    // This is correct: a new focus session always kills apps
    killedAppsList = await killAppsAndReport(); 
  }
  
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
}

function relaunchKilledApps() {
    if (!relaunchOptionalCheckbox.checked) {
        console.log('Renderer: Auto-relaunch disabled by user setting.');
        killedAppsList = [];
        return;
    }
    
    if (killedAppsList.length > 0) {
        console.log('Renderer: Relaunching previously closed apps:', killedAppsList);
        window.pomo.relaunchApps(killedAppsList); 
        killedAppsList = [];
    }
}

// *** MODIFIED: This function is now just "Pause" ***
function stopTimer() {
  isRunning = false;
  startStopBtn.textContent = 'Start';
  startStopBtn.classList.remove('running');
  
  clearInterval(timerInterval);
  timerInterval = null; // Explicitly null the interval
  
  // *** NEW: Set icon to 'paused' (green) ***
  window.pomo.setMode('paused');

  // Relaunch logic removed from here
}

function updateTimer() {
  timeLeft--;

  if (timeLeft < 0) {
    switchMode();
  }
  
  updateDisplay();
}

async function switchMode() {
  stopTimer(); // Stop the current timer
  isFocus = !isFocus;
  readConfig(); // Set timeLeft to the full duration for the new mode

  // *** NEW: Tell main.js to update the icon ***
  const mode = isFocus ? 'focus' : 'break';
  window.pomo.setMode(mode);

  if (isFocus) {
    // --- STARTING FOCUS (ASYNC) ---
    statusDisplay.textContent = 'Focus';
    statusDisplay.classList.remove('break-mode');
    timerDisplay.classList.remove('break-mode'); // Use CSS class to change color
    window.pomo.notify('Break Over!', `Time for a ${focusTimeInput.value}-minute focus session.`);
    
    // startTimer will kill apps
    
  } else {
    // --- STARTING BREAK ---
    statusDisplay.textContent = 'Break';
    statusDisplay.classList.add('break-mode');
    timerDisplay.classList.add('break-mode'); // Use CSS class to change color
    window.pomo.notify('Focus Session Done!', `Time for a ${breakTimeInput.value}-minute break!`);
    
    relaunchKilledApps();
  }
  
  // Restart the timer automatically for the new session
  startTimer(); 
}

function resetTimer() {
  stopTimer(); // Pauses the timer
  isFocus = true;
  readConfig(); // Resets timeLeft to full focus time
  statusDisplay.textContent = 'Focus';
  statusDisplay.classList.remove('break-mode');
  timerDisplay.classList.remove('break-mode'); // Ensure color is red
  
  // *** NEW: Reset icon to focus (red) ***
  window.pomo.setMode('focus'); 
  
  updateDisplay();
  
  // Relaunch any apps if timer is reset during a break
  relaunchKilledApps();
}

function updateDisplay() {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  timerDisplay.textContent = `${pad(minutes)}:${pad(seconds)}`;
}

function pad(num) {
  return num < 10 ? '0' + num : num;
}

// --- Initialization ---
initializeSettings();