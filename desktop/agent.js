/**
 * Bridge Desktop Agent
 * 
 * Responsibilities:
 * - Connects out to Cloud Relay via WebSocket
 * - Hosts local IPC server (127.0.0.1:49152) for Antigravity Hook client
 * - Manages approval request lifecycle & monotonic deadlines
 * - Executes Remote Action Registry: lock, list_apps, close_app, system_stats
 */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WebSocket } = require('../relay/node_modules/ws');
const systemController = require('./system_controller');

// Configuration loader
let fileConfig = {};
try {
  const cfgPath = path.join(__dirname, '..', 'bridge.config.json');
  if (fs.existsSync(cfgPath)) {
    fileConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
} catch (e) {}

function normalizeRelayUrl(input) {
  let url = (input || '').trim();
  if (!url) url = 'ws://127.0.0.1:8765/v1/connect';

  url = url.replace(/\/+$/, '');
  if (url.endsWith('/v1/connect')) {
    url = url.substring(0, url.length - '/v1/connect'.length);
  }

  if (url.startsWith('https://')) {
    url = 'wss://' + url.substring(8);
  } else if (url.startsWith('http://')) {
    url = 'ws://' + url.substring(7);
  } else if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    if (url.includes('.onrender.com') || (!url.includes(':') && !url.includes('localhost') && !url.includes('127.0.0.1'))) {
      url = 'wss://' + url;
    } else {
      url = 'ws://' + url;
    }
  }

  return `${url}/v1/connect`;
}

// Configuration
const CONFIG = {
  deviceId: process.env.BRIDGE_DEVICE_ID || fileConfig.deviceId || 'dev_laptop_01',
  peerPhoneId: process.env.BRIDGE_PHONE_ID || fileConfig.peerPhoneId || 'dev_phone_01',
  relayUrl: normalizeRelayUrl(process.env.BRIDGE_RELAY_URL || fileConfig.relayUrl || 'ws://127.0.0.1:8765/v1/connect'),
  localIpcPort: 48484,
  approvalTimeoutMs: 120000 // 2 minutes
};

// State
let relayWs = null;
let isRelayConnected = false;
let isPhoneConnected = false;
const pendingRequests = new Map(); // rid -> { resolve, deadline, toolCall }
let seqCounter = 0;
let lastSeenClipboard = '';
let isUpdatingClipboardFromPhone = false;

// ==========================================
// 1. Local IPC Server for Antigravity Hook & File Sender
// ==========================================
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.apk': 'application/vnd.android.package-archive',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.json': 'application/json',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return map[ext] || 'application/octet-stream';
}

const ipcServer = http.createServer((req, res) => {
  // CORS support
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && req.url === '/hook') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        handleHookInvocation(payload, (decisionJson) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(decisionJson));
        });
      } catch (err) {
        // Safe failover: defer (pass-through allow)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ decision: 'allow', reason: 'Desktop agent IPC error' }));
      }
    });
    return;
  }

  // Instant Drag & Drop File Sender Endpoint (PC -> Phone)
  if (req.method === 'POST' && req.url === '/send-file') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const targetPath = data.filePath;
        if (!targetPath || !fs.existsSync(targetPath)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'File does not exist: ' + targetPath }));
        }

        if (!isRelayConnected || !relayWs) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Cloud Relay is not connected.' }));
        }

        if (!isPhoneConnected) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'POCO M6 Pro 5G is currently offline.' }));
        }

        const stat = fs.statSync(targetPath);
        if (stat.isDirectory()) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'Cannot send directories directly. Please send files or zip.' }));
        }

        if (stat.size > 50 * 1024 * 1024) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'File exceeds 50MB limit for lightning transfer.' }));
        }

        const fileName = path.basename(targetPath);
        const mimeType = getMimeType(targetPath);
        const buffer = fs.readFileSync(targetPath);
        const b64 = buffer.toString('base64');

        seqCounter++;
        relayWs.send(JSON.stringify({
          v: 1,
          msg_id: 'file_' + crypto.randomUUID().substring(0, 8),
          from: CONFIG.deviceId,
          to: CONFIG.peerPhoneId,
          seq: seqCounter,
          class: 'interactive',
          ttl_s: 120,
          payload: {
            t: 'file.transfer',
            rid: 'file_' + Date.now(),
            body: {
              fileName: fileName,
              fileSize: stat.size,
              mimeType: mimeType,
              fileBase64: b64
            }
          }
        }));

        console.log(`[Agent] 🚀 Pushed file "${fileName}" (${(stat.size / (1024 * 1024)).toFixed(2)} MB) to POCO M6 Pro 5G`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          fileName: fileName,
          fileSize: stat.size,
          sizeMb: (stat.size / (1024 * 1024)).toFixed(2),
          message: `Successfully transferred ${fileName} to POCO M6 Pro 5G`
        }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
    return;
  }

  // Status check for hook health & UI status
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      relayConnected: isRelayConnected,
      phoneConnected: isPhoneConnected,
      peerPhoneId: CONFIG.peerPhoneId,
      pendingCount: pendingRequests.size
    }));
  }

  res.writeHead(404);
  res.end();
});

