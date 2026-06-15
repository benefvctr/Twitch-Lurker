const path = require('path');
const { execSync } = require('child_process');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { ConfigStore } = require('./ConfigStore.js');
const { ProfileCloner } = require('./ProfileCloner.js');
const { LiveDetector } = require('./LiveDetector.js');
const { BrowserController } = require('./BrowserController.js');
const { AudioMuter } = require('./AudioMuter.js');
const { reapLurkerFirefox } = require('./firefoxReaper.js');
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
// Time for Windows to release file handles / named pipes after the old session
// dies before we relaunch. 3s was too short for a 24/7 app and left the profile
// lock held into the next launch.
const CRASH_SETTLE_DELAY_MS = 10000;
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
    this.lastErrors = new Map();   // channel (lowercase) -> error msg
    this._periodicRestartTimer = null;
    this._restartInProgress = false;
    this._consecutiveRestartFailures = 0;
    this._tabRetries = new Map();  // channel (lowercase) -> retry count
    // BUG 4: track user-initiated stop so restart attempts can honor it
    this._userStopped = false;
    // BUG 5: guard against concurrent start() calls
    this._startInProgress = false;
    // NICE 5: track pending tab-retry timeout handles for clean shutdown
    this._pendingRetries = new Set();
  }

  getStatus() {
    const cfg = this.configStore.read();
    const channels = cfg.channels.map(ch => ({
      name: ch,
      live: this.detector?.getState(ch.toLowerCase()) ?? 'unknown',
      // BUG 7: use lowercase key for lookup; display name stays user-entered
      tabOpen: this.browser?.openChannels().includes(ch.toLowerCase()) ?? false,
      lastError: this.lastErrors.get(ch.toLowerCase()) ?? null,
      lastUpdated: this.detector?.getLastUpdated(ch.toLowerCase()) ?? null
    }));
    return { running: this.running, channels };
  }

  async start() {
    if (this.running) return;
    // BUG 5: guard against concurrent calls that both pass the running check
    if (this._startInProgress) return;
    this._startInProgress = true;
    // BUG 4: clear user-stopped flag when user explicitly starts
    this._userStopped = false;
    // BUG 6: reset failure counter on manual start so give-up threshold is fresh
    this._consecutiveRestartFailures = 0;

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
      await this._reapStaleLurkerFirefox();

      const cloner = new ProfileCloner({ sourcePath, destPath: lurkerPath });
      await cloner.clone();   // no-op if already cloned, but always clears transient files

      this.browser = new BrowserController({ profilePath: lurkerPath, nircmdPath: this._nircmdPath });
      // BUG 7: pass lowercase channel names to BrowserController
      this.browser.setWatchedChannels(cfg.channels.map(c => c.toLowerCase()));

      this.browser.on('tab-error', ({ channel, error }) => {
        // BrowserController emits lowercase channel names
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
      // BUG 1: event handlers check this.running before calling crash handler
      this.browser.on('crashed', () => {
        if (!this.running || this._userStopped) return;
        this._handleBrowserCrash();
      });
      this.browser.on('restart-requested', () => {
        if (!this.running || this._userStopped) return;
        this._handleBrowserCrash();
      });

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

      // BUG 7: pass lowercase channel names to LiveDetector
      const lowerChannels = cfg.channels.map(c => c.toLowerCase());
      this.detector = new LiveDetector(lowerChannels, { intervalSec: cfg.pollIntervalSec });
      this.detector.on('online', (ch) => { this.browser.openChannel(ch); this.emit('status-changed'); });
      this.detector.on('offline', (ch) => { this.browser.closeChannel(ch); this.emit('status-changed'); });
      this.detector.on('error', ({ channel, error }) => this.lastErrors.set(channel, error.message));
      // #3: Clear lastError on successful poll — but preserve sticky GATED marker (BUG 3)
      this.detector.on('polled', (ch) => {
        // GATED is a terminal state until restart; do not wipe it on routine poll success
        if (this.lastErrors.get(ch) !== 'GATED') {
          this.lastErrors.delete(ch);
        }
      });
      this.detector.start();

      // #2: Set running = true only at the very end (after periodic timer scheduled)
      // Schedule periodic restart every 6 hours to prevent tab accumulation
      this._periodicRestartTimer = setInterval(async () => {
        if (!this.running) return;
        try {
          this.emit('warning', { msg: 'Periodic 6h restart: recycling browser to prevent tab accumulation' });
          // Periodic restarts go through _handleBrowserCrash directly (not event path)
          this._handleBrowserCrash('periodic');
        } catch (e) {
          this.emit('lifecycle-error', { phase: 'periodic-restart', error: e.message });
        }
      }, PERIODIC_RESTART_MS);

      this.running = true;
      this.emit('started');
      this.emit('status-changed');
    } catch (err) {
      // #2: Transactional rollback on start failure
      // NICE 2: also stop muter during rollback
      if (this.muter) this.muter.stop();
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
    } finally {
      // BUG 5: always release the start-in-progress guard
      this._startInProgress = false;
    }
  }

  async stop({ userInitiated = true } = {}) {
    // BUG 4: mark that the user explicitly stopped so in-flight restarts abort.
    // CRITICAL: only a user-initiated stop sets this flag. The automatic restart
    // path (_attemptRestart) calls stop({ userInitiated: false }) as its first
    // step; if that internal stop set _userStopped, the very next _userStopped
    // guard in _attemptRestart would abort the restart and the browser would
    // never relaunch (the chronic "6h restart never comes back" bug).
    if (userInitiated) this._userStopped = true;
    this.running = false;
    if (this._periodicRestartTimer) {
      clearInterval(this._periodicRestartTimer);
      this._periodicRestartTimer = null;
    }
    // NICE 5: cancel all pending tab-retry timeouts
    for (const handle of this._pendingRetries) clearTimeout(handle);
    this._pendingRetries.clear();
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

  /**
   * BUG 2: Reopen a single channel's tab without a full restart.
   * Used when the tab navigated to login (session expired) — the browser is
   * still healthy, we just need to close and re-open the channel tab.
   */
  async reopenChannel(channel) {
    const ch = channel.toLowerCase();
    this.lastErrors.delete(ch);
    if (this.browser) {
      await this.browser.closeChannel(ch).catch(() => {});
      await this.browser.openChannel(ch).catch(() => {});
    }
    this.emit('status-changed');
  }

  /**
   * BUG 1: Entry point from event handlers (crashed / restart-requested).
   * Only called when running=true and not user-stopped (callers check that).
   * Delegates to _attemptRestart which bypasses the running guard.
   */
  _handleBrowserCrash(reason = 'crash') {
    // Idempotent: only one restart sequence at a time
    if (this._restartInProgress) return;
    this._attemptRestart(reason);
  }

  /**
   * BUG 1: Actual restart logic. Does NOT check this.running — that's intentional.
   * The stop() call inside will set running=false, and we need to be able to
   * call start() after that. Scheduled retries call this directly (not _handleBrowserCrash)
   * so they also bypass the running guard while still respecting _userStopped.
   */
  async _attemptRestart(reason = 'crash') {
    this._restartInProgress = true;
    try {
      // BUG 4: if user stopped while we were queued, abort
      if (this._userStopped) return;

      this.emit('warning', {
        msg: reason === 'periodic'
          ? 'Periodic restart: respawning browser'
          : 'Browser crashed; respawning'
      });

      // Stop watchdog first to prevent re-entrant crash events
      this.browser?.stopWatchdog?.();

      // userInitiated:false — this is our own teardown, not a user stop. Setting
      // _userStopped here would make the guards below abort the relaunch.
      await this.stop({ userInitiated: false });

      // BUG 4: check again after stop() which may have been called concurrently
      if (this._userStopped) return;

      // Settle delay before restart
      await new Promise(r => setTimeout(r, CRASH_SETTLE_DELAY_MS));

      if (this._userStopped) return;

      const cfg = this.configStore.read();
      const lurkerPath = cfg.lurkerProfilePath;

      let lastErr = null;
      for (let attempt = 1; attempt <= CRASH_RESTART_ATTEMPTS; attempt++) {
        // BUG 4: abort mid-loop if user stopped
        if (this._userStopped) return;

        try {
          if (attempt === 1) {
            // Attempt 1: plain restart
            Logger.warn({ msg: `Crash restart attempt ${attempt}: plain restart` });
          } else if (attempt === 2) {
            // Attempt 2: reap stale firefox first
            Logger.warn({ msg: `Crash restart attempt ${attempt}: reap stale firefox then restart` });
            await this._reapStaleLurkerFirefox();
          } else if (attempt === 3) {
            // Attempt 3: reclone profile, reap, then start
            Logger.warn({ msg: `Crash restart attempt ${attempt}: force-reclone profile then restart` });
            const sourcePath = cfg.firefoxProfileSourcePath ?? ProfileCloner.findDefaultFirefoxProfile();
            const cloner = new ProfileCloner({ sourcePath, destPath: lurkerPath });
            await cloner.clone({ force: true });
            await this._reapStaleLurkerFirefox();
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
        // BUG 4: don't increment counter or schedule if user stopped
        if (this._userStopped) return;

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
          // BUG 1: scheduled retry calls _attemptRestart directly, bypassing the
          // running guard in _handleBrowserCrash — that's intentional
          setTimeout(() => this._attemptRestart(), delay);
        }
      }
    } finally {
      this._restartInProgress = false;
    }
  }

  _scheduleTabRetry(channel) {
    const retries = this._tabRetries.get(channel) ?? 0;
    if (retries >= TAB_RETRY_LIMIT) return;

    // NICE 5: track handle so stop() can cancel pending retries
    const handle = setTimeout(() => {
      this._pendingRetries.delete(handle);
      // Only retry if: still running, detector says live, tab not already open
      if (
        this.running &&
        this.detector?.getState(channel) === 'live' &&
        !this.browser?.openChannels().includes(channel)
      ) {
        this.browser?.openChannel(channel).catch(() => {});
      }
    }, TAB_RETRY_DELAY_MS);
    this._pendingRetries.add(handle);

    this._tabRetries.set(channel, retries + 1);
  }

  setChannels(channels) {
    this.configStore.write({ channels });
    // BUG 7: use lowercase keys consistently in internal maps
    const newSet = new Set(channels.map(c => c.toLowerCase()));
    for (const ch of [...this.lastErrors.keys()]) {
      if (!newSet.has(ch)) this.lastErrors.delete(ch);
    }
    for (const ch of [...this._tabRetries.keys()]) {
      if (!newSet.has(ch)) this._tabRetries.delete(ch);
    }
    if (this.detector) this.detector.setChannels([...newSet]);
    // BUG 7: pass lowercase names to BrowserController
    if (this.browser) this.browser.setWatchedChannels([...newSet]);
    this.emit('status-changed');
  }

  _lookupLurkerPid(profilePath) {
    try {
      // Filter Firefox processes by command-line containing the lurker profile path.
      // Use a path fragment that's unlikely to collide (e.g. 'twitch-lurker').
      // Name = 'firefox.exe' filter is required: without it the query matches
      // its own PowerShell process (whose command line contains the marker text)
      // and can return that PID instead of Firefox's, breaking audio mute.
      const out = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = 'firefox.exe'\\" | Where-Object { $_.CommandLine -like '*twitch-lurker*firefox-profile*' } | Select-Object -First 1 -ExpandProperty ProcessId"`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      return out ? parseInt(out, 10) : null;
    } catch {
      return null;
    }
  }

  /**
   * #1: Kill any stale lurker Firefox processes (and their full child tree) from
   * a previous session before launching. This is the primary cure for the
   * chronic launchPersistentContext timeout: a half-dead process tree keeps the
   * profile locked (parent.lock / *.sqlite), and the new launch then stalls.
   *
   * Delegated to firefoxReaper.reapLurkerFirefox, which walks ParentProcessId to
   * find content/gpu/rdd/socket children (they don't carry the profile marker),
   * kills children-first, and verifies by PID. Called unconditionally before
   * every launch via start(), so restart attempt 1 reaps too.
   */
  async _reapStaleLurkerFirefox() {
    const r = await reapLurkerFirefox();
    if (r.killed > 0) {
      this.emit('warning', { msg: `Reaped lurker Firefox tree (${r.killed} process(es))` });
    }
    if (!r.clean) {
      // remaining === -1 means the verify step couldn't run; remaining > 0 means
      // some processes outlived the deadline. Either way the profile may still be
      // locked — surface it loudly so the next-launch timeout isn't a mystery.
      Logger.warn({ msg: 'Stale lurker Firefox did not fully die before launch', killed: r.killed, remaining: r.remaining });
      this.emit('warning', { msg: `Warning: ${r.remaining < 0 ? 'unknown' : r.remaining} lurker Firefox process(es) may still hold the profile lock` });
    }
  }
}

module.exports = { Coordinator };
