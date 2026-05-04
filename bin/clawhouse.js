#!/usr/bin/env node
// npx entrypoint — forwards CLI flags into env vars so `npx clawhouse`
// launches the same server.js the repo's `node server.js` does.
//
//   --demo          force demo mode (no ~/.openclaw needed)
//   --port <n>      listen port (overrides PIXEL_OFFICE_PORT)
//   --host <addr>   bind address (overrides PIXEL_OFFICE_HOST)
//   --state-dir <d> path to OpenClaw state (overrides OPENCLAW_STATE_DIR)
//
// Anything else is passed straight through; defaults live in server.js.

const path = require('path');

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const flag = argv[i];
  const next = argv[i + 1];
  if (flag === '--demo')                      process.env.PIXEL_OFFICE_DEMO = '1';
  else if (flag === '--port'      && next)  { process.env.PIXEL_OFFICE_PORT = next; i++; }
  else if (flag === '--host'      && next)  { process.env.PIXEL_OFFICE_HOST = next; i++; }
  else if (flag === '--state-dir' && next)  { process.env.OPENCLAW_STATE_DIR = next; i++; }
  else if (flag === '--openclaw'  && next)  { process.env.OPENCLAW_URL = next; i++; }
  else if (flag === '--help' || flag === '-h') {
    console.log('Usage: clawhouse [--demo] [--port N] [--host ADDR] [--state-dir PATH] [--openclaw URL]');
    process.exit(0);
  }
}

require(path.join(__dirname, '..', 'server.js'));
