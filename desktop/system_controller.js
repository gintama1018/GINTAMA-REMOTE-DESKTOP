const { exec, execSync } = require('child_process');
const os = require('os');

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

// 5. Remote Screen Snapshot
function takeScreenshot() {
  return new Promise((resolve, reject) => {
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;
      $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;
      $graphics = [System.Drawing.Graphics]::FromImage($bmp);
      $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);
      
      $scale = [Math]::Min(1.0, 1280.0 / $bounds.Width);
      $newW = [int]($bounds.Width * $scale);
      $newH = [int]($bounds.Height * $scale);
      $resized = New-Object System.Drawing.Bitmap $newW, $newH;
      $rg = [System.Drawing.Graphics]::FromImage($resized);
      $rg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::Bilinear;
      $rg.DrawImage($bmp, 0, 0, $newW, $newH);

      $ms = New-Object System.IO.MemoryStream;
      $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg);
      $b64 = [Convert]::ToBase64String($ms.ToArray());
      
      $rg.Dispose();
      $resized.Dispose();
      $graphics.Dispose();
      $bmp.Dispose();
      $ms.Dispose();
      Write-Output $b64;
    `;

    exec(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, ' ')}"`, { maxBuffer: 15 * 1024 * 1024 }, (error, stdout) => {
      if (error) {
        return reject({ ok: false, error: error.message });
      }
      const b64 = stdout.trim();
      resolve({ ok: true, imageBase64: b64, timestamp: Date.now() });
    });
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
  return new Promise((resolve, reject) => {
    const psCmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("{ESC}")`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, (error) => {
      if (error) {
        return reject({ ok: false, error: error.message });
      }
      resolve({ ok: true, message: 'Display woken' });
    });
  });
}

// 8. Toggle Audio Mute
function toggleMute() {
  return new Promise((resolve, reject) => {
    const psCmd = `$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys([char]173)`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, (error) => {
      if (error) {
        return reject({ ok: false, error: error.message });
      }
      resolve({ ok: true, message: 'Mute toggled' });
    });
  });
}

// 9. Adjust Audio Volume Up/Down
function adjustVolume(isUp) {
  return new Promise((resolve, reject) => {
    const code = isUp ? 175 : 174;
    const psCmd = `$wsh = New-Object -ComObject WScript.Shell; $wsh.SendKeys([char]${code})`;
    exec(`powershell -NoProfile -Command "${psCmd}"`, (error) => {
      if (error) {
        return reject({ ok: false, error: error.message });
      }
      resolve({ ok: true, message: `Volume ${isUp ? 'increased' : 'decreased'}` });
    });
  });
}

// 10. Set Volume (~0-100%)
function setVolume(percent) {
  return new Promise((resolve, reject) => {
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const steps = Math.round(pct / 2);
    const psCmd = `
      $wsh = New-Object -ComObject WScript.Shell;
      1..50 | ForEach-Object { $wsh.SendKeys([char]174) };
      1..${steps} | ForEach-Object { $wsh.SendKeys([char]175) };
    `;
    exec(`powershell -NoProfile -Command "${psCmd.replace(/\r?\n/g, ' ')}"`, (error) => {
      if (error) {
        return reject({ ok: false, error: error.message });
      }
      resolve({ ok: true, message: `Volume adjusted to ~${pct}%` });
    });
  });
}

module.exports = {
  lockScreen,
  listRunningApps,
  closeApp,
  getSystemStats,
  takeScreenshot,
  sleepDisplay,
  wakeDisplay,
  toggleMute,
  adjustVolume,
  setVolume
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

