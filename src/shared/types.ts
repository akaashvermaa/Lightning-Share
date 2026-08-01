export interface Device {
  id: string;
  name: string;
  ip: string;
  port: number;
  lastSeen: number;
  isLocal: boolean;
}

export interface FileInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  isDirectory: boolean;
  mimeType: string;
  checksum?: string;
}

export interface ChunkInfo {
  index: number;
  offset: number;
  size: number;
  checksum: string;
}

export interface TransferSession {
  id: string;
  deviceId: string;
  deviceName: string;
  deviceIp: string;
  files: FileInfo[];
  totalSize: number;
  transferredBytes: number;
  status: TransferStatus;
  direction: 'sending' | 'receiving';
  speed: number;
  remainingTime: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  chunks: ChunkInfo[];
  acknowledgedChunks: Set<number>;
  lastAcknowledgedByte: number;
  speedHistory: SpeedSample[];
}

export interface SpeedSample {
  timestamp: number;
  bytesPerSecond: number;
}

export type TransferStatus =
  | 'pending'
  | 'connecting'
  | 'transferring'
  | 'paused'
  | 'reconnecting'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'declined';

export interface IncomingTransfer {
  sessionId: string;
  deviceId: string;
  deviceName: string;
  files: FileInfo[];
  totalSize: number;
  message?: string;
}

export interface TransferProgress {
  sessionId: string;
  fileId: string;
  fileName: string;
  fileTransferred: number;
  fileSize: number;
  totalTransferred: number;
  totalSize: number;
  speed: number;
  remainingTime: number;
  status: TransferStatus;
  currentChunk: number;
  totalChunks: number;
}

export interface DiscoveryMessage {
  type: 'announce' | 'bye';
  deviceId: string;
  deviceName: string;
  port: number;
}

export interface TransferMessage {
  type: 'request' | 'accept' | 'reject' | 'chunk' | 'ack' | 'complete' | 'error' | 'resume';
  sessionId: string;
  payload?: unknown;
}

export interface ChunkPayload {
  sessionId: string;
  fileId: string;
  chunkIndex: number;
  offset: number;
  data: Buffer;
  checksum: string;
}

export interface AckPayload {
  sessionId: string;
  fileId: string;
  chunkIndex: number;
  acknowledgedByte: number;
  checksum: string;
}

export interface ResumePayload {
  sessionId: string;
  fileId: string;
  lastAcknowledgedByte: number;
  lastAcknowledgedChunk: number;
}

export interface FileChecksumPayload {
  sessionId: string;
  fileId: string;
  checksum: string;
}

export interface CompressionInfo {
  enabled: boolean;
  estimatedSize?: number;
  originalSize: number;
  compressionRatio?: number;
}

export interface AppSettings {
  deviceName: string;
  downloadPath: string;
  autoAcceptFromTrusted: boolean;
  trustedDevices: string[];
  compressionEnabled: boolean;
  theme: 'light' | 'dark' | 'system';
}

export interface NetworkInfo {
  isOnline: boolean;
  localIp: string;
  interfaces: NetworkInterface[];
}

export interface NetworkInterface {
  name: string;
  address: string;
  family: string;
  internal: boolean;
}
