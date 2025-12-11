const { app, BrowserWindow, ipcMain, nativeImage, Tray, Menu, Notification, session, powerMonitor, clipboard, shell } = require('electron');
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
    windowBounds: { width: 1200, height: 800, x: undefined, y: undefined },
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
      closeToTray: false, // Disabled by default - requires system tray
      startMinimized: false, // Start minimized to tray
      alwaysOnTop: false // Keep window always on top
    },
    services: [
      { id: 'messenger', name: 'Facebook Messenger', url: 'https://www.messenger.com', enabled: true },
      { id: 'googlechat', name: 'Google Chat', url: 'https://chat.google.com', enabled: true },
      { id: 'wordle', name: 'Wordle', url: 'https://www.nytimes.com/games/wordle/index.html', enabled: false }
    ]
  };
}

let config = loadConfig();

// Migrate config: Add new services if they don't exist
function migrateConfig(config) {
  const defaultServices = getDefaultConfig().services;
  const existingServiceIds = config.services.map(s => s.id);

  // Add any new services from default config that don't exist
  defaultServices.forEach(defaultService => {
    if (!existingServiceIds.includes(defaultService.id)) {
      console.log(`Migrating: Adding new service ${defaultService.name}`);
      config.services.push(defaultService);
    }
  });

  saveConfig(config);
  return config;
}

