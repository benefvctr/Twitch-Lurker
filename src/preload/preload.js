const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lurker', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  getVersion: () => ipcRenderer.invoke('app:version'),
  start: () => ipcRenderer.invoke('lifecycle:start'),
  stop: () => ipcRenderer.invoke('lifecycle:stop'),
  getChannels: () => ipcRenderer.invoke('channels:get'),
  setChannels: (channels) => ipcRenderer.invoke('channels:set', channels),
  refreshProfile: () => ipcRenderer.invoke('profile:refresh'),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  setup: {
    detectFirefox: () => ipcRenderer.invoke('setup:detect-firefox'),
    cloneProfile: () => ipcRenderer.invoke('setup:clone-profile'),
    complete: () => ipcRenderer.invoke('setup:complete')
  },
  onStatusChanged: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on('status:changed', handler);
    return () => ipcRenderer.removeListener('status:changed', handler);
  }
});