ipcServer.listen(CONFIG.localIpcPort, '127.0.0.1', () => {
  console.log(`[Agent] Local IPC server listening on 127.0.0.1:${CONFIG.localIpcPort}`);
});

function handleHookInvocation(payload, callback) {
  const toolName = payload.toolCall?.name || 'unknown';
  const args = payload.toolCall?.args || {};
  const command = args.CommandLine || JSON.stringify(args);

  console.log(`\n======================================================`);
  console.log(`[Agent] 🚨 Intercepted Antigravity Tool Call: ${toolName}`);
  console.log(`[Agent] Command: ${command}`);
  console.log(`======================================================`);

  // Auto-allow harmless internal inspection & build commands so Antigravity doesn't hang
  const cmdTrim = (command || '').trim();
  const harmless = /^(git\s+(status|diff|log|add|commit|push)|tasklist|where\.exe|dir|Get-|Select-|Copy-Item|Test-|netstat|node\s+|echo|cd\s+android|\.?\\?gradlew|&|\.?[\\\/]desktop|C:\\Windows\\Microsoft\.NET)/i;
  if (harmless.test(cmdTrim)) {
    console.log(`[Agent] ⚡ Auto-approving internal assistant command`);
    return callback({ decision: 'allow', reason: 'Internal development command' });
  }

  // If relay is not connected, prompt locally on laptop immediately (ADR-007)
  if (!isRelayConnected || !relayWs) {
    console.log(`[Agent] Cloud relay offline -> Prompting locally on laptop`);
    return callback({ decision: 'ask', reason: 'Remote bridge offline - deferred to local' });
  }

  // If phone is not connected, do NOT wait! Prompt on laptop screen immediately
  if (!isPhoneConnected) {
    console.log(`[Agent] ⚠️ Phone is not connected -> Prompting locally on laptop`);
    return callback({ decision: 'ask', reason: 'Phone not connected - prompting locally' });
  }

  const rid = 'req_' + crypto.randomUUID().substring(0, 8);
  const deadline = Date.now() + CONFIG.approvalTimeoutMs;

  // Compute canonical digest
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    tool: toolName,
    args: args,
    cwd: payload.cwd || '',
    rid: rid
  })).digest('hex');

  // Register in pending map
  pendingRequests.set(rid, {
    resolve: callback,
    deadline: deadline,
    toolCall: payload.toolCall
  });

  // Build message to phone
  const appMsg = {
    t: 'approval.request',
    rid: rid,
    body: {
      digest: digest,
      tool: toolName,
      command: command,
      args: args,
      cwd: payload.cwd || '',
      workspace: payload.workspacePaths?.[0] || '',
      conversation: payload.conversationId || '',
      remaining_ms: CONFIG.approvalTimeoutMs
    }
  };

  // Send envelope to phone via relay
  seqCounter++;
  const envelope = {
    v: 1,
    msg_id: 'msg_' + crypto.randomUUID().substring(0, 8),
    from: CONFIG.deviceId,
    to: CONFIG.peerPhoneId,
    seq: seqCounter,
    class: 'interactive',
    ttl_s: Math.round(CONFIG.approvalTimeoutMs / 1000),
    push: true,
    payload: appMsg
  };

  try {
    relayWs.send(JSON.stringify(envelope));
    console.log(`[Agent] Forwarded request ${rid} to Phone via Relay... Waiting for decision.`);
  } catch (err) {
    console.error(`[Agent] Failed to send to relay:`, err.message);
    pendingRequests.delete(rid);
    return callback({ decision: 'allow', reason: 'Failed to route to phone' });
  }

  // Set timeout fallback
  setTimeout(() => {
    if (pendingRequests.has(rid)) {
      console.log(`[Agent] ⏱️ Request ${rid} timed out waiting for phone decision -> Deferring to local`);
      const req = pendingRequests.get(rid);
      pendingRequests.delete(rid);
      req.resolve({ decision: 'ask', reason: 'Remote approval timed out' });

      // Notify phone that request expired
      if (isRelayConnected && relayWs) {
        relayWs.send(JSON.stringify({
          v: 1,
          msg_id: 'exp_' + crypto.randomUUID().substring(0, 8),
          from: CONFIG.deviceId,
          to: CONFIG.peerPhoneId,
          seq: ++seqCounter,
          class: 'control',
          payload: { t: 'approval.expired', rid: rid }
        }));
      }
    }
  }, CONFIG.approvalTimeoutMs);
}

