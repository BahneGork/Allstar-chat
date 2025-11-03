let currentSettings = {};
let currentServices = [];
let activeTabId = null;
let tabSuspensionTimers = {};
let monitoringStarted = {}; // Track which webviews have monitoring started

// Initialize app
async function init() {
  console.log('Initializing AllStar...');
  currentSettings = await window.electron.getSettings();
  currentServices = await window.electron.getServices();
  console.log('Services loaded:', currentServices);
  console.log('Settings loaded:', currentSettings);

  renderTabs();
  setupEventListeners();

  // Preload services based on setting
  const enabledServices = currentServices.filter(s => s.enabled);
  console.log('Enabled services:', enabledServices);

  if (enabledServices.length === 0) {
    console.error('No enabled services found!');
    return;
  }

  if (currentSettings.preloadServices) {
    // Create webviews for all enabled services
    console.log('Preloading all enabled services...');
    enabledServices.forEach(service => {
      createWebview(service.id);
    });
  } else {
    // Only create first service
    console.log('Preload disabled - creating only first service');
    createWebview(enabledServices[0].id);
  }

  // Activate first enabled service
  const firstEnabledService = enabledServices[0];
  console.log('Activating first service:', firstEnabledService);
  switchTab(firstEnabledService.id);
}

// Render tabs
function renderTabs() {
  const tabsContainer = document.getElementById('tabs');
  tabsContainer.innerHTML = '';

  currentServices.filter(s => s.enabled).forEach(service => {
    const tab = document.createElement('button');
    tab.className = 'tab';
    tab.dataset.serviceId = service.id;

    const tabText = document.createElement('span');
    tabText.className = 'tab-text';
    tabText.textContent = service.name;

    const badge = document.createElement('span');
    badge.className = 'tab-badge';
    badge.dataset.serviceId = service.id;
    badge.style.display = 'none';

    tab.appendChild(tabText);
    tab.appendChild(badge);
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

  // Clear badge when viewing the tab (user has seen the notifications)
  // Note: Badge will reappear if title updates with new unread count
  // This gives immediate visual feedback that you've opened the tab

  // Update webview visibility
  document.querySelectorAll('webview').forEach(webview => {
    webview.classList.toggle('active', webview.dataset.serviceId === serviceId);
  });

  // Create webview if it doesn't exist (lazy loading when preload is disabled)
  const existingWebview = document.querySelector(`webview[data-service-id="${serviceId}"]`);
  if (!existingWebview) {
    console.log(`Creating webview on-demand for: ${serviceId}`);
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
  webview.setAttribute('webpreferences', 'contextIsolation=true,enableRemoteModule=false');

  // Event listeners
  webview.addEventListener('did-start-loading', () => {
    console.log(`${service.name} started loading...`);
  });

  webview.addEventListener('did-stop-loading', () => {
    console.log(`${service.name} loaded successfully`);
  });

  webview.addEventListener('did-fail-load', (e) => {
    // Ignore subframe errors and redirects (error code -3)
    if (!e.isMainFrame || e.errorCode === -3) {
      return; // These are expected during normal operation
    }
    console.error(`${service.name} failed to load:`, e.errorCode, e.errorDescription);
  });

  webview.addEventListener('dom-ready', () => {
    console.log(`${service.name} DOM ready`);

    // Only start monitoring once per webview
    if (monitoringStarted[serviceId]) {
      console.log(`[${serviceId}] Monitoring already started, skipping...`);
      return;
    }

    console.log(`[${serviceId}] First DOM ready - starting monitoring`);
    monitoringStarted[serviceId] = true;

    // Inject user agent to help with compatibility
    try {
      webview.setUserAgent(webview.getUserAgent() + ' AllStar/1.0');
    } catch (e) {
      console.warn(`[${serviceId}] Could not set user agent:`, e.message);
    }

    // Test if JavaScript execution works
    webview.executeJavaScript('document.title').then(title => {
      console.log(`[${serviceId}] JavaScript execution works! Title: ${title}`);
    }).catch(e => {
      // Silently ignore - frame might be disposed during navigation
      if (!e.message.includes('disposed')) {
        console.error(`[${serviceId}] JavaScript execution FAILED:`, e.message);
      }
    });

    // Ad blocking for Wordle
    if (serviceId === 'wordle') {
      injectWordleAdBlocker(webview);
    }

    // Start monitoring for title changes and DOM-based notifications
    startTitleMonitoring(webview, serviceId);
    startDOMMonitoring(webview, serviceId);
  });

  webview.addEventListener('page-title-updated', (e) => {
    updateBadgeFromTitle(serviceId, e.title);
  });

  webview.addEventListener('new-window', (e) => {
    require('electron').shell.openExternal(e.url);
  });

  container.appendChild(webview);
  console.log('Webview appended to container');
}

// Ad blocker for Wordle
function injectWordleAdBlocker(webview) {
  console.log('[Wordle] Injecting ad blocker...');

  const adBlockerCSS = `
    /* Hide NYT ads and promotional content */
    [data-testid*="ad"],
    [class*="ad-"],
    [id*="ad-"],
    .ad,
    .advertisement,
    .pz-ad-box,
    .pz-ad,
    aside[aria-label*="advertisement"],
    iframe[src*="doubleclick"],
    iframe[src*="googlesyndication"],
    .place-ad,
    .ad-container,
    #ad-container,
    .nytimes-ads,
    [class*="AdWrapper"],
    [class*="AdSlot"],
    [id*="AdSlot"],
    div[data-ad-placeholder],
    .css-1wbvk4p, /* NYT specific ad class */
    .css-vurnku, /* NYT specific ad class */
    #gateway-content, /* NYT paywall */
    [data-testid="inline-message"],
    [data-testid="expanded-dock"],
    [data-testid="purr-ad"],
    [class*="adWrapper"],
    [class*="AdUnit"],
    [id*="google_ads"],
    .place-bottom,
    .place-top {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      height: 0 !important;
      width: 0 !important;
      position: absolute !important;
      left: -9999px !important;
    }

    /* Remove bottom ad space */
    body {
      padding-bottom: 0 !important;
    }

    /* Maximize game area */
    #wordle-app-game {
      max-height: 100vh !important;
    }
  `;

  try {
    webview.executeJavaScript(`
      (function() {
        console.log('[Wordle Ad Blocker] Injecting CSS...');

        // Inject ad blocking CSS
        const style = document.createElement('style');
        style.textContent = \`${adBlockerCSS}\`;
        document.head.appendChild(style);

        // Remove ad elements that get added dynamically
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === 1) { // Element node
                // Check if it's an ad by various attributes
                const isAd =
                  node.id?.includes('ad') ||
                  node.className?.includes('ad') ||
                  node.getAttribute('data-testid')?.includes('ad') ||
                  node.tagName === 'IFRAME' && (
                    node.src?.includes('doubleclick') ||
                    node.src?.includes('googlesyndication')
                  );

                if (isAd) {
                  console.log('[Wordle Ad Blocker] Removing ad element:', node);
                  node.remove();
                }
              }
            });
          });
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        console.log('[Wordle Ad Blocker] Active and monitoring for new ads');
      })();
    `).then(() => {
      console.log('[Wordle] Ad blocker injected successfully');
    }).catch(e => {
      console.error('[Wordle] Failed to inject ad blocker:', e);
    });
  } catch (e) {
    console.error('[Wordle] Ad blocker injection error:', e);
  }
}

// Monitor page title for unread counts
function startTitleMonitoring(webview, serviceId) {
  setInterval(() => {
    try {
      const title = webview.getTitle();
      if (title) {
        console.log(`[${serviceId}] Title:`, title);
        updateBadgeFromTitle(serviceId, title);
      }
    } catch (e) {
      // Webview might not be ready
      console.error(`Error getting title for ${serviceId}:`, e);
    }
  }, 3000); // Check every 3 seconds
}

// Monitor DOM for notification elements
function startDOMMonitoring(webview, serviceId) {
  console.log(`[${serviceId}] Starting DOM monitoring interval...`);
  setInterval(() => {
    console.log(`[${serviceId}] Running DOM check...`);
    try {
      // Inject code to check for notification badges in the page
      webview.executeJavaScript(`
        (function() {
          let count = 0;
          let debugInfo = [];

          // Method 1: Messenger specific - check for notification badge elements
          const badges = document.querySelectorAll('[data-testid*="notification"], [data-badge], .notification-badge');
          debugInfo.push('Method 1 (Messenger badges): ' + badges.length + ' elements');
          for (const badge of badges) {
            const text = badge.textContent || badge.getAttribute('aria-label') || '';
            const match = text.match(/\\d+/);
            if (match) {
              count = Math.max(count, parseInt(match[0]));
              debugInfo.push('Found in badge: ' + match[0]);
            }
          }

          // Method 2: Google Chat specific - navigation sidebar badges
          // Google Chat shows unread count in the left sidebar navigation
          const chatSidebar = document.querySelectorAll('[role="navigation"] span, [data-item-id] span, .LoYTxf span');
          debugInfo.push('Method 2 (Chat sidebar): ' + chatSidebar.length + ' elements');
          for (const el of chatSidebar) {
            const text = el.textContent?.trim() || '';
            // Must be ONLY a number (not part of a longer string)
            if (/^\\d+$/.test(text)) {
              const num = parseInt(text);
              if (num < 100 && num > 0) { // Reasonable unread message count
                count = Math.max(count, num);
                debugInfo.push('Found in sidebar: ' + num);
              }
            }
          }

          // Method 3: Check for elements with specific unread-related aria labels
          const ariaElements = document.querySelectorAll('[aria-label*="unread" i], [aria-label*="new message" i]');
          debugInfo.push('Method 3 (Aria labels): ' + ariaElements.length + ' elements');
          for (const el of ariaElements) {
            const ariaLabel = el.getAttribute('aria-label') || '';
            const match = ariaLabel.match(/(\\d+)\\s*(unread|new)/i);
            if (match) {
              count = Math.max(count, parseInt(match[1]));
              debugInfo.push('Found in aria-label: ' + match[1]);
            }
          }

          // Method 4: Check page title for notification pattern (Messenger style)
          const titleMatch = document.title.match(/^\\((\\d+)\\)/);
          if (titleMatch) {
            count = Math.max(count, parseInt(titleMatch[1]));
            debugInfo.push('Found in title: ' + titleMatch[1]);
          }

          // Method 5: Look for badge-like spans (small, numeric content)
          const smallSpans = document.querySelectorAll('span[style*="background"], span[class*="badge" i], span[class*="count" i]');
          debugInfo.push('Method 5 (Badge spans): ' + smallSpans.length + ' elements');
          for (const span of smallSpans) {
            const text = span.textContent?.trim() || '';
            if (/^\\d+$/.test(text)) {
              const num = parseInt(text);
              if (num < 100 && num > 0) {
                count = Math.max(count, num);
                debugInfo.push('Found in badge span: ' + num);
              }
            }
          }

          return { count, debugInfo: debugInfo.join(' | ') };
        })();
      `).then(result => {
        console.log(`[${serviceId}] ${result.debugInfo}`);
        if (result.count > 0) {
          console.log(`[${serviceId}] *** FOUND COUNT: ${result.count} ***`);
          updateBadgeCount(serviceId, result.count);
        } else {
          console.log(`[${serviceId}] No notifications found`);
          updateBadgeCount(serviceId, 0);
        }
      }).catch((e) => {
        // Silently ignore disposed frame errors during navigation
        if (!e.message || !e.message.includes('disposed')) {
          console.error(`[${serviceId}] Injection failed:`, e.message || e);
        }
      });
    } catch (e) {
      console.error(`Error monitoring DOM for ${serviceId}:`, e);
    }
  }, 5000); // Check every 5 seconds
}

// Update badge with a specific count
function updateBadgeCount(serviceId, count) {
  const badge = document.querySelector(`.tab-badge[data-service-id="${serviceId}"]`);
  if (!badge) return;

  const previousCount = parseInt(badge.textContent) || 0;

  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count.toString();
    badge.style.display = 'inline-flex';

    // Show notification if count increased and tab is not active
    console.log(`[${serviceId}] Notification check: count=${count}, prev=${previousCount}, active=${serviceId === activeTabId}, enabled=${currentSettings.notifications}`);
    if (count > previousCount && serviceId !== activeTabId && currentSettings.notifications) {
      const service = currentServices.find(s => s.id === serviceId);
      if (service) {
        const serviceName = service.name;
        const messageCount = count > 99 ? '99+' : count;
        console.log(`[${serviceId}] Triggering notification: ${serviceName} - ${messageCount} messages`);
        window.electron.showNotification(
          serviceName,
          `${messageCount} unread message${count > 1 ? 's' : ''}`,
          serviceId
        );
      }
    }
  } else {
    badge.style.display = 'none';
  }
}

// Update badge based on page title
function updateBadgeFromTitle(serviceId, title) {
  if (!title) return;

  const badge = document.querySelector(`.tab-badge[data-service-id="${serviceId}"]`);
  if (!badge) {
    console.log(`Badge element not found for ${serviceId}`);
    return;
  }

  // Try multiple patterns:
  // "(3) Messenger", "Messenger (3)", "(3)", "3 new messages", etc.
  let count = 0;

  // Pattern 1: (number) at start or end
  let match = title.match(/\((\d+)\)/);
  if (match) {
    count = parseInt(match[1]);
    console.log(`[${serviceId}] Found count in parentheses:`, count);
  }

  // Pattern 2: number followed by "new" or "unread"
  if (count === 0) {
    match = title.match(/(\d+)\s*(new|unread)/i);
    if (match) {
      count = parseInt(match[1]);
      console.log(`[${serviceId}] Found count with 'new/unread':`, count);
    }
  }

  // Pattern 3: Just a number at the start
  if (count === 0) {
    match = title.match(/^(\d+)\s/);
    if (match) {
      count = parseInt(match[1]);
      console.log(`[${serviceId}] Found count at start:`, count);
    }
  }

  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count.toString();
    badge.style.display = 'inline-flex';
    console.log(`[${serviceId}] Badge updated:`, count);
  } else {
    badge.style.display = 'none';
  }
}

// Suspend tab (reduce memory usage)
function suspendTab(serviceId) {
  const webview = document.querySelector(`webview[data-service-id="${serviceId}"]`);
  if (webview && serviceId !== activeTabId) {
    console.log(`Suspending tab: ${serviceId}`);
    // In Electron, we can't truly suspend, but we can hide and throttle
    if (currentSettings.autoSuspendInactiveTabs) {
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
  // Pin button (Always on Top)
  document.getElementById('pin-btn').addEventListener('click', toggleAlwaysOnTop);

  // Settings button
  document.getElementById('settings-btn').addEventListener('click', openSettings);
  document.getElementById('close-settings').addEventListener('click', closeSettings);
  document.getElementById('save-settings').addEventListener('click', saveSettings);
  document.getElementById('test-notification-btn').addEventListener('click', testNotification);

  // Memory monitor
  document.getElementById('memory-btn').addEventListener('click', openMemoryMonitor);
  document.getElementById('close-memory').addEventListener('click', closeMemoryMonitor);
  document.getElementById('refresh-memory').addEventListener('click', updateMemoryStats);

  // Update pin button state on load
  updatePinButtonState();
}

// Test notification
function testNotification() {
  console.log('Test notification button clicked');
  window.electron.showNotification(
    'AllStar Test',
    'This is a test notification to verify the system is working!',
    null
  );
}

// Always on top toggle
async function toggleAlwaysOnTop() {
  const newState = await window.electron.toggleAlwaysOnTop();
  updatePinButtonState(newState);
}

async function updatePinButtonState(state) {
  const pinBtn = document.getElementById('pin-btn');
  if (state === undefined) {
    state = await window.electron.getAlwaysOnTop();
  }

  if (state) {
    pinBtn.style.background = '#007acc';
    pinBtn.style.color = '#fff';
  } else {
    pinBtn.style.background = '';
    pinBtn.style.color = '';
  }
}

// Settings modal
async function openSettings() {
  currentSettings = await window.electron.getSettings();
  currentServices = await window.electron.getServices();

  // Populate settings
  document.getElementById('setting-autoSuspendInactiveTabs').checked = currentSettings.autoSuspendInactiveTabs;
  document.getElementById('setting-tabSuspensionTimeout').value = currentSettings.tabSuspensionTimeout;
  document.getElementById('setting-systemTray').checked = currentSettings.systemTray;
  document.getElementById('setting-closeToTray').checked = currentSettings.closeToTray;
  document.getElementById('setting-startOnBoot').checked = currentSettings.startOnBoot;
  document.getElementById('setting-startMinimized').checked = currentSettings.startMinimized;
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
    autoSuspendInactiveTabs: document.getElementById('setting-autoSuspendInactiveTabs').checked,
    tabSuspensionTimeout: parseInt(document.getElementById('setting-tabSuspensionTimeout').value),
    systemTray: document.getElementById('setting-systemTray').checked,
    closeToTray: document.getElementById('setting-closeToTray').checked,
    startOnBoot: document.getElementById('setting-startOnBoot').checked,
    startMinimized: document.getElementById('setting-startMinimized').checked,
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
