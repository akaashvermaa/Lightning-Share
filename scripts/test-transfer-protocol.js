const assert = require('node:assert/strict');
const { encodeFrame, decodeFrame } = require('../dist/server/services/transfer/protocol');
const { MAX_TRANSFER_FRAME_SIZE } = require('../dist/server/shared/constants');

const control = { type: 'resume', sessionId: 'session-1', lastAcknowledgedChunk: 4 };
const controlFrame = encodeFrame(control);
assert.deepEqual(decodeFrame(controlFrame.subarray(4)), control);

const chunk = {
  type: 'chunk',
  sessionId: 'session-1',
  fileId: 'file-1',
  chunkIndex: 2,
  offset: 8,
  checksum: 'abc123',
  data: Buffer.from('raw binary payload\0\xff'),
};
const chunkFrame = encodeFrame(chunk);
const decodedChunk = decodeFrame(chunkFrame.subarray(4));
assert.equal(decodedChunk.type, chunk.type);
assert.equal(decodedChunk.chunkIndex, chunk.chunkIndex);
assert.deepEqual(decodedChunk.data, chunk.data);

assert.throws(
  () => decodeFrame(Buffer.alloc(MAX_TRANSFER_FRAME_SIZE + 1)),
  /exceeds/,
);

console.log('Transfer protocol checks passed');
