// Preload for the app window (the React UI). Exposes a small, explicit API;
// the renderer never touches ipcRenderer directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('brainrot', {
  platform: process.platform,

  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (callback) => {
      const listener = (_event, maximized) => callback(maximized);
      ipcRenderer.on('window:maximized-changed', listener);
      return () => ipcRenderer.removeListener('window:maximized-changed', listener);
    },
  },

  setSyncScroll: (enabled) => ipcRenderer.send('sync:set-scroll', enabled),
  setAutoScroll: (enabled) => ipcRenderer.send('sync:set-auto-scroll', enabled),
  setLeader: (webContentsId) => ipcRenderer.send('sync:set-leader', webContentsId),
});
