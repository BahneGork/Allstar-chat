const { app, BrowserWindow, ipcMain, nativeImage, Tray, Menu, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

// Set app name for Task Manager (multiple methods for Windows compatibility)
app.setName('AllStar');
process.title = 'AllStar';
if (process.platform === 'win32') {
  app.setAppUserModelId('com.allstar.app');
}

// Process reduction flags
app.commandLine.appendSwitch('disable-http-cache');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors,IsolateOrigins,site-per-process');
app.commandLine.appendSwitch('disable-site-isolation-trials');

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
      autoSuspendInactiveTabs: true,
      tabSuspensionTimeout: 30,
      hardwareAcceleration: true,
      preloadServices: true, // Preload all services for faster switching
      cacheSize: 100,
      clearCacheOnExit: false,
      startOnBoot: false,
      closeToTray: false // Disabled by default - requires system tray
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

function createTray(settings) {
  if (!settings.systemTray || tray) return;

  // Try .ico first (preferred for Windows), then .png
  const iconPaths = [
    path.join(__dirname, '../assets/icon.ico'),
    path.join(__dirname, '../assets/icon.png')
  ];

  let iconPath = null;
  for (const testPath of iconPaths) {
    try {
      const stats = fs.statSync(testPath);
      if (stats.size > 0) {
        iconPath = testPath;
        break;
      }
    } catch (e) {
      // File doesn't exist, try next
    }
  }

  if (!iconPath) {
    console.warn('No valid icon file found (tried icon.ico and icon.png), skipping tray creation');
    return;
  }

  try {
    tray = new Tray(iconPath);
  } catch (e) {
    console.error('Failed to create tray icon:', e);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show AllStar',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Memory Monitor',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.executeJavaScript(`
            document.getElementById('memory-btn').click();
          `).catch(() => {});
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit AllStar',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('AllStar - Messenger & Chat');
  tray.setContextMenu(contextMenu);

  // Click tray icon to show/hide window
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function createWindow() {
  const bounds = store.get('windowBounds');
  const settings = store.get('settings');

  // Hardware acceleration setting
  if (!settings.hardwareAcceleration) {
    app.disableHardwareAcceleration();
  }

  // Create system tray if enabled
  createTray(settings);

  // Set cache size limit
  if (settings.cacheSize && settings.cacheSize < 1000) {
    const cacheSizeBytes = settings.cacheSize * 1024 * 1024; // Convert MB to bytes
    app.commandLine.appendSwitch('disk-cache-size', cacheSizeBytes.toString());
  }

  // Try .ico first (preferred for Windows), then .png
  const iconPaths = [
    path.join(__dirname, '../assets/icon.ico'),
    path.join(__dirname, '../assets/icon.png')
  ];

  let windowIcon = undefined;
  for (const testPath of iconPaths) {
    try {
      if (fs.existsSync(testPath) && fs.statSync(testPath).size > 0) {
        windowIcon = testPath;
        break;
      }
    } catch (e) {}
  }

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    icon: windowIcon,
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
    // Don't allow close to tray if tray isn't available
    if (settings.closeToTray && tray && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    } else {
      // Force quit mode when closing
      app.isQuitting = true;
      saveBounds();
      // Clean up webviews before closing
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.executeJavaScript(`
          document.querySelectorAll('webview').forEach(wv => {
            try {
              wv.stop();
              wv.remove();
            } catch(e) {}
          });
        `).catch(() => {});
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
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

ipcMain.handle('update-settings', (_, newSettings) => {
  const currentSettings = store.get('settings');
  const updatedSettings = { ...currentSettings, ...newSettings };
  store.set('settings', updatedSettings);

  // Update tray based on systemTray setting
  if (updatedSettings.systemTray && !tray) {
    createTray(updatedSettings);
  } else if (!updatedSettings.systemTray && tray) {
    destroyTray();
  }

  // Update auto-launch based on startOnBoot setting
  if (updatedSettings.startOnBoot !== currentSettings.startOnBoot) {
    app.setLoginItemSettings({
      openAtLogin: updatedSettings.startOnBoot,
      path: process.execPath
    });
  }

  return updatedSettings;
});

ipcMain.handle('get-services', () => {
  return store.get('services');
});

ipcMain.handle('update-services', (_, services) => {
  store.set('services', services);
  return services;
});

ipcMain.handle('show-notification', (_, title, body, serviceId) => {
  const settings = store.get('settings');
  if (!settings.notifications) {
    console.log('Notifications disabled in settings');
    return;
  }

  // Check if notifications are supported
  if (!Notification.isSupported()) {
    console.error('Notifications are not supported on this system');
    return;
  }

  console.log(`[Notification] Creating notification: ${title} - ${body}`);

  // Try .ico first (preferred for Windows), then .png
  const iconPaths = [
    path.join(__dirname, '../assets/icon.ico'),
    path.join(__dirname, '../assets/icon.png')
  ];

  let notificationIcon = undefined;
  for (const testPath of iconPaths) {
    try {
      if (fs.existsSync(testPath) && fs.statSync(testPath).size > 0) {
        notificationIcon = testPath;
        console.log(`[Notification] Using icon: ${testPath}`);
        break;
      }
    } catch (e) {}
  }

  try {
    const notification = new Notification({
      title: title,
      body: body,
      icon: notificationIcon,
      silent: false,
      timeoutType: 'default'
    });

    notification.on('click', () => {
      console.log('[Notification] Notification clicked');
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        // Switch to the service tab that triggered the notification
        if (serviceId) {
          mainWindow.webContents.executeJavaScript(`
            switchTab('${serviceId}');
          `).catch(() => {});
        }
      }
    });

    notification.on('show', () => {
      console.log('[Notification] Notification shown successfully');
    });

    notification.on('close', () => {
      console.log('[Notification] Notification closed');
    });

    notification.on('failed', (error) => {
      console.error('[Notification] Failed to show notification:', error);
    });

    notification.show();
    console.log('[Notification] show() called');
  } catch (error) {
    console.error('[Notification] Error creating/showing notification:', error);
  }
});

ipcMain.handle('get-memory-info', async () => {
  const { execSync } = require('child_process');
  const processMemory = process.memoryUsage();
  const systemMemory = process.getSystemMemoryInfo();

  // Get all process metrics from Electron (for process count)
  const allProcessMetrics = app.getAppMetrics();

  // Query Windows directly for accurate memory values (same as Task Manager)
  let totalMemoryMB = 0;

  if (process.platform === 'win32') {
    try {
      // Get PIDs of only OUR processes from Electron API
      const ourPIDs = allProcessMetrics.map(p => p.pid);
      console.log(`[Memory] Our process PIDs: ${ourPIDs.join(', ')}`);

      // Query Windows for memory - use CSV format for reliable parsing
      const pidList = ourPIDs.join(' OR ProcessId=');
      const output = execSync(`wmic process where "ProcessId=${pidList}" get ProcessId,PrivatePageCount,WorkingSetSize /format:csv`, {
        encoding: 'utf8',
        timeout: 5000
      });

      console.log(`[Memory] WMIC CSV output:`);
      console.log(output);

      // Parse CSV output (format: Node,PrivatePageCount,ProcessId,WorkingSetSize)
      const lines = output.trim().split('\n').slice(1); // Skip header
      let totalPrivate = 0;
      let totalWorking = 0;

      lines.forEach(line => {
        if (!line.trim()) return;

        const parts = line.split(',');
        if (parts.length >= 4) {
          const privateBytes = parseInt(parts[1]);  // Column 1: PrivatePageCount
          const pid = parseInt(parts[2]);           // Column 2: ProcessId
          const workingBytes = parseInt(parts[3]);  // Column 3: WorkingSetSize

          if (!isNaN(pid) && !isNaN(privateBytes) && !isNaN(workingBytes)) {
            const privateMB = Math.round(privateBytes / (1024 * 1024));
            const workingMB = Math.round(workingBytes / (1024 * 1024));
            console.log(`  PID ${pid}: Private=${privateMB} MB, Working=${workingMB} MB`);
            totalPrivate += privateMB;
            totalWorking += workingMB;
          }
        }
      });

      console.log(`[Memory] Total Private: ${totalPrivate} MB, Total Working: ${totalWorking} MB`);

      // Use Private memory (closer to Task Manager in most cases)
      totalMemoryMB = totalPrivate;

      console.log(`[Memory] Total from Windows (our processes only): ${totalMemoryMB} MB`);

      // If we got 0, fall back to Electron API
      if (totalMemoryMB === 0) {
        console.log('[Memory] WMIC query failed, using Electron API fallback');
        totalMemoryMB = Math.round(processMemory.rss / 1024 / 1024);
      }
    } catch (error) {
      console.error('[Memory] Failed to query Windows:', error.message);
      // Fallback to old calculation
      totalMemoryMB = Math.round(processMemory.rss / 1024 / 1024);
    }
  } else {
    // Non-Windows fallback
    totalMemoryMB = Math.round(processMemory.rss / 1024 / 1024);
  }

  console.log(`[Memory] Total from Windows API: ${totalMemoryMB} MB (from ${allProcessMetrics.length} processes)`);

  return {
    app: {
      rss: totalMemoryMB, // Total memory across ALL processes
      heapUsed: Math.round(processMemory.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(processMemory.heapTotal / 1024 / 1024), // MB
      external: Math.round(processMemory.external / 1024 / 1024), // MB
      processCount: allProcessMetrics.length
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

app.on('before-quit', async () => {
  app.isQuitting = true;

  // Force destroy all webviews immediately
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const { webContents } = require('electron');
      // Get all webview guest instances and force close them
      const allWebContents = webContents.getAllWebContents();
      const mainWindowContents = mainWindow.webContents;

      if (allWebContents && mainWindowContents) {
        // Stop and destroy each guest webview
        for (const guest of allWebContents) {
          try {
            if (guest && !guest.isDestroyed() && guest.id !== mainWindowContents.id) {
              guest.closeDevTools();
              guest.stop();
              // Force navigation to blank page first
              guest.loadURL('about:blank').catch(() => {});
              guest.destroy();
            }
          } catch (e) {
            console.error('Error destroying guest:', e);
          }
        }

        // Clear all sessions
        try {
          const { session } = require('electron');
          const allSessions = [session.defaultSession];

          // Get all persistent sessions
          const services = store.get('services') || [];
          for (const service of services) {
            try {
              const serviceSession = session.fromPartition(`persist:${service.id}`);
              if (serviceSession) allSessions.push(serviceSession);
            } catch (e) {}
          }

          // Clear cache if needed
          const settings = store.get('settings');
          if (settings && settings.clearCacheOnExit) {
            for (const sess of allSessions) {
              try {
                await sess.clearCache();
                await sess.clearStorageData();
              } catch (e) {}
            }
          }

          // Destroy all sessions
          for (const sess of allSessions) {
            try {
              if (sess && sess !== session.defaultSession) {
                // Close all webcontents using this session
                const allContents = sess.getAllWebContents ? sess.getAllWebContents() : [];
                for (const content of allContents) {
                  try {
                    if (!content.isDestroyed()) {
                      content.destroy();
                    }
                  } catch (e) {}
                }
              }
            } catch (e) {}
          }
        } catch (e) {
          console.error('Error clearing sessions:', e);
        }
      }
    } catch (e) {
      console.error('Error cleaning webviews:', e);
    }
  }
});

app.on('will-quit', () => {
  // Remove all IPC handlers
  try {
    ipcMain.removeHandler('get-settings');
    ipcMain.removeHandler('update-settings');
    ipcMain.removeHandler('get-services');
    ipcMain.removeHandler('update-services');
    ipcMain.removeHandler('get-memory-info');
  } catch (e) {}

  // Force close main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
});

// Force quit all processes on exit
app.on('quit', () => {
  mainWindow = null;
  destroyTray();

  // Immediately kill all child processes
  try {
    const { execSync } = require('child_process');
    if (process.platform === 'win32') {
      // On Windows, kill all AllStar processes
      try {
        // Kill by process name to catch all instances
        execSync('taskkill /F /IM "AllStar.exe" /T', { stdio: 'ignore', timeout: 2000 });
      } catch (e) {
        // Processes already dead or couldn't kill, that's fine
      }
    }
  } catch (e) {}

  // Force exit process immediately
  process.exit(0);
});
