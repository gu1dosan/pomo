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


// --- State Variables ---
let timerInterval = null;
let isRunning = false;
let isFocus = true;
let timeLeft; 
let appKillList = []; 
let killedAppIds = []; 
let fullAppList = []; 
// NEW: State for keyboard navigation focus in the modal
let focusedAppIndex = -1; 
// Array to store the actual LI elements that are currently visible/rendered
let renderedAppElements = []; 


// --- Event Listeners ---
startStopBtn.addEventListener('click', toggleTimer);
resetBtn.addEventListener('click', resetTimer);

// Settings persistence listeners
focusTimeInput.addEventListener('change', () => { resetTimer(); saveSettings(); });
breakTimeInput.addEventListener('change', () => { resetTimer(); saveSettings(); });
relaunchOptionalCheckbox.addEventListener('change', saveSettings);

// App List Modal Listeners
showAppListBtn.addEventListener('click', showRunningAppsModal);
closeAppListBtn.addEventListener('click', hideRunningAppsModal);
appListModal.addEventListener('click', (e) => {
    if (e.target.id === 'appListModal') {
        hideRunningAppsModal();
    }
});

// Search filter listener
appListSearchInput.addEventListener('input', filterAppList);

// Listener for removing apps from the main display list using delegation
killListDisplayUL.addEventListener('click', handleRemoveFromKillList);

// NEW: Listener for keyboard navigation (Arrow Keys, Enter)
appListSearchInput.addEventListener('keydown', handleKeydown);


// --- New Kill List Management Functions ---

// Renders the internal appKillList array to the vertical display list
function renderKillList() {
    killListDisplayUL.innerHTML = ''; // Clear existing list
    
    if (appKillList.length === 0) {
        killListDisplayUL.innerHTML = '<li style="text-align: center; color: #777; font-style: italic;">No apps selected</li>';
        return;
    }
    
    appKillList.forEach((app, index) => {
        const li = document.createElement('li');
        // Store index as a data attribute to make removal easy
        li.setAttribute('data-index', index); 
        
        // Wrapper for text content
        const contentWrapper = document.createElement('div');
        contentWrapper.className = 'content-wrapper';
        
        // Display Name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = app.display;
        
        // Detail (Path/Executable)
        const detailSpan = document.createElement('span');
        detailSpan.className = 'detail';
        detailSpan.textContent = app.detail;
        
        contentWrapper.appendChild(nameSpan);
        contentWrapper.appendChild(detailSpan);
        
        // Remove Button (X)
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-app-btn';
        removeBtn.textContent = '×'; // Unicode multiplication sign for a clean 'X'
        removeBtn.title = `Remove ${app.display}`;
        
        li.appendChild(contentWrapper);
        li.appendChild(removeBtn);
        
        killListDisplayUL.appendChild(li);
    });
}

// Saves the current appKillList array to the hidden input as JSON string and triggers persistence
function saveKillListAndRender() {
    // 1. Save the structured data
    appKillListHidden.value = JSON.stringify(appKillList);
    
    // 2. Render the display list
    renderKillList();
    
    // 3. Persist settings
    saveSettings();
}

// Handles clicking the remove button in the main kill list display
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
            // Rerender with the full list to update selection status in the modal
            renderAppList(fullAppList); 
        }
    }
}

// Handles clicking an app in the modal list to add/remove it from the kill list
function handleAppSelection(event) {
    const target = event.target.closest('li') || (event.target.dataset && event.target);
    const li = target.closest('li');
    if (!li) return;
    
    const id = li.getAttribute('data-app-id');
    const display = li.getAttribute('data-app-display');
    const detail = li.getAttribute('data-app-detail');
    
    const uniqueKey = `${id}|${detail}`; 

    const existingIndex = appKillList.findIndex(app => `${app.id}|${app.detail}` === uniqueKey);

    if (existingIndex === -1) {
        // ADD the app
        appKillList.push({ id, display, detail });
        li.classList.add('selected');
    } else {
        // REMOVE the app
        appKillList.splice(existingIndex, 1);
        li.classList.remove('selected');
    }
    
    // Sort the list alphabetically by display name
    appKillList.sort((a, b) => a.display.localeCompare(b.display));
    
    // Update the saved data and UI
    saveKillListAndRender();
}


// --- Running App List Modal Functions & Keyboard Navigation ---

