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

// Keep references to our window and tray to prevent garbage collection
let mainWindow;
let tray;
let isFirstHide = true; // Flag to control the initial tray notification

// --- Settings Persistence Configuration ---
const SETTINGS_FILE = 'settings.json';
// Electron's app.getPath('userData') is the standard place for config files
const settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 350,
    height: 650, // Increased height to fit new configuration panel
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    // Optional: make it feel more like an app
    frame: false,
    resizable: false,
  });

  mainWindow.loadFile('index.html');

  // Hide the window when it's blurred (clicked off)
  mainWindow.on('blur', () => {
    // Add null check for safety
    if (mainWindow) {
      mainWindow.hide();
      
      // LOGIC: Notify the user the first time the window hides
      if (isFirstHide) {
        if (Notification.isSupported()) {
          new Notification({ 
            // Updated App Name
            title: 'Pomo is Running', 
            body: 'Minimized to system tray. Click the tomato icon to reopen.' 
          }).show();
        }
        isFirstHide = false;
      }
    }
  });
}

// Make createTray an async function
async function createTray() {
  console.log("createTray() started...");

  // Await the buffer from the async helper function
  const buffer = await createIconBuffer();
  console.log("createIconBuffer() finished.");

  const icon = nativeImage.createFromBuffer(buffer, { width: 64, height: 64 });
  tray = new Tray(icon.resize({ width: 16, height: 16 }));

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show/Hide App', click: () => mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show() },
    { type: 'separator' },
    // Updated App Name
    { label: 'Quit Pomo', click: () => app.quit() }
  ]);
  
  // Updated App Name
  tray.setToolTip('Pomo');
  tray.setContextMenu(contextMenu);

  // Show the window when the tray icon is clicked
  tray.on('click', () => {
    // Add null check for safety
    if (mainWindow) {
      mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
    }
  });
}

// --- App Lifecycle ---

