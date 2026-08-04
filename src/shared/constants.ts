export const DISCOVERY_PORT = 51234;
export const TRANSFER_PORT = 51235;
export const DISCOVERY_INTERVAL = 2000;
export const DISCOVERY_TIMEOUT = 10000;
export const MAX_PACKET_SIZE = 65507;
// Transfer frames contain a small JSON header plus at most one configured chunk.
// Rejecting larger frames prevents a peer from forcing unbounded buffer growth.
// 8 MB chunk + JSON framing header — 64 MB is safe headroom.
export const MAX_TRANSFER_FRAME_SIZE = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Chunk sizes: scaled to file size so retransmission cost stays proportional.
//   < 100 MB  → 512 KB  (small — fast start, low retransmit cost)
//   < 4 GB    → 2 MB    (medium — solid WiFi throughput)
//   < 20 GB   → 4 MB    (large — fewer chunks per gigabyte)
//   ≥ 20 GB   → 8 MB    (huge — 90 GB = ~11 500 chunks, not 180 000)
// ---------------------------------------------------------------------------
export const CHUNK_SIZE_SMALL  =  512 * 1024;        //  512 KB
export const CHUNK_SIZE_MEDIUM =    2 * 1024 * 1024; //    2 MB
export const CHUNK_SIZE_LARGE  =    4 * 1024 * 1024; //    4 MB
export const CHUNK_SIZE_HUGE   =    8 * 1024 * 1024; //    8 MB

export const MAX_CHUNK_RETRIES = 3;
export const RETRY_DELAY = 1000;

// ---------------------------------------------------------------------------
// Window sizing: adaptive AIMD starts at 12 and grows toward 64.
// 64 × 4 MB = 256 MB max in-flight bandwidth-delay product for high-speed Wi-Fi.
// ---------------------------------------------------------------------------
export const TRANSFER_WINDOW_SIZE     = 12;  // generous start
export const MIN_TRANSFER_WINDOW_SIZE =  8;  // floor prevents window collapsing to 4
export const MAX_TRANSFER_WINDOW_SIZE = 64;  // headroom for 100+ MB/s pipes

export const TCP_KEEPALIVE = 30000;
export const COMPRESSION_THRESHOLD = 1024 * 1024;
export const WINDOW_SIZE = 8192;

export const FILE_CHUNK_SIZES: Record<string, number> = {
  small:  CHUNK_SIZE_SMALL,
  medium: CHUNK_SIZE_MEDIUM,
  large:  CHUNK_SIZE_LARGE,
  huge:   CHUNK_SIZE_HUGE,
};

export function getChunkSizeForFile(fileSize: number): number {
  if (fileSize < 50 * 1024 * 1024)                 return CHUNK_SIZE_SMALL;   // < 50 MB → 512 KB
  if (fileSize < 2  * 1024 * 1024 * 1024)          return CHUNK_SIZE_MEDIUM;  // 50 MB–2 GB → 2 MB
  if (fileSize < 20 * 1024 * 1024 * 1024)          return CHUNK_SIZE_LARGE;   // 2 GB–20 GB → 4 MB
  return CHUNK_SIZE_HUGE;                                                       // ≥ 20 GB → 8 MB
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
  bandwidthLimit: 0,
};
