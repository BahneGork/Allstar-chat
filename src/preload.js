const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings) => ipcRenderer.invoke('update-settings', settings),

  // Services
  getServices: () => ipcRenderer.invoke('get-services'),
  updateServices: (services) => ipcRenderer.invoke('update-services', services),

  // Memory monitoring
  getMemoryInfo: () => ipcRenderer.invoke('get-memory-info'),

  // Notifications
  showNotification: (title, body, serviceId) => ipcRenderer.invoke('show-notification', title, body, serviceId),

  // Window controls
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: () => ipcRenderer.invoke('get-always-on-top')
});
