const fs = require('fs');
const path = require('path');

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

  clone({ force = false } = {}) {
    let cloned = false;
    if (force && fs.existsSync(this.destPath)) {
      fs.rmSync(this.destPath, { recursive: true, force: true });
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
    // Remove lock files (block re-launch) and compatibility.ini (triggers Firefox version warning)
    for (const f of ['parent.lock', 'lock', '.parentlock', 'compatibility.ini']) {
      const p = path.join(this.destPath, f);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

}

module.exports = { ProfileCloner };