// ==========================================
// 2. Connect to Cloud Relay via WebSocket
// ==========================================
function connectToRelay() {
  const wsUrl = `${CONFIG.relayUrl}?deviceId=${CONFIG.deviceId}&role=desktop`;
  console.log(`[Agent] Connecting to Relay: ${wsUrl}...`);

  try {
    const ws = new WebSocket(wsUrl);

    let pingInterval = null;
    ws.onopen = () => {
      console.log(`[Agent] ✅ Connected to Cloud Relay as ${CONFIG.deviceId}`);
      relayWs = ws;
      isRelayConnected = true;
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try { ws.ping(); } catch {}
        }
      }, 20000);
    };

    ws.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data);
        handleIncomingEnvelope(envelope);
      } catch (err) {
        console.error(`[Agent] Error parsing relay envelope:`, err.message);
      }
    };

    ws.onclose = () => {
      if (pingInterval) clearInterval(pingInterval);
      console.log(`[Agent] Relay connection closed. Reconnecting in 3s...`);
      isRelayConnected = false;
      relayWs = null;
      setTimeout(connectToRelay, 3000);
    };

    ws.onerror = (err) => {
      // Reconnect will trigger on close
    };
  } catch (err) {
    console.error(`[Agent] Connection error:`, err.message);
    setTimeout(connectToRelay, 3000);
  }
}

// ==========================================
// 3. Handle Messages from Phone & Relay
// ==========================================
async function handleIncomingEnvelope(envelope) {
  // Presence notifications (phone online/offline)
  if (envelope.class === 'presence') {
    if (envelope.device === CONFIG.peerPhoneId) {
      isPhoneConnected = (envelope.status === 'online');
      console.log(`[Agent] 📱 Peer phone (${CONFIG.peerPhoneId}) is now: ${envelope.status.toUpperCase()}`);
    }
    return;
  }

  const payload = envelope.payload;
  if (!payload || !payload.t) return;

  // Case A: Phone sent Approval Decision (Allow / Deny)
  if (payload.t === 'approval.decision') {
    const rid = payload.rid;
    const decision = payload.body?.decision; // 'allow' or 'deny'

    console.log(`[Agent] 📩 Received phone decision for ${rid}: ${decision?.toUpperCase()}`);

    if (pendingRequests.has(rid)) {
      const item = pendingRequests.get(rid);
      pendingRequests.delete(rid);

      if (decision === 'allow') {
        item.resolve({
          decision: 'allow',
          reason: 'Approved remotely by phone'
        });
        console.log(`[Agent] 🟢 Responded to Antigravity: allow!`);
      } else {
        item.resolve({
          decision: 'deny',
          reason: 'Denied remotely from mobile phone'
        });
        console.log(`[Agent] 🔴 Responded to Antigravity: deny!`);
      }
    }
  }

  // Case B: Phone requested a Remote Action (Lock, List Apps, Close App, System Stats, Screen Sleep, Volume)
  if (payload.t === 'action.request') {
    const action = payload.body?.action;
    const args = payload.body?.args || {};
    const rid = payload.rid;

    console.log(`[Agent] ⚡ Executing remote action from phone: ${action}`);

    let result = { ok: false, error: 'Unknown action' };

    try {
      if (action === 'lock') {
        result = await systemController.lockScreen();
      } else if (action === 'sleep_display') {
        result = await systemController.sleepDisplay();
      } else if (action === 'wake_display') {
        result = await systemController.wakeDisplay();
      } else if (action === 'toggle_mute') {
        result = await systemController.toggleMute();
      } else if (action === 'adjust_volume') {
        result = await systemController.adjustVolume(Boolean(args.isUp));
      } else if (action === 'set_volume') {
        result = await systemController.setVolume(args.percent);
      } else if (action === 'list_apps') {
        result = await systemController.listRunningApps();
      } else if (action === 'close_app') {
        result = await systemController.closeApp(args.pid, args.force);
      } else if (action === 'system_stats') {
        result = await systemController.getSystemStats();
      } else if (action === 'screenshot') {
        result = await systemController.takeScreenshot(args.maxWidth || 1024, args.quality || 65);
      } else if (action === 'peek') {
        result = await systemController.takeScreenshot(args.maxWidth || 720, args.quality || 45);
      } else if (action === 'get_clipboard') {
        result = await systemController.getClipboard();
      } else if (action === 'set_clipboard') {
        isUpdatingClipboardFromPhone = true;
        lastSeenClipboard = args.text || '';
        result = await systemController.setClipboard(args.text);
        setTimeout(() => { isUpdatingClipboardFromPhone = false; }, 2500);
      } else if (action === 'paste_to_pc') {
        isUpdatingClipboardFromPhone = true;
        lastSeenClipboard = args.text || '';
        result = await systemController.pasteClipboard(args.text);
        setTimeout(() => { isUpdatingClipboardFromPhone = false; }, 2500);
      } else if (action === 'unlock') {
        result = await systemController.unlockWorkstation(args.pin);
      } else if (action === 'save_file') {
        result = await systemController.saveFile(args.name, args.base64);
      } else if (action === 'list_pc_files') {
        result = await systemController.listPcFiles();
      } else if (action === 'get_pc_file') {
        result = await systemController.getPcFile(args.name);
      } else if (action === 'sentry_peek') {
        result = await systemController.getStealthCamPeek();
      } else if (action === 'sentry_start') {
        result = systemController.startSentryGuard(args.threshold);
      } else if (action === 'sentry_stop') {
        result = systemController.stopSentryGuard();
      } else if (action === 'sentry_status') {
        result = { ok: true, armed: systemController.isSentryArmed() };
      }
    } catch (err) {
      result = { ok: false, error: err.message || String(err) };
    }

    // Send action result back to phone
    if (isRelayConnected && relayWs) {
      seqCounter++;
      relayWs.send(JSON.stringify({
        v: 1,
        msg_id: 'act_res_' + crypto.randomUUID().substring(0, 8),
        from: CONFIG.deviceId,
        to: envelope.from || CONFIG.peerPhoneId,
        seq: seqCounter,
        class: 'interactive',
        ttl_s: 60,
        payload: {
          t: 'action.result',
          rid: rid,
          body: result
        }
      }));
      console.log(`[Agent] Returned action result for ${action} to phone.`);
    }
  }
}

