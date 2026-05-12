const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const ICONS = {
  gray:   'tray-gray.png',
  green:  'tray-green.png',
  yellow: 'tray-yellow.png',
  red:    'tray-red.png'
};

function createTray({ assetsDir, onShow, onStart, onStop, onQuit }) {
  const trayIcon = new Tray(nativeImage.createFromPath(path.join(assetsDir, ICONS.gray)));
  trayIcon.setToolTip('TwitchLurker');

  const updateMenu = (running) => {
    const menu = Menu.buildFromTemplate([
      { label: 'Show', click: onShow },
      { type: 'separator' },
      { label: running ? 'Stop' : 'Start', click: running ? onStop : onStart },
      { type: 'separator' },
      { label: 'Quit', click: onQuit }
    ]);
    trayIcon.setContextMenu(menu);
  };
  updateMenu(false);

  trayIcon.on('click', onShow);

  return {
    setColor(color) {
      const file = ICONS[color] ?? ICONS.gray;
      trayIcon.setImage(nativeImage.createFromPath(path.join(assetsDir, file)));
    },
    setRunning(running) { updateMenu(running); },
    destroy() { trayIcon.destroy(); }
  };
}

module.exports = { createTray };
