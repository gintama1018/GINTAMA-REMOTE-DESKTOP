/**
 * Simulated Phone Client for Testing
 * Connects to Relay as dev_phone_01, displays incoming requests, and allows actions.
 */

const { WebSocket } = require('../relay/node_modules/ws');

const RELAY_URL = process.env.BRIDGE_RELAY_URL || 'ws://127.0.0.1:8765/v1/connect?deviceId=dev_phone_01&role=phone';

console.log(`[Phone Sim] Connecting to Relay: ${RELAY_URL}...`);
const ws = new WebSocket(RELAY_URL);

ws.on('open', () => {
  console.log(`[Phone Sim] 📱 Connected to Relay as dev_phone_01!`);
  console.log(`[Phone Sim] Ready to receive Antigravity approvals & dispatch remote actions.\n`);

  // Run test action 1: Request system stats
  setTimeout(() => {
    console.log(`[Phone Sim] ➡️ Requesting System Stats from Laptop...`);
    sendAction('system_stats');
  }, 1000);

  // Run test action 2: Request running apps
  setTimeout(() => {
    console.log(`[Phone Sim] ➡️ Requesting Running Apps List from Laptop...`);
    sendAction('list_apps');
  }, 2000);
});

ws.on('message', (data) => {
  try {
    const envelope = JSON.parse(data.toString());
    const payload = envelope.payload;

    if (!payload) {
      if (envelope.class === 'presence') {
        console.log(`[Phone Sim] 📡 Presence update: Device ${envelope.device} is ${envelope.status}`);
      }
      return;
    }

    // 1. Received Approval Request from Antigravity!
    if (payload.t === 'approval.request') {
      const body = payload.body;
      console.log(`\n======================================================`);
      console.log(`[Phone Sim] 🔔 POP-UP NOTIFICATION: Permission Required!`);
      console.log(`[Phone Sim] Request ID:  ${payload.rid}`);
      console.log(`[Phone Sim] Tool Name:   ${body.tool}`);
      console.log(`[Phone Sim] Command:     ${body.command}`);
      console.log(`[Phone Sim] Working Dir: ${body.cwd}`);
      console.log(`======================================================`);

      // Auto-approve after 2 seconds to simulate user tapping Allow on phone
      setTimeout(() => {
        console.log(`[Phone Sim] 👆 User tapped [ALLOW] (Biometric Signed) for ${payload.rid}!`);
        ws.send(JSON.stringify({
          v: 1,
          msg_id: 'dec_' + Date.now(),
          from: 'dev_phone_01',
          to: 'dev_laptop_01',
          seq: 1,
          class: 'interactive',
          payload: {
            t: 'approval.decision',
            rid: payload.rid,
            body: {
              decision: 'allow',
              sig: 'mock_ecdsa_signature'
            }
          }
        }));
      }, 2000);
    }

    // 2. Received Action Result
    if (payload.t === 'action.result') {
      console.log(`\n[Phone Sim] 📥 Action Result for ${payload.rid}:`, JSON.stringify(payload.body, null, 2));
    }
  } catch (err) {
    console.error(`[Phone Sim] Parse error:`, err.message);
  }
});

function sendAction(actionName, args = {}) {
  const rid = 'act_' + Date.now();
  ws.send(JSON.stringify({
    v: 1,
    msg_id: 'msg_' + Date.now(),
    from: 'dev_phone_01',
    to: 'dev_laptop_01',
    seq: 1,
    class: 'interactive',
    payload: {
      t: 'action.request',
      rid: rid,
      body: {
        action: actionName,
        args: args
      }
    }
  }));
}

ws.on('close', () => {
  console.log(`[Phone Sim] Disconnected.`);
});
