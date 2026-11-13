/**
 * Bridge Cloud Relay Server
 * 
 * Handles:
 * - Device connection via WebSocket (/v1/connect)
 * - Message routing between Laptop and Phone
 * - Pairing ticket management (/v1/tickets, /v1/tickets/redeem)
 * - Device presence tracking
 */

const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const crypto = require('crypto');

const PORT = process.env.PORT || 8765;

// In-memory state (lightweight, zero DB dependency needed for single owner)
const devices = new Map(); // deviceId -> { ws, lastSeen, role, pushToken }
const pairingTickets = new Map(); // ticketId -> { desktopId, psk, expiresAt, used }
const messageQueues = new Map(); // deviceId -> [ { msg_id, envelope, expiresAt } ]

// HTTP Server
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('Content-Type', 'application/json');

  // CORS for dev convenience
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // 1. Root Landing Page (HTML Status Dashboard)
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
    const connected = [];
    devices.forEach((info, id) => {
      if (info.ws && info.ws.readyState === WebSocket.OPEN) {
        connected.push({ deviceId: id, role: info.role, lastSeen: info.lastSeen });
      }
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bridge Cloud Relay</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .card { background: #1e293b; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 10px 25px rgba(0,0,0,0.5); border: 1px solid #334155; }
    .badge { display: inline-flex; align-items: center; gap: 8px; background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 6px 14px; border-radius: 999px; font-weight: 600; font-size: 13px; margin-bottom: 20px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 10px #22c55e; }
    h1 { margin: 0 0 8px 0; font-size: 24px; color: #fff; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0; }
    .info-box { background: #0f172a; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; font-family: monospace; font-size: 13px; color: #38bdf8; word-break: break-all; }
    .label { color: #64748b; font-size: 12px; text-transform: uppercase; font-weight: bold; margin-bottom: 6px; }
    .device-list { margin-top: 20px; border-top: 1px solid #334155; padding-top: 16px; }
    .device-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; font-size: 14px; border-bottom: 1px solid #33415522; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge"><div class="dot"></div> CLOUD RELAY ONLINE</div>
    <h1>Bridge Cloud Relay</h1>
    <p>Real-time bridge connecting Google Antigravity on your Laptop with your Mobile Device.</p>
    
    <div class="label">WebSocket Endpoint</div>
    <div class="info-box">wss://${req.headers.host || 'gintama-remote-desktop.onrender.com'}/v1/connect</div>

    <div class="label">Relay Health</div>
    <div class="info-box">HTTP 200 OK &bull; Uptime: ${Math.round(process.uptime())}s</div>

    <div class="device-list">
      <div class="label">Connected Devices (${connected.length})</div>
      ${connected.length === 0 
        ? '<div style="color: #64748b; font-size: 13px; margin-top: 8px;">No devices active yet. Start laptop agent or open Android app.</div>' 
        : connected.map(d => `<div class="device-item"><span>${d.role === 'desktop' ? '💻' : '📱'} <b>${d.deviceId}</b> (${d.role})</span><span style="color: #4ade80; font-weight: bold;">ONLINE</span></div>`).join('')
      }
    </div>
  </div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.writeHead(200);
    return res.end(html);
  }

  // 2. Health check
  if (req.method === 'GET' && url.pathname === '/healthz') {
    const connected = [];
    devices.forEach((info, id) => {
      if (info.ws && info.ws.readyState === WebSocket.OPEN) {
        connected.push({ deviceId: id, role: info.role, lastSeen: info.lastSeen });
      }
    });

    res.writeHead(200);
    return res.end(JSON.stringify({
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      connectedDevices: connected
    }));
  }

  // Helper to read JSON body
  function readJson(callback) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const json = body ? JSON.parse(body) : {};
        callback(null, json);
      } catch (err) {
        callback(err);
      }
    });
  }

  // 2. Desktop creates a pairing ticket
  if (req.method === 'POST' && url.pathname === '/v1/tickets') {
    readJson((err, data) => {
      if (err) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }

      const ticket = crypto.randomBytes(16).toString('hex');
      const psk = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

      pairingTickets.set(ticket, {
        desktopId: data.desktopId || 'dev_laptop_01',
        psk: psk,
        expiresAt: expiresAt,
        used: false
      });

      console.log(`[Relay] Created pairing ticket: ${ticket} for ${data.desktopId || 'dev_laptop_01'}`);

      res.writeHead(200);
      res.end(JSON.stringify({
        ticket,
        psk,
        expiresAt
      }));
    });
    return;
  }

  // 3. Phone redeems pairing ticket
  if (req.method === 'POST' && url.pathname === '/v1/tickets/redeem') {
    readJson((err, data) => {
      if (err || !data.ticket) {
        res.writeHead(400);
        return res.end(JSON.stringify({ error: 'Ticket required' }));
      }

      const record = pairingTickets.get(data.ticket);
      if (!record || record.used || Date.now() > record.expiresAt) {
        res.writeHead(403);
        return res.end(JSON.stringify({ error: 'Ticket expired or invalid' }));
      }

      record.used = true;
      console.log(`[Relay] Ticket redeemed by phone: ${data.phoneId || 'dev_phone_01'}`);

      res.writeHead(200);
      res.end(JSON.stringify({
        ok: true,
        desktopId: record.desktopId,
        psk: record.psk
      }));
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// WebSocket Server
const wss = new WebSocketServer({ server, path: '/v1/connect', maxPayload: 10 * 1024 * 1024 });

wss.on('connection', (ws, req) => {
  const host = req.headers && req.headers.host ? req.headers.host : 'localhost:8765';
  const url = new URL(req.url, `http://${host}`);
  const deviceId = url.searchParams.get('deviceId');
  const role = url.searchParams.get('role') || 'client';

  if (!deviceId) {
    ws.close(4001, 'deviceId required');
    return;
  }

  console.log(`[Relay] Device connected: ${deviceId} (${role})`);

  // Displace previous connection for this device if any
  const existing = devices.get(deviceId);
  if (existing && existing.ws && existing.ws.readyState === WebSocket.OPEN) {
    existing.ws.close(4002, 'Newer connection opened');
  }

  devices.set(deviceId, {
    ws,
    role,
    lastSeen: Date.now()
  });

  // Notify peer of presence if online
  broadcastPresence(deviceId, 'online');

  // Notify this newly connected device of currently connected peers
  devices.forEach((info, peerId) => {
    if (peerId !== deviceId && info.ws && info.ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        class: 'presence',
        device: peerId,
        status: 'online',
        timestamp: Date.now()
      }));
    }
  });

  // Deliver any queued messages for this device
  deliverQueue(deviceId, ws);

  ws.on('message', (data) => {
    try {
      const envelope = JSON.parse(data.toString());
      handleEnvelope(deviceId, envelope, ws);
    } catch (err) {
      console.error(`[Relay] Invalid envelope from ${deviceId}:`, err.message);
    }
  });

  ws.on('close', () => {
    console.log(`[Relay] Device disconnected: ${deviceId}`);
    const curr = devices.get(deviceId);
    if (curr && curr.ws === ws) {
      curr.ws = null;
      curr.lastSeen = Date.now();
      broadcastPresence(deviceId, 'offline');
    }
  });

  ws.on('error', (err) => {
    console.error(`[Relay] WebSocket error on ${deviceId}:`, err.message);
  });
});

function handleEnvelope(fromDeviceId, envelope, senderWs) {
  const targetId = envelope.to;
  if (!targetId) return;

  const recipient = devices.get(targetId);

  // If recipient is connected, route immediately
  if (recipient && recipient.ws && recipient.ws.readyState === WebSocket.OPEN) {
    recipient.ws.send(JSON.stringify(envelope));
    // Send ack back to sender
    senderWs.send(JSON.stringify({
      class: 'ack',
      msg_id: envelope.msg_id,
      delivered: true
    }));
  } else {
    // Recipient is offline: enqueue message
    if (!messageQueues.has(targetId)) {
      messageQueues.set(targetId, []);
    }
    const queue = messageQueues.get(targetId);
    queue.push({
      msg_id: envelope.msg_id,
      envelope,
      expiresAt: Date.now() + (envelope.ttl_s || 300) * 1000
    });

    console.log(`[Relay] Queued message ${envelope.msg_id} for offline device ${targetId} (queue size: ${queue.length})`);

    senderWs.send(JSON.stringify({
      class: 'ack',
      msg_id: envelope.msg_id,
      delivered: false,
      queued: true
    }));
  }
}

function deliverQueue(deviceId, ws) {
  const queue = messageQueues.get(deviceId);
  if (!queue || queue.length === 0) return;

  const now = Date.now();
  const validMessages = [];

  for (const item of queue) {
    if (item.expiresAt > now) {
      ws.send(JSON.stringify(item.envelope));
    }
  }
  // Clear delivered queue
  messageQueues.set(deviceId, []);
}

function broadcastPresence(deviceId, status) {
  // Send presence notice to other connected peers
  devices.forEach((info, peerId) => {
    if (peerId !== deviceId && info.ws && info.ws.readyState === WebSocket.OPEN) {
      info.ws.send(JSON.stringify({
        class: 'presence',
        device: deviceId,
        status: status,
        timestamp: Date.now()
      }));
    }
  });
}

// Start Listening
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(` Bridge Cloud Relay listening on port ${PORT} `);
  console.log(` WebSocket: ws://0.0.0.0:${PORT}/v1/connect     `);
  console.log(` Health:    http://0.0.0.0:${PORT}/healthz      `);
  console.log(`===============================================`);
});

