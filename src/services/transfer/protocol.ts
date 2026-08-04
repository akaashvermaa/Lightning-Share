import { MAX_TRANSFER_FRAME_SIZE } from '../../shared/constants';

const CONTROL_FRAME = 0;
const CHUNK_FRAME   = 1;

// ---------------------------------------------------------------------------
// Binary chunk frame layout (86 bytes fixed header + N bytes data):
//
//  Offset  Size  Field
//  ------  ----  -----
//    0       1   frame type (always 0x01 = CHUNK_FRAME)
//    1       4   chunkIndex        (UInt32BE)
//    5       8   offset            (BigUInt64BE — supports files up to 16 EB)
//   13       4   dataLength        (UInt32BE — wire bytes, post-compression)
//   17       4   uncompressedLen   (UInt32BE — original chunk length)
//   21       1   flags             (bit 0 = compressed)
//   22      36   fileId            (ASCII UUID string, zero-padded to 36 bytes)
//   58      36   sessionId         (ASCII UUID string, zero-padded to 36 bytes)
//   94       N   raw chunk data
//
// All fixed-size fields. No JSON.stringify or JSON.parse in the hot path.
// Control frames (ack, resume, complete, etc.) still use JSON — they are
// low-frequency and carry complex payloads that benefit from readability.
// ---------------------------------------------------------------------------
const BINARY_HEADER_SIZE = 94;
const UUID_SIZE = 36; // UUIDs are always "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

function parseMessage(data: Buffer): any {
  return JSON.parse(data.toString(), (key, value) => {
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return value;
  });
}

function writeFixedString(buf: Buffer, str: string, offset: number, len: number): void {
  const encoded = Buffer.from(str, 'ascii');
  encoded.copy(buf, offset, 0, Math.min(encoded.length, len));
  // Zero-pad remaining bytes (already 0 from allocUnsafe pre-zero via alloc)
}

export function encodeFrame(message: any): Buffer {
  let payload: Buffer;

  if (message.type === 'chunk' && Buffer.isBuffer(message.data)) {
    // Binary chunk frame — no JSON serialization in the hot path.
    const data: Buffer = message.data;
    const header = Buffer.alloc(BINARY_HEADER_SIZE); // alloc zeros the buffer

    let pos = 0;
    header[pos++] = CHUNK_FRAME;
    header.writeUInt32BE(message.chunkIndex >>> 0, pos);        pos += 4;
    header.writeBigUInt64BE(BigInt(message.offset ?? 0), pos);  pos += 8;
    header.writeUInt32BE(data.length >>> 0, pos);               pos += 4;
    header.writeUInt32BE((message.uncompressedLength ?? data.length) >>> 0, pos); pos += 4;
    header[pos++] = message.compressed ? 1 : 0;
    writeFixedString(header, message.fileId    ?? '', pos, UUID_SIZE); pos += UUID_SIZE;
    writeFixedString(header, message.sessionId ?? '', pos, UUID_SIZE); pos += UUID_SIZE;

    payload = Buffer.concat([header, data]);
  } else {
    // Control frame — JSON as before.
    payload = Buffer.concat([
      Buffer.from([CONTROL_FRAME]),
      Buffer.from(JSON.stringify(message)),
    ]);
  }

  if (payload.length > MAX_TRANSFER_FRAME_SIZE) {
    throw new Error(`Transfer frame exceeds ${MAX_TRANSFER_FRAME_SIZE} bytes`);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  return Buffer.concat([length, payload]);
}

export function decodeFrame(frame: Buffer): any {
  if (frame.length > MAX_TRANSFER_FRAME_SIZE) {
    throw new Error(`Transfer frame exceeds ${MAX_TRANSFER_FRAME_SIZE} bytes`);
  }
  if (frame.length < 1) throw new Error('Transfer frame is empty');

  if (frame[0] === CONTROL_FRAME) {
    return parseMessage(frame.subarray(1));
  }

  if (frame[0] !== CHUNK_FRAME || frame.length < BINARY_HEADER_SIZE) {
    throw new Error(`Unknown or truncated transfer frame type: ${frame[0]}`);
  }

  // Decode binary chunk header — no JSON.parse.
  let pos = 1;
  const chunkIndex      = frame.readUInt32BE(pos);              pos += 4;
  const chunkOffset     = Number(frame.readBigUInt64BE(pos));   pos += 8;
  const dataLength      = frame.readUInt32BE(pos);              pos += 4;
  const uncompressedLen = frame.readUInt32BE(pos);              pos += 4;
  const flags           = frame[pos++];
  const fileId          = frame.subarray(pos, pos + UUID_SIZE).toString('ascii').replace(/\0/g, ''); pos += UUID_SIZE;
  const sessionId       = frame.subarray(pos, pos + UUID_SIZE).toString('ascii').replace(/\0/g, ''); pos += UUID_SIZE;

  const compressed = !!(flags & 1);
  const data = frame.subarray(pos);

  if (data.length !== dataLength) {
    throw new Error(`Transfer chunk length mismatch: expected ${dataLength}, got ${data.length}`);
  }

  return {
    type: 'chunk',
    sessionId,
    fileId,
    chunkIndex,
    offset: chunkOffset,
    uncompressedLength: uncompressedLen,
    compressed,
    checksum: '', // TLS guarantees integrity; checksum disabled for performance
    data,
  };
}
