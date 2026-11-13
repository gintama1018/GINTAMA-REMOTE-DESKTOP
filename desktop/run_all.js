/**
 * Bridge Launcher: Starts both Cloud Relay and Desktop Agent in one process.
 */

const path = require('path');

console.log('========================================================');
console.log('   BRIDGE - Remote Antigravity & Laptop Companion       ');
console.log('========================================================\n');

// 1. Start Relay Server
console.log('[1/2] Starting Cloud Relay Server...');
require('../relay/server.js');

// 2. Start Desktop Agent after relay is listening
setTimeout(() => {
  console.log('\n[2/2] Starting Desktop Agent...');
  require('./agent.js');

  console.log('\n========================================================');
  console.log('  🟢 BRIDGE IS ACTIVE & RUNNING!                         ');
  console.log('  - Local IPC: 127.0.0.1:49152 (For Antigravity)         ');
  console.log('  - Relay URL: ws://192.168.1.13:8765/v1/connect        ');
  console.log('                                                        ');
  console.log('  Install BridgeRemote.apk on your Android phone.       ');
  console.log('  In App Settings, set: 192.168.1.13:8765               ');
  console.log('========================================================\n');
  console.log('Listening for mobile connection and agent requests...\n');
}, 1000);