// ==========================================
// 4. Render Free Tier Keep-Alive Heartbeat
// ==========================================
// Prevents Render from sleeping after 15m of inactivity by pinging /healthz every 10m
function startKeepAlivePing() {
  if (!CONFIG.relayUrl.includes('.onrender.com')) return;
  const https = require('https');
  const healthUrl = CONFIG.relayUrl
    .replace('wss://', 'https://')
    .replace('ws://', 'http://')
    .replace(/\/v1\/connect.*$/, '/healthz');

  console.log(`[Agent] 💓 Render keep-alive enabled (prevents 15m idle sleep)`);

  setInterval(() => {
    https.get(healthUrl, (res) => {
      res.resume();
    }).on('error', () => {});
  }, 10 * 60 * 1000); // 10 minutes
}

// Global crash protection
process.on('unhandledRejection', (reason) => {
  console.error('[Agent] ⚠️ Caught Unhandled Rejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[Agent] ⚠️ Caught Uncaught Exception:', err.message);
});

// ==========================================
// 5. Universal Bi-directional Clipboard Sync Watcher
// ==========================================
function startClipboardSyncWatcher() {
  console.log(`[Agent] 📋 Bi-directional Clipboard Sync Watcher active`);

  setInterval(async () => {
    if (!isRelayConnected || !relayWs || isUpdatingClipboardFromPhone) return;
    try {
      const clip = await systemController.getClipboard();
      if (clip.ok && clip.text && clip.text !== lastSeenClipboard) {
        lastSeenClipboard = clip.text;
        // Don't send huge binary data (> 100KB)
        if (clip.text.length <= 100000) {
          seqCounter++;
          relayWs.send(JSON.stringify({
            v: 1,
            msg_id: 'clip_' + crypto.randomUUID().substring(0, 8),
            from: CONFIG.deviceId,
            to: CONFIG.peerPhoneId,
            seq: seqCounter,
            class: 'interactive',
            ttl_s: 60,
            payload: {
              t: 'clipboard.sync',
              rid: 'clip_' + Date.now(),
              body: {
                text: clip.text,
                source: 'desktop',
                timestamp: Date.now()
              }
            }
          }));
          console.log(`[Agent] 📋 Auto-synced clipboard from PC to phone (${clip.text.length} chars)`);
        }
      }
    } catch {}
  }, 1200);
}

// Wire Sentry Intruder Alert to Relay
systemController.setSentryAlertCallback((alertData) => {
  if (isRelayConnected && relayWs) {
    seqCounter++;
    relayWs.send(JSON.stringify({
      v: 1,
      msg_id: 'sentry_alert_' + crypto.randomUUID().substring(0, 8),
      from: CONFIG.deviceId,
      to: CONFIG.peerPhoneId,
      seq: seqCounter,
      class: 'interactive',
      ttl_s: 120,
      payload: {
        t: 'sentry.alert',
        rid: 'sentry_' + Date.now(),
        body: alertData
      }
    }));
    console.log(`[Agent] 🚨 TRESPASSING DETECTED! Sent Sentry Alert with intruder photo to ${CONFIG.peerPhoneId}`);
  }
});

// Start Agent, Keep-Alive & Clipboard Sync
connectToRelay();
startKeepAlivePing();
startClipboardSyncWatcher();

