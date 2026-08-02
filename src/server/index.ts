import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import express, { Request, Response, NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { exec } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import log from '../shared/logger';
import { DiscoveryService } from '../services/discovery';
import { TransferService } from '../services/transfer';
import { FileService } from '../services/file';
import { BenchmarkService } from '../services/benchmark';
import { networkMonitor } from '../services/network';
import { uploadManager } from './upload';
import {
  Device,
  FileInfo,
  TransferSession,
  IncomingTransfer,
  AppSettings,
} from '../shared/types';
import { DEFAULT_APP_SETTINGS } from '../shared/constants';
import { certificateManager } from '../services/transfer/certificate';

const PORT = parseInt(process.env.PORT || '51236', 10);
const IS_DEV = process.env.NODE_ENV !== 'production';

let discoveryService: DiscoveryService;
let transferService: TransferService;
let fileService: FileService;
let benchmarkService: BenchmarkService;

let settings: AppSettings = { ...DEFAULT_APP_SETTINGS, deviceName: os.hostname() };

const pendingFileData = new Map<string, { resolve: (p: string) => void; reject: (e: Error) => void }>();

async function initializeServices(): Promise<void> {
  fileService = new FileService();
  benchmarkService = new BenchmarkService();
  transferService = new TransferService(fileService);
  transferService.setBandwidthLimit(settings.bandwidthLimit || 0);
  transferService.setCompressionEnabled(settings.compressionEnabled);
  discoveryService = new DiscoveryService();

  await transferService.waitUntilReady();

  networkMonitor.start();

  networkMonitor.on('network-change', (event) => {
    log.info(`Network change: ${event.type} on ${event.interface}`);
    broadcastWS('network-change', {
      type: event.type,
      interface: event.interface,
      address: event.address,
      oldAddress: event.oldAddress,
    });

    if (event.type === 'changed' || event.type === 'added') {
      discoveryService.updateLocalIp(event.address || '');
      transferService.handleNetworkChange(event.address);
    }
  });

  await discoveryService.start();

  // Wire local device identity into the transfer service so outgoing requests
  // correctly identify the sender (not the target device).
  transferService.setLocalDevice(
    discoveryService.getDeviceId(),
    settings.deviceName,
  );

  log.info('Services initialized');
}

let wss: WebSocketServer;

function broadcastWS(event: string, data: any): void {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function setupWSServer(): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws) => {
    log.info('WebSocket client connected');

    ws.on('message', async (raw, isBinary) => {
      if (isBinary) {
        return;
      }

      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'upload-chunk') {
          await handleWSUploadChunk(ws, msg);
        }
      } catch (err) {
        log.error('WS message error:', err);
      }
    });

    ws.on('close', () => {
      log.info('WebSocket client disconnected');
    });
  });

  return wss;
}

// ---------------------------------------------------------------------------
// /ws-stream — streaming upload channel.
// The browser sends:
//   1. {type:'start', deviceId, fileCount}          → server replies {type:'ready', sessionId}
//   2. {type:'manifest-entry', sessionId, fileId,
//         path, size, mtime, mimeType}               → server prepares a temp file slot
//   3. Binary frames: [4B idLen][idBytes][4B chunkIdx][payload]  → appended to temp file
//   4. {type:'file-complete', sessionId, fileId}     → file fully received; hand to TransferService
//   5. {type:'manifest-done', sessionId}             → all files received; start P2P session
// ---------------------------------------------------------------------------
interface StreamEntry {
  fileId: string;
  relativePath: string;
  size: number;
  mtime?: number;
  ctime?: number;
  permissions?: number;
  hidden?: boolean;
  readonly?: boolean;
  isDirectory: boolean;
  mimeType: string;
  tempPath: string;
  bytesReceived: number;
  writeStream: fs.WriteStream | null;
}

