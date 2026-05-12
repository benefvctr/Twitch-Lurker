const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Coordinator } = require('./Coordinator.js');
const { createTray } = require('./tray.js');
const { ProfileCloner } = require('./ProfileCloner.js');

// In dev, __dirname is src/main and PROJECT_ROOT is the repo root.
// When packaged, app.getAppPath() returns the asar root (same structure inside the archive).
const PROJECT_ROOT = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
// Assets are copied to process.resourcesPath/assets by electron-builder extraResources.
const ASSETS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, 'assets')
  : path.join(PROJECT_ROOT, 'assets');

// Set PLAYWRIGHT_BROWSERS_PATH so Playwright finds the bundled Firefox.
if (app.isPackaged) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');
}

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
  coordinator = new Coordinator({ configPath: CONFIG_PATH });
  coordinator.on('status-changed', pushStatus);
  coordinator.on('warning', (w) => console.warn('[lurker]', w));

  tray = createTray({
    assetsDir: ASSETS_DIR,
    onShow: createWindow,
    onStart: () => coordinator.start().catch(e => console.error(e)),
    onStop:  () => coordinator.stop().catch(e => console.error(e)),
    onQuit:  () => { app.exit(0); }
  });

  ipcMain.handle('status:get', () => coordinator.getStatus());
  ipcMain.handle('lifecycle:start', () => coordinator.start());
  ipcMain.handle('lifecycle:stop', () => coordinator.stop());
  ipcMain.handle('channels:get', () => coordinator.configStore.read().channels);
  ipcMain.handle('channels:set', (_e, channels) => coordinator.setChannels(channels));
  ipcMain.handle('profile:refresh', async () => {
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
  });

  createWindow();
  pushStatus();
});

app.on('window-all-closed', (e) => { e.preventDefault?.(); /* keep alive in tray */ });
