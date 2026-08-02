import { MAX_TRANSFER_FRAME_SIZE } from '../../shared/constants';

const CONTROL_FRAME = 0;
const CHUNK_FRAME = 1;

function parseMessage(data: Buffer): any {
  return JSON.parse(data.toString(), (key, value) => {
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return value;
  });
}

export function encodeFrame(message: any): Buffer {
  let payload: Buffer;

  if (message.type === 'chunk' && Buffer.isBuffer(message.data)) {
    const { data, ...header } = message;
    const headerBuffer = Buffer.from(JSON.stringify({ ...header, dataLength: data.length }));
    const frameHeader = Buffer.alloc(5);
    frameHeader[0] = CHUNK_FRAME;
    frameHeader.writeUInt32BE(headerBuffer.length, 1);
    payload = Buffer.concat([frameHeader, headerBuffer, data]);
  } else {
    payload = Buffer.concat([Buffer.from([CONTROL_FRAME]), Buffer.from(JSON.stringify(message))]);
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
  if (frame[0] === CONTROL_FRAME) return parseMessage(frame.subarray(1));
  if (frame[0] !== CHUNK_FRAME || frame.length < 5) {
    throw new Error(`Unknown transfer frame type: ${frame[0]}`);
  }

  const headerLength = frame.readUInt32BE(1);
  const dataStart = 5 + headerLength;
  if (dataStart > frame.length) throw new Error('Transfer chunk header exceeds frame length');
  const header = JSON.parse(frame.subarray(5, dataStart).toString());
  const data = frame.subarray(dataStart);
  if (header.dataLength !== data.length) {
    throw new Error(`Transfer chunk length mismatch: expected ${header.dataLength}, got ${data.length}`);
  }
  return { ...header, data };
}
