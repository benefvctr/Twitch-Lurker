const path = require('path');
const { execSync, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { ConfigStore } = require('./ConfigStore.js');
const { ProfileCloner } = require('./ProfileCloner.js');
const { LiveDetector } = require('./LiveDetector.js');
const { BrowserController } = require('./BrowserController.js');
const { AudioMuter } = require('./AudioMuter.js');
const Logger = require('./Logger.js');

// Resolve nircmd.exe once: use process.resourcesPath when packaged, dev bin/ otherwise.
function resolveNircmdPath() {
  if (app?.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'nircmd.exe');
  }
  return path.resolve(__dirname, '..', '..', 'bin', 'nircmd.exe');
}

const PERIODIC_RESTART_MS = 6 * 60 * 60 * 1000; // 6 hours
const TAB_RETRY_LIMIT = 3;
const TAB_RETRY_DELAY_MS = 30000;
const CRASH_RESTART_ATTEMPTS = 3;
const CRASH_SETTLE_DELAY_MS = 3000;
const CRASH_RETRY_DELAY_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 5;

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
    this._periodicRestartTimer = null;
    this._restartInProgress = false;
    this._consecutiveRestartFailures = 0;
    this._tabRetries = new Map();  // channel -> retry count
  }

  getStatus() {
    const cfg = this.configStore.read();
    const channels = cfg.channels.map(ch => ({
      name: ch,
      live: this.detector?.getState(ch) ?? 'unknown',
      tabOpen: this.browser?.openChannels().includes(ch) ?? false,
      lastError: this.lastErrors.get(ch) ?? null,
      lastUpdated: this.detector?.getLastUpdated(ch) ?? null
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

    try {
      // #1: Reap stale lurker firefox processes before launch
      await this._reapStaleLurkerFirefox(lurkerPath);

      const cloner = new ProfileCloner({ sourcePath, destPath: lurkerPath });
      await cloner.clone();   // no-op if already cloned, but always clears transient files

      this.browser = new BrowserController({ profilePath: lurkerPath, nircmdPath: this._nircmdPath });
      this.browser.setWatchedChannels(cfg.channels);

      this.browser.on('tab-error', ({ channel, error }) => {
        this.lastErrors.set(channel, error.message);
        this.emit('status-changed');
        // #6: Schedule retry if detector still says channel is live
        this._scheduleTabRetry(channel);
      });
      this.browser.on('tab-opened', (ch) => {
        // #3: Clear lastError on successful tab open
        this.lastErrors.delete(ch);
        // Reset retry counter on success
        this._tabRetries.delete(ch);
        this.emit('status-changed');
      });
      this.browser.on('tab-closed', () => this.emit('status-changed'));
      this.browser.on('crashed', () => this._handleBrowserCrash());
      this.browser.on('restart-requested', () => this._handleBrowserCrash());

      // #6: Also retry on tab-died from watchdog
      this.browser.on('tab-died', (channel) => {
        this.lastErrors.set(channel, 'Tab died unexpectedly');
        this.emit('status-changed');
        this._scheduleTabRetry(channel);
      });

      // #11: Handle gated (subscriber-only / login required) tabs
      this.browser.on('tab-skipped', ({ channel, reason }) => {
        this.lastErrors.set(channel, reason === 'gated' ? 'GATED' : reason);
        this.emit('status-changed');
        // No retry for gated channels
      });

      // #12: Login required
      this.browser.on('login-required', ({ channel }) => {
        this.emit('login-required', { channel });
      });

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
      // #3: Clear lastError on successful poll
      this.detector.on('polled', (ch) => {
        this.lastErrors.delete(ch);
      });
      this.detector.start();

      // #2: Set running = true only at the very end (after periodic timer scheduled)
      // Schedule periodic restart every 6 hours to prevent tab accumulation
      this._periodicRestartTimer = setInterval(async () => {
        if (!this.running) return;
        try {
          this.emit('warning', { msg: 'Periodic 6h restart: recycling browser to prevent tab accumulation' });
          await this._handleBrowserCrash();
        } catch (e) {
          this.emit('lifecycle-error', { phase: 'periodic-restart', error: e.message });
        }
      }, PERIODIC_RESTART_MS);

      this.running = true;
      this.emit('started');
      this.emit('status-changed');
    } catch (err) {
      // #2: Transactional rollback on start failure
      await this.browser?.stop().catch(() => {});
      this.browser = null;
      if (this.detector) { this.detector.stop(); this.detector = null; }
      if (this._periodicRestartTimer) {
        clearInterval(this._periodicRestartTimer);
        this._periodicRestartTimer = null;
      }
      this.running = false;
      this.emit('lifecycle-error', { phase: 'start', error: err.message });
      throw err;
    }
  }

  async stop() {
    this.running = false;
    if (this._periodicRestartTimer) {
      clearInterval(this._periodicRestartTimer);
      this._periodicRestartTimer = null;
    }
    if (this.detector) { this.detector.stop(); this.detector = null; }
    if (this.muter) this.muter.stop();
    if (this.browser) {
      this.browser.stopWatchdog();
      await this.browser.stop();
      this.browser = null;
    }
    // #3: Clear lastErrors on stop
    this.lastErrors.clear();
    this._tabRetries.clear();
    this.emit('stopped');
    this.emit('status-changed');
  }

  async _handleBrowserCrash() {
    if (!this.running) return;
    // #4: Idempotent crash handler
    if (this._restartInProgress) return;

    this._restartInProgress = true;
    try {
      this.emit('warning', { msg: 'Browser crashed; respawning' });

      // Stop watchdog first to prevent re-entrant crash events
      this.browser?.stopWatchdog?.();

      await this.stop();

      // Settle delay before restart
      await new Promise(r => setTimeout(r, CRASH_SETTLE_DELAY_MS));

      const cfg = this.configStore.read();
      const lurkerPath = cfg.lurkerProfilePath;

      let lastErr = null;
      for (let attempt = 1; attempt <= CRASH_RESTART_ATTEMPTS; attempt++) {
        try {
          if (attempt === 1) {
            // Attempt 1: plain restart
            Logger.warn({ msg: `Crash restart attempt ${attempt}: plain restart` });
          } else if (attempt === 2) {
            // Attempt 2: reap stale firefox first
            Logger.warn({ msg: `Crash restart attempt ${attempt}: reap stale firefox then restart` });
            await this._reapStaleLurkerFirefox(lurkerPath);
          } else if (attempt === 3) {
            // Attempt 3: reclone profile, reap, then start
            Logger.warn({ msg: `Crash restart attempt ${attempt}: force-reclone profile then restart` });
            const sourcePath = cfg.firefoxProfileSourcePath ?? ProfileCloner.findDefaultFirefoxProfile();
            const cloner = new ProfileCloner({ sourcePath, destPath: lurkerPath });
            await cloner.clone({ force: true });
            await this._reapStaleLurkerFirefox(lurkerPath);
          }

          await this.start();
          // Success
          this._consecutiveRestartFailures = 0;
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          Logger.warn({ msg: `Crash restart attempt ${attempt} failed: ${e.message}` });
          if (attempt < CRASH_RESTART_ATTEMPTS) {
            await new Promise(r => setTimeout(r, CRASH_RETRY_DELAY_MS));
          }
        }
      }

      if (lastErr) {
        this._consecutiveRestartFailures++;
        const n = this._consecutiveRestartFailures;

        if (n >= MAX_CONSECUTIVE_FAILURES) {
          this.emit('give-up', { error: lastErr.message, consecutiveFailures: n });
          Logger.warn({ msg: `Give-up after ${n} consecutive restart failures: ${lastErr.message}` });
          // Stop scheduling further retries
        } else {
          // Exponential backoff: 1min * 2^n, capped at 30min
          const delay = Math.min(60000 * Math.pow(2, n - 1), 30 * 60 * 1000);
          Logger.warn({ msg: `Scheduling retry in ${Math.round(delay / 1000)}s (failure ${n})` });
          setTimeout(() => this._handleBrowserCrash(), delay);
        }
      }
    } finally {
      this._restartInProgress = false;
    }
  }

  _scheduleTabRetry(channel) {
    const retries = this._tabRetries.get(channel) ?? 0;
    if (retries >= TAB_RETRY_LIMIT) return;

    setTimeout(() => {
      // Only retry if: still running, detector says live, tab not already open
      if (
        this.running &&
        this.detector?.getState(channel) === 'live' &&
        !this.browser?.openChannels().includes(channel)
      ) {
        this.browser?.openChannel(channel).catch(() => {});
      }
    }, TAB_RETRY_DELAY_MS);

    this._tabRetries.set(channel, retries + 1);
  }

  setChannels(channels) {
    this.configStore.write({ channels });
    // #3: Prune removed channels from lastErrors
    const newSet = new Set(channels);
    for (const ch of [...this.lastErrors.keys()]) {
      if (!newSet.has(ch)) this.lastErrors.delete(ch);
    }
    for (const ch of [...this._tabRetries.keys()]) {
      if (!newSet.has(ch)) this._tabRetries.delete(ch);
    }
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

  /**
   * #1: Kill any stale lurker Firefox processes from a previous session.
   * Runs a PowerShell WMI query, Stop-Process -Force each found PID,
   * then polls up to 3s for them to disappear.
   */
  async _reapStaleLurkerFirefox() {
    return new Promise((resolve) => {
      const ps = `
$procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*twitch-lurker*firefox-profile*' };
$pids = $procs | Select-Object -ExpandProperty ProcessId;
foreach ($pid_ in $pids) {
  try { Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue } catch {}
}
Write-Output ($pids -join ',')
`;
      execFile('powershell', ['-NoProfile', '-Command', ps], { timeout: 8000 }, (err, stdout) => {
        const raw = (stdout ?? '').trim();
        const killed = raw ? raw.split(',').filter(Boolean) : [];

        if (killed.length === 0) {
          resolve();
          return;
        }

        this.emit('warning', { msg: `Reaped ${killed.length} stale lurker Firefox process(es)` });

        // Poll up to 3s for processes to disappear
        const deadline = Date.now() + 3000;
        const poll = () => {
          if (Date.now() >= deadline) { resolve(); return; }
          try {
            const checkOut = execSync(
              `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*twitch-lurker*firefox-profile*' } | Measure-Object | Select-Object -ExpandProperty Count"`,
              { encoding: 'utf8', timeout: 3000 }
            ).trim();
            const remaining = parseInt(checkOut, 10) || 0;
            if (remaining === 0) { resolve(); return; }
          } catch { /* ignore */ }
          setTimeout(poll, 500);
        };
        setTimeout(poll, 500);
      });
    });
  }
}

module.exports = { Coordinator };