function setupStreamWSServer(): WebSocketServer {
  const streamWss = new WebSocketServer({ noServer: true });

  streamWss.on('connection', (ws) => {
    log.info('[StreamWS] Client connected');

    let sessionId: string | null = null;
    let deviceId: string | null = null;
    const entries = new Map<string, StreamEntry>();
    const completedFiles: FileInfo[] = [];
    let currentFileId: string | null = null; // fileId of the currently streaming binary file

    const sendJSON = (obj: any) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(obj));
      }
    };

    ws.on('message', async (raw, isBinary) => {
      try {
        if (isBinary) {
          // Binary chunk frame: [4B fileIdLen][fileIdBytes][4B chunkIndex][payload]
          const buf = raw as Buffer;
          if (buf.byteLength < 8) return;

          const idLen = buf.readUInt32BE(0);
          if (buf.byteLength < 4 + idLen + 4) return;

          const fileId = buf.slice(4, 4 + idLen).toString('utf8');
          // chunkIndex at offset 4+idLen (not used for write ordering, we append sequentially)
          const payload = buf.slice(4 + idLen + 4);

          const entry = entries.get(fileId);
          if (!entry) {
            log.warn(`[StreamWS] Binary chunk for unknown fileId ${fileId}`);
            return;
          }

          currentFileId = fileId;

          if (!entry.writeStream) {
            const tmpDir = path.join(os.tmpdir(), 'lightningshare-stream');
            await fs.promises.mkdir(tmpDir, { recursive: true });
            entry.tempPath = path.join(tmpDir, `${fileId}${path.extname(entry.relativePath)}`);
            entry.writeStream = fs.createWriteStream(entry.tempPath, { flags: 'a' });
          }

          await new Promise<void>((resolve, reject) => {
            entry.writeStream!.write(payload, (err) => err ? reject(err) : resolve());
          });
          entry.bytesReceived += payload.byteLength;
          return;
        }

        // Control message
        const msg = JSON.parse((raw as Buffer).toString());

        if (msg.type === 'start') {
          deviceId = msg.deviceId;
          sessionId = uuidv4();
          log.info(`[StreamWS] Session started: ${sessionId} → device ${deviceId}`);
          sendJSON({ type: 'ready', sessionId });
          return;
        }

        if (msg.type === 'manifest-entry') {
          const entry: StreamEntry = {
            fileId: msg.fileId,
            relativePath: msg.path, // Preserved relative path!
            size: msg.size,
            mtime: msg.mtime,
            ctime: msg.ctime,
            permissions: msg.permissions,
            hidden: msg.hidden,
            readonly: msg.readonly,
            isDirectory: !!msg.isDirectory,
            mimeType: msg.mimeType,
            tempPath: '',
            bytesReceived: 0,
            writeStream: null,
          };
          entries.set(msg.fileId, entry);
          log.debug(`[StreamWS] Manifest entry: ${msg.path} (${msg.size} bytes) isDir=${entry.isDirectory}`);
          return;
        }

        if (msg.type === 'file-complete') {
          const entry = entries.get(msg.fileId);
          if (!entry) return;

          // Flush & close write stream
          await new Promise<void>((resolve) => {
            if (entry.writeStream) {
              entry.writeStream.end(resolve);
            } else {
              resolve();
            }
          });

          // Handle zero-byte files (no binary frames)
          // Do NOT create temp paths for directories
          if (!entry.tempPath && !entry.isDirectory) {
            const tmpDir = path.join(os.tmpdir(), 'lightningshare-stream');
            await fs.promises.mkdir(tmpDir, { recursive: true });
            entry.tempPath = path.join(tmpDir, `${msg.fileId}${path.extname(entry.relativePath)}`);
            await fs.promises.writeFile(entry.tempPath, Buffer.alloc(0));
          }

          const fileInfo: FileInfo = {
            id: entry.fileId,
            name: entry.relativePath, // BUG FIX: Don't flatten with path.basename()
            path: entry.tempPath,
            size: entry.bytesReceived || entry.size,
            isDirectory: entry.isDirectory,
            mimeType: entry.mimeType,
            mtime: entry.mtime,
            ctime: entry.ctime,
            permissions: entry.permissions,
            hidden: entry.hidden,
            readonly: entry.readonly,
          };
          completedFiles.push(fileInfo);
          log.debug(`[StreamWS] File completed: ${entry.relativePath} → ${entry.tempPath}`);
          return;
        }

        if (msg.type === 'manifest-done') {
          if (!deviceId || !sessionId || completedFiles.length === 0) {
            sendJSON({ type: 'error', error: 'No files received' });
            return;
          }

          const device = discoveryService.getDevices().find((d) => d.id === deviceId);
          if (!device) {
            sendJSON({ type: 'error', error: `Device ${deviceId} not found` });
            return;
          }

          try {
            const session = await transferService.createSession(device, completedFiles, 'sending');
            if (!session) {
              sendJSON({ type: 'error', error: 'Failed to create transfer session' });
              return;
            }
            await transferService.startSession(session.id);
            sendJSON({ type: 'transfer-started', sessionId: session.id });
            log.info(`[StreamWS] Transfer session started: ${session.id}`);
          } catch (err) {
            log.error('[StreamWS] Transfer start error:', err);
            sendJSON({ type: 'error', error: (err as Error).message });
          }
          return;
        }

      } catch (err) {
        log.error('[StreamWS] Message error:', err);
      }
    });

    ws.on('close', () => {
      log.info('[StreamWS] Client disconnected');
      // Clean up any uncompleted write streams
      for (const entry of entries.values()) {
        if (entry.writeStream) {
          entry.writeStream.destroy();
        }
      }
    });
  });

  return streamWss;
}


