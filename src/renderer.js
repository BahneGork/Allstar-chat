let currentSettings = {};
let currentServices = [];
let activeTabId = null;
let tabSuspensionTimers = {};

// Initialize app
async function init() {
  console.log('Initializing AllStar...');
  currentSettings = await window.electron.getSettings();
  currentServices = await window.electron.getServices();
  console.log('Services loaded:', currentServices);
  console.log('Settings loaded:', currentSettings);

  renderTabs();
  setupEventListeners();

  // Activate first enabled service
  const firstEnabledService = currentServices.find(s => s.enabled);
  console.log('First enabled service:', firstEnabledService);
  if (firstEnabledService) {
    switchTab(firstEnabledService.id);
  } else {
    console.error('No enabled services found!');
  }
}

// Render tabs
function renderTabs() {
  const tabsContainer = document.getElementById('tabs');
  tabsContainer.innerHTML = '';

  currentServices.filter(s => s.enabled).forEach(service => {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.textContent = service.name;
    tab.dataset.serviceId = service.id;
    tab.addEventListener('click', () => switchTab(service.id));
    tabsContainer.appendChild(tab);
  });
}

// Switch tab
function switchTab(serviceId) {
  // Clear suspension timer for this tab
  if (tabSuspensionTimers[serviceId]) {
    clearTimeout(tabSuspensionTimers[serviceId]);
    delete tabSuspensionTimers[serviceId];
  }

  // Set previous tab suspension timer
  if (activeTabId && currentSettings.tabSuspensionTimeout > 0) {
    const timeoutMs = currentSettings.tabSuspensionTimeout * 60 * 1000;
    tabSuspensionTimers[activeTabId] = setTimeout(() => {
      suspendTab(activeTabId);
    }, timeoutMs);
  }

  activeTabId = serviceId;

  // Update tab UI
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.serviceId === serviceId);
  });

  // Update webview visibility
  document.querySelectorAll('webview').forEach(webview => {
    webview.classList.toggle('active', webview.dataset.serviceId === serviceId);
  });

  // Create webview if it doesn't exist
  const existingWebview = document.querySelector(`webview[data-service-id="${serviceId}"]`);
  if (!existingWebview) {
    createWebview(serviceId);
  } else {
    // Resume if suspended
    resumeTab(serviceId);
  }
}

// Create webview
function createWebview(serviceId) {
  const service = currentServices.find(s => s.id === serviceId);
  if (!service) {
    console.error('Service not found:', serviceId);
    return;
  }

  console.log('Creating webview for:', service.name, service.url);
  const container = document.getElementById('webview-container');
  const webview = document.createElement('webview');

  webview.dataset.serviceId = serviceId;
  webview.src = service.url;
  webview.classList.add('active');

  // Memory optimization settings
  webview.partition = `persist:${serviceId}`;
  webview.allowpopups = true;

  // Webview attributes for optimization
  webview.setAttribute('nodeintegration', 'false');
  webview.setAttribute('plugins', 'false');
  webview.setAttribute('disablewebsecurity', 'false');
  webview.setAttribute('webpreferences', 'contextIsolation=true,enableRemoteModule=false');

  // Event listeners
  webview.addEventListener('did-start-loading', () => {
    console.log(`${service.name} started loading...`);
  });

  webview.addEventListener('did-stop-loading', () => {
    console.log(`${service.name} loaded successfully`);
  });

  webview.addEventListener('did-fail-load', (e) => {
    console.error(`${service.name} failed to load:`, e);
  });

  webview.addEventListener('dom-ready', () => {
    console.log(`${service.name} DOM ready`);
  });

  webview.addEventListener('new-window', (e) => {
    require('electron').shell.openExternal(e.url);
  });

  container.appendChild(webview);
  console.log('Webview appended to container');
}

// Suspend tab (reduce memory usage)
function suspendTab(serviceId) {
  const webview = document.querySelector(`webview[data-service-id="${serviceId}"]`);
  if (webview && serviceId !== activeTabId) {
    console.log(`Suspending tab: ${serviceId}`);
    // In Electron, we can't truly suspend, but we can hide and throttle
    if (currentSettings.autoHideInactiveTabs) {
      webview.style.display = 'none';
    }
  }
}

// Resume tab
function resumeTab(serviceId) {
  const webview = document.querySelector(`webview[data-service-id="${serviceId}"]`);
  if (webview) {
    webview.style.display = '';
  }
}

