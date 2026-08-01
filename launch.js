#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname);
const SERVER_ENTRY = path.join(ROOT, 'dist', 'server', 'server', 'index.js');
const RENDERER_HTML = path.join(ROOT, 'dist', 'renderer', 'index.html');

function log(label, msg) {
  const colors = {
    BUILD: '\x1b[36m',
    START: '\x1b[32m',
    INFO:  '\x1b[34m',
    ERROR: '\x1b[31m',
    RESET: '\x1b[0m',
  };
  const c = colors[label] || '';
  console.log(`  ${c}[${label}]${colors.RESET} ${msg}`);
}

function runBuild(cmd, label) {
  log('BUILD', `${label}... (first time only)`);
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    log('ERROR', `${label} failed!`);
    process.exit(1);
  }
}

console.log('');
console.log('  ==========================================');
console.log('   LightningShare - LAN File Transfer');
console.log('  ==========================================');
console.log('');

if (!fs.existsSync(SERVER_ENTRY)) {
  runBuild('npm run build:server', 'Building server');
}
if (!fs.existsSync(RENDERER_HTML)) {
  runBuild('npm run build:vite', 'Building UI');
}

log('START', 'Server starting on port 51236...');
log('INFO', 'Browser will open automatically.');

const interfaces = os.networkInterfaces();
const addresses = [];
for (const name of Object.keys(interfaces)) {
  const netInterface = interfaces[name];
  if (!netInterface) continue;
  for (const info of netInterface) {
    if (info.family === 'IPv4' && !info.internal) {
      addresses.push(info.address);
    }
  }
}

console.log('');
console.log('  Share this URL with other devices on your LAN:');
console.log('');
addresses.forEach((addr) => {
  console.log(`    http://${addr}:51236`);
});
console.log('');
console.log('  Press Ctrl+C to stop the server.');
console.log('  ------------------------------------------');
console.log('');

const env = { ...process.env, NODE_ENV: 'production' };
const child = spawn('node', [SERVER_ENTRY], {
  cwd: ROOT,
  env,
  stdio: 'inherit',
});

child.on('exit', (code) => {
  if (code !== 0) {
    console.log('');
    log('ERROR', `Server exited with code ${code}`);
  }
  process.exit(code);
});

process.on('SIGINT', () => {
  child.kill('SIGINT');
  process.exit(0);
});