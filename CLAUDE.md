# AllStar - Claude Instructions

This document extends the general Claude instructions with AllStar-specific requirements.

## Project Context

**AllStar** is an Electron-based Windows desktop application that consolidates multiple chat services (Facebook Messenger and Google Chat) into a single, memory-optimized application.

**Key Technologies:**
- Electron 39.0.0
- Node.js
- electron-builder (Windows builds only)
- Webviews for service isolation

## Development Environment & Workflow

### Critical Workflow

**ENVIRONMENT**: Development happens in WSL2, but this is a **Windows-only application**.

**DO NOT BUILD IN WSL** - electron-builder requires Windows or wine to create Windows executables.

### Standard Development Process

```
┌─────────────┐      ┌──────────┐      ┌─────────┐      ┌──────────┐
│  WSL2       │      │   Git    │      │ Windows │      │  Test    │
│  Code       │─────▶│  Commit  │─────▶│  Pull   │─────▶│  Build   │
│  Changes    │      │  & Push  │      │  Build  │      │  & Run   │
└─────────────┘      └──────────┘      └─────────┘      └──────────┘
```

**Your Role (Claude in WSL2):**
1. ✅ Make code changes
2. ✅ Validate syntax: `node --check src/main.js`
3. ✅ Commit changes with descriptive messages
4. ✅ Push to remote repository
5. ❌ **NEVER** run `npm run build` (requires Windows/wine)

**User's Role (Windows):**
1. Pull changes from git
2. Run `npm run build` on Windows
3. Test the built application
4. Report results/issues

### Syntax Validation Only

Instead of building, validate code syntax:

```bash
# Check JavaScript syntax
node --check src/main.js
node --check src/renderer.js
node --check src/preload.js
```

## Project Structure

```
/home/exit/dev/projects/allstar/
├── src/
│   ├── main.js          # Electron main process (window management, IPC, power monitoring)
│   ├── renderer.js      # UI logic & webview management
│   ├── preload.js       # Security bridge (context isolation)
│   ├── index.html       # Main UI structure
│   └── styles.css       # Dark theme styling
├── assets/
│   └── icon.ico / icon.png
├── package.json         # Dependencies & build config
└── dist/               # Build output (Windows only, git-ignored)
```

## Key Technical Challenges

### 1. Title Bar Disappearing (Windows DWM Issue)
**Problem**: Electron loses window chrome after Windows sleep/wake or lock/unlock
**Solution**: Aggressive multi-step restoration sequence in powerMonitor events
**Location**: `main.js` powerMonitor event handlers

### 2. Session Corruption
**Problem**: Multiple instances corrupting shared session data
**Solution**: Single instance lock + proper cleanup
**Location**: `main.js` app.requestSingleInstanceLock()

### 3. Google Chat Retry/Reload
**Problem**: WebSocket connections failing after sleep/network changes
**Solution**: Error recovery UI with session clearing
**Location**: `renderer.js` webview error handlers

## Code Quality Standards

### Electron-Specific Best Practices
- Always check window/webContents existence before operations
- Use `setTimeout` for sequential operations that need Windows DWM to settle
- Clean up event listeners and intervals to prevent memory leaks
- Validate all data used in shell commands (prevent injection)

### Power Management
- Handle `suspend`, `resume`, `lock-screen`, `unlock-screen` events
- Save state before sleep, restore carefully after wake
- Account for network state changes after resume

### Memory Optimization
- Use webview `partition` for session isolation
- Implement tab suspension for background services
- Configure heap limits and throttling
- Monitor with WMIC queries (Windows-specific)

## Testing Checklist

When changes affect window management:
- [ ] Test after sleep/wake cycle
- [ ] Test after lock/unlock (Win+L)
- [ ] Test with window maximized
- [ ] Test with window minimized to tray
- [ ] Test with multiple monitors
- [ ] Verify title bar controls work (min/max/close)
- [ ] Verify window can be moved and resized

## Git Workflow

### Commit Messages
Follow conventional format:
```
<type>: <description>

Examples:
- "Fix title bar disappearing after Windows wake"
- "Add aggressive window chrome restoration"
- "Refactor power monitor into reusable function"
```

### After Making Changes
```bash
# Validate syntax
node --check src/main.js

# Stage changes
git add src/main.js

# Commit with descriptive message
git commit -m "Fix: Enhanced title bar restoration with maximize/minimize cycles"

# Push to remote
git push
```

## Project-Specific Restrictions

- **NEVER** run `npm run build` in WSL2
- **NEVER** attempt to execute Windows-specific commands that won't work in WSL
- **ALWAYS** validate syntax with `node --check` before committing
- **ALWAYS** commit and push after code changes
- **ALWAYS** let the user handle building and testing on Windows

## Success Criteria

Changes are successful when:
- ✅ Code passes `node --check` validation
- ✅ Changes are committed with clear message
- ✅ Changes are pushed to remote
- ✅ User confirms fix works after building on Windows

---

*This document follows the framework established in /home/exit/dev/projects/CLAUDE.md*
