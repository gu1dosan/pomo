/*
  main.js
  This is the "main" process. It's like the backend.
  It creates the browser window, manages the system tray,
  and handles the "utility" part: running system commands and sending notifications.
*/

console.log("--- main.js started ---");

const { app, BrowserWindow, ipcMain, Notification, Tray, Menu, nativeImage } = require('electron');
const { exec } = require('child_process'); 
const path = require('path');
const fs = require('fs'); // <-- NEW: File System for settings persistence
const os = require('os'); // <-- NEW: For platform-specific commands

// Keep references to our window and tray to prevent garbage collection
let mainWindow;
let tray;
let isFirstHide = true; // Flag to control the initial tray notification

// --- Settings Persistence Configuration ---
const SETTINGS_FILE = 'settings.json';
// Electron's app.getPath('userData') is the standard place for config files
const settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);

// --- Icon Colors ---
const COLOR_FOCUS = '#E04B4B'; // Tomato Red
const COLOR_BREAK = '#4CAF50'; // Stem Green
const COLOR_STEM = '#4CAF50';  // Constant Stem Green


/**
 * Creates a dynamic tomato icon.
 * @param {string} tomatoColor The hex color for the main body of the tomato.
 * @returns {Promise<nativeImage>} A promise that resolves with an Electron nativeImage.
 */
async function createIcon(tomatoColor) {
  console.log(`createIcon() started with color: ${tomatoColor}`);
  const canvas = new BrowserWindow({ width: 64, height: 64, show: false, webPreferences: { offscreen: true } });
  
  await canvas.loadURL('about:blank'); 
  
  const js = `
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 64;
    canvas.height = 64;

    // 1. Draw the tomato shape (main body)
    ctx.fillStyle = '${tomatoColor}';
    ctx.beginPath();
    ctx.arc(32, 36, 26, 0, Math.PI * 2); // Centered at 32, 36 with radius 26
    ctx.fill();

    // 2. Draw the LARGER green leaf/stem (constant color)
    ctx.fillStyle = '${COLOR_STEM}';
    ctx.beginPath();
    
    // Central stem - thicker and taller
    ctx.rect(29, 0, 6, 18); 
    
    // Left leaf
    ctx.moveTo(29, 18); // Connect to stem
    ctx.lineTo(15, 25); // Point down-left
    ctx.lineTo(29, 30); // Point back to center
    
    // Right leaf
    ctx.moveTo(35, 18); // Connect to stem
    ctx.lineTo(49, 25); // Point down-right
    ctx.lineTo(35, 30); // Point back to center
    
    ctx.closePath();
    ctx.fill();

    canvas.toDataURL('image/png').split(',')[1];
  `;
  
  try {
    const data = await canvas.webContents.executeJavaScript(js);
    console.log("Icon JS executed.");
    canvas.close();
    return nativeImage.createFromBuffer(Buffer.from(data, 'base64'));
  } catch (err) {
    console.error("Error drawing dynamic icon:", err);
    canvas.close();
    return nativeImage.createEmpty(); // Fallback
  }
}


async function createWindow() {
  // 1. Create the default (red) icon for the taskbar
  const taskbarIcon = await createIcon(COLOR_FOCUS);

  mainWindow = new BrowserWindow({
    width: 350,
    height: 650, 
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: taskbarIcon, // <-- HERE: Use the red tomato for the taskbar
    frame: false,
    resizable: false,
  });

  mainWindow.loadFile('index.html');

  // Hide the window when it's blurred (clicked off)
  mainWindow.on('blur', () => {
    if (mainWindow) {
      mainWindow.hide();
      if (isFirstHide) {
        if (Notification.isSupported()) {
          new Notification({ 
            title: 'Pomo is Running', 
            body: 'Minimized to system tray. Click the tomato icon to reopen.',
            icon: taskbarIcon // Use the same red icon for notification
          }).show();
        }
        isFirstHide = false;
      }
    }
  });

  // 2. Create the system tray using the same default red icon
  createTray(taskbarIcon);
}

// Make createTray an async function
async function createTray(initialIcon) {
  console.log("createTray() started...");

  // Use the pre-generated red icon to create the tray
  tray = new Tray(initialIcon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show/Hide App', click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() },
    { type: 'separator' },
    { label: 'Quit Pomo', click: () => app.quit() }
  ]);
  
  tray.setToolTip('Pomo (Focus Mode)');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
  console.log("createTray() finished.");
}

// --- App Lifecycle ---

