#!/usr/bin/env node
/**
 * Bridge Antigravity PreToolUse Hook Client
 * 
 * Ultra-fast client called by Antigravity on tool execution.
 * Reads stdin -> forwards to Desktop Agent via local IPC -> prints decision to stdout.
 * Guarantees safe fail-safe defer (pass-through to local prompt: "ask") on any error.
 */

const http = require('http');
const fs = require('fs');

function main() {
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch (err) {
    process.stdout.write(JSON.stringify({ decision: 'ask', reason: 'Hook stdin error' }));
    process.exit(0);
  }

  // Fallback timer: hook must answer before Antigravity host timeout
  const deadlineTimeout = setTimeout(() => {
    process.stdout.write(JSON.stringify({ decision: 'ask', reason: 'Hook client deadline reached' }));
    process.exit(0);
  }, 125000);

  // Send to Desktop Agent local IPC
  const req = http.request({
    hostname: '127.0.0.1',
    port: 48484,
    path: '/hook',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(stdinData)
    },
    timeout: 122000
  }, (res) => {
    let responseBody = '';
    res.on('data', chunk => { responseBody += chunk; });
    res.on('end', () => {
      clearTimeout(deadlineTimeout);
      try {
        const json = JSON.parse(responseBody);
        if (json.decision === 'allow' || json.decision === 'auto_approve') {
          process.stdout.write(JSON.stringify({ decision: 'allow', reason: json.reason || 'Approved' }));
        } else if (json.decision === 'deny') {
          process.stdout.write(JSON.stringify({ decision: 'deny', reason: json.reason || 'Denied' }));
        } else {
          // Defer to normal user prompt on laptop screen
          process.stdout.write(JSON.stringify({ decision: 'ask', reason: 'Prompting on laptop' }));
        }
      } catch (err) {
        process.stdout.write(JSON.stringify({ decision: 'ask', reason: 'Response parse error' }));
      }
      process.exit(0);
    });
  });

  req.on('error', (err) => {
    clearTimeout(deadlineTimeout);
    // Desktop Agent not running: immediately prompt user on laptop screen
    process.stdout.write(JSON.stringify({ decision: 'ask', reason: 'Desktop agent not active' }));
    process.exit(0);
  });

  req.write(stdinData);
  req.end();
}

main();

