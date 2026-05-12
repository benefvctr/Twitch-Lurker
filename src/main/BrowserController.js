const { firefox } = require('playwright');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');

class BrowserController extends EventEmitter {
  constructor({ profilePath, nircmdPath }) {
    super();
    this.profilePath = profilePath;
    this.nircmdPath = nircmdPath;
    this.context = null;
    this.tabs = new Map();   // channel -> Page
    this._stopping = false;
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
    this.context = await firefox.launchPersistentContext(this.profilePath, {
      headless: false,
      args: ['-no-remote'],
      env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' }
    });
    this.context.on('close', () => {
      if (!this._stopping) this.emit('crashed');
    });
    // Coordinator looks up the PID via Win32_Process; browser().process() doesn't exist on persistent contexts in Playwright 1.48
    this.emit('started');
    this.startWatchdog();
  }

  async stop() {
    this.stopWatchdog();
    this._stopping = true;
    if (this.context) {
      try { await this.context.close(); } catch { /* */ }
      this.context = null;
    }
    this.tabs.clear();
  }

  getPid() {
    // browser().process() doesn't exist on persistent contexts in Playwright 1.48.
    // Coordinator uses _lookupLurkerPid via Win32_Process instead.
    return null;
  }

  setWatchedChannels(channels) {
    this.watchedChannels = new Set(channels.map(c => c.toLowerCase()));
  }

  async openChannel(channel) {
    if (this.tabs.has(channel)) return;
    if (!this.context) throw new Error('BrowserController not started');

    const url = `https://www.twitch.tv/${channel}`;
    let page;
    // For subsequent tabs, use window.open from an existing page so Firefox
    // adds a tab to the same window instead of opening a new top-level window.
    const existing = [...this.tabs.values()][0];
    if (existing && !existing.isClosed()) {
      const newPagePromise = this.context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
      await existing.evaluate((u) => window.open(u, '_blank'), url);
      page = await newPagePromise;
      if (!page) {
        // Fallback: window.open got blocked or didn't fire. Use newPage (separate window).
        page = await this.context.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
    } else {
      page = await this.context.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    this.tabs.set(channel, page);
    page._lurkerExpectedChannel = channel;
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this._handleNavigation(page, frame.url());
    });
    try {
      await this._dismissMatureGate(page);
      await page.waitForSelector('video', { timeout: 30000 });
      await this._setLowestQuality(page);
      await this._ensureUnmuted(page);
      this._minimizeLurkerWindows();
      this.emit('tab-opened', channel);
    } catch (e) {
      this.emit('tab-error', { channel, error: e });
      await this.closeChannel(channel);
    }
  }

  async closeChannel(channel) {
    const page = this.tabs.get(channel);
    if (!page) return;
    this.tabs.delete(channel);
    try { await page.close(); } catch { /* */ }
    this.emit('tab-closed', channel);
  }

  async _dismissMatureGate(page) {
    try {
      const sel = 'button[data-a-target="content-classification-gate-overlay-start-watching-button"]';
      await page.waitForSelector(sel, { timeout: 4000 });
      await page.click(sel);
    } catch { /* not present, fine */ }
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
      page._lurkerExpectedChannel = newSlug;
      this.emit('tab-rebound', { from: oldChannel, to: newSlug });
    } else {
      // Not on watchlist — close
      const ch = page._lurkerExpectedChannel;
      this.emit('raid-out', { channel: ch, to: newSlug });
      this.closeChannel(ch);
    }
  }

  async _setLowestQuality(page) {
    try {
      await page.click('[data-a-target="player-settings-button"]', { timeout: 5000 });
      await page.waitForSelector('button[data-a-target="player-settings-menu-item-quality"]', { timeout: 5000 });
      await page.click('button[data-a-target="player-settings-menu-item-quality"]');
      await page.waitForTimeout(400);
      const opts = await page.$$('input[name="player-settings-submenu-quality-option"]');
      if (opts.length > 0) {
        // Use force: true because Twitch sometimes overlays an element on top of the radio
        await opts[opts.length - 1].click({ force: true, timeout: 3000 });
      }
      // Close settings menu by pressing Escape
      await page.keyboard.press('Escape');
    } catch (e) {
      this.emit('warning', { msg: 'Could not set quality', error: e.message });
    }
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

  startWatchdog() {
    if (this._watchdogTimer) return;
    const tick = async () => {
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
