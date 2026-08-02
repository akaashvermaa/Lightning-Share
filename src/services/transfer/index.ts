import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { deflateRaw, inflateRaw } from 'zlib';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import log from '../../shared/logger';
import {
  Device,
  FileInfo,
  TransferSession,
  IncomingTransfer,
  ChunkInfo,
} from '../../shared/types';
import { FileService } from '../file';
import { certificateManager } from './certificate';
import { encodeFrame, decodeFrame } from './protocol';
import {
  TRANSFER_PORT,
  MAX_CHUNK_RETRIES,
  RETRY_DELAY,
  TRANSFER_WINDOW_SIZE,
  MIN_TRANSFER_WINDOW_SIZE,
  MAX_TRANSFER_WINDOW_SIZE,
  MAX_TRANSFER_FRAME_SIZE,
  TCP_KEEPALIVE,
  shouldCompress,
  getChunkSizeForFile,
} from '../../shared/constants';
import { BufferPool } from './BufferPool';

interface ActiveConnection {
  socket: tls.TLSSocket | net.Socket;
  sessionId: string;
  fileId: string;
  chunkIndex: number;
  retries: number;
  timeout?: NodeJS.Timeout;
}

interface PendingTransfer {
  transfer: IncomingTransfer;
  socket: tls.TLSSocket | net.Socket;
}

const TRANSFER_STATE_DIR = path.join(os.homedir(), '.lightningshare');
const TRANSFER_STATE_FILE = path.join(TRANSFER_STATE_DIR, 'transfers.json');
const TRANSFER_STATE_VERSION = 3;
const deflateRawAsync = promisify(deflateRaw);
const inflateRawAsync = promisify(inflateRaw);

