const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'probe.log');
const CONFIG_FILE = path.join(__dirname, 'probe_config.json');

function main() {
  let stdinData = '';
  try {
    stdinData = fs.readFileSync(0, 'utf8');
  } catch (err) {
    stdinData = `[ERROR reading stdin: ${err.message}]`;
  }

  // Load configuration (default to auto_approve if missing)
  let config = {
    decision: 'auto_approve',
    reason: 'Spike S-01 probe approval',
    delay_ms: 0
  };

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...config, ...parsed };
    } catch (err) {
      // Keep defaults
    }
  }

  // Log incoming request
  const timestamp = new Date().toISOString();
  const logEntry = `\n--- [${timestamp}] INCOMING HOOK EVENT ---\n` +
    `CONFIG: ${JSON.stringify(config)}\n` +
    `STDIN: ${stdinData}\n`;

  try {
    fs.appendFileSync(LOG_FILE, logEntry, 'utf8');
  } catch (err) {
    // ignore
  }

  // Handle delay if configured
  if (config.delay_ms && config.delay_ms > 0) {
    const start = Date.now();
    while (Date.now() - start < config.delay_ms) {
      // synchronous busy wait for testing
    }
  }

  // Build response
  const response = {
    decision: config.decision
  };
  if (config.reason) {
    response.reason = config.reason;
  }

  const output = JSON.stringify(response);

  // Log outgoing response
  try {
    fs.appendFileSync(LOG_FILE, `STDOUT: ${output}\n-----------------------------------\n`, 'utf8');
  } catch (err) {
    // ignore
  }

  process.stdout.write(output);
  process.exit(0);
}

main();

