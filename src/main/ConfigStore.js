const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  channels: [],
  pollIntervalSec: 60,
  firefoxProfileSourcePath: null,
  lurkerProfilePath: null,
  firstRunComplete: false
};

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  read() {
    if (!fs.existsSync(this.filePath)) {
      return { ...DEFAULTS };
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return { ...DEFAULTS, ...raw };
    } catch {
      return { ...DEFAULTS };
    }
  }

  write(partial) {
    const current = this.read();
    const merged = { ...current, ...partial };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(merged, null, 2));
  }
}

module.exports = { ConfigStore };
