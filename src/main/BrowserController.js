const { firefox } = require('playwright');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const Logger = require('./Logger.js');
const { reapLurkerFirefox } = require('./firefoxReaper.js');

// Explicit launch timeout. Playwright's default is 180000ms; we raise it for
// headroom + diagnostics, but the real cure for the chronic launch hang is the
// process-tree reaper + lock verification — never this bump alone.
const LAUNCH_TIMEOUT_MS = 300000;
// Bound on context.close() so a hung close (common with many open tabs) can't
// leave the old process holding the profile lock into the next launch.
const CLOSE_TIMEOUT_MS = 10000;

// Paths/hosts that should be preserved (not closed by watchdog page sweep)
const PRESERVED_PATH_PREFIXES = ['/login', '/signup', '/directory', '/settings', '/p/'];
const PRESERVED_HOSTS = ['passport.twitch.tv', 'id.twitch.tv'];

class BrowserController extends EventEmitter {
  constructor({ profilePath, nircmdPath }) {
    super();
    this.profilePath = profilePath;
    this.nircmdPath = nircmdPath;
    this.context = null;
    this.tabs = new Map();   // channel -> Page
    this._stopping = false;
    // Set the moment the context begins tearing down (close/crash) so openChannel
    // doesn't try to create a page against a dying context (the "Target page,
    // context or browser has been closed" burst).
    this._contextClosing = false;
    this.watchedChannels = new Set();
    this._watchdogTimer = null;
    this.watchdogIntervalMs = 30000;
    this._lurkerPid = null;
  }

  setLurkerPid(pid) {
    this._lurkerPid = pid;
    this._minimizeLurkerWindows();
  }

  _minimizeLurkerWindows() {
    // Prefer moving lurker Firefox windows to the secondary monitor (keeps video rendering).
    // If no secondary monitor exists, fall back to SW_MINIMIZE so single-monitor users
    // still get the windows out of the way.
    const moveAll = () => {
      const ps = `
Add-Type -AssemblyName System.Windows.Forms;
$secondary = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1;
$moveSig = '[DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);';
$showSig = '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);';
$type = Add-Type -MemberDefinition ($moveSig + $showSig) -Name W2 -Namespace Q2 -PassThru;
$lurkerPids = Get-CimInstance Win32_Process -Filter "Name = 'firefox.exe'" | Where-Object { $_.CommandLine -like '*twitch-lurker*firefox-profile*' } | Select-Object -ExpandProperty ProcessId;
foreach ($pid_ in $lurkerPids) {
  $proc = Get-Process -Id $pid_ -ErrorAction SilentlyContinue;
  if ($proc -and $proc.MainWindowHandle -ne 0) {
    if ($secondary) {
      $x = $secondary.Bounds.X + 20; $y = $secondary.Bounds.Y + 20;
      $type::MoveWindow($proc.MainWindowHandle, $x, $y, 640, 400, $true) | Out-Null;
    } else {
      $type::ShowWindow($proc.MainWindowHandle, 6) | Out-Null;
    }
  }
}
`;
      execFile('powershell', ['-NoProfile', '-Command', ps], (err) => {
        if (err) this.emit('warning', { msg: 'Window move failed', error: err.message });
      });
    };
    moveAll();
    setTimeout(moveAll, 2000);
    setTimeout(moveAll, 5000);
  }

  async start() {
    this._stopping = false;
    this._contextClosing = false;
    // Instrumentation: prove where time goes (Juggler handshake vs. clone vs.
    // close). Every production timeout being exactly 180000ms is what told us
    // no custom timeout was set; this elapsed log confirms the fix in the next log.
    const launchStart = Date.now();
    // -no-remote is dropped from args: Playwright already passes it, and the
    // duplicate showed up twice on the launch command line.
    this.context = await firefox.launchPersistentContext(this.profilePath, {
      headless: false,
      timeout: LAUNCH_TIMEOUT_MS,
      env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' }
    });
    Logger.info({ msg: 'launchPersistentContext completed', elapsedMs: Date.now() - launchStart });
    // Seed Twitch's quality preference in localStorage BEFORE the page loads.
    // Twitch's player JS reads this on init and picks the right quality with no
    // UI interaction needed. Avoids the historic problem of clicking the wrong
    // element in the quality submenu (e.g. landing on "Gift a Sub").
    await this.context.addInitScript(() => {
      try {
        localStorage.setItem('video-quality', '{"default":"160p30"}');
        localStorage.setItem('video-muted', '{"default":false}');
      } catch { /* private/storage disabled — fine */ }
    });
    this.context.on('close', () => {
      this._contextClosing = true;
      if (!this._stopping) this.emit('crashed');
    });
    // Coordinator looks up the PID via Win32_Process; browser().process() doesn't exist on persistent contexts
    this.emit('started');
    // NOTE: watchdog is started by Coordinator after start() returns
  }

