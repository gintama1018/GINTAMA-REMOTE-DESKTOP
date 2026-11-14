const { exec, execSync, spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const VOL_BIN = `"${path.join(__dirname, 'volume_control.exe')}"`;
const NATIVE_BIN = path.join(__dirname, 'bridge_native.exe');

/**
 * Windows Native System Controller
 * Handles remote actions: lock, list apps, close apps, and system stats.
 */

// 1. Lock Screen
function lockScreen() {
  return new Promise((resolve, reject) => {
    // Windows native LockWorkStation
    exec('rundll32.exe user32.dll,LockWorkStation', (error) => {
      if (error) {
        return reject({ ok: false, error: error.message });
      }
      resolve({ ok: true, message: 'Laptop screen locked successfully' });
    });
  });
}

// 2. List Running User Applications (Processes with active top-level windows)
function listRunningApps() {
  return new Promise((resolve, reject) => {
    // PowerShell command to query processes that have a visible window title
    const psCmd = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id, ProcessName, MainWindowTitle, WorkingSet64, Responding | ConvertTo-Json -Compress`;
    
    exec(`powershell -NoProfile -Command "${psCmd}"`, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        return reject({ ok: false, error: error.message });
      }

      try {
        const raw = stdout.trim();
        if (!raw) {
          return resolve({ ok: true, apps: [] });
        }
        let list = JSON.parse(raw);
        if (!Array.isArray(list)) {
          list = [list];
        }

        const apps = list.map(p => ({
          pid: p.Id,
          name: p.ProcessName,
          title: p.MainWindowTitle,
          memoryMb: Math.round((p.WorkingSet64 || 0) / (1024 * 1024)),
          responding: p.Responding !== false
        }));

        resolve({ ok: true, apps });
      } catch (err) {
        reject({ ok: false, error: 'Failed to parse process list: ' + err.message });
      }
    });
  });
}

// 3. Close or Force Kill an Application
function closeApp(pid, force = false) {
  return new Promise((resolve, reject) => {
    if (!pid || isNaN(pid)) {
      return reject({ ok: false, error: 'Invalid PID' });
    }

    if (force) {
      // Force terminate
      exec(`taskkill /F /PID ${pid}`, (error, stdout) => {
        if (error) {
          return reject({ ok: false, error: error.message });
        }
        resolve({ ok: true, message: `Process ${pid} force terminated` });
      });
    } else {
      // Graceful close: tell PowerShell to call CloseMainWindow()
      const psCmd = `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { $p.CloseMainWindow(); Start-Sleep -Milliseconds 500; if (!$p.HasExited) { $p.Kill() } }`;
      exec(`powershell -NoProfile -Command "${psCmd}"`, (error) => {
        if (error) {
          return reject({ ok: false, error: error.message });
        }
        resolve({ ok: true, message: `Application ${pid} closed` });
      });
    }
  });
}

// 4. Get System Status & Battery Info
function getSystemStats() {
  return new Promise((resolve) => {
    const totalMem = Math.round(os.totalmem() / (1024 * 1024));
    const freeMem = Math.round(os.freemem() / (1024 * 1024));
    const usedMem = totalMem - freeMem;
    const memPct = Math.round((usedMem / totalMem) * 100);

    // Query battery on Windows
    const psCmd = `Get-CimInstance -ClassName Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json -Compress`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, (error, stdout) => {
      let battery = null;
      if (!error && stdout.trim()) {
        try {
          const b = JSON.parse(stdout.trim());
          battery = {
            percentage: b.EstimatedChargeRemaining,
            isCharging: b.BatteryStatus === 2 || b.BatteryStatus === 6 // Charging / discharging codes
          };
        } catch {}
      }

      resolve({
        ok: true,
        stats: {
          hostname: os.hostname(),
          platform: os.platform(),
          uptimeSeconds: Math.round(os.uptime()),
          memory: {
            totalMb: totalMem,
            usedMb: usedMem,
            usedPct: memPct
          },
          cpuCount: os.cpus().length,
          battery: battery || { percentage: 100, isCharging: true }
        }
      });
    });
  });
}

// 5. Remote Screen Snapshot (Ultra-fast native C# binary with fallback)
function takeScreenshot(maxWidth = 1024, quality = 65) {
  return new Promise((resolve) => {
    if (fs.existsSync(NATIVE_BIN)) {
      const child = spawn(NATIVE_BIN, ['screenshot', String(maxWidth), String(quality)]);
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', d => stdout += d.toString());
      child.stderr.on('data', d => stderr += d.toString());
      child.on('close', (code) => {
        const b64 = stdout.trim();
        if (code === 0 && b64.length > 50) {
          return resolve({ ok: true, imageBase64: b64, timestamp: Date.now() });
        }
        // Fallback to powershell if native exited with non-zero
        fallbackPowershellScreenshot(resolve);
      });
      child.on('error', () => fallbackPowershellScreenshot(resolve));
    } else {
      fallbackPowershellScreenshot(resolve);
    }
  });
}

function fallbackPowershellScreenshot(resolve) {
  const psScript = `
    Add-Type -AssemblyName System.Windows.Forms;
    Add-Type -AssemblyName System.Drawing;
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;
    $graphics = [System.Drawing.Graphics]::FromImage($bmp);
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);
    $scale = [Math]::Min(1.0, 1024.0 / $bounds.Width);
    $newW = [int]($bounds.Width * $scale);
    $newH = [int]($bounds.Height * $scale);
    $resized = New-Object System.Drawing.Bitmap $newW, $newH;
    $rg = [System.Drawing.Graphics]::FromImage($resized);
    $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear;
    $rg.DrawImage($bmp, 0, 0, $newW, $newH);
    $ms = New-Object System.IO.MemoryStream;
    $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg);
    $b64 = [Convert]::ToBase64String($ms.ToArray());
    $rg.Dispose(); $resized.Dispose(); $graphics.Dispose(); $bmp.Dispose(); $ms.Dispose();
    Write-Output $b64;
  `;
  exec(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, ' ')}"`, { maxBuffer: 15 * 1024 * 1024 }, (error, stdout) => {
    if (error || !stdout.trim()) {
      return resolve({ ok: false, error: error ? error.message : 'Screenshot failed' });
    }
    resolve({ ok: true, imageBase64: stdout.trim(), timestamp: Date.now() });
  });
}

