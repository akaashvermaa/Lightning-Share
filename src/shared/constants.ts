export const DISCOVERY_PORT = 51234;
export const TRANSFER_PORT = 51235;
export const DISCOVERY_INTERVAL = 2000;
export const DISCOVERY_TIMEOUT = 10000;
export const MAX_PACKET_SIZE = 65507;
export const CHUNK_SIZE_SMALL = 64 * 1024;
export const CHUNK_SIZE_MEDIUM = 256 * 1024;
export const CHUNK_SIZE_LARGE = 512 * 1024;
export const CHUNK_SIZE_XLARGE = 4 * 1024 * 1024;
export const MAX_CHUNK_RETRIES = 3;
export const RETRY_DELAY = 1000;
export const TRANSFER_WINDOW_SIZE = 8;
export const MIN_TRANSFER_WINDOW_SIZE = 4;
export const MAX_TRANSFER_WINDOW_SIZE = 32;
export const TCP_KEEPALIVE = 30000;
export const COMPRESSION_THRESHOLD = 1024 * 1024;
export const WINDOW_SIZE = 8192;

export const FILE_CHUNK_SIZES: Record<string, number> = {
  small: CHUNK_SIZE_SMALL,
  medium: CHUNK_SIZE_MEDIUM,
  large: CHUNK_SIZE_LARGE,
  xlarge: CHUNK_SIZE_XLARGE,
};

export function getChunkSizeForFile(fileSize: number): number {
  if (fileSize < 10 * 1024 * 1024) return CHUNK_SIZE_SMALL;
  if (fileSize < 100 * 1024 * 1024) return CHUNK_SIZE_MEDIUM;
  if (fileSize < 1024 * 1024 * 1024) return CHUNK_SIZE_LARGE;
  return CHUNK_SIZE_XLARGE;
}

export const COMPRESSIBLE_EXTENSIONS = [
  '.txt', '.md', '.json', '.xml', '.csv', '.log', '.yaml', '.yml',
  '.html', '.css', '.js', '.ts', '.jsx', '.tsx', '.py', '.java',
  '.c', '.cpp', '.h', '.hpp', '.rs', '.go', '.rb', '.php',
  '.sql', '.sh', '.bat', '.ps1', '.env', '.ini', '.cfg', '.conf',
];

export const INCOMPRESSIBLE_EXTENSIONS = [
  '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.ico',
  '.mp3', '.wav', '.ogg', '.flac', '.aac', '.m4a',
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.iso', '.img', '.dmg', '.vdi', '.vmdk',
];

export function shouldCompress(fileName: string, fileSize: number): boolean {
  if (fileSize < COMPRESSION_THRESHOLD) return false;
  const ext = fileName.toLowerCase().substring(fileName.lastIndexOf('.'));
  if (INCOMPRESSIBLE_EXTENSIONS.some(e => ext === e)) return false;
  return true;
}

export const DEFAULT_APP_SETTINGS = {
  deviceName: '',
  downloadPath: '',
  autoAcceptFromTrusted: false,
  trustedDevices: [],
  compressionEnabled: true,
  theme: 'system' as const,
};