async function handleWSUploadChunk(ws: WebSocket, msg: any): Promise<void> {
  const { uploadId, chunkIndex, data, isLast } = msg;
  log.debug(`Upload chunk ${chunkIndex} for ${uploadId}, size=${data?.length || 0}`);
  if (isLast) {
    const pending = pendingFileData.get(uploadId);
    if (pending) {
      pendingFileData.delete(uploadId);
    }
  }
}

function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-File-Name, X-File-Size, X-File-Id, X-Mime-Type');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // --- Server info (health check + connection info) ---
  app.get('/api/server-info', (_req, res) => {
    const interfaces = os.networkInterfaces();
    const addresses: string[] = [];
    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;
      for (const info of netInterface) {
        if (info.family === 'IPv4' && !info.internal) {
          addresses.push(info.address);
        }
      }
    }
    res.json({
      running: true,
      port: PORT,
      deviceName: settings.deviceName,
      deviceId: discoveryService?.getDeviceId() || '',
      localIp: addresses[0] || '127.0.0.1',
      allAddresses: addresses,
      url: `http://${addresses[0] || 'localhost'}:${PORT}`,
      timestamp: Date.now(),
    });
  });

  app.get('/api/diagnostics', (_req, res) => {
    res.json(buildDiagnosticsReport());
  });

  app.get('/api/diagnostics/export', (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="lightningshare-diagnostics.json"');
    res.send(JSON.stringify(buildDiagnosticsReport(), null, 2));
  });

  // --- Device info ---
  app.get('/api/device-id', (_req, res) => {
    res.json({ id: discoveryService.getDeviceId() });
  });

  app.get('/api/device-name', (_req, res) => {
    res.json({ name: settings.deviceName });
  });

  app.post('/api/device-name', (req, res) => {
    const { name } = req.body;
    if (name) {
      settings.deviceName = name;
      discoveryService.setDeviceName(name);
      transferService.setLocalDevice(discoveryService.getDeviceId(), name);
    }
    res.json({ success: true });
  });

  app.get('/api/devices', (_req, res) => {
    const devices = discoveryService.getDevices();
    log.info('/api/devices called. Size: ' + devices.length + ' Content: ' + JSON.stringify(devices));
    res.json(devices);
  });

  app.get('/api/local-ip', (_req, res) => {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;
      for (const info of netInterface) {
        if (info.family === 'IPv4' && !info.internal) {
          return res.json({ ip: info.address });
        }
      }
    }
    res.json({ ip: '127.0.0.1' });
  });

  // --- Settings ---
  app.get('/api/settings', (_req, res) => {
    res.json(settings);
  });

  app.post('/api/settings', (req, res) => {
    settings = { ...settings, ...req.body };
    transferService.setBandwidthLimit(settings.bandwidthLimit || 0);
    transferService.setCompressionEnabled(settings.compressionEnabled);
    res.json(settings);
  });

  app.get('/api/download-path', async (_req, res) => {
    if (settings.downloadPath) return res.json({ path: settings.downloadPath });
    const downloadsPath = path.join(os.homedir(), 'Downloads');
    if (!fs.existsSync(downloadsPath)) {
      fs.mkdirSync(downloadsPath, { recursive: true });
    }
    settings.downloadPath = downloadsPath;
    res.json({ path: downloadsPath });
  });

  app.post('/api/download-path', (req, res) => {
    const { downloadPath } = req.body;
    if (downloadPath) {
      settings.downloadPath = downloadPath;
    }
    res.json({ path: settings.downloadPath });
  });

  // --- Browse directories (for save location picker) ---
  app.get('/api/browse-dirs', (req, res) => {
    const dirPath = (req.query.path as string) || os.homedir();
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory())
        .filter((e) => !e.name.startsWith('.') && !e.name.startsWith('$'))
        .map((e) => ({
          name: e.name,
          path: path.join(dirPath, e.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({
        current: dirPath,
        parent: path.dirname(dirPath) !== dirPath ? path.dirname(dirPath) : null,
        dirs,
      });
    } catch (err) {
      res.status(400).json({ error: 'Cannot read directory' });
    }
  });

  app.get('/api/quick-dirs', (_req, res) => {
    const home = os.homedir();
    const candidates = [
      { label: 'Desktop', path: path.join(home, 'Desktop') },
      { label: 'Downloads', path: path.join(home, 'Downloads') },
      { label: 'Documents', path: path.join(home, 'Documents') },
      { label: 'Home', path: home },
    ];
    const valid = candidates.filter((c) => {
      try { return fs.existsSync(c.path) && fs.statSync(c.path).isDirectory(); }
      catch { return false; }
    });
    res.json(valid);
  });

  // --- File upload ---
  app.post('/api/upload', async (req, res) => {
    const encodedFileName = req.headers['x-file-name'] as string;
    let fileName = encodedFileName;
    try {
      fileName = decodeURIComponent(encodedFileName || '');
    } catch {
      // Keep the raw header for compatibility with older clients.
    }
    const fileSize = parseInt(req.headers['x-file-size'] as string, 10);
    const fileId = (req.headers['x-file-id'] as string) || uuidv4();
    const mimeType = (req.headers['x-mime-type'] as string) || 'application/octet-stream';

    if (!fileName) {
      return res.status(400).json({ error: 'Missing X-File-Name header' });
    }

    const tempPath = uploadManager.getTempPath(fileId, fileName);

    try {
      await uploadManager.saveUpload(fileId, fileName, req);
      log.info(`File uploaded: ${fileName} (${fileSize} bytes) -> ${tempPath}`);

      const fileInfo: FileInfo = {
        id: fileId,
        name: fileName,
        path: tempPath,
        size: fileSize,
        isDirectory: false,
        mimeType,
      };

      res.json(fileInfo);
    } catch (err) {
      log.error('Upload failed:', err);
      res.status(500).json({ error: 'Upload failed' });
    }
  });

  // --- File selection (returns FileInfo from already-uploaded files) ---
  app.post('/api/select-files', (req, res) => {
    const files = req.body as FileInfo[];
    res.json(files);
  });

  // --- Transfer operations ---
  app.post('/api/transfer/start', async (req, res) => {
    const { deviceId, files } = req.body as { deviceId: string; files: FileInfo[] };
    const device = discoveryService.getDevices().find((d) => d.id === deviceId);
    if (!device) {
      return res.status(404).json({ success: false, error: 'Device not found' });
    }
    try {
      const session = await transferService.createSession(device, files, 'sending');
      if (!session) {
        return res.status(500).json({ success: false, error: 'Failed to create session' });
      }
      await transferService.startSession(session.id);
      res.json({ success: true, sessionId: session.id });
    } catch (err) {
      log.error('Transfer start error:', err);
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/transfer/accept', async (req, res) => {
    const { sessionId, downloadPath: customPath } = req.body;
    log.info(`[ACCEPT] Request received: sessionId=${sessionId}, downloadPath=${customPath}`);
    if (!sessionId) {
      log.error('[ACCEPT] Missing sessionId');
      return res.status(400).json({ success: false, error: 'Missing sessionId' });
    }
    try {
      const downloadPath = customPath || settings.downloadPath || path.join(os.homedir(), 'Downloads');
      try {
        await fs.promises.mkdir(downloadPath, { recursive: true });
        const pathStats = await fs.promises.stat(downloadPath);
        if (!pathStats.isDirectory()) {
          throw new Error('The selected save path is not a directory');
        }
      } catch (error) {
        const message = `Cannot initialize save directory: ${(error as Error).message}`;
        log.error(`[ACCEPT] ${message}`);
        return res.status(400).json({ success: false, error: message });
      }
      settings.downloadPath = downloadPath;
      log.info(`[ACCEPT] Calling transferService.acceptSession...`);
      await transferService.acceptSession(sessionId, downloadPath);
      log.info(`[ACCEPT] acceptSession completed OK`);
      res.json({ success: true, downloadPath });
    } catch (err) {
      log.error('[ACCEPT] Error:', err);
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/transfer/reject', async (req, res) => {
    const { sessionId } = req.body;
    log.info(`[REJECT] Request received: sessionId=${sessionId}`);
    if (!sessionId) {
      log.error('[REJECT] Missing sessionId');
      return res.status(400).json({ success: false, error: 'Missing sessionId' });
    }
    try {
      await transferService.rejectSession(sessionId);
      log.info(`[REJECT] rejectSession completed OK`);
      res.json({ success: true });
    } catch (err) {
      log.error('[REJECT] Error:', err);
      res.status(500).json({ success: false, error: (err as Error).message });
    }
  });

  app.post('/api/transfer/cancel', async (req, res) => {
    const { sessionId } = req.body;
    await transferService.cancelSession(sessionId);
    res.json({ success: true });
  });

  app.post('/api/transfer/pause', async (req, res) => {
    const { sessionId } = req.body;
    await transferService.pauseSession(sessionId);
    res.json({ success: true });
  });

  app.post('/api/benchmark/run', async (req, res) => {
    try {
      const downloadPath = settings.downloadPath || path.join(os.homedir(), 'Downloads');
      const results = await benchmarkService.runBenchmark(downloadPath);
      res.json(results);
    } catch (err) {
      log.error('Benchmark error:', err);
      res.status(500).json({ error: 'Failed to run benchmark' });
    }
  });

  app.post('/api/transfer/resume', async (req, res) => {
    const { sessionId } = req.body;
    await transferService.resumeSession(sessionId);
    res.json({ success: true });
  });

  app.post('/api/transfer/clear-history', (req, res) => {
    transferService.clearHistory();
    res.json({ success: true });
  });

  app.get('/api/transfer/sessions', (_req, res) => {
    const sessions = transferService.getSessions();
    res.json(sessions.map(serializeSession));
  });

  app.get('/api/transfer/sessions/:id', (req, res) => {
    const session = transferService.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(serializeSession(session));
  });

  // --- OS shell operations ---
  app.post('/api/open-file', (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Missing filePath' });

    const cmd = process.platform === 'win32'
      ? `start "" "${filePath}"`
      : process.platform === 'darwin'
      ? `open "${filePath}"`
      : `xdg-open "${filePath}"`;

    exec(cmd, (err) => {
      if (err) {
        log.error('Open file error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true });
    });
  });

  app.post('/api/show-in-folder', (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'Missing filePath' });

    const cmd = process.platform === 'win32'
      ? `explorer /select,"${filePath}"`
      : process.platform === 'darwin'
      ? `open -R "${filePath}"`
      : `xdg-open "${path.dirname(filePath)}"`;

    exec(cmd, (err) => {
      if (err) {
        log.error('Show in folder error:', err);
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true });
    });
  });

  // --- Static file serving (production) ---
  if (!IS_DEV) {
    const rendererDir = path.resolve(__dirname, '../../renderer');
    app.use(express.static(rendererDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      res.sendFile(path.join(rendererDir, 'index.html'));
    });
  }

  return app;
}

function serializeSession(session: TransferSession): any {
  const internal = session as any;
  return {
    ...session,
    acknowledgedChunks: Array.from(session.acknowledgedChunks),
    speedHistory: session.speedHistory,
    fileResume: internal.fileResume
      ? Object.fromEntries(Object.entries(internal.fileResume).map(([fileId, state]: [string, any]) => [
        fileId,
        {
          acknowledgedChunks: Array.from(state.acknowledgedChunks || []),
          contiguousBytes: state.contiguousBytes || 0,
          completed: Boolean(state.completed),
        },
      ]))
      : undefined,
  };
}

function buildDiagnosticsReport(): any {
  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: '1.0.0',
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
    },
    process: {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      resource: process.resourceUsage(),
    },
    network: Object.fromEntries(
      Object.entries(os.networkInterfaces()).map(([name, entries]) => [
        name,
        (entries || []).map(entry => ({
          address: entry.address,
          family: entry.family,
          internal: entry.internal,
        })),
      ]),
    ),
    discovery: discoveryService.getDiagnostics(),
    tls: certificateManager.getDiagnostics(),
    transfers: transferService.getDiagnostics(),
  };
}

