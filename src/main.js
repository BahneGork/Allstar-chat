const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Memory optimization flags
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
app.commandLine.appendSwitch('disable-background-timer-throttling', 'false');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Simple settings store (file-based)
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (e) {
    console.error('Error loading config:', e);
  }
  return getDefaultConfig();
}

function saveConfig(config) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving config:', e);
  }
}

function getDefaultConfig() {
  return {
    windowBounds: { width: 1200, height: 800 },
    settings: {
      systemTray: true,
      notifications: true,
      persistSessions: true,
      autoHideInactiveTabs: true,
      tabSuspensionTimeout: 30,
      hardwareAcceleration: true,
      preloadServices: false,
      cacheSize: 100,
      clearCacheOnExit: false,
      startOnBoot: false,
      closeToTray: true
    },
    services: [
      { id: 'messenger', name: 'Facebook Messenger', url: 'https://www.messenger.com', enabled: true },
      { id: 'googlechat', name: 'Google Chat', url: 'https://chat.google.com', enabled: true }
    ]
  };
}

let config = loadConfig();

// Store helper object to mimic electron-store API
const store = {
  get: (key) => {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
      value = value?.[k];
    }
    return value;
  },
  set: (key, value) => {
    const keys = key.split('.');
    let obj = config;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    saveConfig(config);
  }
};

let mainWindow;
let tray = null;

function createWindow() {
  const bounds = store.get('windowBounds');
  const settings = store.get('settings');

  // Hardware acceleration setting
  if (!settings.hardwareAcceleration) {
    app.disableHardwareAcceleration();
  }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true, // Enable webview tags
      // Memory optimizations
      backgroundThrottling: true,
      spellcheck: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Save window bounds on resize/move
  mainWindow.on('resize', () => saveBounds());
  mainWindow.on('move', () => saveBounds());

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (settings.closeToTray && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    } else {
      saveBounds();
    }
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
}

function saveBounds() {
  const bounds = mainWindow.getBounds();
  store.set('windowBounds', bounds);
}

// IPC Handlers
ipcMain.handle('get-settings', () => {
  return store.get('settings');
});

ipcMain.handle('update-settings', (event, newSettings) => {
  const currentSettings = store.get('settings');
  const updatedSettings = { ...currentSettings, ...newSettings };
  store.set('settings', updatedSettings);
  return updatedSettings;
});

ipcMain.handle('get-services', () => {
  return store.get('services');
});

ipcMain.handle('update-services', (event, services) => {
  store.set('services', services);
  return services;
});

ipcMain.handle('get-memory-info', async () => {
  const processMemory = process.memoryUsage();
  const systemMemory = process.getSystemMemoryInfo();

  return {
    app: {
      rss: Math.round(processMemory.rss / 1024 / 1024), // MB
      heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024), // MB
      external: Math.round(processMemory.external / 1024 / 1024) // MB
    },
    system: {
      total: Math.round(systemMemory.total / 1024), // MB
      free: Math.round(systemMemory.free / 1024) // MB
    }
  };
});

// App lifecycle
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;

  const settings = store.get('settings');
  if (settings.clearCacheOnExit) {
    const { session } = require('electron');
    session.defaultSession.clearCache();
    session.defaultSession.clearStorageData();
  }
});
