const path = require('path');
const { execSync } = require('child_process');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { ConfigStore } = require('./ConfigStore.js');
const { ProfileCloner } = require('./ProfileCloner.js');
const { LiveDetector } = require('./LiveDetector.js');
const { BrowserController } = require('./BrowserController.js');
const { AudioMuter } = require('./AudioMuter.js');

// Resolve nircmd.exe once: use process.resourcesPath when packaged, dev bin/ otherwise.
function resolveNircmdPath() {
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'nircmd.exe');
  }
  return path.resolve(__dirname, '..', '..', 'bin', 'nircmd.exe');
}

class Coordinator extends EventEmitter {
  constructor({ configPath }) {
    super();
    this.configStore = new ConfigStore(configPath);
    this.detector = null;
    this.browser = null;
    const nircmdPath = resolveNircmdPath();
    this.muter = new AudioMuter({ nircmdPath });
    this._nircmdPath = nircmdPath;
    this.running = false;
    this.lastErrors = new Map();   // channel -> error msg
  }

  getStatus() {
    const cfg = this.configStore.read();
    const channels = cfg.channels.map(ch => ({
      name: ch,
      live: this.detector?.getState(ch) ?? 'unknown',
      tabOpen: this.browser?.openChannels().includes(ch) ?? false,
      lastError: this.lastErrors.get(ch) ?? null
    }));
    return { running: this.running, channels };
  }

  async start() {
    if (this.running) return;
    const cfg = this.configStore.read();

    // Resolve profile paths
    let sourcePath = cfg.firefoxProfileSourcePath;
    if (!sourcePath) {
      sourcePath = ProfileCloner.findDefaultFirefoxProfile();
      this.configStore.write({ firefoxProfileSourcePath: sourcePath });
    }
    let lurkerPath = cfg.lurkerProfilePath;
    if (!lurkerPath) {
      lurkerPath = path.join(process.env.APPDATA, 'twitch-lurker', 'firefox-profile');
      this.configStore.write({ lurkerProfilePath: lurkerPath });
    }

    const cloner = new ProfileCloner({ sourcePath, destPath: lurkerPath });
    cloner.clone();   // no-op if already cloned, but always clears transient files

    this.browser = new BrowserController({ profilePath: lurkerPath, nircmdPath: this._nircmdPath });
    this.browser.setWatchedChannels(cfg.channels);
    this.browser.on('tab-error', ({ channel, error }) => {
      this.lastErrors.set(channel, error.message);
      this.emit('status-changed');
    });
    this.browser.on('tab-opened', () => this.emit('status-changed'));
    this.browser.on('tab-closed', () => this.emit('status-changed'));
    this.browser.on('crashed', () => this._handleBrowserCrash());

    await this.browser.start();
    this.browser.startWatchdog();

    // Resolve PID via Win32_Process (BrowserController.getPid returns null on persistent contexts)
    const pid = this._lookupLurkerPid(lurkerPath);
    if (pid) {
      this.browser.setLurkerPid(pid);
      try { await this.muter.start(pid); }
      catch (e) { this.emit('warning', { msg: 'Audio mute failed', error: e.message }); }
    } else {
      this.emit('warning', { msg: 'Could not find lurker Firefox PID for audio mute' });
    }

    this.detector = new LiveDetector(cfg.channels, { intervalSec: cfg.pollIntervalSec });
    this.detector.on('online', (ch) => { this.browser.openChannel(ch); this.emit('status-changed'); });
    this.detector.on('offline', (ch) => { this.browser.closeChannel(ch); this.emit('status-changed'); });
    this.detector.on('error', ({ channel, error }) => this.lastErrors.set(channel, error.message));
    this.detector.start();

    this.running = true;
    this.emit('started');
    this.emit('status-changed');
  }

  async stop() {
    this.running = false;
    if (this.detector) { this.detector.stop(); this.detector = null; }
    if (this.muter) this.muter.stop();
    if (this.browser) {
      this.browser.stopWatchdog();
      await this.browser.stop();
      this.browser = null;
    }
    this.emit('stopped');
    this.emit('status-changed');
  }

  async _handleBrowserCrash() {
    if (!this.running) return;
    this.emit('warning', { msg: 'Browser crashed; respawning' });
    await this.stop();
    await this.start();
  }

  setChannels(channels) {
    this.configStore.write({ channels });
    if (this.detector) this.detector.setChannels(channels);
    if (this.browser) this.browser.setWatchedChannels(channels);
    this.emit('status-changed');
  }

  _lookupLurkerPid(profilePath) {
    try {
      // Filter Firefox processes by command-line containing the lurker profile path.
      // Use a path fragment that's unlikely to collide (e.g. 'twitch-lurker').
      const out = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*twitch-lurker*firefox-profile*' } | Select-Object -First 1 -ExpandProperty ProcessId"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      return out ? parseInt(out, 10) : null;
    } catch {
      return null;
    }
  }
}

module.exports = { Coordinator };