function setupServiceEventBridge(): void {
  discoveryService.on('device-discovered', (device: Device) => {
    broadcastWS('device-discovered', device);
  });

  discoveryService.on('device-left', (deviceId: string) => {
    broadcastWS('device-left', deviceId);
  });

  transferService.on('session-updated', (session: TransferSession) => {
    broadcastWS('session-updated', serializeSession(session));
  });

  transferService.on('session-completed', (session: TransferSession) => {
    broadcastWS('session-completed', serializeSession(session));
  });

  transferService.on('session-error', (sessionId: string, error: string) => {
    broadcastWS('session-error', { sessionId, error });
  });

  transferService.on('incoming-transfer', (transfer: IncomingTransfer) => {
    if (settings.autoAcceptFromTrusted && settings.trustedDevices?.includes(transfer.deviceId)) {
      log.info(`[Auto-Accept] Accepting transfer ${transfer.sessionId} from trusted device ${transfer.deviceId}`);
      const downloadPath = settings.downloadPath || path.join(os.homedir(), 'Downloads');
      fs.promises.mkdir(downloadPath, { recursive: true })
        .then(() => transferService.acceptSession(transfer.sessionId, downloadPath))
        .catch(err => log.error('[Auto-Accept] Failed:', err));
    } else {
      broadcastWS('incoming-transfer', transfer);
    }
  });
}

