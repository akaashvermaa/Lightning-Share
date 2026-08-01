import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import {
  Device,
  FileInfo,
  TransferSession,
  ChunkInfo,
  IncomingTransfer,
  ChunkPayload,
  AckPayload,
  ResumePayload,
} from '../../shared/types';
import { FileService } from '../file';
import {
  TRANSFER_PORT,
  MAX_CHUNK_RETRIES,
  RETRY_DELAY,
  getChunkSizeForFile,
} from '../../shared/constants';

interface ActiveConnection {
  socket: net.Socket;
  sessionId: string;
  fileId: string;
  chunkIndex: number;
  retries: number;
}

export class TransferService extends EventEmitter {
  private sessions: Map<string, TransferSession> = new Map();
  private server: net.Server | null = null;
  private fileService: FileService;
  private connections: Map<string, ActiveConnection> = new Map();
  private pendingTransfers: Map<string, IncomingTransfer> = new Map();
  private writeStreams: Map<string, fs.WriteStream> = new Map();

  constructor(fileService: FileService) {
    super();
    this.fileService = fileService;
    this.startServer();
  }

  private async startServer(): Promise<void> {
    this.server = net.createServer((socket) => {
      this.handleConnection(socket);
    });

    this.server.listen(TRANSFER_PORT, '0.0.0.0', () => {
      log.info(`Transfer server listening on port ${TRANSFER_PORT}`);
    });

    this.server.on('error', (err) => {
      log.error('Transfer server error:', err);
    });
  }

  private handleConnection(socket: net.Socket): void {
    const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
    log.info(`New transfer connection from ${remoteAddress}`);

    let buffer = Buffer.alloc(0);

    socket.on('data', async (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32BE(0);
        if (buffer.length < 4 + messageLength) break;

        const messageData = buffer.slice(4, 4 + messageLength);
        buffer = buffer.slice(4 + messageLength);

        try {
          const message = JSON.parse(messageData.toString());
          await this.handleMessage(socket, message);
        } catch (err) {
          log.error('Failed to parse transfer message:', err);
        }
      }
    });

    socket.on('close', () => {
      log.info(`Connection closed: ${remoteAddress}`);
    });

