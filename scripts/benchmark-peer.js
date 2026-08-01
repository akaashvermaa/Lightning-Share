const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function requestJson(baseUrl, route, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(route, baseUrl);
    const request = http.request(target, {
      method: options.method || 'GET',
      headers: options.headers || {},
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

function uploadFile(baseUrl, filePath, fileSize) {
  return new Promise((resolve, reject) => {
    const target = new URL('/api/upload', baseUrl);
    const request = http.request(target, {
      method: 'POST',
      headers: {
        'Content-Length': fileSize,
        'X-File-Name': path.basename(filePath),
        'X-File-Size': String(fileSize),
        'X-File-Id': crypto.randomUUID(),
        'X-Mime-Type': 'application/octet-stream',
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Upload failed with HTTP ${response.statusCode}: ${body}`));
          return;
        }
        resolve(JSON.parse(body));
      });
    });
    request.on('error', reject);
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.pipe(request);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.url || 'http://127.0.0.1:51236';
  const filePath = args.file && path.resolve(args.file);
  const deviceId = args.device;

  if (!filePath || !deviceId || !fs.existsSync(filePath)) {
    console.error('Usage: npm run benchmark -- --device DEVICE_ID --file PATH [--url http://127.0.0.1:51236]');
    process.exitCode = 1;
    return;
  }

  const fileSize = fs.statSync(filePath).size;
  console.log(`Uploading ${path.basename(filePath)} (${fileSize} bytes)...`);
  const file = await uploadFile(baseUrl, filePath, fileSize);
  const startedAt = Date.now();
  const result = await requestJson(baseUrl, '/api/transfer/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId, files: [file] }),
  });

  console.log(`Transfer ${result.sessionId} started. Waiting for completion...`);
  while (true) {
    await sleep(1000);
    const session = await requestJson(baseUrl, `/api/transfer/sessions/${result.sessionId}`);
    if (session.status === 'completed') {
      const seconds = Math.max((Date.now() - startedAt) / 1000, 0.001);
      const megabytesPerSecond = fileSize / seconds / 1024 / 1024;
      console.log(`Completed in ${seconds.toFixed(2)}s at ${megabytesPerSecond.toFixed(2)} MB/s`);
      return;
    }
    if (session.status === 'failed' || session.status === 'cancelled' || session.status === 'declined') {
      throw new Error(`Transfer ${session.status}: ${session.error || 'no error provided'}`);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
