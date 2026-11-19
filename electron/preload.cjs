'use strict';
// Preload: the only bridge between the web app and Node/Electron. The renderer gets a small,
// explicit API on window.pdfcut. Nothing else from Node is exposed.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfcut', {
  isElectron: true,
  platform: process.platform,

  /** Returns requests that arrived before the window was ready (double-click, command line). */
  launch: () => ipcRenderer.invoke('app:launch'),

  /** Requests that arrive while the app is running (second launch, tray menu). */
  onOpenRequest(callback) {
    const listener = (_event, request) => callback(request);
    ipcRenderer.on('app:open-request', listener);
    return () => ipcRenderer.removeListener('app:open-request', listener);
  },

  /** Reads a file the user opened with PDFCut. The main process refuses any other path. */
  readFile: (filePath) => ipcRenderer.invoke('fs:read', filePath),

  info: () => ipcRenderer.invoke('app:info'),

  /** Adds Nautilus, Thunar and Dolphin right-click actions for the current user. */
  integrate: () => ipcRenderer.invoke('shell:integrate'),

  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    onMaximizeChange(callback) {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('win:maximized', listener);
      return () => ipcRenderer.removeListener('win:maximized', listener);
    },
  },
});