async function main(): Promise<void> {
  log.info('LightningShare starting...');

  process.on('uncaughtException', (error) => {
    log.error('Uncaught exception:', error);
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection:', reason);
  });

  await initializeServices();
  setupServiceEventBridge();
  transferService.recoverPersistedSessions();

  const app = createApp();
  const server = http.createServer(app);

  const wssMain = setupWSServer();
  const wssStream = setupStreamWSServer();

  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? request.url.split('?')[0] : '';
    if (pathname === '/ws') {
      wssMain.handleUpgrade(request, socket as any, head, (ws) => {
        wssMain.emit('connection', ws, request);
      });
    } else if (pathname === '/ws-stream') {
      wssStream.handleUpgrade(request, socket as any, head, (ws) => {
        wssStream.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });


  server.listen(PORT, () => {
    log.info(`Server listening on http://localhost:${PORT}`);
    if (process.env.NODE_ENV !== 'test' && !IS_DEV) {
      const url = `http://localhost:${PORT}`;
      const cmd = process.platform === 'win32'
        ? `start "" "${url}"`
        : process.platform === 'darwin'
        ? `open "${url}"`
        : `xdg-open "${url}"`;
      exec(cmd);
    }
  });

  process.on('SIGINT', async () => {
    log.info('Shutting down...');
    networkMonitor.stop();
    if (discoveryService) await discoveryService.stop();
    if (transferService) await transferService.stop();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error('Failed to start:', err);
  process.exit(1);
});