// Make the 'ready' handler async
app.on('ready', async () => {
  console.log("App ready event fired.");
  createWindow();
  console.log("createWindow() called.");
  // Await the tray creation since it now depends on an async buffer
  await createTray();
  console.log("createTray() finished.");
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user explicitly quits with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// --- IPC Handler for Listing Running Apps ---

ipcMain.handle('apps:list', async () => {
    let command, parseFunction, apps = [];

    if (process.platform === 'win32') {
        // Windows: Reverted to simple task list, which returns only the ImageName.
        command = 'tasklist /fo csv /nh';
        
        parseFunction = (stdout) => {
            const regex = /"((?:[^"]|"")*)"/g;
            const lines = stdout.trim().split('\n');
            const appMap = new Map(); // Use map to ensure unique ImageName
            
            const systemBlacklist = ['System', 'svchost.exe', 'conhost.exe', 'explorer.exe', 'taskhostw.exe', 'audiodg.exe', 'lsass.exe', 'wininit.exe', 'RuntimeBroker.exe', 'electron'];

            for (const line of lines) {
                const fields = [];
                let match;
                while (match = regex.exec(line)) {
                    fields.push(match[1].replace(/""/g, '"'));
                }

                // Extract only the ImageName (first field)
                const [imageName] = fields;
                
                if (imageName && 
                    !systemBlacklist.includes(imageName) && 
                    imageName.length > 5) 
                {
                    // Use ImageName as the kill ID and the display name
                    let killId = imageName.replace(/\.exe$/i, '').trim();
                    let displayName = killId;
                    let detail = imageName; 
                    
                    // Use killId as unique key for non-verbose output
                    const uniqueKey = killId; 
                    
                    if (!appMap.has(uniqueKey)) {
                        appMap.set(uniqueKey, {
                            id: killId,
                            display: displayName,
                            detail: detail
                        });
                    }
                }
            }
            // Return an array of the unique application objects, sorted by display name
            return Array.from(appMap.values()).sort((a, b) => a.display.localeCompare(b.display));
        };

    } else if (process.platform === 'darwin') {
        // macOS: Use osascript to reliably get application names from the Dock/UI
        command = `osascript -e 'tell application "System Events" to get {name, bundle identifier} of (processes where background only is false)'`;
        
        parseFunction = (stdout) => {
            const namesAndIdentifiers = stdout.trim();
            // Expected format: {App Name 1, App Name 2}, {Identifier 1, Identifier 2}
            const parts = namesAndIdentifiers.split('}, {');
            if (parts.length !== 2) return [];

            const names = parts[0].replace(/[{}]/g, '').split(', ').map(s => s.trim()).filter(s => s.length > 0);
            const identifiers = parts[1].replace(/[{}]/g, '').split(', ').map(s => s.trim()).filter(s => s.length > 0);
            
            const blacklist = ['Finder', 'Dock', 'System Settings', 'SystemUIServer', 'ControlCenter', 'Electron'];
            const apps = [];

            names.forEach((name, index) => {
                const identifier = identifiers[index] || name;
                if (!blacklist.includes(name) && !name.toLowerCase().includes('electron')) {
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
        // Linux: Use ps to get command names (comm)
        command = 'ps -axco comm=';
        
        parseFunction = (stdout) => {
            const lines = stdout.trim().split('\n');
            const appMap = new Map();
            
            const blacklist = ['systemd', 'kworker', 'sh', 'bash', 'zsh', 'gnome-shell', 'xfwm4', 'kwin_x11', 'dbus-daemon', 'Xorg', 'electron'];

            for (const line of lines) {
                const name = line.trim();
                if (name.length > 3 && !blacklist.includes(name) && !name.includes('/')) {
                    // Use the name as both ID, display, and detail for simplicity on Linux
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

// LISTEN for the kill command and REPLY with the list of apps that were successfully targeted.
ipcMain.on('apps:kill', (event, appNames) => {
  if (!appNames || appNames.length === 0) {
    console.log('Main: No apps configured to kill. Skipping.');
    // Send an empty list back
    event.reply('apps:kill-reply', []);
    return;
  }
  
  const killedList = [];
  let pendingKills = appNames.length;
  
  appNames.forEach(appName => {
    let command;
    let name = appName.trim();
    
    // Determine platform-specific command
    if (process.platform === 'win32') {
      // Windows: taskkill /IM requires just the executable name (image name), NOT the full path.
      let killName = name;
      
      // LOGIC: If the input contains path separators or a drive letter, extract only the executable name.
      if (name.includes('\\') || name.includes(':')) {
          killName = path.basename(name);
          console.log(`Main: Detected Windows path input. Killing process name: ${killName}`);
      }

      if (!killName.toLowerCase().endsWith('.exe')) {
          killName = `${killName}.exe`;
      }
      command = `taskkill /IM "${killName}" /F`;
      console.log(`Main: Attempting to kill Windows process: ${killName}`);
    } else if (process.platform === 'darwin' || process.platform === 'linux') {
      // macOS/Linux: use killall, which accepts the application name (e.g., 'Google Chrome.app') 
      // or the executable name (e.g., 'chrome'). We rely on the user input here.
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
      // If no error and no stderr, we assume the command succeeded in being sent.
      if (!error || (error && error.code !== 128)) { 
        // If the command executes without a fatal system error, we add the *original* name/path to the list.
        killedList.push(appName);
        console.log(`Successfully sent kill command for: ${appName}`);
      } else {
        // Log the warning/failure
        console.warn(`Kill warning/failure for ${appName}: ${error.message.trim()}`);
      }

      pendingKills--;
      
      // Once all commands have returned (or timed out), send the final list back.
      if (pendingKills === 0) {
          event.reply('apps:kill-reply', killedList);
      }
    });
  });
});

// Listen for the "relaunch apps" command from the UI
ipcMain.handle('apps:relaunch', (event, appNames) => {
    if (!appNames || appNames.length === 0) {
        console.log('Main: No apps to relaunch. Skipping.');
        return;
    }

    appNames.forEach(appName => {
        let command;
        let name = appName.trim();
        
        // Helper to check if the input is likely a full file path
        const isPath = name.includes('/') || name.includes('\\') || name.includes(':');

        if (process.platform === 'win32') {
            // Windows: 'start' works for both simple executable names (if in PATH) and full executable paths.
            // We use the full original name/path provided by the user.
            command = `start "" "${name}"`;
            console.log(`Main: Attempting to relaunch Windows app: ${name}`);

        } else if (process.platform === 'darwin') {
            if (isPath) {
                // If it looks like a path, use 'open' to handle the path or bundle.
                command = `open "${name}"`;
                console.log(`Main: Attempting to relaunch macOS app via path: ${name}`);
            } else {
                // If it's a simple name (e.g., Google Chrome), use 'open -a' which targets the Application bundle.
                command = `open -a "${name}"`;
                console.log(`Main: Attempting to relaunch macOS app via application name: ${name}`);
            }
        } else if (process.platform === 'linux') {
            // Linux: Simple execution of the command name or path.
            command = `${name}`; 
            console.log(`Main: Attempting to relaunch Linux app: ${name}`);
        } else {
            console.error(`Main: App relaunch not supported on platform: ${process.platform}`);
            return;
        }

        exec(command, (error, stdout, stderr) => {
            if (error) {
                // Log the error but continue trying to launch others
                console.error(`Relaunch failure for ${appName}: ${error.message.trim()}.`);
            } else {
                console.log(`Successfully attempted relaunch of: ${appName}`);
            }
        });
    });
});

// Listen for the "notify" command from the UI
ipcMain.handle('notify', (event, { title, body }) => {
  // Check if system notifications are enabled
  if (Notification.isSupported()) {
    new Notification({ title, body }).show();
  } else {
    console.warn(`Notifications not supported on this system.`);
  }
});

// --- Settings Persistence Handlers ---

// Load settings from file
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
    // Return default settings if file doesn't exist or loading fails
    return {
        focusTime: 25,
        breakTime: 5,
        appKillList: '',
        relaunchOptional: true,
    };
});

// Save settings to file
ipcMain.handle('settings:save', async (event, settings) => {
    console.log('Main: Saving settings...', settings);
    try {
        // Use JSON.stringify with null, 2 for pretty printing
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
        return true;
    } catch (error) {
        console.error('Error saving settings:', error);
        return false;
    }
});


// --- Helper to create a dynamic icon (no file needed) ---

// Make this an async function
async function createIconBuffer() {
  console.log("createIconBuffer() started...");
  const canvas = new BrowserWindow({ width: 64, height: 64, show: false });
  
  // *** FIX: Must wait for the window to be ready before executing JS ***
  await canvas.loadURL('about:blank'); 
  
  const js = `
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 64;
    canvas.height = 64;

    // Draw the tomato shape
    ctx.fillStyle = '#E04B4B'; // Primary red
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();

    // Draw the leaf/stem
    ctx.strokeStyle = '#4CAF50'; // Green
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(32, 8);
    ctx.lineTo(32, 18);
    ctx.lineTo(24, 18);
    ctx.stroke();

    canvas.toDataURL('image/png').split(',')[1];
  `;
  // Await the result of the JavaScript execution
  const data = await canvas.webContents.executeJavaScript(js);
  console.log("Icon JS executed.");
  
  // Clean up the temporary browser window
  canvas.close();

  return Buffer.from(data, 'base64');
}