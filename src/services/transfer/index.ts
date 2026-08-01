import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import log from '../../shared/logger';
import {
  Device,
  FileInfo,
  TransferSession,
  IncomingTransfer,
} from '../../shared/types';
import { FileService } from '../file';
import { certificateManager } from './certificate';
import {
  TRANSFER_PORT,
  MAX_CHUNK_RETRIES,
  RETRY_DELAY,
  TRANSFER_WINDOW_SIZE,
  MIN_TRANSFER_WINDOW_SIZE,
  MAX_TRANSFER_WINDOW_SIZE,
  getChunkSizeForFile,
} from '../../shared/constants';

interface ActiveConnection {
  socket: tls.TLSSocket | net.Socket;
  sessionId: string;
  fileId: string;
  chunkIndex: number;
  retries: number;
}

interface PendingTransfer {
  transfer: IncomingTransfer;
  socket: tls.TLSSocket | net.Socket;
}

const CONTROL_FRAME = 0;
const CHUNK_FRAME = 1;
const TRANSFER_STATE_DIR = path.join(os.homedir(), '.lightningshare');
const TRANSFER_STATE_FILE = path.join(TRANSFER_STATE_DIR, 'transfers.json');

function parseMessage(data: Buffer): any {
  return JSON.parse(data.toString(), (key, value) => {
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return value;
  });
}

function encodeFrame(message: any): Buffer {
  let payload: Buffer;

  if (message.type === 'chunk' && Buffer.isBuffer(message.data)) {
    const { data, ...header } = message;
    const headerBuffer = Buffer.from(JSON.stringify({
      ...header,
      dataLength: data.length,
    }));
    const frameHeader = Buffer.alloc(5);
    frameHeader[0] = CHUNK_FRAME;
    frameHeader.writeUInt32BE(headerBuffer.length, 1);
    payload = Buffer.concat([frameHeader, headerBuffer, data]);
  } else {
    payload = Buffer.concat([
      Buffer.from([CONTROL_FRAME]),
      Buffer.from(JSON.stringify(message)),
    ]);
  }

  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  return Buffer.concat([length, payload]);
}