// Event listeners
function setupEventListeners() {
  // Settings button
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-settings').addEventListener('click', closeSettings);
  document.getElementById('save-settings').addEventListener('click', saveSettings);

  // Memory monitor
  document.getElementById('memory-btn').addEventListener('click', openMemoryMonitor);
  document.getElementById('close-memory').addEventListener('click', closeMemoryMonitor);
  document.getElementById('refresh-memory').addEventListener('click', updateMemoryStats);
}

// Settings modal
async function openSettings() {
  currentSettings = await window.electron.getSettings();
  currentServices = await window.electron.getServices();

  // Populate settings
  document.getElementById('setting-autoHideInactiveTabs').checked = currentSettings.autoHideInactiveTabs;
  document.getElementById('setting-tabSuspensionTimeout').value = currentSettings.tabSuspensionTimeout;
  document.getElementById('setting-systemTray').checked = currentSettings.systemTray;
  document.getElementById('setting-closeToTray').checked = currentSettings.closeToTray;
  document.getElementById('setting-startOnBoot').checked = currentSettings.startOnBoot;
  document.getElementById('setting-notifications').checked = currentSettings.notifications;
  document.getElementById('setting-hardwareAcceleration').checked = currentSettings.hardwareAcceleration;
  document.getElementById('setting-preloadServices').checked = currentSettings.preloadServices;
  document.getElementById('setting-cacheSize').value = currentSettings.cacheSize;
  document.getElementById('setting-persistSessions').checked = currentSettings.persistSessions;
  document.getElementById('setting-clearCacheOnExit').checked = currentSettings.clearCacheOnExit;

  // Populate services
  const servicesList = document.getElementById('services-list');
  servicesList.innerHTML = '';
  currentServices.forEach(service => {
    const serviceItem = document.createElement('div');
    serviceItem.className = 'service-item';
    serviceItem.innerHTML = `
      <label>
        <input type="checkbox" ${service.enabled ? 'checked' : ''} data-service-id="${service.id}">
        ${service.name}
      </label>
      <span class="memory-tip">~200MB when active</span>
    `;
    servicesList.appendChild(serviceItem);
  });

  document.getElementById('settings-modal').classList.remove('hidden');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function saveSettings() {
  const newSettings = {
    autoHideInactiveTabs: document.getElementById('setting-autoHideInactiveTabs').checked,
    tabSuspensionTimeout: parseInt(document.getElementById('setting-tabSuspensionTimeout').value),
    systemTray: document.getElementById('setting-systemTray').checked,
    closeToTray: document.getElementById('setting-closeToTray').checked,
    startOnBoot: document.getElementById('setting-startOnBoot').checked,
    notifications: document.getElementById('setting-notifications').checked,
    hardwareAcceleration: document.getElementById('setting-hardwareAcceleration').checked,
    preloadServices: document.getElementById('setting-preloadServices').checked,
    cacheSize: parseInt(document.getElementById('setting-cacheSize').value),
    persistSessions: document.getElementById('setting-persistSessions').checked,
    clearCacheOnExit: document.getElementById('setting-clearCacheOnExit').checked
  };

  // Update services
  const serviceCheckboxes = document.querySelectorAll('#services-list input[type="checkbox"]');
  serviceCheckboxes.forEach(checkbox => {
    const serviceId = checkbox.dataset.serviceId;
    const service = currentServices.find(s => s.id === serviceId);
    if (service) {
      service.enabled = checkbox.checked;
    }
  });

  await window.electron.updateSettings(newSettings);
  await window.electron.updateServices(currentServices);

  currentSettings = newSettings;

  // Show restart notice for hardware acceleration changes
  const oldHwAccel = currentSettings.hardwareAcceleration;
  if (oldHwAccel !== newSettings.hardwareAcceleration) {
    alert('Hardware acceleration changes require a restart to take effect.');
  }

  closeSettings();

  // Re-render tabs
  renderTabs();
}

// Memory monitor
async function openMemoryMonitor() {
  document.getElementById('memory-modal').classList.remove('hidden');
  await updateMemoryStats();
}

function closeMemoryMonitor() {
  document.getElementById('memory-modal').classList.add('hidden');
}

async function updateMemoryStats() {
  const memoryInfo = await window.electron.getMemoryInfo();

  document.getElementById('total-memory').textContent = `${memoryInfo.app.rss} MB`;
  document.getElementById('process-count').textContent = memoryInfo.app.processCount || '--';
  document.getElementById('heap-used').textContent = `${memoryInfo.app.heapUsed} MB`;
  document.getElementById('current-usage').textContent = memoryInfo.app.rss;
  document.getElementById('system-free').textContent = `${memoryInfo.system.free} MB`;
}

// Initialize on load
init();