// 5b. Get PC Clipboard
function getClipboard() {
  return new Promise((resolve) => {
    if (fs.existsSync(NATIVE_BIN)) {
      exec(`"${NATIVE_BIN}" get-clipboard`, { maxBuffer: 5 * 1024 * 1024 }, (error, stdout) => {
        if (!error) {
          return resolve({ ok: true, text: stdout });
        }
        fallbackGetClipboard(resolve);
      });
    } else {
      fallbackGetClipboard(resolve);
    }
  });
}

function fallbackGetClipboard(resolve) {
  exec('powershell -NoProfile -Command "Get-Clipboard"', (error, stdout) => {
    resolve({ ok: !error, text: stdout || '' });
  });
}

// 5c. Set PC Clipboard
function setClipboard(text) {
  return new Promise((resolve) => {
    if (fs.existsSync(NATIVE_BIN)) {
      const child = spawn(NATIVE_BIN, ['set-clipboard']);
      child.stdin.write(text || '');
      child.stdin.end();
      child.on('close', (code) => {
        resolve({ ok: code === 0, message: code === 0 ? 'Clipboard updated on PC' : 'Clipboard set failed' });
      });
      child.on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });
    } else {
      const safeText = (text || '').replace(/"/g, '`"');
      exec(`powershell -NoProfile -Command "Set-Clipboard -Value '${safeText}'"`, (error) => {
        resolve({ ok: !error, message: error ? error.message : 'Clipboard updated on PC' });
      });
    }
  });
}

// 5d. Paste Clipboard on PC Active Window
function pasteClipboard(text) {
  return new Promise(async (resolve) => {
    if (text) {
      await setClipboard(text);
      await new Promise(r => setTimeout(r, 60));
    }
    if (fs.existsSync(NATIVE_BIN)) {
      exec(`"${NATIVE_BIN}" paste-clipboard`, (error) => {
        resolve({ ok: !error, message: error ? error.message : 'Pasted on PC active window' });
      });
    } else {
      exec(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"`, (error) => {
        resolve({ ok: !error, message: error ? error.message : 'Pasted on PC active window' });
      });
    }
  });
}

