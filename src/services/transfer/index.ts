import * as net from 'net';
import * as tls from 'tls';
import * as fs from 'fs';
import * as path from 'path';
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

function parseMessage(data: Buffer): any {
  return JSON.parse(data.toString(), (key, value) => {
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return value;
  });
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
  private fileHandles: Map<string, number> = new Map();
  private localDeviceId: string = '';
  private localDeviceName: string = '';

  constructor(fileService: FileService) {
    super();
    this.fileService = fileService;
    this.serverReady = this.startServer();
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
          const message = parseMessage(messageData);
          log.info(`[TRACE] RECEIVER MESSAGE ${message.type} START session=${message.sessionId || 'unknown'}`);
          await this.handleMessage(socket, message);
          log.info(`[TRACE] RECEIVER MESSAGE ${message.type} SUCCESS session=${message.sessionId || 'unknown'}`);
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
    log.info(`[TRACE] ENTER handleMessage type=${message.type} session=${message.sessionId || 'unknown'}`);
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
      case 'error':
        await this.handleError(socket, message);
        break;
    }
    log.info(`[TRACE] EXIT handleMessage type=${message.type} session=${message.sessionId || 'unknown'}`);
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
    log.info(`[RECV_CHUNK] chunk ${chunkIndex} for file ${fileId}, offset=${offset}, dataLen=${data?.length || data?.data?.length || 0}`);

    const chunkBuffer: Buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.data || data);

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
      writeStream = await this.createWriteStream(session, fileId);
    }

    if (writeStream) {
      writeStream.write(chunkBuffer);
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

    log.info(`[RECV_ACK] chunk ${message.chunkIndex} valid=${message.valid} for session ${message.sessionId}`);

    const connectionKey = `${socket.remoteAddress}:${socket.remotePort}`;
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
    }
    session.acknowledgedChunks.add(message.chunkIndex);
    session.lastAcknowledgedByte = message.acknowledgedByte;

    this.updateProgress(session);
    await this.sendNextChunk(session, socket);
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

    const { lastAcknowledgedByte, lastAcknowledgedChunk } = message;
    session.lastAcknowledgedByte = lastAcknowledgedByte;
    session.acknowledgedChunks.clear();
    for (let i = 0; i <= lastAcknowledgedChunk; i++) {
      session.acknowledgedChunks.add(i);
    }

    log.info(`Resuming session ${session.id} from byte ${lastAcknowledgedByte}`);
    this.emitSessionUpdate(session);
    await this.startSendingChunks(session, socket);
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

  private async createWriteStream(session: TransferSession, fileId: string): Promise<fs.WriteStream | null> {
    const fileInfo = session.files.find(f => f.id === fileId);
    if (!fileInfo) return null;

    const downloadPath = (session as any).downloadPath || '';
    let filePath = path.join(downloadPath, fileInfo.name);
    filePath = await this.fileService.getUniqueFilePath(filePath);
    (session as any).filePaths = (session as any).filePaths || {};
    (session as any).filePaths[fileId] = filePath;

    await this.fileService.ensureDir(downloadPath);

    const stream = this.fileService.createWriteStream(filePath);
    const key = `${session.id}:${fileId}`;
    this.writeStreams.set(key, stream);

    log.info(`Created write stream for ${fileInfo.name} -> ${filePath}`);
    return stream;
  }

  private async startSendingChunks(session: TransferSession, socket: net.Socket): Promise<void> {
    const currentFileIndex = (session as any).currentFileIndex || 0;
    const fileInfo = session.files[currentFileIndex];
    if (!fileInfo) {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.emit('session-completed', session);
      return;
    }

    const chunks = this.fileService.createChunks(fileInfo.size, fileInfo.id);
    session.chunks = chunks;
    session.acknowledgedChunks = new Set();
    session.lastAcknowledgedByte = 0;

    (session as any).currentFileIndex = currentFileIndex;
    (session as any).fileProgress = (session as any).fileProgress || {};
    (session as any).fileProgress[fileInfo.id] = {
      transferred: 0,
      completed: false,
    };

    log.info(`Starting to send ${fileInfo.name} (${fileInfo.size} bytes, ${chunks.length} chunks)`);
    await this.sendNextChunk(session, socket);
  }

  private async readChunkData(filePath: string, offset: number, size: number): Promise<Buffer | null> {
    try {
      const fd = await fs.promises.open(filePath, 'r');
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await fd.read(buffer, 0, size, offset);
      await fd.close();
      return buffer.slice(0, bytesRead);
    } catch (err) {
      log.error(`Failed to read chunk at offset ${offset}: ${err}`);
      return null;
    }
  }

  private async sendNextChunk(session: TransferSession, socket: net.Socket): Promise<void> {
    const unacknowledged = session.chunks.find(
      c => !session.acknowledgedChunks.has(c.index)
    );

    if (!unacknowledged) {
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
        const nextFile = session.files[nextFileIndex];
        session.chunks = this.fileService.createChunks(nextFile.size, nextFile.id);
        session.acknowledgedChunks = new Set();
        session.lastAcknowledgedByte = 0;
        (session as any).fileProgress[nextFile.id] = {
          transferred: 0,
          completed: false,
        };
        log.info(`Moving to next file: ${nextFile.name}`);
        await this.sendNextChunk(session, socket);
      } else {
        session.status = 'completed';
        session.completedAt = Date.now();
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

    this.sendMessage(socket, {
      type: 'chunk',
      sessionId: session.id,
      fileId: fileInfo.id,
      chunkIndex: unacknowledged.index,
      offset: unacknowledged.offset,
      data: chunkData,
      checksum,
    });

    const connKey = `${socket.remoteAddress}:${socket.remotePort}`;
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
      log.info(`[TRACE] SEND ${message.type} START session=${message.sessionId || 'unknown'} socket=${remoteAddr}`);
      const data = Buffer.from(JSON.stringify(message));
      const lengthBuffer = Buffer.alloc(4);
      lengthBuffer.writeUInt32BE(data.length);
      const frame = Buffer.concat([lengthBuffer, data]);
      socket.write(frame, (err) => {
        if (err) {
          log.error(`[TRACE] SEND ${message.type} ERROR socket=${remoteAddr}:\n${errorDetails(err)}`);
          return;
        }
        log.info(`[TRACE] SEND ${message.type} SUCCESS session=${message.sessionId || 'unknown'} socket=${remoteAddr} bytes=${data.length}`);
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
            const message = parseMessage(messageData);
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
        session.status = 'transferring';
        this.emitSessionUpdate(session);

        this.sendMessage(socket, {
          type: 'resume',
          sessionId: session.id,
          fileId: session.files[0]?.id,
          lastAcknowledgedByte: session.lastAcknowledgedByte,
          lastAcknowledgedChunk: Math.max(...Array.from(session.acknowledgedChunks), 0),
        });
      });

      socket.on('error', (err) => {
        log.warn(`Reconnect attempt failed for session ${session.id}:`, err.message);
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
      session.status = 'cancelled';
    }

    for (const stream of this.writeStreams.values()) {
      stream.end();
    }

    this.writeStreams.clear();
    this.sessions.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    log.info('Transfer service stopped');
  }
}
