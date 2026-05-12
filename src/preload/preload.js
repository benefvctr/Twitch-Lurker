const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lurker', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  start: () => ipcRenderer.invoke('lifecycle:start'),
  stop: () => ipcRenderer.invoke('lifecycle:stop'),
  getChannels: () => ipcRenderer.invoke('channels:get'),
  setChannels: (channels) => ipcRenderer.invoke('channels:set', channels),
  refreshProfile: () => ipcRenderer.invoke('profile:refresh'),
  onStatusChanged: (cb) => {
    const handler = (_e, status) => cb(status);
    ipcRenderer.on('status:changed', handler);
    return () => ipcRenderer.removeListener('status:changed', handler);
  }
});