function decodeFrame(frame: Buffer): any {
  if (frame.length < 1) {
    throw new Error('Transfer frame is empty');
  }

  if (frame[0] === CONTROL_FRAME) {
    return parseMessage(frame.subarray(1));
  }

  if (frame[0] !== CHUNK_FRAME || frame.length < 5) {
    throw new Error(`Unknown transfer frame type: ${frame[0]}`);
  }

  const headerLength = frame.readUInt32BE(1);
  const headerStart = 5;
  const dataStart = headerStart + headerLength;
  if (dataStart > frame.length) {
    throw new Error('Transfer chunk header exceeds frame length');
  }

  const header = JSON.parse(frame.subarray(headerStart, dataStart).toString());
  const data = frame.subarray(dataStart);
  if (header.dataLength !== data.length) {
    throw new Error(`Transfer chunk length mismatch: expected ${header.dataLength}, got ${data.length}`);
  }

  return { ...header, data };
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
  private pendingTransfers: Map<string, PendingTransfer> = new Map();
  private writeStreams: Map<string, fs.WriteStream> = new Map();
  private fileHandles: Map<string, fs.promises.FileHandle> = new Map();
  private persistTimer: NodeJS.Timeout | null = null;
  private localDeviceId: string = '';
  private localDeviceName: string = '';

  constructor(fileService: FileService) {
    super();
    this.fileService = fileService;
    this.loadPersistedSessions();
    this.serverReady = this.startServer();
  }

  private loadPersistedSessions(): void {
    try {
      if (!fs.existsSync(TRANSFER_STATE_FILE)) return;

      const records = JSON.parse(fs.readFileSync(TRANSFER_STATE_FILE, 'utf8')) as any[];
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
        }
        if (active) {
          session.status = 'reconnecting';
        }

        this.sessions.set(session.id, session);
      }
      log.info(`Restored ${this.sessions.size} persisted transfer session(s)`);
    } catch (err) {
      log.error(`Failed to restore persisted transfers:\n${errorDetails(err)}`);
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
          },
        };
      });
      const tempFile = `${TRANSFER_STATE_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(records), 'utf8');
      fs.renameSync(tempFile, TRANSFER_STATE_FILE);
    } catch (err) {
      log.error(`Failed to persist transfers:\n${errorDetails(err)}`);
    }
  }

  recoverPersistedSessions(): void {
    for (const session of this.sessions.values()) {
      if (session.direction === 'sending' && session.status === 'reconnecting') {
        log.info(`Scheduling persisted transfer recovery for ${session.id}`);
        setTimeout(() => this.attemptReconnect(session), 1000);
      }
    }
  }

  setLocalDevice(deviceId: string, deviceName: string): void {
    this.localDeviceId = deviceId;
    this.localDeviceName = deviceName;
    log.info(`TransferService: local device set to ${deviceName} (${deviceId})`);
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

    let buffer = Buffer.alloc(0);

    socket.on('data', async (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32BE(0);
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
    log.info(`[RECV_REQUEST] Stored pending transfer. Map now has: ${Array.from(this.pendingTransfers.keys()).join(', ')}`);
    this.emit('incoming-transfer', incomingTransfer);
    log.info(`[TRACE] EXIT handleTransferRequest session=${sessionId} incoming-transfer-emitted`);
  }

  private async handleAccept(socket: net.Socket, message: any): Promise<void> {
    log.info(`[TRACE] ENTER handleAccept session=${message.sessionId}`);
    log.info(`[RECV_ACCEPT] Received 'accept' from ${socket.remoteAddress} for session ${message.sessionId}`);
    const session = this.sessions.get(message.sessionId);
    if (!session) {
      log.warn(`[RECV_ACCEPT] No session found for ${message.sessionId}`);
      return;
    }

    log.info(`[RECV_ACCEPT] Session status was '${session.status}', changing to 'transferring'`);
    session.status = 'transferring';
    this.emitSessionUpdate(session);
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
      const candidatePath = path.join(downloadPath, manifestFile.name);
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

    const chunkBuffer: Buffer = Buffer.isBuffer(data)
      ? data
      : message.dataEncoding === 'base64' && typeof data === 'string'
      ? Buffer.from(data, 'base64')
      : Buffer.from(data.data || data);

    const isValid = await this.fileService.verifyChunkChecksum(chunkBuffer, checksum);
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

    const fileInfo = session.files.find(f => f.id === fileId);
    if (!fileInfo) return;

    let writeStream = this.getWriteStream(session.id, fileId);
    if (!writeStream) {
      writeStream = await this.createWriteStream(session, fileId, offset);
    }

    if (writeStream) {
      if (!writeStream.write(chunkBuffer)) {
        await new Promise<void>((resolve) => writeStream?.once('drain', resolve));
      }
    }

    (session as any).fileProgress = (session as any).fileProgress || {};
    (session as any).fileProgress[fileId] = (session as any).fileProgress[fileId] || {
      transferred: 0,
      completed: false,
    };
    (session as any).fileProgress[fileId].transferred += chunkBuffer.length;

    session.lastAcknowledgedByte = offset + chunkBuffer.length;
    session.acknowledgedChunks.add(chunkIndex);

    this.sendMessage(socket, {
      type: 'ack',
      sessionId: message.sessionId,
      fileId,
      chunkIndex,
      acknowledgedByte: session.lastAcknowledgedByte,
      checksum,
      valid: true,
    });

    this.updateProgress(session);
  }

  private async handleAck(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    log.debug(`[RECV_ACK] chunk ${message.chunkIndex} valid=${message.valid} for session ${message.sessionId}`);

    const connectionKey = `${socket.remoteAddress}:${socket.remotePort}:${message.chunkIndex}`;
    const connection = this.connections.get(connectionKey);

    if (!message.valid) {
      log.warn(`Chunk ${message.chunkIndex} failed verification, will retry`);
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
      this.connections.delete(connectionKey);
    }
    this.recordChunkAck(session, socket, message.chunkIndex);
    const inFlightChunks: Set<number> = (session as any).inFlightChunks || new Set<number>();
    inFlightChunks.delete(message.chunkIndex);
    session.acknowledgedChunks.add(message.chunkIndex);
    session.lastAcknowledgedByte = message.acknowledgedByte;

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
    const writeStream = this.writeStreams.get(key);
    if (writeStream) {
      await new Promise<void>((resolve) => {
        writeStream.end(() => {
          this.writeStreams.delete(key);
          resolve();
        });
      });
    }

    (session as any).fileProgress = (session as any).fileProgress || {};
    (session as any).fileProgress[fileId] = {
      transferred: fileInfo.size,
      completed: true,
    };

    const filePath = (session as any).filePaths?.[fileId];
    if (filePath) {
      const isValid = await this.fileService.verifyFileChecksum(filePath, checksum);
      if (!isValid) {
        log.error(`File ${fileId} checksum mismatch after transfer`);
        session.status = 'failed';
        session.error = 'File integrity verification failed';
        this.emit('session-error', session.id, session.error);
        return;
      }
    }

    log.info(`File ${fileInfo.name} transferred and verified successfully`);

    const allComplete = session.files.every(f => {
      return (session as any).fileProgress?.[f.id]?.completed;
    });

    if (allComplete) {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.emit('session-completed', session);
    }

    this.emitSessionUpdate(session);
  }

  private async handleResume(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    if (session.direction === 'receiving') {
      session.status = 'transferring';
      this.emitSessionUpdate(session);
      this.sendMessage(socket, {
        type: 'resume-ack',
        sessionId: session.id,
        lastAcknowledgedByte: session.lastAcknowledgedByte,
        lastAcknowledgedChunk: Math.max(...Array.from(session.acknowledgedChunks), -1),
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

  private async handleResumeAck(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    session.lastAcknowledgedByte = message.lastAcknowledgedByte;
    session.acknowledgedChunks.clear();
    for (let i = 0; i <= message.lastAcknowledgedChunk; i++) {
      session.acknowledgedChunks.add(i);
    }

    session.status = 'transferring';
    this.emitSessionUpdate(session);
    log.info(`Resume acknowledged for session ${session.id} at chunk ${message.lastAcknowledgedChunk}`);
    await this.startSendingChunks(session, socket, true);
  }

  private async handleError(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    session.status = 'failed';
    session.error = message.error;
    this.emit('session-error', session.id, message.error);
  }

  private getWriteStream(sessionId: string, fileId: string): fs.WriteStream | null {
    const key = `${sessionId}:${fileId}`;
    return this.writeStreams.get(key) || null;
  }

  private async createWriteStream(
    session: TransferSession,
    fileId: string,
    offset = 0,
  ): Promise<fs.WriteStream | null> {
    const fileInfo = session.files.find(f => f.id === fileId);
    if (!fileInfo) return null;

    const downloadPath = (session as any).downloadPath || '';
    const persistedPath = (session as any).filePaths?.[fileId];
    const isResume = Boolean(persistedPath && fs.existsSync(persistedPath));
    let filePath = persistedPath || path.join(downloadPath, fileInfo.name);
    if (!isResume) {
      filePath = await this.fileService.getUniqueFilePath(filePath);
    }
    (session as any).filePaths = (session as any).filePaths || {};
    (session as any).filePaths[fileId] = filePath;

    await this.fileService.ensureDir(downloadPath);

    const stream = this.fileService.createWriteStream(filePath, {
      flags: isResume ? 'r+' : 'ax',
      start: isResume ? offset : undefined,
    });
    const key = `${session.id}:${fileId}`;
    this.writeStreams.set(key, stream);

    log.info(`Created write stream for ${fileInfo.name} -> ${filePath}`);
    return stream;
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
    chunkIndex: number,
  ): void {
    const metrics = session as any;
    const sentAt = metrics.chunkSentAt?.get(chunkIndex);
    if (sentAt) {
      const rttMs = Math.max(1, Date.now() - sentAt);
      metrics.rttMs = metrics.rttMs
        ? metrics.rttMs * 0.875 + rttMs * 0.125
        : rttMs;
      metrics.minRttMs = metrics.minRttMs
        ? Math.min(metrics.minRttMs, rttMs)
        : rttMs;
      metrics.ackCount = (metrics.ackCount || 0) + 1;
      metrics.chunkSentAt.delete(chunkIndex);

      const queuedBytes = socket.writableLength;
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

  private async startSendingChunks(
    session: TransferSession,
    socket: net.Socket,
    isResume = false,
  ): Promise<void> {
    const skippedFiles: Set<string> = (session as any).skippedFiles || new Set<string>();
    let currentFileIndex = (session as any).currentFileIndex || 0;
    while (
      currentFileIndex < session.files.length &&
      skippedFiles.has(session.files[currentFileIndex].id)
    ) {
      const skippedFile = session.files[currentFileIndex];
      (session as any).fileProgress = (session as any).fileProgress || {};
      (session as any).fileProgress[skippedFile.id] = {
        transferred: skippedFile.size,
        completed: true,
      };
      currentFileIndex++;
    }

    (session as any).currentFileIndex = currentFileIndex;
    const fileInfo = session.files[currentFileIndex];
    if (!fileInfo) {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.updateProgress(session);
      this.persistSessionsSoon();
      this.emit('session-completed', session);
      return;
    }

    const chunks = this.fileService.createChunks(fileInfo.size, fileInfo.id);
    session.chunks = chunks;
    this.initializeTransferMetrics(session, !isResume);
    if (!isResume) {
      session.acknowledgedChunks = new Set();
      session.lastAcknowledgedByte = 0;
    }
    (session as any).inFlightChunks = new Set<number>();

    (session as any).currentFileIndex = currentFileIndex;
    (session as any).fileProgress = (session as any).fileProgress || {};
    if (!isResume || !(session as any).fileProgress[fileInfo.id]) {
      (session as any).fileProgress[fileInfo.id] = {
        transferred: 0,
        completed: false,
      };
    }

    log.info(`Starting to send ${fileInfo.name} (${fileInfo.size} bytes, ${chunks.length} chunks)`);
    await this.fillSendWindow(session, socket);
  }

  private async readChunkData(filePath: string, offset: number, size: number): Promise<Buffer | null> {
    try {
      let fd = this.fileHandles.get(filePath);
      if (!fd) {
        fd = await fs.promises.open(filePath, 'r');
        this.fileHandles.set(filePath, fd);
      }

      const buffer = Buffer.allocUnsafe(size);
      const { bytesRead } = await fd.read(buffer, 0, size, offset);
      return buffer.subarray(0, bytesRead);
    } catch (err) {
      log.error(`Failed to read chunk at offset ${offset}: ${err}`);
      return null;
    }
  }

  private async fillSendWindow(session: TransferSession, socket: net.Socket): Promise<void> {
    const inFlightChunks: Set<number> = (session as any).inFlightChunks || new Set<number>();
    (session as any).inFlightChunks = inFlightChunks;

    while (
      inFlightChunks.size < ((session as any).windowSize || TRANSFER_WINDOW_SIZE) &&
      session.status !== 'completed' &&
      session.status !== 'failed' &&
      session.status !== 'cancelled'
    ) {
      const previousInFlight = inFlightChunks.size;
      await this.sendNextChunk(session, socket);
      if (inFlightChunks.size === previousInFlight) break;
    }
  }

  private async sendNextChunk(session: TransferSession, socket: net.Socket): Promise<void> {
    const inFlightChunks: Set<number> = (session as any).inFlightChunks || new Set<number>();
    (session as any).inFlightChunks = inFlightChunks;
    const unacknowledged = session.chunks.find(
      c => !session.acknowledgedChunks.has(c.index) && !inFlightChunks.has(c.index)
    );

    if (!unacknowledged) {
      if (inFlightChunks.size > 0) return;

      const currentFileIndex = (session as any).currentFileIndex || 0;
      const fileInfo = session.files[currentFileIndex];

      if (!fileInfo) return;

      const fileChecksum = await this.fileService.calculateFileChecksum(fileInfo.path);
      this.sendMessage(socket, {
        type: 'complete',
        sessionId: session.id,
        fileId: fileInfo.id,
        checksum: fileChecksum,
      });

      (session as any).fileProgress[fileInfo.id].completed = true;

      const nextFileIndex = currentFileIndex + 1;
      if (nextFileIndex < session.files.length) {
        (session as any).currentFileIndex = nextFileIndex;
        log.info(`Moving to next file: ${session.files[nextFileIndex].name}`);
        await this.startSendingChunks(session, socket);
      } else {
        session.status = 'completed';
        session.completedAt = Date.now();
        this.persistSessionsSoon();
        this.emit('session-completed', session);
      }
      return;
    }

    const currentFileIndex = (session as any).currentFileIndex || 0;
    const fileInfo = session.files[currentFileIndex];
    if (!fileInfo) return;

    const chunkData = await this.readChunkData(fileInfo.path, unacknowledged.offset, unacknowledged.size);
    if (!chunkData) {
      session.status = 'failed';
      session.error = `Failed to read chunk ${unacknowledged.index}`;
      this.emit('session-error', session.id, session.error);
      return;
    }

    const checksum = await this.fileService.calculateChunkChecksum(chunkData);

    inFlightChunks.add(unacknowledged.index);
    const metrics = session as any;
    metrics.chunkSentAt?.set(unacknowledged.index, Date.now());

    this.sendMessage(socket, {
      type: 'chunk',
      sessionId: session.id,
      fileId: fileInfo.id,
      chunkIndex: unacknowledged.index,
      offset: unacknowledged.offset,
      data: chunkData,
      checksum,
    });

    const connKey = `${socket.remoteAddress}:${socket.remotePort}:${unacknowledged.index}`;
    this.connections.set(connKey, {
      socket,
      sessionId: session.id,
      fileId: fileInfo.id,
      chunkIndex: unacknowledged.index,
      retries: 0,
    });

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
    const currentFileIndex = (session as any).currentFileIndex || 0;
    const fileInfo = session.files[currentFileIndex];
    if (!fileInfo) return;

    const chunk = session.chunks.find(c => c.index === connection.chunkIndex);
    if (!chunk) return;

    const chunkData = await this.readChunkData(fileInfo.path, chunk.offset, chunk.size);
    if (!chunkData) return;

    const checksum = await this.fileService.calculateChunkChecksum(chunkData);

    this.sendMessage(connection.socket, {
      type: 'chunk',
      sessionId: session.id,
      fileId: fileInfo.id,
      chunkIndex: chunk.index,
      offset: chunk.offset,
      data: chunkData,
      checksum,
    });
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
      socket.write(frame, (err) => {
        if (err) {
          log.error(`[TRACE] SEND ${message.type} ERROR socket=${remoteAddr}:\n${errorDetails(err)}`);
          return;
        }
        messageLog(`[TRACE] SEND ${message.type} SUCCESS session=${message.sessionId || 'unknown'} socket=${remoteAddr} bytes=${frame.length}`);
      });
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

  async createSession(
    device: Device,
    files: FileInfo[],
    direction: 'sending' | 'receiving'
  ): Promise<TransferSession | null> {
    const sessionId = uuidv4();

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);

    const session: TransferSession = {
      id: sessionId,
      deviceId: device.id,
      deviceName: device.name,
      deviceIp: device.ip,
      files,
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
    this.persistSessionsSoon();
    log.info(`Created transfer session ${sessionId} with ${device.name}`);

    if (direction === 'sending') {
      const port = Number.isInteger(device.port) && device.port > 0
        ? device.port
        : TRANSFER_PORT;

      log.info(`[TRACE] ENTER createSession session=${sessionId} target=${device.name}`);
      log.info(`[TRACE] DEVICE RESOLVED id=${device.id} ip=${device.ip}`);
      log.info(`[TRACE] PORT RESOLVED port=${port}`);
      log.info(`[TRACE] OPEN SOCKET START ${device.ip}:${port}`);

      const options: tls.ConnectionOptions = {
        host: device.ip,
        port,
        rejectUnauthorized: false,
      };

      const socket = tls.connect(options);

      socket.on('connect', () => {
        log.info(`[TRACE] TCP CONNECTED ${device.ip}:${port}`);
      });

      socket.on('secureConnect', () => {
        socket.setTimeout(0);
        log.info(`[TRACE] TLS CONNECTED ${device.ip}:${port}`);
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

      socket.setTimeout(10000, () => {
        log.error(`[TRACE] CONNECT TIMEOUT ${device.ip}:${port}`);
        const timeoutError = new Error(`Timed out connecting to ${device.ip}:${port}`);
        socket.destroy(timeoutError);
      });

      let buffer = Buffer.alloc(0);
      socket.on('data', async (data) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 4) {
          const messageLength = buffer.readUInt32BE(0);
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
        const code = (err as NodeJS.ErrnoException).code;
        log.error(
          `[TRACE] SOCKET ERROR ${device.ip}:${port}${code ? ` (${code})` : ''}:\n${errorDetails(err)}`,
        );
        session.status = 'failed';
        session.error = err.message;
        this.emit('session-error', session.id, err.message);
      });

      socket.on('close', (hadError) => {
        log.info(`[TRACE] SOCKET CLOSE session=${sessionId} hadError=${hadError}`);
      });

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
    log.info(`[ACCEPT_SESSION] Called: sessionId=${sessionId}, downloadPath=${downloadPath}`);
    const pending = this.pendingTransfers.get(sessionId);
    if (!pending) {
      log.warn(`[ACCEPT_SESSION] No pending transfer found for session ${sessionId}`);
      log.warn(`[TRACE] EXIT acceptSession session=${sessionId} pending-not-found`);
      log.info(`[ACCEPT_SESSION] Pending transfers map keys: ${Array.from(this.pendingTransfers.keys()).join(', ') || '(empty)'}`);
      return;
    }

    const incoming = pending.transfer;
    const socket = pending.socket;
    log.info(`[ACCEPT_SESSION] Found pending transfer: device=${incoming.deviceName}, socketDestroyed=${socket.destroyed}, socketWritable=${socket.writable}`);

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

    (session as any).downloadPath = downloadPath;
    (session as any).fileProgress = {};
    (session as any).filePaths = {};

    this.sessions.set(sessionId, session);
    this.pendingTransfers.delete(sessionId);
    this.persistSessionsSoon();

    this.sendMessage(socket, {
      type: 'accept',
      sessionId,
    });

    log.info(`[ACCEPT_SESSION] Sent 'accept' message to sender. Session ${sessionId} ready to receive.`);
    log.info(`[TRACE] EXIT acceptSession session=${sessionId} accept-queued`);
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

    for (const [key, stream] of this.writeStreams) {
      if (key.startsWith(sessionId)) {
        stream.end();
        this.writeStreams.delete(key);
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

    session.status = 'reconnecting';
    this.emitSessionUpdate(session);

    log.info(`Resuming transfer session ${sessionId}`);
  }

  getSessions(): TransferSession[] {
    return Array.from(this.sessions.values());
  }

  getSession(sessionId: string): TransferSession | null {
    return this.sessions.get(sessionId) || null;
  }

  handleNetworkChange(newIp?: string): void {
    const activeSessions = this.sessions.values();

    for (const session of activeSessions) {
      if (session.status === 'transferring' || session.status === 'reconnecting') {
        log.info(`Network changed, session ${session.id} will attempt to resume`);
        session.status = 'reconnecting';
        this.emitSessionUpdate(session);

        setTimeout(() => {
          this.attemptReconnect(session);
        }, 1000);
      }
    }
  }

  private async attemptReconnect(session: TransferSession): Promise<void> {
    if (session.status !== 'reconnecting') return;

    try {
      log.info(`Attempting to reconnect session ${session.id}`);

      const options: tls.ConnectionOptions = {
        host: session.deviceIp,
        port: TRANSFER_PORT,
        rejectUnauthorized: false,
      };

      const socket = tls.connect(options, () => {
        log.info(`Reconnected for session ${session.id}`);

        this.sendMessage(socket, {
          type: 'resume',
          sessionId: session.id,
          fileId: session.files[0]?.id,
          lastAcknowledgedByte: session.lastAcknowledgedByte,
          lastAcknowledgedChunk: Math.max(...Array.from(session.acknowledgedChunks), -1),
        });
      });

      let buffer = Buffer.alloc(0);
      socket.on('data', async (data) => {
        buffer = Buffer.concat([buffer, data]);
        while (buffer.length >= 4) {
          const messageLength = buffer.readUInt32BE(0);
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
        if (session.status === 'reconnecting') {
          setTimeout(() => {
            this.attemptReconnect(session);
          }, 3000);
        }
      });

    } catch (err) {
      log.error(`Failed to initiate reconnect for session ${session.id}:`, err);
      if (session.status === 'reconnecting') {
        setTimeout(() => {
          this.attemptReconnect(session);
        }, 3000);
      }
    }
  }

  async stop(): Promise<void> {
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

    for (const stream of this.writeStreams.values()) {
      stream.end();
    }

    this.writeStreams.clear();

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