  async stop() {
    this.stopWatchdog();
    this._stopping = true;
    this._contextClosing = true;
    const ctx = this.context;
    // Null the handle up front so any concurrent openChannel bails immediately.
    this.context = null;
    if (ctx) {
      // Bound context.close(): a bare close can hang indefinitely with many open
      // tabs, and a hung close keeps the old Firefox — and its profile lock —
      // alive into the next launch (the launchPersistentContext timeout).
      const closeStart = Date.now();
      let timer;
      try {
        await Promise.race([
          ctx.close(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`context.close exceeded ${CLOSE_TIMEOUT_MS}ms`)), CLOSE_TIMEOUT_MS);
          })
        ]);
        Logger.info({ msg: 'context.close completed', elapsedMs: Date.now() - closeStart });
      } catch (e) {
        // close hung — force-kill the lurker Firefox tree so the lock is released.
        Logger.warn({ msg: 'context.close did not complete; force-killing lurker Firefox tree', error: e.message });
        try {
          const r = await reapLurkerFirefox();
          Logger.warn({ msg: 'forced reap after hung close', killed: r.killed, remaining: r.remaining, clean: r.clean });
        } catch (killErr) {
          Logger.warn({ msg: 'forced reap after hung close failed', error: killErr.message });
        }
      } finally {
        clearTimeout(timer);
      }
      // Whether close resolved or we force-killed, the handle is gone and stop()
      // always completes — so the next launch isn't blocked by a hung teardown.
    }
    this.tabs.clear();
  }

  getPid() {
    // browser().process() doesn't exist on persistent contexts.
    // Coordinator uses _lookupLurkerPid via Win32_Process instead.
    return null;
  }

  setWatchedChannels(channels) {
    this.watchedChannels = new Set(channels.map(c => c.toLowerCase()));
  }

  async openChannel(channel) {
    // BUG 7: normalize at the BrowserController boundary so Map keys are always lowercase
    const ch = channel.toLowerCase();
    if (this.tabs.has(ch)) return;
    if (!this.context) throw new Error('BrowserController not started');
    // Guard against the teardown race: an `online` event can fire while the
    // context is closing/restarting. Creating a page now throws "Target page,
    // context or browser has been closed" — skip quietly; the restart will
    // reopen live channels.
    if (this._contextClosing || this._stopping) return;

    const url = `https://www.twitch.tv/${ch}`;

    // Use context.newPage() directly for serialized, predictable tab creation.
    // Firefox prefs (browser.link.open_newwindow=3) coalesce new pages into tabs in same window.
    const ctx = this.context;
    const page = await ctx.newPage();
    this.tabs.set(ch, page);
    page._lurkerExpectedChannel = ch;
    page._lurkerOpening = true;

    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this._handleNavigation(page, frame.url());
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await this._dismissMatureGate(page);

      // Check for subscriber/login gating before declaring tab-error
      const gated = await this._checkGated(page);
      if (gated) {
        page._lurkerOpening = false;
        this.tabs.delete(ch);
        try { await page.close(); } catch { /* */ }
        this.emit('tab-skipped', { channel: ch, reason: 'gated' });
        return;
      }

      await page.waitForSelector('video', { timeout: 30000 });
      page._lurkerOpening = false;
      // Quality is set via the addInitScript localStorage seed in start();
      // no menu navigation here — that historically misclicked "Gift a Sub".
      await this._ensureUnmuted(page);
      this._minimizeLurkerWindows();
      this.emit('tab-opened', ch);
    } catch (e) {
      page._lurkerOpening = false;
      this.tabs.delete(ch);
      this.emit('tab-error', { channel: ch, error: e });
      try { await page.close(); } catch { /* */ }
    }
  }

  async closeChannel(channel) {
    // BUG 7: normalize at boundary
    const ch = channel.toLowerCase();
    const page = this.tabs.get(ch);
    if (!page) return;
    this.tabs.delete(ch);
    try { await page.close(); } catch { /* */ }
    this.emit('tab-closed', ch);
  }

  async _dismissMatureGate(page) {
    // Try multiple selectors for mature/age gate variants; allow 8s total window
    const selectors = [
      'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
      'button[data-a-target="content-classification-gate-overlay-watch-anyway-button"]',
      'button[data-a-target="player-overlay-mature-accept"]'
    ];

    // Try data-a-target selectors first (fast, specific)
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 2000 });
        await page.click(sel);
        return; // clicked one, done
      } catch { /* not present, try next */ }
    }

    // Fallback: role-based button match for variants not covered above
    try {
      await page.getByRole('button', { name: /start watching|watch anyway|continue|i.?m 18/i })
        .click({ timeout: 1500 });
    } catch { /* not present, fine */ }
  }

  async _checkGated(page) {
    // Check for subscriber-only or login-required text after gate dismiss attempt
    try {
      const visible = await page.locator('text=/subscribe to watch|log in to watch/i').first().isVisible();
      return visible;
    } catch {
      return false;
    }
  }

  _isPreservedPage(url) {
    try {
      const u = new URL(url);
      if (PRESERVED_HOSTS.includes(u.hostname)) return true;
      for (const prefix of PRESERVED_PATH_PREFIXES) {
        if (u.pathname.startsWith(prefix)) return true;
      }
    } catch { /* invalid url */ }
    return false;
  }

  _extractChannelFromUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname !== 'www.twitch.tv') return null;
      const seg = u.pathname.split('/').filter(Boolean);
      if (seg.length === 0) return null;
      // Skip non-channel paths
      if (['directory', 'videos', 'p', 'settings', 'inventory'].includes(seg[0])) return null;
      return seg[0].toLowerCase();
    } catch { return null; }
  }

  _handleNavigation(page, url) {
    // Suppress framenavigated events while the tab is still in the opening sequence
    if (page._lurkerOpening) return;

    // Detect login/auth redirect
    if (this._isLoginUrl(url)) {
      this.emit('login-required', { channel: page._lurkerExpectedChannel });
      return;
    }

    const newSlug = this._extractChannelFromUrl(url);
    const expected = page._lurkerExpectedChannel?.toLowerCase();
    if (!newSlug) return;            // non-channel page (settings, etc.)
    if (newSlug === expected) return; // same channel, normal page mutation
    // We've navigated to a different channel — raid or host
    if (this.watchedChannels.has(newSlug)) {
      // Re-bind: we now lurk this channel via this tab
      const oldChannel = page._lurkerExpectedChannel;
      this.tabs.delete(oldChannel);
      this.tabs.set(newSlug, page);
      page._lurkerExpectedChannel = newSlug.toLowerCase();
      this.emit('tab-rebound', { from: oldChannel, to: newSlug });
    } else {
      // Not on watchlist — close
      const ch = page._lurkerExpectedChannel;
      this.emit('raid-out', { channel: ch, to: newSlug });
      this.closeChannel(ch);
    }
  }

  _isLoginUrl(url) {
    try {
      const u = new URL(url);
      if (PRESERVED_HOSTS.includes(u.hostname)) return true;
      if (u.pathname.startsWith('/login') || u.pathname.startsWith('/signup')) return true;
    } catch { /* */ }
    return false;
  }

  async _ensureUnmuted(page) {
    try {
      const isMuted = await page.evaluate(() => document.querySelector('video')?.muted);
      if (isMuted) {
        await page.focus('video');
        await page.keyboard.press('m');
      }
    } catch { /* */ }
  }

  requestRestart() {
    this.emit('restart-requested');
  }

  startWatchdog() {
    if (this._watchdogTimer) return;
    const tick = async () => {
      if (!this.context) return;

      // --- Hard cap: too many pages forces a full restart ---
      // Preserved pages (login/settings) are excluded from the count
      let allPages;
      try {
        allPages = this.context.pages();
      } catch {
        return;
      }
      const countablePages = allPages.filter(p => {
        try { return !this._isPreservedPage(p.url()); } catch { return true; }
      });
      if (countablePages.length > 20) {
        this.emit('warning', { msg: `Page count ${countablePages.length} exceeds hard cap of 20; requesting restart` });
        this.requestRestart();
        return;
      }

      // --- Sweep: close untracked pages with a twitch channel slug ---
      const trackedChannels = new Set([...this.tabs.keys()].map(c => c.toLowerCase()));
      for (const page of allPages) {
        if (page.isClosed()) continue;
        const url = page.url();
        // Skip blank/transient pages and preserved pages (login, settings, etc.)
        if (!url || url === 'about:blank' || url === '') continue;
        if (this._isPreservedPage(url)) continue;
        const slug = this._extractChannelFromUrl(url);
        // Only close pages that belong to a twitch channel that we are NOT tracking
        if (slug && !trackedChannels.has(slug)) {
          try { await page.close(); } catch { /* */ }
        }
      }

      // --- Original watchdog: check tracked tabs for stalls ---
      for (const [channel, page] of this.tabs) {
        try {
          if (page.isClosed()) {
            this.tabs.delete(channel);
            this.emit('tab-died', channel);
            continue;
          }
          const ok = await page.evaluate(() => !!document.querySelector('video'));
          if (!ok) {
            this.emit('tab-stalled', channel);
            await this.closeChannel(channel);
          }
        } catch (e) {
          this.emit('tab-died', channel);
          this.tabs.delete(channel);
        }
      }
    };
    this._watchdogTimer = setInterval(tick, this.watchdogIntervalMs);
  }

  stopWatchdog() {
    if (this._watchdogTimer) clearInterval(this._watchdogTimer);
    this._watchdogTimer = null;
  }

  openChannels() {
    return [...this.tabs.keys()];
  }
}

module.exports = { BrowserController };