// Run migration on existing config
if (config.services) {
  config = migrateConfig(config);
}

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

  // Determine base path - works in both dev and production
  const basePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'assets')
    : path.join(__dirname, '../assets');

  // Try .ico first (preferred for Windows), then .png
  const iconPaths = [
    path.join(basePath, 'icon.ico'),
    path.join(basePath, 'icon.png')
  ];

  let iconPath = null;
  for (const testPath of iconPaths) {
    try {
      console.log('Trying icon path:', testPath);
      const stats = fs.statSync(testPath);
      if (stats.size > 0) {
        iconPath = testPath;
        console.log('Found valid icon:', testPath);
        break;
      }
    } catch (e) {
      console.log('Icon not found at:', testPath);
      // File doesn't exist, try next
    }
  }

  if (!iconPath) {
    console.warn('No valid icon file found (tried icon.ico and icon.png), skipping tray creation');
    return;
  }

  try {
    tray = new Tray(iconPath);
    console.log('Tray created successfully');
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
      label: 'Notifications',
      type: 'checkbox',
      checked: settings.notifications,
      click: (menuItem) => {
        const newSettings = { ...store.get('settings'), notifications: menuItem.checked };
        store.set('settings', newSettings);
        // Update tray menu
        if (tray) {
          destroyTray();
          createTray(newSettings);
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
    x: bounds.x,
    y: bounds.y,
    icon: windowIcon,
    alwaysOnTop: settings.alwaysOnTop || false,
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
    // Don't show window if start minimized is enabled and tray is available
    if (settings.startMinimized && tray) {
      // Window stays hidden
      console.log('Starting minimized to tray');
    } else {
      mainWindow.show();
    }
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

      // Gracefully stop webviews but don't remove them
      // Let the before-quit handler do the cleanup
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.executeJavaScript(`
          document.querySelectorAll('webview').forEach(wv => {
            try {
              // Just stop loading, don't destroy yet
              wv.stop();
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
    // Only allow startup registration when app is packaged
    if (app.isPackaged) {
      app.setLoginItemSettings({
        openAtLogin: updatedSettings.startOnBoot,
        path: process.execPath
      });
    } else {
      console.warn('[Startup] Cannot register startup in development mode - app must be packaged');
      // Revert the setting since we can't apply it
      updatedSettings.startOnBoot = false;
      store.set('settings', updatedSettings);
    }
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

ipcMain.handle('toggle-always-on-top', () => {
  if (!mainWindow) return false;

  const currentState = mainWindow.isAlwaysOnTop();
  const newState = !currentState;
  mainWindow.setAlwaysOnTop(newState);

  // Save to settings
  const settings = store.get('settings');
  settings.alwaysOnTop = newState;
  store.set('settings', settings);

  return newState;
});

ipcMain.handle('get-always-on-top', () => {
  if (!mainWindow) return false;
  return mainWindow.isAlwaysOnTop();
});

ipcMain.handle('clear-service-session', async (_, serviceId) => {
  console.log(`[Session] Clearing session for service: ${serviceId}`);
  try {
    const serviceSession = session.fromPartition(`persist:${serviceId}`);
    if (serviceSession) {
      await serviceSession.clearCache();
      await serviceSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage']
      });
      console.log(`[Session] Successfully cleared session for ${serviceId}`);
      return { success: true };
    }
  } catch (error) {
    console.error(`[Session] Failed to clear session for ${serviceId}:`, error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-image-to-clipboard', async (_, imageDataUrl) => {
  console.log(`[Clipboard] Copying image to clipboard (data URL length: ${imageDataUrl?.length || 0})`);
  try {
    if (!imageDataUrl || !imageDataUrl.startsWith('data:image')) {
      console.error('[Clipboard] Invalid data URL format');
      return { success: false, error: 'Invalid image data format' };
    }

    // Create image from data URL
    const image = nativeImage.createFromDataURL(imageDataUrl);

    if (image.isEmpty()) {
      console.error('[Clipboard] Failed to create image from data URL');
      return { success: false, error: 'Invalid image data' };
    }

    clipboard.writeImage(image);
    console.log('[Clipboard] Image copied successfully');
    return { success: true };
  } catch (error) {
    console.error('[Clipboard] Failed to copy image:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-new-window', async (_, url) => {
  console.log(`[Window] Opening new window for URL: ${url}`);
  try {
    // Create a new browser window
    const newWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    });

    // Load the URL
    newWindow.loadURL(url);

    // Open links in this window in external browser
    newWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    // Clean up on close
    newWindow.on('closed', () => {
      console.log(`[Window] New window closed`);
    });

    return { success: true };
  } catch (error) {
    console.error('[Window] Failed to open new window:', error);
    return { success: false, error: error.message };
  }
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

      // Validate PIDs are integers (security - prevent command injection)
      const validPIDs = ourPIDs.filter(pid => Number.isInteger(pid) && pid > 0);
      if (validPIDs.length === 0) {
        throw new Error('No valid PIDs found');
      }

      // Query Windows for WorkingSetPrivate - this is what Task Manager shows!
      // Use Win32_PerfRawData_PerfProc_Process for WorkingSetPrivate property
      const pidList = validPIDs.join(' OR IDProcess=');
      const output = execSync(`wmic path Win32_PerfRawData_PerfProc_Process where "IDProcess=${pidList}" get IDProcess,WorkingSetPrivate /format:csv`, {
        encoding: 'utf8',
        timeout: 15000,  // Increased to 15 seconds - perf counters are slower
        maxBuffer: 10 * 1024 * 1024  // 10MB buffer
      });

      console.log(`[Memory] WMIC CSV output:`);
      console.log(output);

      // Parse CSV output (format: Node,IDProcess,WorkingSetPrivate)
      const lines = output.trim().split('\n').slice(1); // Skip header

      lines.forEach(line => {
        if (!line.trim()) return;

        const parts = line.split(',');
        if (parts.length >= 3) {
          const pid = parseInt(parts[1]);                 // Column 1: IDProcess
          const workingSetPrivate = parseInt(parts[2]);   // Column 2: WorkingSetPrivate

          if (!isNaN(pid) && !isNaN(workingSetPrivate)) {
            const memMB = Math.round(workingSetPrivate / (1024 * 1024));
            console.log(`  PID ${pid}: ${memMB} MB (WorkingSetPrivate)`);
            totalMemoryMB += memMB;
          }
        }
      });

      console.log(`[Memory] Total WorkingSetPrivate: ${totalMemoryMB} MB (matches Task Manager!)`);

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

// Built-in ad blocker for Wordle
// Common ad domains to block
const adDomains = [
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'adservice.google.com',
  'pagead2.googlesyndication.com',
  'tpc.googlesyndication.com',
  'pubads.g.doubleclick.net',
  'securepubads.g.doubleclick.net',
  'static.doubleclick.net',
  'nyt.com/ads',
  'nytimes.com/ads',
  'sentry.io',
  'chartbeat.com',
  'brandmetrics.com'
];

// Setup ad blocker for a specific session
function setupAdBlockerForSession(sessionToBlock, sessionName = 'session') {
  sessionToBlock.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url.toLowerCase();
    const shouldBlock = adDomains.some(domain => url.includes(domain));

    if (shouldBlock) {
      console.log(`[Ad Blocker - ${sessionName}] Blocked:`, url);
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });

  console.log(`Built-in ad blocker enabled for ${sessionName}`);
}

// Setup ad blocker for all sessions
function setupAdBlocker() {
  // Enable ad blocking for default session (used by child windows/popups)
  setupAdBlockerForSession(session.defaultSession, 'default session');

  // Enable ad blocking for all service partitions
  const services = config.services || [];
  services.forEach(service => {
    const serviceSession = session.fromPartition(`persist:${service.id}`);
    setupAdBlockerForSession(serviceSession, service.name);
  });

  console.log(`Ad blocker enabled for ${services.length + 1} sessions (default + all services)`);
}

// App lifecycle
app.whenReady().then(() => {
  // Prevent multiple instances from running
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    console.log('[SingleInstance] Another instance is already running. Quitting this instance.');
    app.quit();
    return;
  }

  // Handle second instance attempts - focus the existing window
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    console.log('[SingleInstance] Second instance blocked. Focusing existing window.');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  // Setup ad blocker for all sessions
  setupAdBlocker();

  createWindow();

  // Handle Windows sleep/wake to fix title bar disappearing
  // Also handle lock-screen events which can cause similar issues
  powerMonitor.on('suspend', () => {
    console.log('[PowerMonitor] System going to sleep');
  });

  powerMonitor.on('lock-screen', () => {
    console.log('[PowerMonitor] Screen locked');
  });

  powerMonitor.on('unlock-screen', () => {
    console.log('[PowerMonitor] Screen unlocked - triggering restoration');
    restoreWindowChrome();
  });

  powerMonitor.on('resume', () => {
    console.log('[PowerMonitor] System resumed from sleep');
    restoreWindowChrome();
  });

  // Aggressive window chrome restoration function
  function restoreWindowChrome() {
    if (!mainWindow || mainWindow.isDestroyed()) {
      console.log('[PowerMonitor] Window does not exist, skipping restoration');
      return;
    }

    console.log('[PowerMonitor] Starting AGGRESSIVE window restoration...');

    // Save current window state
    const wasVisible = mainWindow.isVisible();
    const wasMaximized = mainWindow.isMaximized();
    const wasMinimized = mainWindow.isMinimized();
    const wasOnTop = mainWindow.isAlwaysOnTop();
    const currentBounds = mainWindow.getBounds();

    // Step 1: Toggle movable/resizable (100ms)
    mainWindow.setMovable(false);
    mainWindow.setResizable(false);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setMovable(true);
        mainWindow.setResizable(true);
        console.log('[PowerMonitor] ✓ Step 1: Toggled movable/resizable');
      }
    }, 100);

    // Step 2: Force bounds update (300ms)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBounds(currentBounds);
        console.log('[PowerMonitor] ✓ Step 2: Forced bounds refresh');
      }
    }, 300);

    // Step 3: MAXIMIZE/RESTORE cycle - this is the DWM killer move (500ms)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && !wasMaximized && !wasMinimized) {
        console.log('[PowerMonitor] ⚡ Step 3: Starting maximize/restore cycle...');
        mainWindow.maximize();
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.unmaximize();
            mainWindow.setBounds(currentBounds);
            console.log('[PowerMonitor] ✓ Step 3: Maximize/restore cycle completed');
          }
        }, 200);
      }
    }, 500);

    // Step 4: Hide/show cycle for visible windows (800ms)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (wasVisible && !wasMinimized) {
          console.log('[PowerMonitor] ⚡ Step 4: Hide/show cycle...');
          mainWindow.hide();
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.show();
              mainWindow.focus();
              console.log('[PowerMonitor] ✓ Step 4: Hide/show completed');
            }
          }, 100);
        }
      }
    }, 800);

    // Step 5: Minimize/restore cycle if window was visible (1100ms)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && wasVisible && !wasMinimized) {
        console.log('[PowerMonitor] ⚡ Step 5: Minimize/restore cycle...');
        mainWindow.minimize();
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.restore();
            mainWindow.focus();
            console.log('[PowerMonitor] ✓ Step 5: Minimize/restore completed');
          }
        }, 150);
      }
    }, 1100);

    // Step 6: Toggle alwaysOnTop and invalidate webContents (1400ms)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setAlwaysOnTop(!wasOnTop);
        setTimeout(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setAlwaysOnTop(wasOnTop);

            if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
              mainWindow.webContents.invalidate();
            }
            console.log('[PowerMonitor] ✓ Step 6: AlwaysOnTop toggle and invalidation');
          }
        }, 50);
      }
    }, 1400);

    // Step 7: Final bounds restoration and focus (1600ms)
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (wasMaximized) {
          mainWindow.maximize();
        } else {
          mainWindow.setBounds(currentBounds);
        }
        if (wasVisible && !wasMinimized) {
          mainWindow.focus();
        }
        console.log('[PowerMonitor] ✓ Step 7: Final restoration complete');
        console.log('[PowerMonitor] 🎉 AGGRESSIVE restoration sequence COMPLETE');
      }
    }, 1600);
  }
});

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
    ipcMain.removeHandler('clear-service-session');
    ipcMain.removeHandler('show-notification');
    ipcMain.removeHandler('toggle-always-on-top');
    ipcMain.removeHandler('get-always-on-top');
    ipcMain.removeHandler('copy-image-to-clipboard');
    ipcMain.removeHandler('open-new-window');
  } catch (e) {}

  // Force close main window
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.destroy();
  }
});

// Force quit all processes on exit
app.on('quit', () => {
  // Clean up tray first to prevent orphaned icons
  destroyTray();

  mainWindow = null;

  // Don't force kill all AllStar processes - now that we have single instance lock,
  // this would only kill the legitimate instance
  // Just exit gracefully
  console.log('[App] Exiting gracefully...');
});
