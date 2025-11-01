# Memory Monitoring Solution

## Problem
AllStar's memory dashboard was showing values that didn't match Windows Task Manager.

## Root Cause
Electron's `app.getAppMetrics()` API returns confusing memory metrics that don't directly match what Task Manager displays. Multiple attempts to decode these values failed:

1. ❌ Using `workingSetSize ÷ 1024` - Too high (~1600 MB vs 800 MB actual)
2. ❌ Using `privateBytes ÷ 2048` - Too low (~500 MB vs 800 MB actual)
3. ❌ Using `privateBytes ÷ 1024` - Still off (~1020 MB vs 800 MB actual)
4. ❌ Mixed metrics (different divisors per process type) - Inconsistent

## The Solution: Query Windows Directly

Instead of trying to decode Electron's API, we query Windows Performance Counters directly using WMIC - **the same source Task Manager uses**.

### Key Discovery
Task Manager's default "Memory" column shows **"Working Set Private"** (also called "Active Private Working Set"), which is:
- The amount of physical RAM currently used by the process
- Memory that **cannot be shared** with other processes
- Available via Windows Performance Counter: `Win32_PerfRawData_PerfProc_Process.WorkingSetPrivate`

### Implementation

```javascript
// Get PIDs from Electron API
const ourPIDs = allProcessMetrics.map(p => p.pid);

// Query Windows Performance Counters for WorkingSetPrivate
const pidList = ourPIDs.join(' OR IDProcess=');
const output = execSync(
  `wmic path Win32_PerfRawData_PerfProc_Process where "IDProcess=${pidList}" get IDProcess,WorkingSetPrivate /format:csv`,
  { encoding: 'utf8', timeout: 15000 }
);

// Parse CSV output and sum WorkingSetPrivate values
// Convert bytes to MB: value / (1024 * 1024)
```

### Why This Works
1. **Same data source as Task Manager** - We're querying the exact same Windows API
2. **Accurate by definition** - No guessing at conversion factors
3. **Process-specific** - Only counts our app's processes by PID
4. **Handles dev and production modes** - Works with electron.exe or AllStar.exe

## Important Notes

### Performance Counter Timeout
Performance counter queries are slower than regular process queries. Timeout must be set to at least 15 seconds:
```javascript
timeout: 15000  // 15 seconds minimum
```

### Memory Metrics Explained

| Metric | What It Is | Used By |
|--------|-----------|---------|
| **WorkingSetPrivate** | Physical RAM, non-shared | Task Manager "Memory" column ✅ |
| WorkingSetSize | Physical RAM, shared + non-shared | - |
| PrivatePageCount | Virtual memory committed | Task Manager "Commit size" column |
| PrivateBytes | Same as PrivatePageCount | Process Explorer |

### Testing Validation
To verify accuracy:
1. Open Task Manager → Details tab
2. Find AllStar processes by PID
3. Compare "Memory (active private working set)" column
4. Values should match within 1-2 MB (due to natural fluctuation)

## References
- [Memory Information in Task Manager - Pavel Yosifovich](https://scorpiosoftware.net/2023/04/12/memory-information-in-task-manager/)
- [Windows Task Manager Memory Columns - JamesCoyle.net](https://www.jamescoyle.net/knowledge/670-windows-task-manager-what-do-the-memory-columns-mean)
- [Calculating Private Working Set from WMI - Stack Overflow](https://stackoverflow.com/questions/14773457/calculating-private-working-set-memory-from-wmi-class-methods)

## Result
Memory dashboard now shows values within 1-2 MB of Task Manager - accurate enough for real-world monitoring! 🎉
