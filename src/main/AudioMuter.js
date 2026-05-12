const { execFile } = require('child_process');
const fs = require('fs');

// Mutes the Windows audio session belonging to a given PID.
// Re-applies mute periodically because Firefox sometimes recreates audio sessions
// when starting/stopping playback.
class AudioMuter {
  constructor(opts = {}) {
    this.targetPid = null;
    this._timer = null;
    this.intervalMs = opts.intervalMs ?? 5000;
    this.nircmdPath = opts.nircmdPath;
  }

  async start(pid) {
    this.targetPid = pid;
    if (!fs.existsSync(this.nircmdPath)) {
      throw new Error(`nircmd.exe not found at ${this.nircmdPath}. Download from nirsoft.net/utils/nircmd.html and place there.`);
    }
    await this._applyMute();
    this._timer = setInterval(() => this._applyMute().catch(() => {}), this.intervalMs);
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this.targetPid = null;
  }

  async _applyMute() {
    if (!this.targetPid) return;
    return new Promise((resolve, reject) => {
      // nircmd muteappvolume /<pid> 1 — the /<pid> form selects the audio session
      // by process ID. Verified working on this machine (exit code 0).
      execFile(this.nircmdPath, ['muteappvolume', `/${this.targetPid}`, '1'], (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }
}

module.exports = { AudioMuter };