// 6. Sleep Display / Monitor Power Off
function sleepDisplay() {
  return new Promise((resolve, reject) => {
    // SendMessage(HWND_BROADCAST=0xffff, WM_SYSCOMMAND=0x0112, SC_MONITORPOWER=0xf170, 2)
    const psCmd = `(Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern int SendMessage(int hWnd, int hMsg, int wParam, int lParam);' -Name "WinPower" -Namespace "Win32" -PassThru)::SendMessage(0xffff, 0x0112, 0xf170, 2)`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, (error) => {
      if (error) {
        return reject({ ok: false, error: error.message });
      }
      resolve({ ok: true, message: 'Display set to sleep mode' });
    });
  });
}

// 7. Wake Display
function wakeDisplay() {
  return new Promise((resolve) => {
    const psCmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{ESC}")`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, (error) => {
      resolve({ ok: !error, message: error ? error.message : 'Display woken' });
    });
  });
}

// 8. Toggle Audio Mute (CoreAudio native)
function toggleMute() {
  return new Promise((resolve) => {
    exec(`${VOL_BIN} mute`, (error, stdout) => {
      const isMuted = stdout && stdout.includes('MUTE:ON');
      resolve({ ok: true, isMuted, message: isMuted ? 'Muted' : 'Unmuted' });
    });
  });
}

// 9. Adjust Audio Volume Up/Down (CoreAudio native)
function adjustVolume(isUp) {
  return new Promise((resolve) => {
    exec(`${VOL_BIN} ${isUp ? 'up' : 'down'}`, (error, stdout) => {
      resolve({ ok: true, message: `Volume ${isUp ? 'increased' : 'decreased'}: ${stdout.trim()}` });
    });
  });
}

// 10. Set Volume 0-100% (CoreAudio native, instant 5ms)
function setVolume(percent) {
  return new Promise((resolve) => {
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    exec(`${VOL_BIN} ${pct}`, (error, stdout) => {
      resolve({ ok: true, message: `Volume set to ${pct}%` });
    });
  });
}

// 11. Unlock Workstation / Wake & Type PIN
function unlockWorkstation(pin) {
  return new Promise((resolve) => {
    wakeDisplay().catch(() => {});
    const cleanPin = (pin || '').replace(/"/g, '`"');
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      [System.Windows.Forms.SendKeys]::SendWait("{ESC}");
      Start-Sleep -Milliseconds 300;
      [System.Windows.Forms.SendKeys]::SendWait(" ");
      Start-Sleep -Milliseconds 300;
      if ("${cleanPin}") {
        [System.Windows.Forms.SendKeys]::SendWait("${cleanPin}");
        Start-Sleep -Milliseconds 200;
        [System.Windows.Forms.SendKeys]::SendWait("{ENTER}");
      }
    `;
    exec(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, ' ')}"`, (error) => {
      resolve({ ok: !error, message: error ? error.message : 'Workstation unlock sequence dispatched' });
    });
  });
}

// 12. Save File from Phone (Direct to Downloads folder)
function saveFile(name, base64Data) {
  return new Promise((resolve, reject) => {
    try {
      const cleanName = path.basename(name || 'transferred_file_' + Date.now());
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
      }

      let targetPath = path.join(downloadsDir, cleanName);
      if (fs.existsSync(targetPath)) {
        const ext = path.extname(cleanName);
        const base = path.basename(cleanName, ext);
        targetPath = path.join(downloadsDir, `${base}_${Date.now()}${ext}`);
      }

      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(targetPath, buffer);

      console.log(`[FileTransfer] 📥 Saved file: ${targetPath} (${(buffer.length / 1024).toFixed(1)} KB)`);

      resolve({
        ok: true,
        fileSaved: true,
        fileName: path.basename(targetPath),
        path: targetPath,
        size: buffer.length,
        message: `Saved ${path.basename(targetPath)} to PC Downloads (${(buffer.length / 1024).toFixed(1)} KB)`
      });
    } catch (err) {
      reject({ ok: false, error: err.message });
    }
  });
}

// 13. List Recent PC Files from Downloads
function listPcFiles() {
  return new Promise((resolve) => {
    try {
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      if (!fs.existsSync(downloadsDir)) {
        return resolve({ ok: true, files: [] });
      }

      const entries = fs.readdirSync(downloadsDir, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        if (entry.isFile()) {
          try {
            const fullPath = path.join(downloadsDir, entry.name);
            const stat = fs.statSync(fullPath);
            files.push({
              name: entry.name,
              sizeBytes: stat.size,
              sizeMb: (stat.size / (1024 * 1024)).toFixed(2),
              mtime: stat.mtimeMs,
              ext: path.extname(entry.name).toLowerCase()
            });
          } catch {}
        }
      }

      files.sort((a, b) => b.mtime - a.mtime);
      resolve({ ok: true, files: files.slice(0, 20) });
    } catch (err) {
      resolve({ ok: false, files: [], error: err.message });
    }
  });
}