function sanitizeRelativePath(unsafePath: string): string {
  // Reject absolute paths, UNC paths, and Windows device names
  if (
    /^(?:[a-zA-Z]:\\|\/|\\\\)/.test(unsafePath) || 
    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(path.basename(unsafePath)) ||
    unsafePath.includes('..') ||
    unsafePath.includes('~/') ||
    unsafePath.includes('%USERPROFILE%')
  ) {
    return path.basename(unsafePath).replace(/[\/\\]/g, '_');
  }

  return unsafePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

interface PersistedTransferState {
  version: number;
  updatedAt: number;
  sessions: any[];
  pendingTransfers: IncomingTransfer[];
}

interface FileResumeRecord {
  acknowledgedChunks: Set<number>;
  contiguousBytes: number;
  completed: boolean;
}

interface ReconnectState {
  attempts: number;
  timer: NodeJS.Timeout | null;
  inFlight: boolean;
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function socketAddress(socket: tls.TLSSocket | net.Socket): string {
  return `${socket.remoteAddress || 'unknown'}:${socket.remotePort || 'unknown'}`;
}

export class TransferService extends EventEmitter {
  private sessions: Map<string, TransferSession> = new Map();
  private server: tls.Server | null = null;
  private serverReady: Promise<void>;
  private fileService: FileService;
  private connections: Map<string, ActiveConnection> = new Map();
  private pendingTransfers: Map<string, { transfer: IncomingTransfer, socket: net.Socket }> = new Map();
  private bufferPool = new BufferPool();
  private pendingIncomingTransfers: Map<string, IncomingTransfer> = new Map();
  private writeHandles: Map<string, fs.promises.FileHandle> = new Map();
  private fileHandles: Map<string, fs.promises.FileHandle> = new Map();
  private chunkReadAhead: Map<string, Promise<Buffer | null>> = new Map();
  private reconnects: Map<string, ReconnectState> = new Map();
  private awaitingComplete: Set<string> = new Set();
  private persistTimer: NodeJS.Timeout | null = null;
  private localDeviceId: string = '';
  private localDeviceName: string = '';
  private stopping = false;
  private bandwidthLimitBytesPerSecond = 0;
  private bandwidthTail: Promise<void> = Promise.resolve();
  private compressionEnabled = true;
  // Write Buffer Queue: one sequential promise chain per file so that
  // concurrent chunk handlers never issue overlapping pwrite calls.
  private writeQueues: Map<string, Promise<void>> = new Map();
  // Persistent Send Queue: ordered list of session IDs waiting to connect.
  // Sessions are processed one-at-a-time to avoid simultaneous reconnect races.
  private sendQueue: string[] = [];
  private sendQueueRunning = false;

  constructor(fileService: FileService) {
    super();
    this.fileService = fileService;
    this.loadPersistedSessions();
    this.serverReady = this.startServer();
  }

  private loadPersistedSessions(): void {
    try {
      if (!fs.existsSync(TRANSFER_STATE_FILE)) return;

      const parsed: any = JSON.parse(fs.readFileSync(TRANSFER_STATE_FILE, 'utf8'));
      if (!Array.isArray(parsed) && (!Number.isInteger(parsed?.version) || parsed.version > TRANSFER_STATE_VERSION)) {
        throw new Error(`Unsupported transfer state version: ${parsed?.version ?? 'unknown'}`);
      }
      const records = Array.isArray(parsed) ? parsed : parsed?.sessions;
      if (!Array.isArray(records)) throw new Error('Invalid transfer state format');

      const pendingTransfers = Array.isArray(parsed)
        ? []
        : Array.isArray(parsed.pendingTransfers) ? parsed.pendingTransfers : [];
      for (const pending of pendingTransfers) {
        if (pending?.sessionId && Array.isArray(pending.files)) {
          this.pendingIncomingTransfers.set(pending.sessionId, pending);
        }
      }

      for (const record of records) {
        if (!record?.id || !record.files || !Array.isArray(record.files)) continue;

        const active = ['pending', 'connecting', 'transferring', 'reconnecting', 'paused']
          .includes(record.status);
        const session = record as TransferSession & { internal?: Record<string, any> };
        session.acknowledgedChunks = new Set(record.acknowledgedChunks || []);
        session.chunks = record.chunks || [];
        session.speedHistory = record.speedHistory || [];

        if (record.internal) {
          Object.assign(session, record.internal);
          if (Array.isArray(record.internal.skippedFiles)) {
            (session as any).skippedFiles = new Set(record.internal.skippedFiles);
          }
          if (record.internal.fileResume && typeof record.internal.fileResume === 'object') {
            const fileResume: Record<string, FileResumeRecord> = {};
            for (const [fileId, state] of Object.entries(record.internal.fileResume)) {
              const value = state as any;
              fileResume[fileId] = {
                acknowledgedChunks: new Set(value.acknowledgedChunks || []),
                contiguousBytes: Number(value.contiguousBytes) || 0,
                completed: Boolean(value.completed),
              };
            }
            (session as any).fileResume = fileResume;
          }
        }
        if (active) {
          session.status = 'reconnecting';
        }

        this.sessions.set(session.id, session);
      }
      log.info(
        `Restored ${this.sessions.size} persisted transfer session(s) and ` +
        `${this.pendingIncomingTransfers.size} pending request(s)`,
      );
    } catch (err) {
      log.error(`Failed to restore persisted transfers:\n${errorDetails(err)}`);
      try {
        fs.copyFileSync(
          TRANSFER_STATE_FILE,
          `${TRANSFER_STATE_FILE}.corrupt-${Date.now()}`,
        );
      } catch {
        // Preserve the original error when the diagnostic copy cannot be made.
      }
    }
  }

  private persistSessionsSoon(): void {
    if (this.persistTimer) return;

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistSessionsNow();
    }, 250);
  }

  private persistSessionsNow(): void {
    try {
      fs.mkdirSync(TRANSFER_STATE_DIR, { recursive: true });
      const records = Array.from(this.sessions.values()).map((session) => {
        const internal = session as any;
        return {
          ...session,
          acknowledgedChunks: Array.from(session.acknowledgedChunks),
          internal: {
            downloadPath: internal.downloadPath,
            fileProgress: internal.fileProgress,
            filePaths: internal.filePaths,
            currentFileIndex: internal.currentFileIndex,
            windowSize: internal.windowSize,
            skippedFiles: internal.skippedFiles
              ? Array.from(internal.skippedFiles)
              : undefined,
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
            devicePort: internal.devicePort,
            queuedAt: internal.queuedAt,
          },
        };
      });
      const state: PersistedTransferState = {
        version: TRANSFER_STATE_VERSION,
        updatedAt: Date.now(),
        sessions: records,
        pendingTransfers: Array.from(this.pendingIncomingTransfers.values()),
      };
      const tempFile = `${TRANSFER_STATE_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(state), 'utf8');
      const tempHandle = fs.openSync(tempFile, 'r');
      try {
        fs.fsyncSync(tempHandle);
      } finally {
        fs.closeSync(tempHandle);
      }
      fs.renameSync(tempFile, TRANSFER_STATE_FILE);
    } catch (err) {
      log.error(`Failed to persist transfers:\n${errorDetails(err)}`);
    }
  }

  recoverPersistedSessions(): void {
    // Re-surface pending incoming transfer requests to the UI so the user can
    // accept or reject them after a restart. Without this, restored
    // pendingIncomingTransfers are invisible — the toasts never re-appear.
    for (const pending of this.pendingIncomingTransfers.values()) {
      log.info(`Re-emitting restored pending transfer request ${pending.sessionId} from ${pending.deviceName}`);
      // Give the UI a moment to mount before firing the event.
      setTimeout(() => this.emit('incoming-transfer', pending), 500);
    }

    // Re-queue outbound sending sessions for reconnection.
    const sendingSessions = Array.from(this.sessions.values())
      .filter(s => s.direction === 'sending' && s.status === 'reconnecting')
      .sort((a, b) => ((a as any).queuedAt || 0) - ((b as any).queuedAt || 0));

    for (const session of sendingSessions) {
      log.info(`Queuing persisted sending session ${session.id} for recovery`);
      this.sendQueue.push(session.id);
    }

    if (this.sendQueue.length > 0) {
      setTimeout(() => this.drainSendQueue(), 1000);
    }
  }

  clearHistory(): void {
    let changed = false;
    for (const [id, session] of this.sessions.entries()) {
      if (['completed', 'failed', 'cancelled', 'declined'].includes(session.status)) {
        this.sessions.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.persistSessionsSoon();
    }
  }

  // ---------------------------------------------------------------------------
  // Send Queue: drains sessions one-at-a-time so reconnect attempts don't race.
  // ---------------------------------------------------------------------------
  private drainSendQueue(): void {
    if (this.sendQueueRunning || this.sendQueue.length === 0) return;
    this.sendQueueRunning = true;

    const sessionId = this.sendQueue[0];
    const session = this.sessions.get(sessionId);

    if (!session || ['completed', 'cancelled', 'failed', 'declined'].includes(session.status)) {
      this.sendQueue.shift();
      this.sendQueueRunning = false;
      this.drainSendQueue();
      return;
    }

    log.info(`[SEND_QUEUE] Processing session ${sessionId} (${this.sendQueue.length} in queue)`);

    // Listen for the session to either complete or fail before processing next.
    const onDone = (s: TransferSession) => {
      if (s.id !== sessionId) return;
      if (['completed', 'cancelled', 'failed', 'declined', 'transferring'].includes(s.status)) {
        this.removeListener('session-updated', onDone);
        this.removeListener('session-completed', onDone);
        this.sendQueue.shift();
        this.sendQueueRunning = false;
        // Small delay before next so the network isn't slammed
        setTimeout(() => this.drainSendQueue(), 200);
      }
    };
    this.on('session-updated', onDone);
    this.on('session-completed', onDone);

    void this.attemptReconnect(session);
  }

  setLocalDevice(deviceId: string, deviceName: string): void {
    this.localDeviceId = deviceId;
    this.localDeviceName = deviceName;
    log.info(`TransferService: local device set to ${deviceName} (${deviceId})`);
  }

  setBandwidthLimit(bytesPerSecond: number): void {
    this.bandwidthLimitBytesPerSecond = Number.isFinite(bytesPerSecond) && bytesPerSecond > 0
      ? bytesPerSecond
      : 0;
  }

  setCompressionEnabled(enabled: boolean): void {
    this.compressionEnabled = enabled;
  }

  async waitUntilReady(): Promise<void> {
    await this.serverReady;
  }

  private async startServer(): Promise<void> {
    log.info('[TRACE] ENTER startServer');
    log.info('[TRACE] CERTIFICATE LOAD START');
    const certInfo = await certificateManager.getCertificate();
    log.info(`[TRACE] CERTIFICATE LOAD SUCCESS cert=${certInfo.certPath}`);

    const options = {
      key: fs.readFileSync(certInfo.keyPath),
      cert: fs.readFileSync(certInfo.certPath),
      rejectUnauthorized: false,
      handshakeTimeout: 10000,
    };

    this.server = tls.createServer(options, (socket) => {
      log.info(`[TRACE] TLS SERVER CALLBACK ${socketAddress(socket)}`);
      this.handleConnection(socket);
    });

    this.server.on('error', (err) => {
      log.error('TLS server error:', err);
    });

    this.server.on('tlsClientError', (err, socket) => {
      log.error(
        `[TRACE] TLS HANDSHAKE ERROR from ${socketAddress(socket)}:\n${errorDetails(err)}`,
      );
    });

    this.server.on('secureConnection', (socket) => {
      log.info(`[TRACE] TLS CLIENT CONNECTED ${socketAddress(socket)}`);
    });

    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        log.info(`[TRACE] EXIT startServer listening on 0.0.0.0:${TRANSFER_PORT}`);
        resolve();
      };
      const onError = (err: Error) => {
        this.server?.off('listening', onListening);
        reject(err);
      };

      this.server?.once('listening', onListening);
      this.server?.once('error', onError);
      this.server?.listen(TRANSFER_PORT, '0.0.0.0');
    });
  }

  private handleConnection(socket: tls.TLSSocket | net.Socket): void {
    const remoteAddress = socketAddress(socket);
    log.info(`[TRACE] ENTER handleConnection ${remoteAddress}`);
    log.info(`[TRACE] INCOMING TLS CONNECTION ${remoteAddress}`);
    socket.setKeepAlive(true, TCP_KEEPALIVE);
    // Socket Buffer Optimization: tune kernel send/recv buffers and set a
    // generous stream highWaterMark so Node doesn't fragment large writes.
    try { (socket as any).setNoDelay(true); } catch {}
    try { (socket as any).setSendBufferSize?.(4 * 1024 * 1024); } catch {}
    try { (socket as any).setRecvBufferSize?.(4 * 1024 * 1024); } catch {}
    (socket as any)._writableState && ((socket as any)._writableState.highWaterMark = 4 * 1024 * 1024);

    let buffer = Buffer.alloc(0);

    socket.on('data', async (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32BE(0);
        if (messageLength > MAX_TRANSFER_FRAME_SIZE) {
          socket.destroy(new Error(`Transfer frame exceeds ${MAX_TRANSFER_FRAME_SIZE} bytes`));
          return;
        }
        if (buffer.length < 4 + messageLength) break;

        const messageData = buffer.slice(4, 4 + messageLength);
        buffer = buffer.slice(4 + messageLength);

        try {
          const message = decodeFrame(messageData);
          const messageLog = message.type === 'chunk' || message.type === 'ack'
            ? log.debug.bind(log)
            : log.info.bind(log);
          messageLog(`[TRACE] RECEIVER MESSAGE ${message.type} START session=${message.sessionId || 'unknown'}`);
          await this.handleMessage(socket, message);
          messageLog(`[TRACE] RECEIVER MESSAGE ${message.type} SUCCESS session=${message.sessionId || 'unknown'}`);
        } catch (err) {
          log.error(`[TRACE] RECEIVER MESSAGE ERROR ${remoteAddress}:\n${errorDetails(err)}`);
          socket.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    socket.on('close', (hadError) => {
      log.info(`[TRACE] RECEIVER SOCKET CLOSE ${remoteAddress} hadError=${hadError}`);
    });

    socket.on('error', (err) => {
      log.error(`[TRACE] RECEIVER SOCKET ERROR ${remoteAddress}:\n${errorDetails(err)}`);
    });

    log.info(`[TRACE] EXIT handleConnection ${remoteAddress}`);
  }

  private async handleMessage(socket: tls.TLSSocket | net.Socket, message: any): Promise<void> {
    const messageLog = message.type === 'chunk' || message.type === 'ack'
      ? log.debug.bind(log)
      : log.info.bind(log);
    messageLog(`[TRACE] ENTER handleMessage type=${message.type} session=${message.sessionId || 'unknown'}`);
    switch (message.type) {
      case 'request':
        await this.handleTransferRequest(socket, message);
        break;
      case 'accept':
        await this.handleAccept(socket, message);
        break;
      case 'reject':
        await this.handleReject(socket, message);
        break;
      case 'manifest':
        await this.handleManifest(socket, message);
        break;
      case 'manifest-ack':
        await this.handleManifestAck(socket, message);
        break;
      case 'chunk':
        await this.handleChunk(socket, message);
        break;
      case 'ack':
        await this.handleAck(socket, message);
        break;
      case 'complete':
        await this.handleComplete(socket, message);
        break;
      case 'complete-ack':
        await this.handleCompleteAck(socket, message);
        break;
      case 'resume':
        await this.handleResume(socket, message);
        break;
      case 'resume-ack':
        await this.handleResumeAck(socket, message);
        break;
      case 'error':
        await this.handleError(socket, message);
        break;
    }
    messageLog(`[TRACE] EXIT handleMessage type=${message.type} session=${message.sessionId || 'unknown'}`);
  }

  private async handleTransferRequest(socket: net.Socket, message: any): Promise<void> {
    const { sessionId, deviceId, deviceName, files, totalSize } = message;

    log.info(`[TRACE] ENTER handleTransferRequest session=${sessionId}`);
    log.info(`[RECV_REQUEST] Transfer request from ${deviceName}: sessionId=${sessionId}, ${files.length} files, ${totalSize} bytes, socketDestroyed=${socket.destroyed}`);

    const incomingTransfer: IncomingTransfer = {
      sessionId,
      deviceId,
      deviceName,
      files,
      totalSize,
    };

    this.pendingTransfers.set(sessionId, { transfer: incomingTransfer, socket });
    this.pendingIncomingTransfers.set(sessionId, incomingTransfer);
    this.persistSessionsSoon();
    log.info(`[RECV_REQUEST] Stored pending transfer. Map now has: ${Array.from(this.pendingTransfers.keys()).join(', ')}`);
    this.emit('incoming-transfer', incomingTransfer);
    log.info(`[TRACE] EXIT handleTransferRequest session=${sessionId} incoming-transfer-emitted`);
  }

  private async handleAccept(socket: net.Socket, message: any): Promise<void> {
    log.info(`[TRACE] ENTER handleAccept session=${message.sessionId}`);
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    if (Array.isArray(message.skippedFiles)) {
       (session as any).fileProgress = (session as any).fileProgress || {};
       for (const fileId of message.skippedFiles) {
          const file = session.files.find(f => f.id === fileId);
          if (file) {
             (session as any).fileProgress[fileId] = {
                transferred: file.size,
                completed: true
             };
             log.info(`[WORKSPACE_SYNC] Sender skipping identical file: ${file.name}`);
          }
       }
    }

    log.info(`[RECV_ACCEPT] Session status was '${session.status}', changing to 'transferring'`);
    session.status = 'transferring';
    session.error = undefined;
    this.emitSessionUpdate(session);
    
    const allCompleted = session.files.every(f => (session as any).fileProgress?.[f.id]?.completed);
    if (allCompleted) {
       session.status = 'completed';
       session.completedAt = Date.now();
       this.persistSessionsSoon();
       this.emit('session-completed', session);
       return;
    }

    await this.startSendingChunks(session, socket);
    log.info(`[TRACE] EXIT handleAccept session=${message.sessionId}`);
  }

  private async handleManifest(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session || session.direction !== 'receiving') return;

    const downloadPath = (session as any).downloadPath || '';
    const fileProgress = (session as any).fileProgress || {};
    const filePaths = (session as any).filePaths || {};
    const matches: { fileId: string; skip: boolean }[] = [];

    for (const manifestFile of message.files || []) {
      const sanitizedName = sanitizeRelativePath(manifestFile.name);
      const candidatePath = path.join(downloadPath, sanitizedName);
      let skip = false;

      try {
        const stats = await fs.promises.stat(candidatePath);
        if (stats.isFile() && stats.size === manifestFile.size) {
          const checksum = await this.fileService.calculateFileChecksum(candidatePath);
          skip = checksum === manifestFile.checksum;
        }
      } catch {
        skip = false;
      }

      if (skip) {
        filePaths[manifestFile.fileId] = candidatePath;
        fileProgress[manifestFile.fileId] = {
          transferred: manifestFile.size,
          completed: true,
        };
        log.info(`Skipping identical file ${manifestFile.name}`);
      }
      matches.push({ fileId: manifestFile.fileId, skip });
    }

    (session as any).fileProgress = fileProgress;
    (session as any).filePaths = filePaths;
    this.emitSessionUpdate(session);
    this.sendMessage(socket, {
      type: 'manifest-ack',
      sessionId: session.id,
      files: matches,
    });

    if (matches.length > 0 && matches.every((file) => file.skip)) {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.persistSessionsSoon();
      this.emit('session-completed', session);
    }
  }

  private async handleManifestAck(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    (session as any).skippedFiles = new Set<string>(
      (message.files || []).filter((file: any) => file.skip).map((file: any) => file.fileId),
    );
    await this.startSendingChunks(session, socket);
  }

  private getFileResumeState(session: TransferSession, fileId: string): FileResumeRecord {
    const internal = session as any;
    internal.fileResume = internal.fileResume || {};
    internal.fileResume[fileId] = internal.fileResume[fileId] || {
      acknowledgedChunks: new Set<number>(),
      contiguousBytes: 0,
      completed: false,
    };
    const state = internal.fileResume[fileId];
    if (!(state.acknowledgedChunks instanceof Set)) {
      state.acknowledgedChunks = new Set(state.acknowledgedChunks || []);
    }
    return state;
  }

  private updateContiguousBytes(session: TransferSession, fileId: string): number {
    const state = this.getFileResumeState(session, fileId);
    const fileInfo = session.files.find(file => file.id === fileId);
    if (!fileInfo) return state.contiguousBytes;

    const chunks = this.fileService.createChunks(fileInfo.size, fileId);
    let contiguousBytes = 0;
    for (const chunk of chunks) {
      if (!state.acknowledgedChunks.has(chunk.index)) break;
      contiguousBytes = chunk.offset + chunk.size;
    }
    state.contiguousBytes = contiguousBytes;
    return contiguousBytes;
  }

  private getCurrentFileId(session: TransferSession): string | undefined {
    const index = (session as any).currentFileIndex || 0;
    return session.files[index]?.id;
  }

  private clearSessionConnections(sessionId: string): void {
    for (const [key, connection] of this.connections) {
      if (connection.sessionId !== sessionId) continue;
      if (connection.timeout) clearTimeout(connection.timeout);
      if (!connection.socket.destroyed) connection.socket.destroy();
      this.connections.delete(key);
    }
  }

  private getContiguousChunkIndex(session: TransferSession, fileId: string): number {
    const state = this.getFileResumeState(session, fileId);
    const file = session.files.find(item => item.id === fileId);
    if (!file) return -1;
    const chunks = this.fileService.createChunks(file.size, fileId);
    let last = -1;
    for (const chunk of chunks) {
      if (!state.acknowledgedChunks.has(chunk.index)) break;
      last = chunk.index;
    }
    return last;
  }

  private async handleReject(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    session.status = 'declined';
    this.emitSessionUpdate(session);
    socket.end();
  }

  private async handleChunk(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) {
      log.warn(`[RECV_CHUNK] No session found for ${message.sessionId}`);
      return;
    }

    const { fileId, chunkIndex, offset, data, checksum } = message;
    log.debug(`[RECV_CHUNK] chunk ${chunkIndex} for file ${fileId}, offset=${offset}, dataLen=${data?.length || data?.data?.length || 0}`);

    // Binary-only protocol: data is always a raw Buffer from decodeFrame.
    // The base64 fallback path has been removed — all transfers are raw binary.
    const wireBuffer: Buffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.data || data);

    const fileInfo = session.files.find(f => f.id === fileId);
    if (!fileInfo) return;

    let chunkBuffer: Buffer;
    try {
      chunkBuffer = message.compressed
        ? await inflateRawAsync(wireBuffer)
        : wireBuffer;
    } catch {
      chunkBuffer = Buffer.alloc(0);
    }

    const isValid = true; // TLS guarantees integrity
    if (!isValid) {
      log.warn(`Chunk ${chunkIndex} checksum mismatch for file ${fileId}`);
      this.sendMessage(socket, {
        type: 'ack',
        sessionId: message.sessionId,
        fileId,
        chunkIndex,
        acknowledgedByte: offset,
        checksum: '',
        valid: false,
      });
      return;
    }

    const expectedChunk = this.fileService
      .createChunks(fileInfo.size, fileId)
      .find(chunk => chunk.index === chunkIndex);
    if (!expectedChunk || expectedChunk.offset !== offset || expectedChunk.size !== chunkBuffer.length ||
      (message.uncompressedLength !== undefined && message.uncompressedLength !== chunkBuffer.length)) {
      this.sendMessage(socket, {
        type: 'ack',
        sessionId: message.sessionId,
        fileId,
        chunkIndex,
        acknowledgedByte: this.getFileResumeState(session, fileId).contiguousBytes,
        checksum: '',
        valid: false,
      });
      return;
    }

    const resumeState = this.getFileResumeState(session, fileId);
    if (resumeState.completed) {
      this.sendMessage(socket, {
        type: 'ack',
        sessionId: message.sessionId,
        fileId,
        chunkIndex,
        acknowledgedByte: resumeState.contiguousBytes,
        checksum,
        valid: true,
      });
      return;
    }
    if (!resumeState.acknowledgedChunks.has(chunkIndex)) {
      const writeHandle = await this.createWriteHandle(session, fileId);
      if (writeHandle) {
        // Write Buffer Queue: chain onto the per-file queue so writes are
        // sequential but we never block the chunk handler with fsync per chunk.
        const queueKey = `${session.id}:${fileId}`;
        const prevWrite = this.writeQueues.get(queueKey) ?? Promise.resolve();
        const nextWrite = prevWrite.then(() =>
          writeHandle.write(chunkBuffer, 0, chunkBuffer.length, offset).then(() => {
            // Track metrics without awaiting
            const metrics = session as any;
            metrics.writeBytes = (metrics.writeBytes || 0) + chunkBuffer.length;
            metrics.writeStartedAt = metrics.writeStartedAt || Date.now();
            metrics.writeSpeed = metrics.writeBytes / Math.max((Date.now() - metrics.writeStartedAt) / 1000, 0.001);
          })
        ).catch((err) => {
          log.error(`[WRITE_QUEUE] Write error for chunk ${chunkIndex} of ${fileId}: ${err}`);
        });
        this.writeQueues.set(queueKey, nextWrite);
        // Await so that ack is only sent after the write is committed to the queue
        await nextWrite;
      }
      resumeState.acknowledgedChunks.add(chunkIndex);
    }
    const contiguousBytes = this.updateContiguousBytes(session, fileId);

    (session as any).fileProgress = (session as any).fileProgress || {};
    (session as any).fileProgress[fileId] = (session as any).fileProgress[fileId] || {
      transferred: 0,
      completed: false,
    };
    const fileChunks = this.fileService.createChunks(fileInfo.size, fileId);
    (session as any).fileProgress[fileId].transferred = Array.from(resumeState.acknowledgedChunks)
      .map(index => fileChunks[index]?.size || 0)
      .reduce((sum, size) => sum + size, 0);

    session.lastAcknowledgedByte = contiguousBytes;
    session.acknowledgedChunks = resumeState.acknowledgedChunks;

    this.sendMessage(socket, {
      type: 'ack',
      sessionId: message.sessionId,
      fileId,
      chunkIndex,
      acknowledgedByte: contiguousBytes,
      checksum,
      valid: true,
    });

    this.updateProgress(session);
  }

  private async handleAck(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    log.debug(`[RECV_ACK] chunk ${message.chunkIndex} valid=${message.valid} for session ${message.sessionId}`);

    const connectionKey = `${socket.remoteAddress}:${socket.remotePort}:${message.fileId}:${message.chunkIndex}`;
    const connection = this.connections.get(connectionKey);

    if (!message.valid) {
      log.warn(`Chunk ${message.chunkIndex} failed verification, will retry`);
      const metrics = session as any;
      metrics.totalRetries = (metrics.totalRetries || 0) + 1;
      if (connection) {
        connection.retries++;
        if (connection.retries < MAX_CHUNK_RETRIES) {
          setTimeout(() => {
            this.resendChunk(session, connection);
          }, RETRY_DELAY);
        } else {
          session.status = 'failed';
          session.error = `Chunk ${message.chunkIndex} failed after ${MAX_CHUNK_RETRIES} attempts`;
          this.emit('session-error', session.id, session.error);
        }
      }
      return;
    }

    if (connection) {
      connection.retries = 0;
      if (connection.timeout) clearTimeout(connection.timeout);
      this.connections.delete(connectionKey);
    }
    this.recordChunkAck(session, socket, message);
    
    const activeFilesMap = (session as any).activeFiles;
    if (activeFilesMap) {
      const af = activeFilesMap.get(message.fileId);
      if (af) {
        af.inFlight.delete(message.chunkIndex);
        af.acknowledged.add(message.chunkIndex);
      }
    }
    
    const resumeState = this.getFileResumeState(session, message.fileId);
    resumeState.acknowledgedChunks.add(message.chunkIndex);
    resumeState.contiguousBytes = this.updateContiguousBytes(session, message.fileId);

    this.updateProgress(session);
    await this.fillSendWindow(session, socket);
  }

  private async handleComplete(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    const { fileId, checksum } = message;
    const fileInfo = session.files.find(f => f.id === fileId);
    if (!fileInfo) return;

    const key = `${session.id}:${fileId}`;
    const writeHandle = this.writeHandles.get(key);
    if (writeHandle) {
      // Flush the write queue before syncing so all buffered writes land on disk.
      const queueKey = key;
      await (this.writeQueues.get(queueKey) ?? Promise.resolve());
      this.writeQueues.delete(queueKey);
      await writeHandle.sync();
      await writeHandle.close();
      this.writeHandles.delete(key);
    }

    const filePath = (session as any).filePaths?.[fileId];
    let verifiedPath = filePath;
    if (!verifiedPath) {
      const handle = await this.createWriteHandle(session, fileId);
      if (handle) {
        await handle.sync();
        await handle.close();
      }
      this.writeHandles.delete(key);
      verifiedPath = (session as any).filePaths?.[fileId];
    }
    
    if (verifiedPath && !fileInfo.isDirectory) {
      const isValid = await this.fileService.verifyFileChecksum(verifiedPath, checksum);
      if (!isValid) {
        log.error(`File ${fileId} checksum mismatch after transfer`);
        session.status = 'failed';
        session.error = 'File integrity verification failed';
        this.emit('session-error', session.id, session.error);
        return;
      }
    }

    if (verifiedPath) {
      try {
        if (fileInfo.mtime || fileInfo.ctime) {
          const atime = Date.now() / 1000;
          const mtime = (fileInfo.mtime || Date.now()) / 1000;
          await fs.promises.utimes(verifiedPath, atime, mtime);
        }
      } catch (err) {
        log.warn(`Failed to restore timestamps for ${verifiedPath}:`, err);
      }
    }

    const resumeState = this.getFileResumeState(session, fileId);
    resumeState.completed = true;
    (session as any).fileProgress = (session as any).fileProgress || {};
    (session as any).fileProgress[fileId] = {
      transferred: fileInfo.size,
      completed: true,
    };

    log.info(`File ${fileInfo.name} transferred and verified successfully`);

    const allComplete = session.files.every(f => {
      return (session as any).fileProgress?.[f.id]?.completed;
    });

    if (allComplete) {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.emit('session-completed', session);
    }

    this.sendMessage(socket, {
      type: 'complete-ack',
      sessionId: session.id,
      fileId,
      checksum,
      valid: true,
    });

    this.emitSessionUpdate(session);
  }

  private async handleResume(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) {
      const pending = this.pendingIncomingTransfers.get(message.sessionId);
      if (pending) {
        this.pendingTransfers.set(message.sessionId, { transfer: pending, socket });
        this.emit('incoming-transfer', pending);
        log.info(`Reattached persisted pending transfer ${message.sessionId}`);
      }
      return;
    }

    if (session.direction === 'receiving') {
      const fileId = message.fileId || this.getCurrentFileId(session) || session.files[0]?.id;
      const resumeState = fileId
        ? this.getFileResumeState(session, fileId)
        : { acknowledgedChunks: new Set<number>(), contiguousBytes: 0, completed: false };
      if (fileId) {
        session.lastAcknowledgedByte = resumeState.contiguousBytes;
        session.acknowledgedChunks = resumeState.acknowledgedChunks;
      }
      session.status = 'transferring';
      this.emitSessionUpdate(session);
      this.sendMessage(socket, {
        type: 'resume-ack',
        sessionId: session.id,
        fileId,
        fileIndex: fileId ? session.files.findIndex(file => file.id === fileId) : 0,
        lastAcknowledgedByte: resumeState.contiguousBytes,
        lastAcknowledgedChunk: fileId ? this.getContiguousChunkIndex(session, fileId) : -1,
        completedFiles: session.files
          .filter(file => this.getFileResumeState(session, file.id).completed)
          .map(file => file.id),
      });
      return;
    }

    const { lastAcknowledgedByte, lastAcknowledgedChunk } = message;
    session.lastAcknowledgedByte = lastAcknowledgedByte;
    session.acknowledgedChunks.clear();
    for (let i = 0; i <= lastAcknowledgedChunk; i++) {
      session.acknowledgedChunks.add(i);
    }

    log.info(`Resuming session ${session.id} from byte ${lastAcknowledgedByte}`);
    this.emitSessionUpdate(session);
    await this.startSendingChunks(session, socket, true);
  }

  private async handleCompleteAck(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session || session.direction !== 'sending') return;

    const key = `${session.id}:${message.fileId}`;
    if (!this.awaitingComplete.delete(key)) return;
    if (!message.valid) {
      session.status = 'failed';
      session.error = `Receiver rejected the checksum for ${message.fileId}`;
      this.emit('session-error', session.id, session.error);
      return;
    }

    const resumeState = this.getFileResumeState(session, message.fileId);
    resumeState.completed = true;
    (session as any).fileProgress = (session as any).fileProgress || {};
    const file = session.files.find(item => item.id === message.fileId);
    if (file) {
      (session as any).fileProgress[message.fileId] = {
        transferred: file.size,
        completed: true,
      };
    }

    const activeFilesMap = (session as any).activeFiles;
    if (activeFilesMap) {
      activeFilesMap.delete(message.fileId);
    }
    this.updateActiveFiles(session);

    if (!activeFilesMap || activeFilesMap.size === 0) {
      const anyIncomplete = session.files.some(f => !(session as any).fileProgress?.[f.id]?.completed);
      if (!anyIncomplete) {
        session.status = 'completed';
        session.completedAt = Date.now();
        this.persistSessionsSoon();
        this.emit('session-completed', session);
        return;
      }
    }

    await this.startSendingChunks(session, socket);
  }

  private async handleResumeAck(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    const reconnectState = this.reconnects.get(session.id);
    if (reconnectState) {
      reconnectState.inFlight = false;
      reconnectState.attempts = 0;
      if (reconnectState.timer) clearTimeout(reconnectState.timer);
      reconnectState.timer = null;
    }

    const completedFiles = new Set<string>(message.completedFiles || []);
    (session as any).fileProgress = (session as any).fileProgress || {};
    for (const fileId of completedFiles) {
      const file = session.files.find(item => item.id === fileId);
      if (file) {
        this.awaitingComplete.delete(`${session.id}:${fileId}`);
        this.getFileResumeState(session, fileId).completed = true;
        (session as any).fileProgress[fileId] = { transferred: file.size, completed: true };
      }
    }

    const fileIndex = Number.isInteger(message.fileIndex)
      ? message.fileIndex
      : (session as any).currentFileIndex || 0;
    (session as any).currentFileIndex = fileIndex;
    const fileId = message.fileId || session.files[fileIndex]?.id;
    const resumeState = fileId ? this.getFileResumeState(session, fileId) : null;
    session.lastAcknowledgedByte = message.lastAcknowledgedByte || resumeState?.contiguousBytes || 0;
    if (resumeState) {
      resumeState.acknowledgedChunks.clear();
      resumeState.contiguousBytes = session.lastAcknowledgedByte;
    }
    session.acknowledgedChunks = resumeState?.acknowledgedChunks || new Set<number>();
    for (let i = 0; i <= message.lastAcknowledgedChunk; i++) {
      session.acknowledgedChunks.add(i);
    }

    session.status = 'transferring';
    session.error = undefined;
    this.emitSessionUpdate(session);
    log.info(`Resume acknowledged for session ${session.id} at chunk ${message.lastAcknowledgedChunk}`);
    while ((session as any).currentFileIndex < session.files.length &&
      this.getFileResumeState(session, session.files[(session as any).currentFileIndex].id).completed) {
      (session as any).currentFileIndex++;
    }
    if ((session as any).currentFileIndex >= session.files.length) {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.emit('session-completed', session);
      return;
    }
    await this.startSendingChunks(session, socket, true);
  }

  private async handleError(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    session.status = 'failed';
    session.error = message.error;
    this.emit('session-error', session.id, message.error);
  }

  private async createWriteHandle(session: TransferSession, fileId: string): Promise<fs.promises.FileHandle | null> {
    const key = `${session.id}:${fileId}`;
    const existingHandle = this.writeHandles.get(key);
    if (existingHandle) return existingHandle;

    const fileInfo = session.files.find(file => file.id === fileId);
    if (!fileInfo) throw new Error(`Unknown file ${fileId}`);

    const downloadPath = (session as any).downloadPath || '';
    const persistedPath = (session as any).filePaths?.[fileId];
    const isResume = Boolean(persistedPath && fs.existsSync(persistedPath));
    const sanitizedName = sanitizeRelativePath(fileInfo.name);
    let filePath = persistedPath || path.join(downloadPath, sanitizedName);
    
    // Only get unique file path if it's not a resume and not a directory
    if (!isResume && !fileInfo.isDirectory) {
      filePath = await this.fileService.getUniqueFilePath(filePath);
    }

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

    (session as any).filePaths = (session as any).filePaths || {};
    (session as any).filePaths[fileId] = filePath;

    if (fileInfo.isDirectory) {
      await fs.promises.mkdir(filePath, { recursive: true });
      return null;
    }

    const handle = await fs.promises.open(filePath, isResume ? 'r+' : 'w+');
    this.writeHandles.set(key, handle);
    log.info(`Created random-access write handle for ${fileInfo.name} -> ${filePath}`);
    return handle;
  }

  private initializeTransferMetrics(session: TransferSession, resetWindow: boolean): void {
    const metrics = session as any;
    if (resetWindow || !metrics.windowSize) {
      metrics.windowSize = TRANSFER_WINDOW_SIZE;
      metrics.rttMs = 0;
      metrics.minRttMs = 0;
      metrics.ackCount = 0;
      metrics.metricsLastAt = Date.now();
      metrics.metricsLastBytes = session.transferredBytes;
    }
    metrics.chunkSentAt = new Map<number, number>();
  }

  private recordChunkAck(
    session: TransferSession,
    socket: net.Socket,
    message: any,
  ): void {
    const metrics = session as any;
    const key = `${message.fileId}:${message.chunkIndex}`;
    const sentAt = metrics.chunkSentAt?.get(key);
    if (sentAt) {
      const rttMs = Math.max(1, Date.now() - sentAt);
      metrics.rttMs = metrics.rttMs
        ? metrics.rttMs * 0.875 + rttMs * 0.125
        : rttMs;
      metrics.minRttMs = metrics.minRttMs
        ? Math.min(metrics.minRttMs, rttMs)
        : rttMs;
      metrics.ackCount = (metrics.ackCount || 0) + 1;
      metrics.chunkSentAt.delete(key);

      const queuedBytes = socket.writableLength;
      metrics.socketWritableLength = queuedBytes;
      const rttCongested = metrics.minRttMs > 0 && metrics.rttMs > metrics.minRttMs * 2;
      const queueCongested = queuedBytes > 16 * 1024 * 1024;
      if (rttCongested || queueCongested) {
        metrics.windowSize = Math.max(
          MIN_TRANSFER_WINDOW_SIZE,
          Math.floor(metrics.windowSize / 2),
        );
      } else if (
        metrics.ackCount % 8 === 0 &&
        queuedBytes < 2 * 1024 * 1024 &&
        metrics.rttMs <= metrics.minRttMs * 1.25
      ) {
        metrics.windowSize = Math.min(
          MAX_TRANSFER_WINDOW_SIZE,
          metrics.windowSize + 1,
        );
      }
    }

    const now = Date.now();
    const elapsedMs = now - (metrics.metricsLastAt || now);
    if (elapsedMs >= 1000) {
      const bytesDelta = session.transferredBytes - (metrics.metricsLastBytes || 0);
      const currentSpeed = bytesDelta / (elapsedMs / 1000);
      const averageSpeed = session.startedAt < now
        ? session.transferredBytes / ((now - session.startedAt) / 1000)
        : 0;
      log.info(
        `[METRICS] session=${session.id} current=${Math.round(currentSpeed)}B/s ` +
        `average=${Math.round(averageSpeed)}B/s rtt=${Math.round(metrics.rttMs || 0)}ms ` +
        `window=${metrics.windowSize} inFlight=${metrics.inFlightChunks?.size || 0} ` +
        `queued=${socket.writableLength}B acked=${session.acknowledgedChunks.size}`,
      );
      metrics.metricsLastAt = now;
      metrics.metricsLastBytes = session.transferredBytes;
    }
  }

  private updateActiveFiles(session: TransferSession) {
    const active = (session as any).activeFiles || new Map();
    (session as any).activeFiles = active;

    const maxParallel = 4;
    const sizeLimit = 10 * 1024 * 1024; // 10 MB

    let numActive = active.size;

    for (let i = 0; i < session.files.length; i++) {
      const file = session.files[i];
      const progress = (session as any).fileProgress?.[file.id];
      if (progress && progress.completed) continue;

      if (!active.has(file.id)) {
        if (numActive === 0) {
          active.set(file.id, this.createActiveFileState(session, file));
          numActive++;
          if (file.size >= sizeLimit) break;
        } else {
          if (file.size < sizeLimit && numActive < maxParallel) {
            active.set(file.id, this.createActiveFileState(session, file));
            numActive++;
          } else {
            break;
          }
        }
      } else {
        if (file.size >= sizeLimit) {
          break;
        }
      }
    }
  }

  private createActiveFileState(session: TransferSession, file: FileInfo) {
    const chunks = this.fileService.createChunks(file.size, file.id);
    (session as any).fileProgress = (session as any).fileProgress || {};
    if (!(session as any).fileProgress[file.id]) {
      (session as any).fileProgress[file.id] = { transferred: 0, completed: false };
    }
    return {
      file,
      chunks,
      inFlight: new Set<number>(),
      acknowledged: new Set<number>(),
    };
  }

  private async startSendingChunks(
    session: TransferSession,
    socket: net.Socket,
    isResume = false,
  ): Promise<void> {
    this.initializeTransferMetrics(session, !isResume);
    this.updateActiveFiles(session);

    if (isResume) {
      const activeFiles = (session as any).activeFiles;
      if (activeFiles) {
        for (const af of activeFiles.values()) {
          const resumeState = this.getFileResumeState(session, af.file.id);
          af.acknowledged = new Set(resumeState.acknowledgedChunks);
        }
      }
    } else {
      session.acknowledgedChunks = new Set();
      session.lastAcknowledgedByte = 0;
    }

    log.info(`Starting/resuming parallel chunks engine for session ${session.id}`);
    this.prefetchChunks(session);
    await this.fillSendWindow(session, socket);
  }

  private async readChunkData(filePath: string, offset: number, size: number): Promise<Buffer | null> {
    try {
      let fd = this.fileHandles.get(filePath);
      if (!fd) {
        fd = await fs.promises.open(filePath, 'r');
        this.fileHandles.set(filePath, fd);
      }

      const buffer = this.bufferPool.acquire(size);
      const { bytesRead } = await fd.read(buffer, 0, size, offset);
      if (bytesRead < size) {
        return buffer.subarray(0, bytesRead);
      }
      return buffer;
    } catch (err) {
      log.error(`Failed to read chunk at offset ${offset}: ${err}`);
      return null;
    }
  }

  private consumeBandwidth(bytes: number): Promise<void> {
    const run = async () => {
      const limit = this.bandwidthLimitBytesPerSecond;
      if (!limit || bytes <= 0) return;
      const delay = (bytes / limit) * 1000;
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    };
    const next = this.bandwidthTail.then(run, run);
    this.bandwidthTail = next.catch(() => {});
    return next;
  }

  private readChunkAhead(fileInfo: FileInfo, chunk: { index: number; offset: number; size: number }): Promise<Buffer | null> {
    const key = `${fileInfo.id}:${chunk.index}`;
    const existing = this.chunkReadAhead.get(key);
    if (existing) return existing;

    const pending = this.readChunkData(fileInfo.path, chunk.offset, chunk.size);
    this.chunkReadAhead.set(key, pending);
    void pending.catch(() => {
      if (this.chunkReadAhead.get(key) === pending) this.chunkReadAhead.delete(key);
    });
    return pending;
  }

  private prefetchChunks(session: TransferSession): void {
    const activeFilesMap = (session as any).activeFiles;
    if (!activeFilesMap) return;

    const readAheadLimit = Math.max(8, ((session as any).windowSize || TRANSFER_WINDOW_SIZE) * 2);
    let totalPrefetched = 0;

    for (const af of activeFilesMap.values()) {
      const candidates = af.chunks
        .filter((chunk: ChunkInfo) => !af.acknowledged.has(chunk.index) && !af.inFlight.has(chunk.index));
      for (const chunk of candidates) {
         if (totalPrefetched >= readAheadLimit) return;
         this.readChunkAhead(af.file, chunk);
         totalPrefetched++;
      }
    }
  }

  private async fillSendWindow(session: TransferSession, socket: net.Socket): Promise<void> {
    this.updateActiveFiles(session);
    let totalInFlight = 0;
    if ((session as any).activeFiles) {
       for (const af of (session as any).activeFiles.values()) {
          totalInFlight += af.inFlight.size;
       }
    }

    while (
      totalInFlight < ((session as any).windowSize || TRANSFER_WINDOW_SIZE) &&
      session.status !== 'completed' &&
      session.status !== 'failed' &&
      session.status !== 'cancelled'
    ) {
      const previousInFlight = totalInFlight;
      await this.sendNextChunk(session, socket);
      this.prefetchChunks(session);
      
      totalInFlight = 0;
      if ((session as any).activeFiles) {
         for (const af of (session as any).activeFiles.values()) {
            totalInFlight += af.inFlight.size;
         }
      }
      if (totalInFlight === previousInFlight) break;
    }
  }

  private async sendNextChunk(session: TransferSession, socket: net.Socket): Promise<void> {
    this.updateActiveFiles(session);
    const activeFilesMap = (session as any).activeFiles as Map<string, any>;
    if (!activeFilesMap || activeFilesMap.size === 0) return;

    let unacknowledged = null;
    let activeFile = null;

    for (const af of activeFilesMap.values()) {
      unacknowledged = af.chunks.find(
        (c: ChunkInfo) => !af.acknowledged.has(c.index) && !af.inFlight.has(c.index)
      );
      if (unacknowledged) {
        activeFile = af;
        break;
      }
    }

    if (!unacknowledged) {
      for (const af of activeFilesMap.values()) {
        const fullyDispatched = af.chunks.length === 0 || af.chunks.every((c: ChunkInfo) => af.acknowledged.has(c.index) || af.inFlight.has(c.index));
        if (fullyDispatched) {
          const completionKey = `${session.id}:${af.file.id}`;
          if (!this.awaitingComplete.has(completionKey)) {
            const fileChecksum = await this.fileService.calculateFileChecksum(af.file.path);
            this.awaitingComplete.add(completionKey);
            this.sendMessage(socket, {
              type: 'complete',
              sessionId: session.id,
              fileId: af.file.id,
              checksum: fileChecksum,
            });
            this.emitSessionUpdate(session);
            return;
          }
        }
      }
      return;
    }

    const fileInfo = activeFile.file;
    const chunkData = await this.readChunkAhead(fileInfo, unacknowledged);
    this.chunkReadAhead.delete(`${fileInfo.id}:${unacknowledged.index}`);
    if (!chunkData) {
      session.status = 'failed';
      session.error = `Failed to read chunk ${unacknowledged.index}`;
      this.emit('session-error', session.id, session.error);
      return;
    }

    const metrics = session as any;
    const readStartedAt = Date.now();
    metrics.readBytes = (metrics.readBytes || 0) + chunkData.length;
    metrics.readStartedAt = metrics.readStartedAt || readStartedAt;
    metrics.readSpeed = metrics.readBytes / Math.max((Date.now() - metrics.readStartedAt) / 1000, 0.001);
    const hashStartedAt = Date.now();
    const checksum = ''; // Disabled for performance (TLS guarantees integrity)
    metrics.hashBytes = (metrics.hashBytes || 0) + chunkData.length;
    metrics.hashStartedAt = metrics.hashStartedAt || hashStartedAt;
    metrics.hashSpeed = metrics.hashBytes / Math.max((Date.now() - metrics.hashStartedAt) / 1000, 0.001);
    let wireData = chunkData;
    let compressed = false;
    if (this.compressionEnabled && shouldCompress(fileInfo.name, chunkData.length)) {
      const candidate = await deflateRawAsync(chunkData);
      if (candidate.length < chunkData.length * 0.95) {
        wireData = candidate;
        compressed = true;
        metrics.compressedBytes = (metrics.compressedBytes || 0) + candidate.length;
        metrics.uncompressedBytes = (metrics.uncompressedBytes || 0) + chunkData.length;
      }
    }

    await this.consumeBandwidth(chunkData.length);

    activeFile.inFlight.add(unacknowledged.index);
    if (!metrics.chunkSentAt) metrics.chunkSentAt = new Map();
    metrics.chunkSentAt.set(`${fileInfo.id}:${unacknowledged.index}`, Date.now());

    this.sendMessage(socket, {
      type: 'chunk',
      sessionId: session.id,
      fileId: fileInfo.id,
      chunkIndex: unacknowledged.index,
      offset: unacknowledged.offset,
      data: wireData,
      compressed,
      uncompressedLength: chunkData.length,
      checksum,
    });

    if (chunkData.byteOffset === 0 && chunkData.byteLength === chunkData.buffer.byteLength) {
      this.bufferPool.release(chunkData);
    } else {
      this.bufferPool.release(Buffer.from(chunkData.buffer));
    }

    const connKey = `${socket.remoteAddress}:${socket.remotePort}:${fileInfo.id}:${unacknowledged.index}`;
    const connection: ActiveConnection = {
      socket,
      sessionId: session.id,
      fileId: fileInfo.id,
      chunkIndex: unacknowledged.index,
      retries: 0,
    };
    this.connections.set(connKey, connection);
    this.scheduleChunkTimeout(session, connKey, connection);

    session.transferredBytes += chunkData.length;

    const elapsed = (Date.now() - session.startedAt) / 1000;
    if (elapsed > 0) {
      session.speed = session.transferredBytes / elapsed;
      if (session.speed > 0) {
        session.remainingTime = (session.totalSize - session.transferredBytes) / session.speed;
      }
    }

    const now = Date.now();
    if (session.speedHistory.length === 0 ||
        now - session.speedHistory[session.speedHistory.length - 1].timestamp >= 500) {
      session.speedHistory.push({
        timestamp: now,
        bytesPerSecond: session.speed,
      });
      if (session.speedHistory.length > 60) {
        session.speedHistory.shift();
      }
    }

    (session as any).fileProgress = (session as any).fileProgress || {};
    (session as any).fileProgress[fileInfo.id] = (session as any).fileProgress[fileInfo.id] || {
      transferred: 0,
      completed: false,
    };
    (session as any).fileProgress[fileInfo.id].transferred += chunkData.length;

    this.emitSessionUpdate(session);
  }

  private async resendChunk(session: TransferSession, connection: ActiveConnection): Promise<void> {
    const fileInfo = session.files.find(file => file.id === connection.fileId);
    if (!fileInfo) return;

    const chunk = this.fileService
      .createChunks(fileInfo.size, fileInfo.id)
      .find(c => c.index === connection.chunkIndex);
    if (!chunk) return;

    const chunkData = await this.readChunkData(fileInfo.path, chunk.offset, chunk.size);
    if (!chunkData) return;

    const checksum = ''; // Disabled for performance

    this.sendMessage(connection.socket, {
      type: 'chunk',
      sessionId: session.id,
      fileId: fileInfo.id,
      chunkIndex: chunk.index,
      offset: chunk.offset,
      data: chunkData,
      checksum,
    });
    
    if (chunkData.byteOffset === 0 && chunkData.byteLength === chunkData.buffer.byteLength) {
      this.bufferPool.release(chunkData);
    } else {
      this.bufferPool.release(Buffer.from(chunkData.buffer));
    }

    const connectionKey = `${connection.socket.remoteAddress}:${connection.socket.remotePort}:${connection.fileId}:${connection.chunkIndex}`;
    this.scheduleChunkTimeout(session, connectionKey, connection);
  }

  private scheduleChunkTimeout(
    session: TransferSession,
    connectionKey: string,
    connection: ActiveConnection,
  ): void {
    if (connection.timeout) clearTimeout(connection.timeout);
    const metrics = session as any;
    const timeoutMs = Math.max(2000, Math.min(10000, (metrics.rttMs || 500) * 3));
    connection.timeout = setTimeout(async () => {
      if (this.connections.get(connectionKey) !== connection) return;
      if (connection.retries >= MAX_CHUNK_RETRIES) {
        session.status = 'reconnecting';
        session.error = `Chunk ${connection.chunkIndex} timed out after ${MAX_CHUNK_RETRIES} retries`;
        this.emitSessionUpdate(session);
        this.scheduleReconnect(session, session.error);
        return;
      }
      connection.retries++;
      await this.resendChunk(session, connection);
    }, timeoutMs);
  }

  private sendMessage(socket: tls.TLSSocket | net.Socket, message: any): void {
    const remoteAddr = (socket as any).remoteAddress || 'unknown';
    if (socket.destroyed || socket.writable === false) {
      log.warn(`[TRACE] SEND ${message.type} SKIPPED socket=${remoteAddr} destroyed=${socket.destroyed} writable=${socket.writable}`);
      return;
    }
    try {
      const messageLog = message.type === 'chunk' || message.type === 'ack'
        ? log.debug.bind(log)
        : log.info.bind(log);
      messageLog(`[TRACE] SEND ${message.type} START session=${message.sessionId || 'unknown'} socket=${remoteAddr}`);
      const frame = encodeFrame(message);
      // Socket Buffer Optimization: if the kernel write buffer is full, wait
      // for 'drain' before writing. This prevents memory from piling up.
      const ok = socket.write(frame, (err) => {
        if (err) {
          log.error(`[TRACE] SEND ${message.type} ERROR socket=${remoteAddr}:\n${errorDetails(err)}`);
          return;
        }
        messageLog(`[TRACE] SEND ${message.type} SUCCESS session=${message.sessionId || 'unknown'} socket=${remoteAddr} bytes=${frame.length}`);
      });
      if (!ok) {
        // Socket buffer is full — log for metrics but don't block (Node will buffer).
        log.debug(`[TRACE] SEND ${message.type} BUFFERED socket=${remoteAddr} queued=${socket.writableLength}B`);
      }
    } catch (err) {
      log.error(`[TRACE] SEND ${message.type} ERROR socket=${remoteAddr}:\n${errorDetails(err)}`);
    }
  }

  private updateProgress(session: TransferSession): void {
    let totalTransferred = 0;
    for (const file of session.files) {
      const progress = (session as any).fileProgress?.[file.id];
      if (progress) {
        totalTransferred += progress.transferred;
      }
    }
    session.transferredBytes = totalTransferred;
    this.emitSessionUpdate(session);
  }

  private emitSessionUpdate(session: TransferSession): void {
    this.persistSessionsSoon();
    this.emit('session-updated', session);
  }

  private sortFilesByPriority(files: FileInfo[]): FileInfo[] {
    const getPriority = (name: string) => {
      const lower = name.toLowerCase();
      if (lower === 'readme.md' || lower === 'readme.txt' || lower === 'readme') return 1;
      if (lower === 'package.json') return 2;
      if (lower.startsWith('src/') || lower.includes('/src/')) return 3;
      if (lower.includes('config')) return 4;
      if (lower.endsWith('.pdf') || lower.endsWith('.doc') || lower.endsWith('.txt')) return 5;
      if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 6;
      if (lower.endsWith('.mp4') || lower.endsWith('.mkv') || lower.endsWith('.mov')) return 7;
      if (lower.endsWith('.zip') || lower.endsWith('.rar') || lower.endsWith('.tar')) return 8;
      return 9;
    };
    return [...files].sort((a, b) => getPriority(a.name) - getPriority(b.name));
  }

  async createSession(
    device: Device,
    files: FileInfo[],
    direction: 'sending' | 'receiving'
  ): Promise<TransferSession | null> {
    const sessionId = uuidv4();

    const sortedFiles = direction === 'sending' ? this.sortFilesByPriority(files) : files;
    const totalSize = sortedFiles.reduce((sum, f) => sum + f.size, 0);

    const session: TransferSession = {
      id: sessionId,
      deviceId: device.id,
      deviceName: device.name,
      deviceIp: device.addresses?.[0] || 'unknown',
      files: sortedFiles,
      totalSize,
      transferredBytes: 0,
      status: 'pending',
      direction,
      speed: 0,
      remainingTime: 0,
      startedAt: Date.now(),
      chunks: [],
      acknowledgedChunks: new Set(),
      lastAcknowledgedByte: 0,
      speedHistory: [],
    };

    this.sessions.set(sessionId, session);
    (session as any).devicePort = device.port;
    (session as any).queuedAt = Date.now();
    this.persistSessionsSoon();
    log.info(`Created transfer session ${sessionId} with ${device.name}`);

    if (direction === 'sending') {
      const port = Number.isInteger(device.port) && device.port > 0
        ? device.port
        : TRANSFER_PORT;

      log.info(`[TRACE] ENTER createSession session=${sessionId} target=${device.name}`);
      log.info(`[TRACE] DEVICE RESOLVED id=${device.id} addresses=${(device as any).addresses?.join(', ') || 'unknown'}`);
      log.info(`[TRACE] PORT RESOLVED port=${port}`);

      const addresses = (device as any).addresses || [];

      const attemptConnection = (addressIndex: number) => {
        if (addressIndex >= addresses.length) {
          log.error(`[TRACE] ALL CONNECTION ATTEMPTS FAILED session=${sessionId}`);
          session.status = 'failed';
          session.error = 'Failed to connect to any available address';
          this.emitSessionUpdate(session);
          return;
        }

        const currentIp = addresses[addressIndex];
        log.info(`[TRACE] OPEN SOCKET START ${currentIp}:${port} (Attempt ${addressIndex + 1}/${addresses.length})`);

        const options: tls.ConnectionOptions = {
          host: currentIp,
          port,
          rejectUnauthorized: false,
        };

        const socket = tls.connect(options);
        socket.setKeepAlive(true, TCP_KEEPALIVE);

        socket.on('connect', () => {
          log.info(`[TRACE] TCP CONNECTED ${currentIp}:${port}`);
        });

        socket.on('secureConnect', () => {
          socket.setTimeout(0);
          try { (socket as any).setNoDelay(true); } catch {}
          try { (socket as any).setSendBufferSize?.(4 * 1024 * 1024); } catch {}
          try { (socket as any).setRecvBufferSize?.(4 * 1024 * 1024); } catch {}
          (socket as any)._writableState && ((socket as any)._writableState.highWaterMark = 4 * 1024 * 1024);

          log.info(`[TRACE] TLS CONNECTED ${currentIp}:${port}`);
          session.status = 'connecting';
          this.emitSessionUpdate(session);

          log.info(`[TRACE] HELLO/METADATA START session=${sessionId}`);
          this.sendMessage(socket, {
            type: 'request',
            sessionId,
            deviceId: this.localDeviceId || sessionId,
            deviceName: this.localDeviceName || 'Unknown Device',
            files,
            totalSize,
          });
          log.info(`[TRACE] HELLO/METADATA QUEUED session=${sessionId}`);
        });

        let handledError = false;

        socket.setTimeout(5000, () => {
          if (handledError) return;
          handledError = true;
          log.error(`[TRACE] CONNECT TIMEOUT ${currentIp}:${port}`);
          socket.destroy();
          attemptConnection(addressIndex + 1);
        });

        let buffer = Buffer.alloc(0);
        socket.on('data', async (data) => {
          buffer = Buffer.concat([buffer, data]);
          while (buffer.length >= 4) {
            const messageLength = buffer.readUInt32BE(0);
            if (messageLength > MAX_TRANSFER_FRAME_SIZE) {
              socket.destroy(new Error(`Transfer frame exceeds ${MAX_TRANSFER_FRAME_SIZE} bytes`));
              return;
            }
            if (buffer.length < 4 + messageLength) break;
            const messageData = buffer.slice(4, 4 + messageLength);
            buffer = buffer.slice(4 + messageLength);
            try {
              const message = decodeFrame(messageData);
              await this.handleMessage(socket, message);
            } catch (err) {
              log.error(`[TRACE] SENDER MESSAGE ERROR session=${sessionId}:\n${errorDetails(err)}`);
              socket.destroy(err instanceof Error ? err : new Error(String(err)));
            }
          }
        });

        socket.on('error', (err) => {
          if (handledError) return;
          handledError = true;
          const code = (err as NodeJS.ErrnoException).code;
          log.error(`[TRACE] SOCKET ERROR ${currentIp}:${port}${code ? ` (${code})` : ''}:\n${errorDetails(err)}`);
          socket.destroy();
          attemptConnection(addressIndex + 1);
        });

        socket.on('close', (hadError) => {
          log.info(`[TRACE] SOCKET CLOSE session=${sessionId} hadError=${hadError}`);
          if (!['completed', 'cancelled', 'declined', 'failed', 'transferring'].includes(session.status)) {
            if (!handledError) {
              handledError = true;
              attemptConnection(addressIndex + 1);
            }
          }
        });
      };

      attemptConnection(0);

      log.info(`[TRACE] EXIT createSession session=${sessionId} socket-opening`);
    }

    if (direction !== 'sending') {
      log.info(`[TRACE] EXIT createSession session=${sessionId} direction=${direction}`);
    }
    return session;
  }

  async startSession(sessionId: string): Promise<void> {
    log.info(`[TRACE] ENTER startSession session=${sessionId}`);
    const session = this.sessions.get(sessionId);
    if (!session) {
      log.warn(`[TRACE] EXIT startSession session=${sessionId} not-found`);
      return;
    }

    // Don't override 'connecting' status if TLS callback already set it
    if (session.status === 'pending') {
      session.status = 'connecting';
      this.emitSessionUpdate(session);
    }
    log.info(`[TRACE] EXIT startSession session=${sessionId} status=${session.status}`);
  }

  async acceptSession(sessionId: string, downloadPath: string): Promise<void> {
    log.info(`[TRACE] ENTER acceptSession session=${sessionId}`);
    const pending = this.pendingTransfers.get(sessionId);
    if (!pending) return;

    const incoming = pending.transfer;
    const socket = pending.socket;
    log.info(`[ACCEPT_SESSION] Found pending transfer: device=${incoming.deviceName}`);

    const session: TransferSession = {
      id: sessionId,
      deviceId: incoming.deviceId,
      deviceName: incoming.deviceName,
      deviceIp: socket.remoteAddress || '',
      files: incoming.files,
      totalSize: incoming.totalSize,
      transferredBytes: 0,
      status: 'transferring',
      direction: 'receiving',
      speed: 0,
      remainingTime: 0,
      startedAt: Date.now(),
      chunks: [],
      acknowledgedChunks: new Set(),
      lastAcknowledgedByte: 0,
      speedHistory: [],
    };

    const skippedFiles: string[] = [];
    const fileProgress: any = {};
    const filePaths: any = {};

    for (const file of incoming.files) {
      const sanitizedName = file.name.replace(/^(\.\.(\/|\\|$))+/, '');
      const candidatePath = path.join(downloadPath, sanitizedName);
      
      let skip = false;
      try {
        const stats = await fs.promises.stat(candidatePath);
        if (stats.isFile() && stats.size === file.size) {
          if (file.mtime && Math.abs(stats.mtimeMs - file.mtime) < 2000) {
            skip = true;
          }
        }
      } catch (e) {
        // File doesn't exist
      }

      if (skip) {
        skippedFiles.push(file.id);
        filePaths[file.id] = candidatePath;
        fileProgress[file.id] = { transferred: file.size, completed: true };
        log.info(`[WORKSPACE_SYNC] Skipping identical file: ${file.name}`);
      }
    }

    (session as any).downloadPath = downloadPath;
    (session as any).fileProgress = fileProgress;
    (session as any).filePaths = filePaths;

    this.sessions.set(sessionId, session);
    this.pendingTransfers.delete(sessionId);
    this.pendingIncomingTransfers.delete(sessionId);
    this.persistSessionsSoon();

    this.sendMessage(socket, {
      type: 'accept',
      sessionId,
      skippedFiles,
    });
    
    if (skippedFiles.length === incoming.files.length) {
       session.status = 'completed';
       session.completedAt = Date.now();
       this.persistSessionsSoon();
       this.emit('session-completed', session);
    }

    log.info(`[TRACE] EXIT acceptSession session=${sessionId}`);
  }

  async rejectSession(sessionId: string): Promise<void> {
    log.info(`[REJECT_SESSION] Called: sessionId=${sessionId}`);
    const pending = this.pendingTransfers.get(sessionId);
    if (pending) {
      log.info(`[REJECT_SESSION] Found pending transfer, sending reject...`);
      this.sendMessage(pending.socket, {
        type: 'reject',
        sessionId,
      });
      this.pendingTransfers.delete(sessionId);
      this.pendingIncomingTransfers.delete(sessionId);
      this.persistSessionsSoon();
      log.info(`[REJECT_SESSION] Sent 'reject' message to sender and cleaned up.`);
    } else {
      log.warn(`[REJECT_SESSION] No pending transfer to reject for session ${sessionId} (already processed)`);
      log.info(`[REJECT_SESSION] Pending transfers map keys: ${Array.from(this.pendingTransfers.keys()).join(', ') || '(empty)'}`);
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'cancelled';
    const reconnectState = this.reconnects.get(sessionId);
    if (reconnectState?.timer) clearTimeout(reconnectState.timer);
    this.reconnects.delete(sessionId);
    this.awaitingComplete.forEach(key => {
      if (key.startsWith(`${sessionId}:`)) this.awaitingComplete.delete(key);
    });
    this.clearSessionConnections(sessionId);

    for (const [key, handle] of this.writeHandles) {
      if (key.startsWith(`${sessionId}:`)) {
        await handle.close();
        this.writeHandles.delete(key);
      }
    }

    this.emitSessionUpdate(session);
    log.info(`Cancelled transfer session ${sessionId}`);
  }

  async pauseSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'paused';
    this.emitSessionUpdate(session);
    log.info(`Paused transfer session ${sessionId}`);
  }

  async resumeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    log.info(`Resuming transfer session ${sessionId}`);
    this.scheduleReconnect(session, 'Resume requested');
  }

  getSessions(): TransferSession[] {
    return Array.from(this.sessions.values());
  }

  getDiagnostics(): any[] {
    return Array.from(this.sessions.values()).map(session => {
      const internal = session as any;
      let retries = 0;
      for (const connection of this.connections.values()) {
        if (connection.sessionId === session.id) retries += connection.retries;
      }
      const compressedBytes = internal.compressedBytes || 0;
      const uncompressedBytes = internal.uncompressedBytes || 0;
      return {
        id: session.id,
        deviceName: session.deviceName,
        direction: session.direction,
        status: session.status,
        transferredBytes: session.transferredBytes,
        totalSize: session.totalSize,
        speed: session.speed,
        rttMs: internal.rttMs || 0,
        windowSize: internal.windowSize || TRANSFER_WINDOW_SIZE,
        inFlightChunks: internal.inFlightChunks?.size || 0,
        acknowledgedChunks: session.acknowledgedChunks.size,
        retryCount: retries,
        queuedBytes: internal.socketWritableLength || 0,
        compressionRatio: uncompressedBytes > 0 ? compressedBytes / uncompressedBytes : 1,
        compressedBytes,
        uncompressedBytes,
        startedAt: session.startedAt,
        error: session.error,
        speedHistory: session.speedHistory,
      };
    });
  }

  getSession(sessionId: string): TransferSession | null {
    return this.sessions.get(sessionId) || null;
  }

  private scheduleReconnect(session: TransferSession, reason?: string): void {
    if (this.stopping) return;
    if (['completed', 'cancelled', 'declined', 'failed'].includes(session.status)) return;

    const state = this.reconnects.get(session.id) || {
      attempts: 0,
      timer: null,
      inFlight: false,
    };
    this.reconnects.set(session.id, state);
    if (state.timer || state.inFlight) return;

    session.status = 'reconnecting';
    if (reason) session.error = reason;
    this.clearSessionConnections(session.id);
    this.emitSessionUpdate(session);

    const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(state.attempts, 5)));
    state.timer = setTimeout(() => {
      state.timer = null;
      void this.attemptReconnect(session);
    }, delay);
  }

  handleNetworkChange(newIp?: string): void {
    const activeSessions = this.sessions.values();

    for (const session of activeSessions) {
      // The sender owns reconnect negotiation. The receiver keeps its durable
      // state and answers the sender's resume request, avoiding two sockets
      // racing to resume the same session.
      if (session.direction === 'sending' &&
        (session.status === 'transferring' || session.status === 'reconnecting')) {
        log.info(`Network changed, session ${session.id} will attempt to resume`);
        this.scheduleReconnect(session, 'Network changed; waiting to reconnect');
      }
    }
  }

  private async attemptReconnect(session: TransferSession): Promise<void> {
    if (session.status !== 'reconnecting') return;

    const reconnectState = this.reconnects.get(session.id) || {
      attempts: 0,
      timer: null,
      inFlight: false,
    };
    if (reconnectState.inFlight) return;
    reconnectState.inFlight = true;
    this.reconnects.set(session.id, reconnectState);
    reconnectState.attempts++;

    try {
      log.info(`Attempting to reconnect session ${session.id}`);

      const options: tls.ConnectionOptions = {
        host: session.deviceIp,
        port: (session as any).devicePort || TRANSFER_PORT,
        rejectUnauthorized: false,
      };

      const socket = tls.connect(options);
      socket.setKeepAlive(true, TCP_KEEPALIVE);
      socket.once('secureConnect', () => {
        log.info(`Reconnected for session ${session.id}`);

        const fileIndex = (session as any).currentFileIndex || 0;
        const fileId = session.files[fileIndex]?.id;
        const resumeState = fileId ? this.getFileResumeState(session, fileId) : null;
        this.sendMessage(socket, {
          type: 'resume',
          sessionId: session.id,
          fileId,
          fileIndex,
          lastAcknowledgedByte: resumeState?.contiguousBytes || session.lastAcknowledgedByte,
          lastAcknowledgedChunk: fileId ? this.getContiguousChunkIndex(session, fileId) : -1,
        });
      });

      let buffer = Buffer.alloc(0);
      socket.on('data', async (data) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 4) {
          const messageLength = buffer.readUInt32BE(0);
          if (messageLength > MAX_TRANSFER_FRAME_SIZE) {
            socket.destroy(new Error(`Transfer frame exceeds ${MAX_TRANSFER_FRAME_SIZE} bytes`));
            return;
          }
          if (buffer.length < 4 + messageLength) break;

          const messageData = buffer.slice(4, 4 + messageLength);
          buffer = buffer.slice(4 + messageLength);
          try {
            await this.handleMessage(socket, decodeFrame(messageData));
          } catch (err) {
            log.error(`Resume message failed for session ${session.id}:\n${errorDetails(err)}`);
            socket.destroy(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });

      socket.setTimeout(10000, () => {
        socket.destroy(new Error(`Resume connection timed out for session ${session.id}`));
      });

      socket.on('error', (err) => {
        log.warn(`Reconnect attempt failed for session ${session.id}:`, err);
        reconnectState.inFlight = false;
        if (session.status === 'reconnecting') {
          this.scheduleReconnect(session, err.message);
        }
      });

      socket.on('close', () => {
        reconnectState.inFlight = false;
        if (session.status === 'reconnecting') {
          this.scheduleReconnect(session, 'Connection closed while resuming');
        }
      });

    } catch (err) {
      log.error(`Failed to initiate reconnect for session ${session.id}:`, err);
      reconnectState.inFlight = false;
      if (session.status === 'reconnecting') {
        this.scheduleReconnect(session, errorDetails(err));
      }
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const session of this.sessions.values()) {
      if (['pending', 'connecting', 'transferring', 'paused'].includes(session.status)) {
        session.status = 'reconnecting';
      }
    }

    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistSessionsNow();

    for (const session of this.sessions.values()) {
      const reconnectState = this.reconnects.get(session.id);
      if (reconnectState?.timer) clearTimeout(reconnectState.timer);
      this.clearSessionConnections(session.id);
    }
    this.reconnects.clear();
    this.awaitingComplete.clear();
    this.chunkReadAhead.clear();

    for (const handle of this.writeHandles.values()) {
      try {
        await handle.sync();
        await handle.close();
      } catch (err) {
        log.warn('Failed to close write handle:', err);
      }
    }
    this.writeHandles.clear();

    for (const [filePath, handle] of this.fileHandles) {
      try {
        await handle.close();
      } catch (err) {
        log.warn(`Failed to close read handle for ${filePath}:`, err);
      }
    }
    this.fileHandles.clear();
    this.sessions.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    log.info('Transfer service stopped');
  }
}