    socket.on('error', (err) => {
      log.error(`Socket error from ${remoteAddress}:`, err);
    });
  }

  private async handleMessage(socket: net.Socket, message: any): Promise<void> {
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
  }

  private async handleTransferRequest(socket: net.Socket, message: any): Promise<void> {
    const { sessionId, deviceId, deviceName, files, totalSize } = message;

    const incomingTransfer: IncomingTransfer = {
      sessionId,
      deviceId,
      deviceName,
      files,
      totalSize,
    };

    this.pendingTransfers.set(sessionId, incomingTransfer);
    this.emit('incoming-transfer', incomingTransfer);
  }

  private async handleAccept(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    session.status = 'transferring';
    this.emitSessionUpdate(session);
    this.startSendingChunks(session, socket);
  }

  private async handleReject(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    session.status = 'declined';
    this.emitSessionUpdate(session);
    socket.end();
  }

  private async handleChunk(socket: net.Socket, message: ChunkPayload): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    const { fileId, chunkIndex, offset, data, checksum } = message;

    const isValid = await this.fileService.verifyChunkChecksum(data, checksum);
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
      } as AckPayload & { valid: boolean });
      return;
    }

    const fileInfo = session.files.find(f => f.id === fileId);
    if (!fileInfo) return;

    const writeStream = this.getWriteStream(session.id, fileId);
    if (writeStream) {
      writeStream.write(data);
    }

    session.lastAcknowledgedByte = offset + data.length;
    session.acknowledgedChunks.add(chunkIndex);

    this.sendMessage(socket, {
      type: 'ack',
      sessionId: message.sessionId,
      fileId,
      chunkIndex,
      acknowledgedByte: session.lastAcknowledgedByte,
      checksum,
      valid: true,
    } as AckPayload & { valid: boolean });

    this.updateProgress(session);
  }

  private async handleAck(socket: net.Socket, message: AckPayload & { valid?: boolean }): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    const connectionKey = `${socket.remoteAddress}:${socket.remotePort}`;
    const connection = this.connections.get(connectionKey);
    if (!connection) return;

    if (!message.valid) {
      log.warn(`Chunk ${message.chunkIndex} failed verification, will retry`);
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
      return;
    }

    connection.retries = 0;
    session.acknowledgedChunks.add(message.chunkIndex);
    session.lastAcknowledgedByte = message.acknowledgedByte;

    this.updateProgress(session);
    this.sendNextChunk(session, socket);
  }

  private async handleComplete(socket: net.Socket, message: any): Promise<void> {
    const session = this.sessions.get(message.sessionId);
    if (!session) return;

    const { fileId, checksum } = message;
    const fileInfo = session.files.find(f => f.id === fileId);
    if (!fileInfo) return;

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
      const fSession = (session as any).fileProgress?.[f.id];
      return fSession?.completed;
    });

    if (allComplete) {
      session.status = 'completed';
      session.completedAt = Date.now();
      this.emit('session-completed', session);
    }

    this.emitSessionUpdate(session);
  }

  private async handleResume(socket: net.Socket, message: ResumePayload): Promise<void> {
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
    this.startSendingChunks(session, socket);
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

  private async createWriteStream(session: TransferSession, fileId: string): Promise<fs.WriteStream> {
    const fileInfo = session.files.find(f => f.id === fileId);
    if (!fileInfo) throw new Error(`File ${fileId} not found`);

    const downloadPath = (session as any).downloadPath || '';
    let filePath = path.join(downloadPath, fileInfo.name);
    filePath = await this.fileService.getUniqueFilePath(filePath);
    (session as any).filePaths = (session as any).filePaths || {};
    (session as any).filePaths[fileId] = filePath;

    await this.fileService.ensureDir(downloadPath);

    const stream = this.fileService.createWriteStream(filePath);
    const key = `${session.id}:${fileId}`;
    this.writeStreams.set(key, stream);

    return stream;
  }

  private async startSendingChunks(session: TransferSession, socket: net.Socket): Promise<void> {
    const fileInfo = session.files[0];
    if (!fileInfo) {
      session.status = 'completed';
      this.emit('session-completed', session);
      return;
    }

    const chunks = this.fileService.createChunks(fileInfo.size, fileInfo.id);
    session.chunks = chunks;
    session.acknowledgedChunks = new Set();
    session.lastAcknowledgedByte = 0;

    (session as any).currentFileIndex = 0;
    (session as any).fileProgress = (session as any).fileProgress || {};
    (session as any).fileProgress[fileInfo.id] = {
      transferred: 0,
      completed: false,
    };

    await this.sendChunksForFile(session, socket, fileInfo);
  }

  private async sendChunksForFile(
    session: TransferSession,
    socket: net.Socket,
    fileInfo: FileInfo
  ): Promise<void> {
    const chunks = session.chunks;
    const filePath = fileInfo.path;
    const startTime = Date.now();
    let bytesSent = 0;

    const readStream = this.fileService.createReadStream(filePath);

    let currentChunkIndex = 0;

    const sendNextAvailableChunk = async (): Promise<void> => {
      while (currentChunkIndex < chunks.length) {
        const chunk = chunks[currentChunkIndex];
        if (session.acknowledgedChunks.has(chunk.index)) {
          currentChunkIndex++;
          continue;
        }

        const connectionKey = `${socket.remoteAddress}:${socket.remotePort}`;
        const connection = this.connections.get(connectionKey);
        if (connection && connection.chunkIndex === chunk.index) {
          return;
        }

        const chunkData = await this.readChunkFromStream(
          readStream,
          chunk.offset,
          chunk.size
        );

        if (!chunkData) break;

        const checksum = await this.fileService.calculateChunkChecksum(chunkData);

        const payload: ChunkPayload = {
          sessionId: session.id,
          fileId: fileInfo.id,
          chunkIndex: chunk.index,
          offset: chunk.offset,
          data: chunkData,
          checksum,
        };

        this.sendMessage(socket, payload);

        const connKey = `${socket.remoteAddress}:${socket.remotePort}`;
        this.connections.set(connKey, {
          socket,
          sessionId: session.id,
          fileId: fileInfo.id,
          chunkIndex: chunk.index,
          retries: 0,
        });

        currentChunkIndex++;
        bytesSent += chunkData.length;

        session.transferredBytes += chunkData.length;

        const elapsed = (Date.now() - startTime) / 1000;
        session.speed = bytesSent / elapsed;
        if (session.speed > 0) {
          session.remainingTime = (session.totalSize - session.transferredBytes) / session.speed;
        }

        this.emitSessionUpdate(session);
        return;
      }
    };

    readStream.on('data', async () => {
      await sendNextAvailableChunk();
    });

    readStream.on('end', async () => {
      while (currentChunkIndex < chunks.length) {
        await sendNextAvailableChunk();
      }

      const fileChecksum = await this.fileService.calculateFileChecksum(fileInfo.path);
      this.sendMessage(socket, {
        type: 'complete',
        sessionId: session.id,
        fileId: fileInfo.id,
        checksum: fileChecksum,
      });

      (session as any).fileProgress[fileInfo.id].completed = true;

      const nextFileIndex = (session as any).currentFileIndex + 1;
      if (nextFileIndex < session.files.length) {
        (session as any).currentFileIndex = nextFileIndex;
        const nextFile = session.files[nextFileIndex];
        const nextChunks = this.fileService.createChunks(nextFile.size, nextFile.id);
        session.chunks = nextChunks;
        session.acknowledgedChunks = new Set();
        session.lastAcknowledgedByte = 0;
        (session as any).fileProgress[nextFile.id] = {
          transferred: 0,
          completed: false,
        };
        await this.sendChunksForFile(session, socket, nextFile);
      } else {
        session.status = 'completed';
        session.completedAt = Date.now();
        this.emit('session-completed', session);
      }
    });

    readStream.on('error', (err) => {
      log.error(`Read stream error for ${fileInfo.path}:`, err);
      session.status = 'failed';
      session.error = err.message;
      this.emit('session-error', session.id, err.message);
    });
  }

  private async readChunkFromStream(
    stream: fs.ReadStream,
    offset: number,
    size: number
  ): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      const handler = (data: Buffer | string) => {
        const chunk = typeof data === 'string' ? Buffer.from(data) : data;
        chunks.push(chunk);
        totalBytes += chunk.length;

        if (totalBytes >= size) {
          stream.pause();
          const result = Buffer.concat(chunks).slice(0, size);
          stream.removeListener('data', handler);
          resolve(result);
        }
      };

      stream.on('data', handler);
      stream.on('end', () => {
        if (chunks.length > 0) {
          resolve(Buffer.concat(chunks));
        } else {
          resolve(null);
        }
      });
      stream.on('error', () => resolve(null));
    });
  }

  private async sendNextChunk(session: TransferSession, socket: net.Socket): Promise<void> {
    const unacknowledged = session.chunks.find(
      c => !session.acknowledgedChunks.has(c.index)
    );

    if (!unacknowledged) return;

    const fileInfo = session.files[(session as any).currentFileIndex];
    if (!fileInfo) return;

    const filePath = fileInfo.path;
    const chunkData = await this.readChunkFromStream(
      this.fileService.createReadStream(filePath),
      unacknowledged.offset,
      unacknowledged.size
    );

    if (!chunkData) return;

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
  }

  private async resendChunk(session: TransferSession, connection: ActiveConnection): Promise<void> {
    const fileInfo = session.files[(session as any).currentFileIndex];
    if (!fileInfo) return;

    const chunk = session.chunks.find(c => c.index === connection.chunkIndex);
    if (!chunk) return;

    const chunkData = await this.readChunkFromStream(
      this.fileService.createReadStream(fileInfo.path),
      chunk.offset,
      chunk.size
    );

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

  private sendMessage(socket: net.Socket, message: any): void {
    const data = Buffer.from(JSON.stringify(message));
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(data.length);
    socket.write(Buffer.concat([lengthBuffer, data]));
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
    };

    this.sessions.set(sessionId, session);
    log.info(`Created transfer session ${sessionId} with ${device.name}`);

    if (direction === 'sending') {
      const socket = new net.Socket();

      socket.connect(device.port, device.ip, () => {
        log.info(`Connected to ${device.ip}:${device.port} for transfer`);
        session.status = 'connecting';
        this.emitSessionUpdate(session);

        this.sendMessage(socket, {
          type: 'request',
          sessionId,
          deviceId: device.id,
          deviceName: device.name,
          files,
          totalSize,
        });
      });

      socket.on('error', (err) => {
        log.error(`Connection error to ${device.ip}:`, err);
        session.status = 'failed';
        session.error = err.message;
        this.emit('session-error', session.id, err.message);
      });
    }

    return session;
  }

  async startSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'transferring';
    this.emitSessionUpdate(session);
  }

  async acceptSession(sessionId: string, downloadPath: string): Promise<void> {
    const incoming = this.pendingTransfers.get(sessionId);
    if (!incoming) return;

    const session: TransferSession = {
      id: sessionId,
      deviceId: incoming.deviceId,
      deviceName: incoming.deviceName,
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
    };

    (session as any).downloadPath = downloadPath;
    this.sessions.set(sessionId, session);

    log.info(`Accepted incoming transfer ${sessionId}`);
  }

  async rejectSession(sessionId: string): Promise<void> {
    this.pendingTransfers.delete(sessionId);
    log.info(`Rejected incoming transfer ${sessionId}`);
  }

  async cancelSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.status = 'cancelled';

    for (const [key, stream] of this.writeStreams) {
      if (key.startsWith(sessionId)) {
        stream.end();
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
