const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logPath = null;
let stream = null;

function init() {
  if (logPath) return;
  try {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true });
    logPath = path.join(dir, 'lurker.log');
    // Truncate if larger than 2 MB to keep it manageable
    try {
      const st = fs.statSync(logPath);
      if (st.size > 2 * 1024 * 1024) fs.unlinkSync(logPath);
    } catch { /* fresh file */ }
    stream = fs.createWriteStream(logPath, { flags: 'a' });
    write('INFO', `=== TwitchLurker ${app.getVersion()} started at ${new Date().toISOString()} ===`);
    write('INFO', `Platform: ${process.platform} ${process.arch}, Electron ${process.versions.electron}, Node ${process.versions.node}`);
    write('INFO', `Packaged: ${app.isPackaged}, ResourcesPath: ${process.resourcesPath}`);
  } catch (e) {
    console.error('Logger init failed:', e);
  }
}

function write(level, msg) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  if (stream) stream.write(line);
  // Also mirror to console for dev mode
  if (level === 'ERROR') console.error(line.trim());
  else console.log(line.trim());
}

function info(msg)  { write('INFO', String(msg)); }
function warn(msg)  { write('WARN', String(msg)); }
function error(msg, err) {
  let text = String(msg);
  if (err) {
    text += '\n' + (err.stack || err.message || String(err));
  }
  write('ERROR', text);
}

function getLogPath() { return logPath; }

module.exports = { init, info, warn, error, getLogPath };
