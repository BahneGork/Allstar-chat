let currentSettings = {};
let currentServices = [];
let activeTabId = null;
let tabSuspensionTimers = {};
let monitoringStarted = {}; // Track which webviews have monitoring started
let titleMonitoringIntervals = {}; // Track title monitoring intervals
let domMonitoringIntervals = {}; // Track DOM monitoring intervals

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

  // Update webview visibility and notification permissions
  document.querySelectorAll('webview').forEach(webview => {
    const isActive = webview.dataset.serviceId === serviceId;
    webview.classList.toggle('active', isActive);

    // Block notifications and mute audio for active tab (user is viewing it)
    // Allow notifications and unmute audio for inactive tabs
    if (isActive) {
      blockWebviewNotifications(webview);
      // Mute in-page sounds for active tab (you can see the messages already)
      try {
        webview.setAudioMuted(true);
        console.log(`[${webview.dataset.serviceId}] Audio muted (active tab)`);
      } catch (e) {
        console.warn('Could not mute webview:', e.message);
      }
    } else {
      allowWebviewNotifications(webview);
      // Unmute for inactive tabs (so you hear notifications from background chats)
      try {
        webview.setAudioMuted(false);
        console.log(`[${webview.dataset.serviceId}] Audio unmuted (inactive tab)`);
      } catch (e) {
        console.warn('Could not unmute webview:', e.message);
      }
    }
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

// Block notifications from webview (for active tab)
function blockWebviewNotifications(webview) {
  try {
    webview.executeJavaScript(`
      (function() {
        // Save original Notification if not already saved
        if (!window.__originalNotification) {
          window.__originalNotification = window.Notification;
        }

        // Override Notification API to be silent
        window.Notification = function() {
          console.log('[AllStar] Notification blocked (active tab)');
          // Return a dummy notification that does nothing
          return {
            close: () => {},
            addEventListener: () => {},
            removeEventListener: () => {}
          };
        };
        window.Notification.permission = 'granted'; // Pretend permission is granted
        window.Notification.requestPermission = () => Promise.resolve('granted');

        console.log('[AllStar] Notifications muted for active tab');
      })();
    `).catch(e => {
      // Silently ignore - frame might be disposed or not ready
      if (!e.message.includes('disposed')) {
        console.log('[AllStar] Could not block notifications:', e.message);
      }
    });
  } catch (e) {
    console.log('[AllStar] Error blocking notifications:', e.message);
  }
}

// Allow notifications from webview (for inactive tabs)
function allowWebviewNotifications(webview) {
  try {
    webview.executeJavaScript(`
      (function() {
        // Restore original Notification API
        if (window.__originalNotification) {
          window.Notification = window.__originalNotification;
          console.log('[AllStar] Notifications enabled for inactive tab');
        }
      })();
    `).catch(e => {
      // Silently ignore - frame might be disposed or not ready
      if (!e.message.includes('disposed')) {
        console.log('[AllStar] Could not allow notifications:', e.message);
      }
    });
  } catch (e) {
    console.log('[AllStar] Error allowing notifications:', e.message);
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

    // Show error message with retry option for main frame load failures
    const errorOverlay = document.createElement('div');
    errorOverlay.id = `load-error-${serviceId}`;
    errorOverlay.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #2d2d2d;
      color: #fff;
      padding: 30px;
      border-radius: 8px;
      text-align: center;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      max-width: 400px;
    `;
    errorOverlay.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #ff6b6b;">⚠️ Failed to Load ${service.name}</h3>
      <p style="margin: 0 0 10px 0; color: #ccc; font-size: 14px;">Error: ${e.errorDescription}</p>
      <p style="margin: 0 0 20px 0; color: #888; font-size: 12px;">Code: ${e.errorCode}</p>
      <button id="retry-load-${serviceId}" style="
        background: #007acc;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
        margin-right: 10px;
      ">Retry</button>
      <button id="clear-session-${serviceId}" style="
        background: #d9534f;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      ">Clear Session & Retry</button>
    `;

    container.appendChild(errorOverlay);

    // Retry button - simple reload
    document.getElementById(`retry-load-${serviceId}`).addEventListener('click', () => {
      errorOverlay.remove();
      webview.reload();
    });

    // Clear session button - clear all session data and reload
    document.getElementById(`clear-session-${serviceId}`).addEventListener('click', async () => {
      errorOverlay.remove();
      console.log(`[${serviceId}] Clearing session and reloading...`);

      try {
        // Clear session data via main process
        const result = await window.electron.clearServiceSession(serviceId);

        if (result.success) {
          console.log(`[${serviceId}] Session cleared successfully`);
        } else {
          console.warn(`[${serviceId}] Session clear returned error:`, result.error);
        }

        // Clear webview history
        webview.clearHistory();

        // Navigate to blank first, then back to service URL
        await webview.loadURL('about:blank');
        setTimeout(() => {
          webview.src = service.url;
        }, 500);
      } catch (err) {
        console.error(`[${serviceId}] Failed to clear session:`, err);
        webview.reload();
      }
    });
  });

  webview.addEventListener('dom-ready', () => {
    console.log(`${service.name} DOM ready`);

    // Enable DevTools for Wordle to debug ad blocking (commented out for normal use)
    // if (serviceId === 'wordle') {
    //   webview.openDevTools();
    // }

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

    // Hide ad placeholders for Wordle
    if (serviceId === 'wordle') {
      hideWordleAdPlaceholders(webview);
    }

    // Block notifications if this is the active tab
    if (serviceId === activeTabId) {
      blockWebviewNotifications(webview);
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

  // Context menu for images (right-click -> Copy Image)
  webview.addEventListener('context-menu', (e) => {
    e.preventDefault();

    // Check if the context menu was triggered on an image
    const { x, y, mediaType, srcURL } = e.params;

    if (mediaType === 'image' && srcURL) {
      // Create a custom context menu
      const contextMenuHtml = `
        <div id="custom-context-menu" style="
          position: fixed;
          left: ${x}px;
          top: ${y}px;
          background: #2d2d2d;
          border: 1px solid #444;
          border-radius: 4px;
          padding: 4px 0;
          box-shadow: 0 2px 8px rgba(0,0,0,0.5);
          z-index: 99999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 13px;
          min-width: 150px;
        ">
          <div class="context-menu-item" data-action="copy-image" data-url="${srcURL}" style="
            padding: 6px 12px;
            cursor: pointer;
            color: #fff;
            user-select: none;
          " onmouseover="this.style.background='#007acc'" onmouseout="this.style.background='transparent'">
            Copy Image
          </div>
          <div class="context-menu-item" data-action="open-image" data-url="${srcURL}" style="
            padding: 6px 12px;
            cursor: pointer;
            color: #fff;
            user-select: none;
          " onmouseover="this.style.background='#007acc'" onmouseout="this.style.background='transparent'">
            Open Image in Browser
          </div>
        </div>
      `;

      // Remove any existing context menu
      const existingMenu = document.getElementById('custom-context-menu');
      if (existingMenu) {
        existingMenu.remove();
      }

      // Add context menu to DOM
      document.body.insertAdjacentHTML('beforeend', contextMenuHtml);

      const menu = document.getElementById('custom-context-menu');

      // Handle menu item clicks
      menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', async () => {
          const action = item.dataset.action;
          const url = item.dataset.url;

          if (action === 'copy-image') {
            console.log('Copying image:', url);
            try {
              const result = await window.electron.copyImageToClipboard(url);
              if (result.success) {
                console.log('Image copied to clipboard successfully');
                // Optional: Show a brief success indicator
                showCopyNotification();
              } else {
                console.error('Failed to copy image:', result.error);
              }
            } catch (error) {
              console.error('Error copying image:', error);
            }
          } else if (action === 'open-image') {
            window.open(url, '_blank');
          }

          menu.remove();
        });
      });

      // Remove menu when clicking outside
      const removeMenu = (event) => {
        if (!menu.contains(event.target)) {
          menu.remove();
          document.removeEventListener('click', removeMenu);
        }
      };

      setTimeout(() => {
        document.addEventListener('click', removeMenu);
      }, 100);
    }
  });

  // Handle webview crashes
  webview.addEventListener('render-process-gone', (e) => {
    console.error(`[${serviceId}] Webview crashed:`, e.details);

    // Show error overlay
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #2d2d2d;
      color: #fff;
      padding: 30px;
      border-radius: 8px;
      text-align: center;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;
    errorDiv.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #ff6b6b;">⚠️ ${service.name} Crashed</h3>
      <p style="margin: 0 0 20px 0; color: #ccc;">The page stopped responding</p>
      <button id="reload-${serviceId}" style="
        background: #007acc;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      ">Reload</button>
    `;

    container.appendChild(errorDiv);

    document.getElementById(`reload-${serviceId}`).addEventListener('click', () => {
      errorDiv.remove();
      webview.reload();
    });

    // Auto-reload after 3 seconds
    setTimeout(() => {
      if (errorDiv.parentNode) {
        console.log(`[${serviceId}] Auto-reloading after crash...`);
        errorDiv.remove();
        webview.reload();
      }
    }, 3000);
  });

  // Handle webview becoming unresponsive
  webview.addEventListener('unresponsive', () => {
    console.warn(`[${serviceId}] Webview became unresponsive`);

    // Show warning overlay
    const warningDiv = document.createElement('div');
    warningDiv.id = `unresponsive-${serviceId}`;
    warningDiv.style.cssText = `
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #2d2d2d;
      color: #fff;
      padding: 30px;
      border-radius: 8px;
      text-align: center;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;
    warningDiv.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #ffa500;">⚠️ ${service.name} Not Responding</h3>
      <p style="margin: 0 0 20px 0; color: #ccc;">Waiting for page to respond...</p>
      <button id="reload-unresponsive-${serviceId}" style="
        background: #007acc;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      ">Reload Now</button>
    `;

    container.appendChild(warningDiv);

    document.getElementById(`reload-unresponsive-${serviceId}`).addEventListener('click', () => {
      warningDiv.remove();
      webview.reload();
    });
  });

  // Handle webview becoming responsive again
  webview.addEventListener('responsive', () => {
    console.log(`[${serviceId}] Webview became responsive again`);

    // Remove warning overlay if present
    const warningDiv = document.getElementById(`unresponsive-${serviceId}`);
    if (warningDiv) {
      warningDiv.remove();
    }
  });

  container.appendChild(webview);
  console.log('Webview appended to container');
}

// Hide ad placeholders on Wordle
function hideWordleAdPlaceholders(webview) {
  console.log('[Wordle] Attempting to inject ad blocker...');

  webview.executeJavaScript(`
    (function() {
      try {
        console.log('[Wordle Ad Blocker] Script starting...');

        // CSS to hide ad containers and buttons
        const style = document.createElement('style');
        style.textContent = \`
          /* Hide ad containers that are left empty after blocking */
          [class*="ad-"],
          [id*="ad-"],
          [data-testid*="ad"],
          .pz-ad,
          .pz-moment,
          #pz-moment,
          button[aria-label*="dvertisement"],
          /* Hide empty divs that were ad containers */
          div[style*="min-height"]:empty,
          aside:empty {
            display: none !important;
            height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
          }
        \`;
        document.head.appendChild(style);
        console.log('[Wordle Ad Blocker] CSS injected successfully');

        // Remove advertisement buttons and containers
        function removeAdButtons() {
          try {
            console.log('[Wordle Ad Blocker] Running removeAdButtons...');

            // Find and log all buttons for debugging
            const allButtons = Array.from(document.querySelectorAll('button'));
            console.log('[Wordle Ad Blocker] Total buttons found:', allButtons.length);

            let foundAdButton = false;
            allButtons.forEach(btn => {
              try {
                const text = btn.textContent.toLowerCase().trim();
                const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';

                if (text.includes('advertisement') || ariaLabel.includes('advertisement')) {
                  foundAdButton = true;
                  console.log('[Wordle Ad Blocker] Found ad button:', {
                    text: btn.textContent,
                    ariaLabel: btn.getAttribute('aria-label'),
                    parent: btn.parentElement?.tagName,
                    parentClass: btn.parentElement?.className,
                    parentId: btn.parentElement?.id
                  });

                  // Remove the button and potentially its parent container
                  const parent = btn.parentElement;
                  const grandparent = parent?.parentElement;

                  btn.remove();
                  console.log('[Wordle Ad Blocker] Button removed');

                  // If parent is now empty, remove it too
                  if (parent && parent.children.length === 0) {
                    console.log('[Wordle Ad Blocker] Removing empty parent:', parent.tagName, parent.className);
                    parent.remove();

                    // Check grandparent too
                    if (grandparent && grandparent.children.length === 0) {
                      console.log('[Wordle Ad Blocker] Removing empty grandparent:', grandparent.tagName, grandparent.className);
                      grandparent.remove();
                    }
                  }
                }
              } catch (btnError) {
                console.error('[Wordle Ad Blocker] Error processing button:', btnError);
              }
            });

            if (!foundAdButton) {
              console.log('[Wordle Ad Blocker] No advertisement buttons found');
            }

            // Remove containers with aria-label advertisement
            const ariaElements = document.querySelectorAll('[aria-label*="dvertisement"]');
            console.log('[Wordle Ad Blocker] Found', ariaElements.length, 'aria-label ad elements');
            ariaElements.forEach(el => {
              console.log('[Wordle Ad Blocker] Removing aria-label ad element:', el.tagName, el.className);
              el.remove();
            });

            // Look for and remove pz-moment and similar containers
            const adContainers = document.querySelectorAll('.pz-moment, [class*="ad-"], [id*="ad-"], [class*="adContainer"], [class*="Ad-module"]');
            console.log('[Wordle Ad Blocker] Found', adContainers.length, 'potential ad containers');
            adContainers.forEach(el => {
              // Don't remove if it contains the game
              if (!el.querySelector('#wordle-app-game') && !el.id.includes('game')) {
                console.log('[Wordle Ad Blocker] Removing ad container:', el.tagName, el.className || el.id);

                // Also remove parent container (usually has min-height that causes spacing)
                const parent = el.parentElement;
                const grandparent = parent?.parentElement;

                el.remove();

                // Remove parent if it only has minimal content or becomes empty
                if (parent && (parent.children.length === 0 || parent.children.length === 1)) {
                  console.log('[Wordle Ad Blocker] Removing parent of ad container:', parent.tagName, parent.className || parent.id, 'children:', parent.children.length);
                  parent.remove();

                  // Also check grandparent
                  if (grandparent && grandparent.children.length === 0) {
                    console.log('[Wordle Ad Blocker] Removing grandparent too:', grandparent.tagName, grandparent.className || grandparent.id);
                    grandparent.remove();
                  }
                }
              }
            });
          } catch (removeError) {
            console.error('[Wordle Ad Blocker] Error in removeAdButtons:', removeError);
          }
        }

        // Run immediately and after delays
        removeAdButtons();
        setTimeout(removeAdButtons, 1500);
        setTimeout(removeAdButtons, 3000);
        setTimeout(removeAdButtons, 5000);

        // Watch for new ad elements
        const observer = new MutationObserver(() => {
          removeAdButtons();
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        console.log('[Wordle Ad Blocker] Observer started');
      } catch (mainError) {
        console.error('[Wordle Ad Blocker] Main error:', mainError);
      }
    })();
  `).then(() => {
    console.log('[Wordle] Ad blocker injection completed');
  }).catch(e => {
    console.error('[Wordle] Failed to inject ad hiding script:', e);
  });
}

// Monitor page title for unread counts
function startTitleMonitoring(webview, serviceId) {
  // Clear existing interval if any
  if (titleMonitoringIntervals[serviceId]) {
    clearInterval(titleMonitoringIntervals[serviceId]);
  }

  titleMonitoringIntervals[serviceId] = setInterval(() => {
    try {
      // Check if webview still exists and is not destroyed
      if (!webview || !webview.isConnected) {
        console.log(`[${serviceId}] Webview disconnected, stopping title monitoring`);
        clearInterval(titleMonitoringIntervals[serviceId]);
        delete titleMonitoringIntervals[serviceId];
        return;
      }

      const title = webview.getTitle();
      if (title) {
        console.log(`[${serviceId}] Title:`, title);
        updateBadgeFromTitle(serviceId, title);
      }
    } catch (e) {
      // Webview might not be ready or destroyed
      if (e.message && e.message.includes('destroyed')) {
        console.log(`[${serviceId}] Webview destroyed, stopping title monitoring`);
        clearInterval(titleMonitoringIntervals[serviceId]);
        delete titleMonitoringIntervals[serviceId];
      } else {
        console.error(`Error getting title for ${serviceId}:`, e);
      }
    }
  }, 3000); // Check every 3 seconds
}

// Monitor DOM for notification elements
function startDOMMonitoring(webview, serviceId) {
  console.log(`[${serviceId}] Starting DOM monitoring interval...`);

  // Clear existing interval if any
  if (domMonitoringIntervals[serviceId]) {
    clearInterval(domMonitoringIntervals[serviceId]);
  }

  domMonitoringIntervals[serviceId] = setInterval(() => {
    console.log(`[${serviceId}] Running DOM check...`);
    try {
      // Check if webview still exists and is not destroyed
      if (!webview || !webview.isConnected) {
        console.log(`[${serviceId}] Webview disconnected, stopping DOM monitoring`);
        clearInterval(domMonitoringIntervals[serviceId]);
        delete domMonitoringIntervals[serviceId];
        return;
      }
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

// Show brief notification when image is copied
function showCopyNotification() {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #28a745;
    color: white;
    padding: 12px 20px;
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    animation: slideIn 0.3s ease-out;
  `;
  notification.textContent = '✓ Image copied to clipboard';

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.transition = 'opacity 0.3s ease-out';
    notification.style.opacity = '0';
    setTimeout(() => {
      notification.remove();
      style.remove();
    }, 300);
  }, 2000);
}

// Initialize on load
init();
