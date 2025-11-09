/*
  preload.js
  This is the "preload" script. It's a secure bridge
  that connects the "frontend" (index.html) to the "backend" (main.js).
  It exposes specific, safe functions to your UI.
*/
const { contextBridge, ipcRenderer } = require('electron');

// Expose a 'pomo' object to the window (frontend)
contextBridge.exposeInMainWorld('pomo', {
  // Function to *start* the kill process, sends the list to main.js (used with ipcRenderer.send)
  killApps: (appIds) => ipcRenderer.send('apps:kill', appIds), // Send app IDs
  
  // Function to *listen* for the reply from main.js (list of successfully killed app IDs)
  onKilledApps: (callback) => {
    const listener = (event, killedList) => callback(killedList);
    ipcRenderer.on('apps:kill-reply', listener);
    // Return a function to clean up the listener after use
    return () => ipcRenderer.removeListener('apps:kill-reply', listener);
  },
  
  // Function to relaunch a list of apps (sends full app objects)
  relaunchApps: (appsToRelaunch) => ipcRenderer.invoke('apps:relaunch', appsToRelaunch),
  
  // Function to list running apps
  listApps: () => ipcRenderer.invoke('apps:list'),

  // Function to send a notification
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  
  // Settings Persistence
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  // *** NEW: Function to update the tray icon based on mode ***
  setMode: (mode) => ipcRenderer.send('set-mode', mode),
});