async function showRunningAppsModal() {
    appListModal.style.display = 'flex';
    appListUL.innerHTML = '<li style="text-align: center; color: #aaa;">Fetching list of running apps...</li>';
    appListSearchInput.value = ''; 
    focusedAppIndex = -1; // Reset focus state on open
    
    // 1. Automatically focus the search input when the modal opens
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
    focusedAppIndex = -1; // Reset focus state
}

function filterAppList() {
    const searchTerm = appListSearchInput.value.toLowerCase().trim();
    
    if (!Array.isArray(fullAppList) || fullAppList.length === 0) return;

    const filteredApps = fullAppList.filter(app => 
        app.display.toLowerCase().includes(searchTerm) || app.detail.toLowerCase().includes(searchTerm)
    );
    
    renderAppList(filteredApps);
}


// Function to visually manage keyboard focus
function focusApp(index) {
    // 1. Remove focus from previous element
    if (focusedAppIndex >= 0 && renderedAppElements[focusedAppIndex]) {
        renderedAppElements[focusedAppIndex].classList.remove('focused');
    }

    // 2. Set new index and apply focus class
    focusedAppIndex = index;
    if (renderedAppElements[focusedAppIndex]) {
        renderedAppElements[focusedAppIndex].classList.add('focused');
        // Ensure the focused item is visible in the scroll container
        renderedAppElements[focusedAppIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

// Keydown handler for keyboard navigation in the app list modal
function handleKeydown(event) {
    if (appListModal.style.display !== 'flex') return;
    
    const maxIndex = renderedAppElements.length - 1;

    switch (event.key) {
        case 'ArrowDown':
            if (maxIndex < 0) return;
            event.preventDefault(); // Prevent page scroll
            // Cycle focus: If at end, go to 0. Otherwise, increment.
            const nextIndex = (focusedAppIndex < maxIndex) ? focusedAppIndex + 1 : 0;
            focusApp(nextIndex);
            break;
            
        case 'ArrowUp':
            if (maxIndex < 0) return;
            event.preventDefault(); // Prevent page scroll
            // Cycle focus: If at start (or -1), go to end. Otherwise, decrement.
            const prevIndex = (focusedAppIndex <= 0) ? maxIndex : focusedAppIndex - 1;
            focusApp(prevIndex);
            break;
            
        case 'Enter':
            // Only act on Enter if an item is actually focused
            if (focusedAppIndex >= 0 && renderedAppElements[focusedAppIndex]) {
                event.preventDefault(); // Prevent form submission/other default action
                // Simulate a click on the focused list item
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
    renderedAppElements = []; // Reset the stored list elements
    focusedAppIndex = -1; // Reset focus state

    if (!Array.isArray(apps) || apps.length === 0 || (apps[0].id === 'Error')) {
        const errorMsg = apps.length > 0 ? apps[0].display : 'No running apps found.';
        appListUL.innerHTML = `<li style="text-align: center; color: var(--primary);">${errorMsg}</li>`;
        return;
    }

    // Determine which apps are currently selected in the kill list
    const killListKeys = appKillList.map(app => `${app.id}|${app.detail}`);

    // Render the provided (filtered or full) list
    apps.forEach((app, index) => { 
        const li = document.createElement('li');
        li.setAttribute('data-app-id', app.id);
        li.setAttribute('data-app-display', app.display);
        li.setAttribute('data-app-detail', app.detail);
        
        // Display Name
        const nameSpan = document.createElement('span');
        nameSpan.textContent = app.display;
        
        // Detail (Path/Executable)
        const detailSpan = document.createElement('span');
        detailSpan.className = 'detail';
        detailSpan.textContent = app.detail;
        
        li.appendChild(nameSpan);
        li.appendChild(detailSpan);

        // Check if selected
        const appKey = `${app.id}|${app.detail}`;
        if (killListKeys.includes(appKey)) {
             li.classList.add('selected');
        }

        // Add click handler 
        li.addEventListener('click', handleAppSelection);
        
        appListUL.appendChild(li);
        renderedAppElements.push(li); // Store the actual element
    });
    
    // NEW: Automatically focus the first element if results exist
    if (renderedAppElements.length > 0) {
        focusApp(0);
    }
}


// --- Core Timer & Persistence Functions ---

function getSettingsFromDOM() {
    return {
        focusTime: parseInt(focusTimeInput.value) || 25,
        breakTime: parseInt(breakTimeInput.value) || 5,
        // Save the structured JSON string
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
    
    // Apply loaded settings to DOM inputs
    focusTimeInput.value = settings.focusTime;
    breakTimeInput.value = settings.breakTime;
    relaunchOptionalCheckbox.checked = settings.relaunchOptional;
    
    // Load and parse the structured app list
    try {
        appKillList = JSON.parse(settings.appKillList || '[]');
    } catch (e) {
        console.error("Failed to parse appKillList JSON, resetting to empty list.", e);
        appKillList = [];
    }

    // Save and render the loaded list
    saveKillListAndRender();

    // Initialize timer state based on loaded settings
    readConfig();
    updateDisplay();
}


// Promisify the async kill operation
function killAppsAndReport(appIds) {
    return new Promise((resolve) => {
        const removeListener = window.pomo.onKilledApps((killedList) => {
            resolve(killedList);
            removeListener();
        });
        window.pomo.killApps(appIds);
        console.log(`Renderer: Sent kill command for ${appIds.length} configured apps.`);
    });
}


// Reads configuration from inputs and updates state
function readConfig() {
  const focusMin = parseInt(focusTimeInput.value) * 60;
  const breakMin = parseInt(breakTimeInput.value) * 60;
  
  timeLeft = isFocus ? focusMin : breakMin;

  if (isNaN(timeLeft) || timeLeft <= 0) {
      focusTimeInput.value = 25; 
      breakTimeInput.value = 5;
      timeLeft = (isFocus ? 25 : 5) * 60;
  }
}

async function toggleTimer() {
  if (isRunning) {
    stopTimer();
  } else {
    readConfig();
    await startTimer();
  }
}

async function startTimer() {
  isRunning = true;
  startStopBtn.textContent = 'Pause';
  startStopBtn.classList.add('running');
  
  if (isFocus) {
    // Get only the 'id' (the value needed for the kill command) from the structured list
    const appIdsToKill = appKillList.map(app => app.id);
    
    const confirmedKilledAppIds = await killAppsAndReport(appIdsToKill);
    
    // Save only the IDs that were confirmed to be killed
    killedAppIds = confirmedKilledAppIds;
    console.log(`Renderer: ${killedAppIds.length} apps confirmed for relaunch.`);
  }
  
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
}

// Helper function to relaunch apps
function relaunchKilledApps() {
    if (!relaunchOptionalCheckbox.checked) {
        console.log('Renderer: Auto-relaunch disabled by user setting.');
        killedAppIds = [];
        return;
    }
    
    if (killedAppIds.length > 0) {
        console.log('Renderer: Relaunching previously closed apps:', killedAppIds);
        window.pomo.relaunchApps(killedAppIds);
        killedAppIds = [];
    }
}


function stopTimer() {
  isRunning = false;
  startStopBtn.textContent = 'Start';
  startStopBtn.classList.remove('running');
  
  clearInterval(timerInterval);
  
  if (!isFocus) { // Relaunch happens when break mode stops
      relaunchKilledApps();
  }
}

function updateTimer() {
  timeLeft--;

  if (timeLeft < 0) {
    switchMode();
  }
  
  updateDisplay();
}

async function switchMode() {
  isFocus = !isFocus;
  readConfig(); 

  if (isFocus) {
    // --- STARTING FOCUS (ASYNC) ---
    statusDisplay.textContent = 'Focus';
    window.pomo.notify('Break Over!', `Time for a ${focusTimeInput.value}-minute focus session.`);
    
    const appIdsToKill = appKillList.map(app => app.id);
    const confirmedKilledAppIds = await killAppsAndReport(appIdsToKill);
    killedAppIds = confirmedKilledAppIds;

  } else {
    // --- STARTING BREAK ---
    statusDisplay.textContent = 'Break';
    window.pomo.notify('Focus Session Done!', `Time for a ${breakTimeInput.value}-minute break!`);
    
    relaunchKilledApps();
  }
  
  // Restart the timer automatically for the next session
  startTimer(); 
}

function resetTimer() {
  stopTimer();
  isFocus = true;
  readConfig();
  statusDisplay.textContent = 'Focus';
  updateDisplay();
  
  relaunchKilledApps();
}

function updateDisplay() {
  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;
  timerDisplay.textContent = `${pad(minutes)}:${pad(seconds)}`;
}

// Helper function to add leading zeros
function pad(num) {
  return num < 10 ? '0' + num : num;
}

// --- Initialization ---
initializeSettings();