// 14. Get PC File (Download from PC to Phone)
function getPcFile(name) {
  return new Promise((resolve) => {
    try {
      const cleanName = path.basename(name);
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      const targetPath = path.join(downloadsDir, cleanName);

      if (!fs.existsSync(targetPath)) {
        return resolve({ ok: false, error: 'File not found on PC' });
      }

      const stat = fs.statSync(targetPath);
      if (stat.size > 30 * 1024 * 1024) {
        return resolve({ ok: false, error: 'File too large (> 30MB) for direct transfer' });
      }

      const buffer = fs.readFileSync(targetPath);
      resolve({
        ok: true,
        fileName: cleanName,
        size: buffer.length,
        fileBase64: buffer.toString('base64')
      });
    } catch (err) {
      resolve({ ok: false, error: err.message });
    }
  });
}

// 15. Sentry Guard & Stealth Cam Functions
let sentryProcess = null;
let sentryAlertCallback = null;

function setSentryAlertCallback(cb) {
  sentryAlertCallback = cb;
}

function getStealthCamPeek() {
  return new Promise((resolve) => {
    const pythonExe = 'C:\\Python313\\python.exe';
    const scriptPath = path.join(__dirname, 'sentry_guard.py');
    const cp = spawn(pythonExe, [scriptPath, 'peek'], { windowsHide: true });
    let stdout = '';
    cp.stdout.on('data', d => { stdout += d; });
    cp.on('close', () => {
      try {
        const res = JSON.parse(stdout);
        resolve(res);
      } catch (err) {
        resolve({ ok: false, error: 'Webcam capture failed' });
      }
    });
    cp.on('error', err => resolve({ ok: false, error: err.message }));
  });
}

function startSentryGuard(threshold = 100) {
  if (sentryProcess) {
    return { ok: true, armed: true, message: 'Sentry Guard already active' };
  }
  const pythonExe = 'C:\\Python313\\python.exe';
  const scriptPath = path.join(__dirname, 'sentry_guard.py');
  sentryProcess = spawn(pythonExe, [scriptPath, 'guard', String(threshold)], { windowsHide: true });
  
  let lineBuffer = '';
  sentryProcess.stdout.on('data', chunk => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line.trim());
        if (msg.event === 'trespassing_detected') {
          console.log('[SentryGuard] 🚨 Trespassing detected! Auto-locking PC...');
          lockScreen();
          if (sentryAlertCallback) {
            sentryAlertCallback(msg);
          }
        }
      } catch {}
    }
  });

  sentryProcess.on('close', () => {
    sentryProcess = null;
  });

  return { ok: true, armed: true, message: 'Sentry Guard armed & monitoring' };
}

function stopSentryGuard() {
  if (sentryProcess) {
    try { sentryProcess.kill(); } catch {}
    sentryProcess = null;
  }
  return { ok: true, armed: false, message: 'Sentry Guard disarmed' };
}

function isSentryArmed() {
  return Boolean(sentryProcess);
}

module.exports = {
  lockScreen,
  listRunningApps,
  closeApp,
  getSystemStats,
  takeScreenshot,
  getClipboard,
  setClipboard,
  pasteClipboard,
  sleepDisplay,
  wakeDisplay,
  toggleMute,
  adjustVolume,
  setVolume,
  unlockWorkstation,
  saveFile,
  listPcFiles,
  getPcFile,
  setSentryAlertCallback,
  getStealthCamPeek,
  startSentryGuard,
  stopSentryGuard,
  isSentryArmed
};

// Self-test when run directly
if (require.main === module) {
  (async () => {
    console.log('--- Testing System Stats ---');
    const stats = await getSystemStats();
    console.log(JSON.stringify(stats, null, 2));

    console.log('\n--- Testing Active Running Applications ---');
    const apps = await listRunningApps();
    console.log(`Found ${apps.apps.length} active apps with visible windows:`);
    apps.apps.forEach(a => console.log(`  [PID ${a.pid}] ${a.name} (RAM: ${a.memoryMb}MB) -> "${a.title}"`));
  })();
}

