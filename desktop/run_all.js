/**
 * Bridge Launcher: Starts Cloud Relay (if local) and Desktop Agent.
 */

const fs = require('fs');
const path = require('path');

console.log('========================================================');
console.log('   BRIDGE - Remote Antigravity & Laptop Companion       ');
console.log('========================================================\n');

let fileConfig = {};
try {
  const cfgPath = path.join(__dirname, '..', 'bridge.config.json');
  if (fs.existsSync(cfgPath)) {
    fileConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
} catch (e) {}

const relayUrl = (process.env.BRIDGE_RELAY_URL || fileConfig.relayUrl || 'ws://127.0.0.1:8765/v1/connect').trim();
const isLocal = relayUrl.includes('127.0.0.1') || relayUrl.includes('localhost');

if (isLocal) {
  console.log('[1/2] Starting Local Cloud Relay Server...');
  require('../relay/server.js');
} else {
  console.log(`[Cloud] Connected to Cloud Relay: ${relayUrl}`);
}

setTimeout(() => {
  console.log('\n[2/2] Starting Desktop Agent...');
  require('./agent.js');

  console.log('\n========================================================');
  console.log('  🟢 BRIDGE IS ACTIVE & RUNNING!                         ');
  console.log('  - Local IPC: 127.0.0.1:48484 (For Antigravity)         ');
  console.log(`  - Relay URL: ${relayUrl}                              `);
  console.log('                                                        ');
  console.log('  Open Bridge Remote on your Android phone.             ');
  console.log('  In Settings tab, verify Relay Host is set.            ');
  console.log('========================================================\n');
  console.log('Listening for mobile connection and agent requests...\n');
}, isLocal ? 1000 : 200);

