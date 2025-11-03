# AllStar

A lightweight, memory-efficient all-in-one messenger app for Windows.

## Features

- **Ultra Lightweight**: Uses ~500-800MB vs 2GB+ of alternatives like Singlebox (60-75% memory reduction)
- **Tabbed Interface**: Switch between Messenger and Google Chat seamlessly
- **Smart Memory Management**: Auto-suspend inactive tabs, configurable timeouts
- **Comprehensive Settings**: Control every aspect with memory impact tips
- **Real-time Memory Monitor**: Accurate memory tracking matching Windows Task Manager
- **System Tray Integration**: Minimize to tray, close to tray, notification toggle in tray menu
- **Desktop Notifications**: Native Windows notifications for new messages in background tabs
- **Always on Top**: Quick-access pin button to keep window above other apps
- **Window Position Memory**: Automatically restores window size and position
- **Start Minimized**: Optional start minimized to system tray
- **Persistent Sessions**: Stay logged in across restarts
- **Hardware Acceleration**: Optional GPU acceleration for better performance
- **Privacy Controls**: Clear cache on exit, control session persistence

## Services Included

- Facebook Messenger
- Google Chat
- Wordle (NYT Games) - disabled by default

## Memory Optimization Features

### Built-in Optimizations
- JavaScript heap size limited to 512MB
- Background throttling enabled
- Renderer backgrounding disabled for better resource management
- Shared Chromium process across services

### User-Configurable Optimizations
- **Tab Suspension**: Automatically suspend inactive tabs after configurable timeout (10min - 2hr)
- **Auto-hide Inactive Tabs**: Hide tabs not in use to save ~100MB per tab
- **Cache Size Control**: Set cache limits (50MB - Unlimited)
- **Hardware Acceleration**: Toggle GPU usage
- **Preload Services**: Trade startup speed for memory (disabled by default)

## Installation

### Development
```bash
npm install
npm start
```

### Build Windows Installer
```bash
npm run build
```

The installer will be created in the `dist/` directory.

## Settings

All settings are accessible via the ⚙️ button in the top-right corner. Each setting includes a memory impact tip to help you make informed decisions about performance vs features.

### Recommended Settings (Default)
These settings provide the best balance of performance and usability:

- **Auto-hide Inactive Tabs**: ON (saves ~100MB per tab)
- **Tab Suspension**: 30 minutes (saves ~70% memory per suspended tab)
- **System Tray**: ON
- **Close to Tray**: ON
- **Start Minimized**: OFF (enable if you want silent startup)
- **Notifications**: ON
- **Hardware Acceleration**: ON
- **Preload Services**: ON (faster tab switching, uses more memory)
- **Cache Size**: 100MB

### Quick Access Features
- **📌 Pin Button**: Click the pin icon in the tab bar to toggle always-on-top mode
- **🔔 Tray Notifications**: Right-click system tray icon to quickly enable/disable notifications
- **📊 Memory Dashboard**: Displays accurate memory usage matching Task Manager values

## Memory Comparison

**Singlebox (Electron without optimization)**: ~2000MB
**AllStar (Optimized Electron)**: ~500-800MB
**Memory Saved**: ~1200-1500MB (60-75%)

## Architecture

Built with:
- **Electron**: Cross-platform desktop framework
- **electron-store**: Settings persistence
- **Webviews**: Isolated contexts for each service
- **Custom memory management**: Optimized for minimal resource usage

## System Requirements

- Windows 10/11 (x64)
- 4GB RAM recommended
- 100MB disk space

## License

MIT

## Technical Highlights

### Memory Monitoring Accuracy
AllStar queries Windows Performance Counters directly using `Win32_PerfRawData_PerfProc_Process.WorkingSetPrivate` - the same metric Windows Task Manager displays. This ensures memory readings are accurate to within 1-2 MB. See [MEMORY-MONITORING-SOLUTION.md](MEMORY-MONITORING-SOLUTION.md) for technical details.

### Design Files
Source design files are stored in the `design/` folder with version control. See [design/README.md](design/README.md) for the workflow.

## Future Enhancements

- Add more services (WhatsApp Web, Slack, Discord, etc.)
- True tab suspension with WebContents API
- Custom service URLs
- Themes (light/dark mode)
- Keyboard shortcuts
