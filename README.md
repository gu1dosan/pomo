Focus Pomo

Focus Pomo is a desktop utility designed for the "Utility" hackathon. It helps users maintain deep work by combining a configurable Pomodoro timer with a powerful app "silencer."

When a focus session begins, the app automatically closes user-selected distracting applications (like Slack, Discord, etc.). When the focus session ends, it can automatically relaunch those applications, letting you dive back into your break or collaborative work without missing a beat.

Core Features

Configurable Timer: Set custom durations for your focus and break sessions.

Dynamic App Silencer:

Fetches a list of all your running, user-facing applications.

Lets you select which apps to "silence" (close) from a searchable list.

Automatically closes the selected apps when the focus timer starts.

Auto-Relaunch: Optionally (and enabled by default), the app will automatically relaunch all the apps it closed as soon as your break session begins.

Dynamic Icon: The app uses a dynamically drawn taskbar and system tray icon.

Red Tomato: Indicates a "Focus" session is active.

Green Tomato: Indicates a "Break" or "Paused" state.

System Tray Utility: The app lives in your system tray, staying out of the way until you need it.

Persistent Settings: Your timer settings, app list, and relaunch preference are all saved locally and loaded on the next launch.

How It Works (Tech Stack)

The app is built with Electron, allowing us to use web technologies (HTML, JS, CSS) to create a cross-platform desktop application with system-level capabilities.

Backend (main.js): This is the Node.js process that handles all the "utility" work.

Electron APIs: Uses BrowserWindow, Tray, Menu, and Notification to create the UI and integrate with the native OS.

child_process: The core of the silencer. It runs native OS commands to:

List Apps: Uses wmic (Windows), osascript (macOS), or ps (Linux) to get a list of running applications and their full executable paths (which is key for reliable relaunching).

Kill Apps: Uses taskkill (Windows) or killall (macOS/Linux) to close the selected apps.

Relaunch Apps: Uses start (Windows) or open (macOS) with the saved file paths to relaunch the correct apps.

fs (File System): Saves and loads user settings from a settings.json file in the app's userData directory.

Dynamic Icon: Uses a hidden BrowserWindow to draw the custom tomato icon to a <canvas> and export it as a nativeImage, allowing the icon to change colors dynamically.

Frontend (index.html, renderer.js): This is the user interface, written in vanilla HTML/CSS/JS.

Manages the timer state (running, paused, focus, break).

Handles all DOM manipulation, such as rendering the app list.

Provides a searchable modal with keyboard navigation (ArrowUp, ArrowDown, Enter) to select apps.

Bridge (preload.js): This is the secure bridge that connects the frontend and backend. It uses Electron's contextBridge to safely expose functions from main.js (like listApps, killApps, relaunchApps) to the renderer.js script.

How to Run

Prerequisites

Node.js (which includes npm)

Setup & Launch

Install Dependencies: Open a terminal in the project's root folder and run:

npm install


(This will install Electron, which is the only dependency).

Run the App: Once installation is complete, run:

npm start


This will launch the Focus Pomo application. The app window will appear, but you can click away to hide it in your system tray. Click the tray icon at any time to reopen the main window.