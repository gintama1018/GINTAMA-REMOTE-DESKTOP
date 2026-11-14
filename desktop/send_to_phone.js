/**
 * Send File to POCO M6 Pro 5G CLI / Shell Helper
 * 
 * Invoked by:
 * - Windows Explorer Context Menu: "Send to POCO M6 Pro 5G"
 * - Windows SendTo Shortcut
 * - Command line: node desktop/send_to_phone.js "path/to/file"
 */

const http = require('http');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node send_to_phone.js <file-path>');
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);

if (!fs.existsSync(resolvedPath)) {
  console.error('File not found: ' + resolvedPath);
  showToast('Error', 'File not found: ' + path.basename(resolvedPath));
  process.exit(1);
}

const fileName = path.basename(resolvedPath);
const stat = fs.statSync(resolvedPath);
const sizeMb = (stat.size / (1024 * 1024)).toFixed(2);

console.log(`[SendToPhone] 🚀 Sending "${fileName}" (${sizeMb} MB) to POCO M6 Pro 5G...`);

const reqBody = JSON.stringify({ filePath: resolvedPath });

const req = http.request({
  hostname: '127.0.0.1',
  port: 48484,
  path: '/send-file',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(reqBody)
  },
  timeout: 60000
}, (res) => {
  let responseBody = '';
  res.on('data', chunk => { responseBody += chunk; });
  res.on('end', () => {
    try {
      const data = JSON.parse(responseBody);
      if (res.statusCode === 200 && data.ok) {
        console.log(`[SendToPhone] ✅ Successfully sent "${fileName}" to POCO M6 Pro 5G!`);
        showToast('Bridge Remote ⚡', `Sent ${fileName} (${sizeMb} MB) to POCO M6 Pro 5G!`);
      } else {
        console.error(`[SendToPhone] ❌ Failed: ${data.error || 'Unknown error'}`);
        showToast('Bridge Remote Transfer Failed', data.error || 'Transfer failed');
      }
    } catch (e) {
      console.error(`[SendToPhone] ❌ Invalid response from Agent`);
      showToast('Bridge Remote Error', 'Failed to communicate with Desktop Agent');
    }
  });
});

req.on('error', (err) => {
  console.error(`[SendToPhone] ❌ Desktop Agent is not running. Please start Bridge Remote first.`);
  showToast('Bridge Remote Offline', 'Desktop Agent is not running. Start start_bridge.bat first.');
});

req.write(reqBody);
req.end();

function showToast(title, message) {
  const safeTitle = title.replace(/"/g, '`"');
  const safeMsg = message.replace(/"/g, '`"');
  const psCmd = `powershell -NoProfile -Command "[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null; [reflection.assembly]::loadwithpartialname('System.Drawing') | Out-Null; $n = new-object system.windows.forms.notifyicon; $n.icon = [system.drawing.systemicons]::Information; $n.visible = $true; $n.showballoontip(4000, '${safeTitle}', '${safeMsg}', [system.windows.forms.tooltipicon]::Info); Start-Sleep -Milliseconds 4500; $n.dispose()"`;
  exec(psCmd, () => {});
}
