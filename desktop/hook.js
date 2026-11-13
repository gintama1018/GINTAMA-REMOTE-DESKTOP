#!/usr/bin/env node
/**
 * Bridge Antigravity PreToolUse Hook Client
 * 
 * Ultra-fast client called by Antigravity on tool execution.
 * Reads stdin -> forwards to Desktop Agent via local IPC -> prints decision to stdout.
 * Guarantees safe fail-safe defer (pass-through allow) on any error.
 */

const http = require('http');
const fs = require('fs');

function main() {
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch (err) {
    // Stdin error: pass-through
    process.stdout.write(JSON.stringify({ decision: 'allow' }));
    process.exit(0);
  }

  // Fallback timer: hook must answer before Antigravity host timeout
  const deadlineTimeout = setTimeout(() => {
    process.stdout.write(JSON.stringify({ decision: 'allow', reason: 'Hook client deadline reached' }));
    process.exit(0);
  }, 125000); // 125s

  // Send to Desktop Agent local IPC
  const req = http.request({
    hostname: '127.0.0.1',
    port: 49152,
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
        process.stdout.write(JSON.stringify(json));
      } catch (err) {
        process.stdout.write(JSON.stringify({ decision: 'allow' }));
      }
      process.exit(0);
    });
  });

  req.on('error', (err) => {
    clearTimeout(deadlineTimeout);
    // Desktop Agent not running: safe pass-through to local Antigravity prompt
    process.stdout.write(JSON.stringify({ decision: 'allow', reason: 'Desktop agent not active' }));
    process.exit(0);
  });

  req.write(stdinData);
  req.end();
}

main();