app.on('ready', async () => {
  console.log("App ready event fired.");
  // createWindow will now also create the tray
  createWindow(); 
  console.log("createWindow() and createTray() called.");
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- NEW: IPC Handler for setting the icon mode ---
ipcMain.on('set-mode', async (event, mode) => {
  if (!tray) return; // Exit if tray hasn't been created yet

  if (mode === 'break') {
    console.log("Switching to Break Mode (Green Icon)");
    const breakIcon = await createIcon(COLOR_BREAK);
    tray.setImage(breakIcon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Pomo (Break Mode)');
  } else if (mode === 'paused') { // *** NEW PAUSED STATE ***
    console.log("Switching to Paused Mode (Green Icon)");
    const breakIcon = await createIcon(COLOR_BREAK); // Use green icon
    tray.setImage(breakIcon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Pomo (Paused)');
  } else { // 'focus'
    console.log("Switching to Focus Mode (Red Icon)");
    const focusIcon = await createIcon(COLOR_FOCUS);
    tray.setImage(focusIcon.resize({ width: 16, height: 16 }));
    tray.setToolTip('Pomo (Focus Mode)');
  }
});


// --- IPC Handler for Listing Running Apps ---

ipcMain.handle('apps:list', async () => {
    let command, parseFunction, apps = [];

    if (process.platform === 'win32') {
        // *** MODIFIED: Use wmic to get the full executable path for reliable relaunch ***
        command = 'wmic process get Caption, ExecutablePath /format:csv';
        
        parseFunction = (stdout) => {
            const lines = stdout.trim().split('\n').slice(1); // slice(1) to skip header
            const appMap = new Map();
            
            const systemBlacklist = ['System', 'svchost.exe', 'conhost.exe', 'explorer.exe', 'taskhostw.exe', 'audiodg.exe', 'lsass.exe', 'wininit.exe', 'RuntimeBroker.exe', 'electron', 'Pomo.exe', 'wmic.exe', 'tasklist.exe'];

            for (const line of lines) {
                const parts = line.trim().split(',');
                if (parts.length < 2) continue;
                
                // WMIC CSV format: Node,Caption,ExecutablePath
                const caption = parts[1]; // e.g., chrome.exe
                const executablePath = parts[2]; // e.g., C:\Program Files\...

                if (caption && executablePath && 
                    !systemBlacklist.includes(caption) && 
                    !caption.toLowerCase().includes('pomo') &&
                    caption.length > 3) 
                {
                    let killId = caption.replace(/\.exe$/i, '').trim();
                    let displayName = killId;
                    
                    const uniqueKey = executablePath; // Use full path as unique key
                    
                    if (!appMap.has(uniqueKey)) {
                        appMap.set(uniqueKey, {
                            id: killId,         // 'chrome' (for taskkill)
                            display: displayName, // 'chrome' (for display)
                            detail: executablePath  // 'C:\Program Files\...' (for relaunch)
                        });
                    }
                }
            }
            return Array.from(appMap.values()).sort((a, b) => a.display.localeCompare(b.display));
        };

    } else if (process.platform === 'darwin') {
        command = `osascript -e 'tell application "System Events" to get {name, bundle identifier} of (processes where background only is false)'`;
        
        parseFunction = (stdout) => {
            const namesAndIdentifiers = stdout.trim();
            const parts = namesAndIdentifiers.split('}, {');
            if (parts.length !== 2) return [];

            const names = parts[0].replace(/[{}]/g, '').split(', ').map(s => s.trim()).filter(s => s.length > 0);
            const identifiers = parts[1].replace(/[{}]/g, '').split(', ').map(s => s.trim()).filter(s => s.length > 0);
            
            const blacklist = ['Finder', 'Dock', 'System Settings', 'SystemUIServer', 'ControlCenter', 'Electron', 'Pomo'];
            const apps = [];

            names.forEach((name, index) => {
                const identifier = identifiers[index] || name;
                if (!blacklist.includes(name) && !name.toLowerCase().includes('electron') && !name.toLowerCase().includes('pomo')) {
                    apps.push({
                        id: name, // The app name is the best kill ID for osascript
                        display: name,
                        detail: identifier
                    });
                }
            });
            return apps.sort((a, b) => a.display.localeCompare(b.display));
        };
        
    } else if (process.platform === 'linux') {
        command = 'ps -axco comm=';
        
        parseFunction = (stdout) => {
            const lines = stdout.trim().split('\n');
            const appMap = new Map();
            const blacklist = ['systemd', 'kworker', 'sh', 'bash', 'zsh', 'gnome-shell', 'xfwm4', 'kwin_x11', 'dbus-daemon', 'Xorg', 'electron', 'pomo'];

            for (const line of lines) {
                const name = line.trim();
                if (name.length > 3 && !blacklist.includes(name) && !name.includes('/')) {
                    if (!appMap.has(name)) {
                           appMap.set(name, {
                                id: name,
                                display: name,
                                detail: name
                            });
                    }
                }
            }
            return Array.from(appMap.values()).sort((a, b) => a.display.localeCompare(b.display));
        };
    } else {
        return [{ id: 'Unsupported', display: 'Unsupported OS', detail: 'N/A' }];
    }

    return new Promise((resolve) => {
      console.log("Executing command:", command);
        exec(command, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            if (error || stderr) {
                console.error(`Error listing apps: ${error?.message || stderr}`);
                resolve([{ id: 'Error', display: 'Error fetching list', detail: error?.message || stderr }]);
                return;
            }
            try {
              console.log("Parsing app list...");
                apps = parseFunction(stdout);
                resolve(apps);
            } catch (e) {
                console.error('Error parsing app list:', e);
                resolve([{ id: 'Error', display: 'Error parsing list output', detail: e.message }]);
            }
        });
    });
});


// --- IPC Handler (The Targeted Silencer Utility!) ---

ipcMain.on('apps:kill', (event, appIds) => { // Renamed from appNames to appIds for clarity
  if (!appIds || appIds.length === 0) {
    console.log('Main: No apps configured to kill. Skipping.');
    event.reply('apps:kill-reply', []);
    return;
  }
  
  const killedList = [];
  let pendingKills = appIds.length;
  
  appIds.forEach(appId => {
    let command;
    let name = appId.trim(); // appId is the 'id' property, e.g., 'chrome' or 'chrome.exe'
    
    if (process.platform === 'win32') {
      let killName = name;
      if (!killName.toLowerCase().endsWith('.exe')) {
          killName = `${killName}.exe`;
      }
      command = `taskkill /IM "${killName}" /F`;
      console.log(`Main: Attempting to kill Windows process: ${killName}`);
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      command = `killall "${name}"`;
      console.log(`Main: Attempting to kill Unix process: ${name}`);
    } else {
      console.error(`Main: App killing not supported on platform: ${process.platform}`);
      pendingKills--;
      if (pendingKills === 0) {
          event.reply('apps:kill-reply', killedList);
      }
      return;
    }
    
    exec(command, (error, stdout, stderr) => {
      if (!error || (error && error.code !== 128)) { 
        killedList.push(appId); // Send back the ID that was killed
        console.log(`Successfully sent kill command for: ${appId}`);
      } else {
        console.warn(`Kill warning/failure for ${appId}: ${error.message.trim()}`);
      }

      pendingKills--;
      if (pendingKills === 0) {
          event.reply('apps:kill-reply', killedList);
      }
    });
  });
});

// Listen for the "relaunch apps" command from the UI
ipcMain.handle('apps:relaunch', (event, appsToRelaunch) => { // This now receives full app objects
    if (!appsToRelaunch || appsToRelaunch.length === 0) {
        console.log('Main: No apps to relaunch. Skipping.');
        return;
    }

    appsToRelaunch.forEach(app => {
        let command;
        // *** MODIFIED: Use app.detail (the full path) for relaunch ***
        let name = app.detail; 
        
        if (!name) {
            console.warn(`Cannot relaunch ${app.display}, path is missing.`);
            return;
        }

        if (process.platform === 'win32') {
            // 'start' works well with full executable paths
            command = `start "" "${name}"`;
            console.log(`Main: Attempting to relaunch Windows app: ${name}`);
        } else if (process.platform === 'darwin') {
             // 'open -a' (open application) is more reliable with the app name (app.display)
             // The 'detail' is often the bundle ID, which 'open' also handles.
            command = `open -a "${app.display}"`;
            console.log(`Main: Attempting to relaunch macOS app: ${app.display}`);
        } else if (process.platform === 'linux') {
            command = `${name}`; // Relaunch using the executable name
            console.log(`Main: Attempting to relaunch Linux app: ${name}`);
        } else {
            console.error(`Main: App relaunch not supported on platform: ${process.platform}`);
            return;
        }

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error(`Relaunch failure for ${app.display}: ${error.message.trim()}.`);
            } else {
                console.log(`Successfully attempted relaunch of: ${app.display}`);
            }
        });
    });
});

// Listen for the "notify" command from the UI
ipcMain.handle('notify', (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  } else {
    console.warn(`Notifications not supported on this system.`);
  }
});

// --- Settings Persistence Handlers ---

ipcMain.handle('settings:load', async () => {
    console.log(`Main: Attempting to load settings from ${settingsPath}`);
    try {
        if (fs.existsSync(settingsPath)) {
            const data = fs.readFileSync(settingsPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error loading settings, returning defaults:', error);
    }
    // Return default settings
    return {
        focusTime: 25,
        breakTime: 5,
        appKillList: '[]', // <-- Default to empty JSON array
        relaunchOptional: true,
    };
});

ipcMain.handle('settings:save', async (event, settings) => {
    console.log('Main: Saving settings...', settings);
    try {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
});