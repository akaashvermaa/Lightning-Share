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

const PORT = parseInt(process.env.PORT || '51236', 10);
const IS_DEV = process.env.NODE_ENV !== 'production';

let discoveryService: DiscoveryService;
let transferService: TransferService;
let fileService: FileService;

let settings: AppSettings = { ...DEFAULT_APP_SETTINGS, deviceName: os.hostname() };

const pendingFileData = new Map<string, { resolve: (p: string) => void; reject: (e: Error) => void }>();

async function initializeServices(): Promise<void> {
  fileService = new FileService();
  transferService = new TransferService(fileService);
  discoveryService = new DiscoveryService();

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

function setupWSServer(server: http.Server): void {
  wss = new WebSocketServer({ server, path: '/ws' });

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
    }
    res.json({ success: true });
  });

  app.get('/api/devices', (_req, res) => {
    res.json(discoveryService.getDevices());
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

  // --- File upload ---
  app.post('/api/upload', async (req, res) => {
    const fileName = req.headers['x-file-name'] as string;
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
    const { sessionId } = req.body;
    const downloadPath = settings.downloadPath || path.join(os.homedir(), 'Downloads');
    await transferService.acceptSession(sessionId, downloadPath);
    res.json({ success: true });
  });

  app.post('/api/transfer/reject', async (req, res) => {
    const { sessionId } = req.body;
    await transferService.rejectSession(sessionId);
    res.json({ success: true });
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

  app.post('/api/transfer/resume', async (req, res) => {
    const { sessionId } = req.body;
    await transferService.resumeSession(sessionId);
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
  return {
    ...session,
    acknowledgedChunks: Array.from(session.acknowledgedChunks),
    speedHistory: session.speedHistory,
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
    broadcastWS('incoming-transfer', transfer);
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

  const app = createApp();
  const server = http.createServer(app);

  setupWSServer(server);

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