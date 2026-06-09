const fs = require('fs');
const path = require('path');
const Logger = require('./Logger.js');

const TOLERATED_UNLINK_CODES = ['EBUSY', 'EPERM', 'ENOENT'];
// Lock files that block a fresh launchPersistentContext if left behind.
const LOCK_FILES = ['parent.lock', 'lock', '.parentlock'];

function _sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

class ProfileCloner {
  constructor({ sourcePath, destPath }) {
    this.sourcePath = sourcePath;
    this.destPath = destPath;
  }

  static findDefaultFirefoxProfile() {
    const appData = process.env.APPDATA;
    if (!appData) throw new Error('APPDATA not set');
    const profilesIni = path.join(appData, 'Mozilla', 'Firefox', 'profiles.ini');
    if (!fs.existsSync(profilesIni)) {
      throw new Error(`Firefox profiles.ini not found at ${profilesIni}`);
    }
    const text = fs.readFileSync(profilesIni, 'utf8');
    const sections = text.split(/\r?\n\r?\n/);
    for (const s of sections) {
      if (s.startsWith('[Install')) {
        const m = s.match(/Default=(.+)/);
        if (m) return path.join(appData, 'Mozilla', 'Firefox', m[1].trim());
      }
    }
    for (const s of sections) {
      if (s.startsWith('[Profile') && /Default=1/.test(s)) {
        const m = s.match(/Path=(.+)/);
        if (m) return path.join(appData, 'Mozilla', 'Firefox', m[1].trim());
      }
    }
    throw new Error('Could not find default Firefox profile');
  }

  exists() {
    return fs.existsSync(this.destPath) && fs.existsSync(path.join(this.destPath, 'prefs.js'));
  }

  async clone({ force = false } = {}) {
    let cloned = false;
    if (force && fs.existsSync(this.destPath)) {
      // Retry helper: up to 3 attempts with 1s delay, tolerating EBUSY on intermediate attempts
      let lastErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          fs.rmSync(this.destPath, { recursive: true, force: true });
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < 3 && e.code === 'EBUSY') {
            await _sleep(1000);
          } else if (attempt === 3) {
            // On final failure, log warning and proceed (best-effort reclone)
            console.warn(`[ProfileCloner] rmSync failed after 3 attempts: ${e.message} — proceeding anyway`);
            lastErr = null; // don't re-throw, proceed
          } else {
            throw e; // non-EBUSY errors on intermediate attempts are fatal
          }
        }
      }
    }
    if (!this.exists()) {
      this._copyDir(this.sourcePath, this.destPath);
      cloned = true;
    }
    this._clearTransient();
    // Always (re)write our user.js so pref changes propagate to existing profiles too
    this._writeLurkerPrefs();
    return cloned;
  }

  _writeLurkerPrefs() {
    const userJs = path.join(this.destPath, 'user.js');
    const lines = [
      // Disable signature checks in case the user's channel-points extension fails to load
      'user_pref("xpinstall.signatures.required", false);',
      // Force tabs over new windows so all lurker channels share one Firefox window
      'user_pref("browser.link.open_newwindow", 3);',
      'user_pref("browser.link.open_newwindow.restriction", 0);',
      'user_pref("browser.tabs.loadDivertedInBackground", true);',
      // Keep video playing when window is minimized / not visible (critical for watch-time accrual)
      'user_pref("media.suspend-bkgnd-video.enabled", false);',
      'user_pref("media.block-autoplay-until-in-foreground", false);',
      'user_pref("dom.audiochannel.mediaControl", false);',
      'user_pref("media.autoplay.default", 0);',
      'user_pref("media.autoplay.blocking_policy", 0);'
    ];
    fs.writeFileSync(userJs, lines.join('\n') + '\n');
  }

  // Recursive copy that skips locked/busy files (Firefox may hold DB files open)
  _copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        this._copyDir(srcPath, destPath);
      } else {
        try {
          fs.copyFileSync(srcPath, destPath);
        } catch (e) {
          // Skip files locked by a running Firefox process (EBUSY / EPIPE on Windows)
          if (e.code !== 'EBUSY' && e.code !== 'EPIPE' && e.code !== 'EPERM') throw e;
        }
      }
    }
  }

  _clearTransient() {
    // compatibility.ini only triggers a version warning — best-effort unlink is fine.
    const p = path.join(this.destPath, 'compatibility.ini');
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch (e) {
      if (!TOLERATED_UNLINK_CODES.includes(e.code)) throw e;
    }

    // Lock files are different: if any survive, the next launchPersistentContext
    // inherits a locked profile and hangs until the 180s timeout. So we must
    // VERIFY each one is actually gone, retry, and as a last resort rename it
    // out of the way — and warn loudly if even that fails.
    for (const f of LOCK_FILES) {
      this._removeLockFile(path.join(this.destPath, f), f);
    }
  }

  // Best-effort-but-verified removal of a single lock file.
  _removeLockFile(p, name) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!fs.existsSync(p)) return; // gone — success
      try {
        fs.unlinkSync(p);
      } catch (e) {
        if (!TOLERATED_UNLINK_CODES.includes(e.code)) throw e;
        // tolerated (EBUSY/EPERM) — fall through to verify/retry
      }
      if (!fs.existsSync(p)) return; // verified gone
    }

    // Still present after retries — rename it aside so Firefox can claim a fresh lock.
    if (fs.existsSync(p)) {
      const aside = `${p}.old`;
      try {
        try { if (fs.existsSync(aside)) fs.rmSync(aside, { force: true }); } catch { /* */ }
        fs.renameSync(p, aside);
        Logger.warn({ msg: `Profile lock '${name}' could not be deleted; renamed to ${name}.old`, path: p });
      } catch (e) {
        // Last resort failed — this is the condition that produces the launch hang.
        Logger.warn({ msg: `Profile lock '${name}' is stuck and could not be cleared or renamed; next launch may time out`, path: p, error: e.message });
      }
    }
  }

}

module.exports = { ProfileCloner };
