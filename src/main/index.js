const { app, BrowserWindow, ipcMain, Notification, shell } = require('electron');
const path = require('path');

// IMPORTANT: PLAYWRIGHT_BROWSERS_PATH must be set BEFORE any module that
// transitively requires 'playwright' is loaded. Playwright reads this env
// var at require-time and caches the path. Setting it later (e.g. inside
// app.whenReady) is too late — Playwright already resolved the default
// %LOCALAPPDATA%/ms-playwright location, which is empty on fresh installs.
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');
}

const Logger = require('./Logger.js');
const { Coordinator } = require('./Coordinator.js');
const { createTray } = require('./tray.js');
const { ProfileCloner } = require('./ProfileCloner.js');
const { ConfigStore } = require('./ConfigStore.js');

process.on('uncaughtException', e => Logger.error('uncaughtException', e));
process.on('unhandledRejection', e => Logger.error('unhandledRejection', e instanceof Error ? e : new Error(String(e))));

// In dev, __dirname is src/main and PROJECT_ROOT is the repo root.
// When packaged, app.getAppPath() returns the asar root (same structure inside the archive).
const PROJECT_ROOT = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
// Assets are copied to process.resourcesPath/assets by electron-builder extraResources.
const ASSETS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(PROJECT_ROOT, 'assets');

let mainWindow = null;
let tray = null;
let coordinator = null;

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); return; }
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      // __dirname is inside the asar when packaged, so this resolves correctly in both modes.
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true
    }
  });
  if (process.env.VITE_DEV) {
    mainWindow.loadURL('http://localhost:5174');
  } else {
    mainWindow.loadFile(path.join(PROJECT_ROOT, 'dist', 'renderer', 'index.html'));
  }
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow.hide();
  });
}

function statusColor(status) {
  if (!status.running) return 'gray';
  const errored = status.channels.some(c => c.lastError);
  if (errored) return 'yellow';
  return 'green';
}

function pushStatus() {
  const status = coordinator.getStatus();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('status:changed', status);
  }
  if (tray) {
    tray.setColor(statusColor(status));
    tray.setRunning(status.running);
  }
}

app.whenReady().then(() => {
  Logger.init();

  coordinator = new Coordinator({ configPath: CONFIG_PATH });
  coordinator.on('status-changed', pushStatus);
  coordinator.on('warning', (w) => Logger.warn(w));

  tray = createTray({
    assetsDir: ASSETS_DIR,
    onShow: createWindow,
    onStart: () => coordinator.start().catch(e => Logger.error('tray onStart failed', e)),
    onStop:  () => coordinator.stop().catch(e => Logger.error('tray onStop failed', e)),
    onQuit:  () => { app.exit(0); }
  });

  ipcMain.handle('status:get', async () => {
    try { return coordinator.getStatus(); }
    catch (e) { Logger.error('IPC status:get failed', e); throw e; }
  });
  ipcMain.handle('config:get', async () => {
    try { return coordinator.configStore.read(); }
    catch (e) { Logger.error('IPC config:get failed', e); throw e; }
  });
  ipcMain.handle('app:version', async () => {
    try { return app.getVersion(); }
    catch (e) { Logger.error('IPC app:version failed', e); throw e; }
  });
  ipcMain.handle('app:open-external', async (_e, url) => {
    try { return shell.openExternal(url); }
    catch (e) { Logger.error('IPC app:open-external failed', e); throw e; }
  });
  ipcMain.handle('lifecycle:start', async () => {
    try { return await coordinator.start(); }
    catch (e) { Logger.error('IPC lifecycle:start failed', e); throw e; }
  });
  ipcMain.handle('lifecycle:stop', async () => {
    try { return await coordinator.stop(); }
    catch (e) { Logger.error('IPC lifecycle:stop failed', e); throw e; }
  });
  ipcMain.handle('channels:get', async () => {
    try { return coordinator.configStore.read().channels; }
    catch (e) { Logger.error('IPC channels:get failed', e); throw e; }
  });
  ipcMain.handle('channels:set', async (_e, channels) => {
    try { return await coordinator.setChannels(channels); }
    catch (e) { Logger.error('IPC channels:set failed', e); throw e; }
  });
  ipcMain.handle('profile:refresh', async () => {
    try {
      if (coordinator.running) {
        throw new Error('Stop the app before refreshing the profile (Firefox holds files open).');
      }
      const cfg = coordinator.configStore.read();
      const cloner = new ProfileCloner({
        sourcePath: cfg.firefoxProfileSourcePath ?? ProfileCloner.findDefaultFirefoxProfile(),
        destPath: cfg.lurkerProfilePath
      });
      cloner.clone({ force: true });
      return { ok: true };
    } catch (e) { Logger.error('IPC profile:refresh failed', e); throw e; }
  });

  ipcMain.handle('setup:detect-firefox', async () => {
    try {
      const profilePath = ProfileCloner.findDefaultFirefoxProfile();
      return { found: true, path: profilePath, error: null };
    } catch (e) {
      Logger.warn('setup:detect-firefox: ' + e.message);
      return { found: false, path: null, error: e.message };
    }
  });

  ipcMain.handle('setup:clone-profile', async () => {
    try {
      const cfg = coordinator.configStore.read();
      const sourcePath = cfg.firefoxProfileSourcePath ?? ProfileCloner.findDefaultFirefoxProfile();
      let lurkerPath = cfg.lurkerProfilePath;
      if (!lurkerPath) {
        lurkerPath = path.join(process.env.APPDATA, 'twitch-lurker', 'firefox-profile');
        coordinator.configStore.write({ lurkerProfilePath: lurkerPath });
      }
      if (!cfg.firefoxProfileSourcePath) {
        coordinator.configStore.write({ firefoxProfileSourcePath: sourcePath });
      }
      const cloner = new ProfileCloner({ sourcePath, destPath: lurkerPath });
      cloner.clone({ force: false });
      return { ok: true, error: null };
    } catch (e) {
      Logger.error('IPC setup:clone-profile failed', e);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('setup:complete', async () => {
    try {
      coordinator.configStore.write({ firstRunComplete: true });
      return { ok: true };
    } catch (e) { Logger.error('IPC setup:complete failed', e); throw e; }
  });

  ipcMain.handle('log:get-path', () => Logger.getLogPath());
  ipcMain.handle('log:open', () => {
    const p = Logger.getLogPath();
    if (p) shell.showItemInFolder(p);
  });

  // First-launch notification (shown once, before wizard completes)
  const launchCfg = coordinator.configStore.read();
  if (!launchCfg.firstRunComplete && Notification.isSupported()) {
    new Notification({
      title: 'TwitchLurker',
      body: 'TwitchLurker is running in your system tray. Click the tray icon to configure.'
    }).show();
  }

  createWindow();
  pushStatus();
});

app.on('window-all-closed', (e) => { e.preventDefault?.(); /* keep alive in tray */ });
