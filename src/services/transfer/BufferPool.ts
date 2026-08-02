export class BufferPool {
  private pools: Map<number, Buffer[]> = new Map();

  acquire(size: number): Buffer {
    let pool = this.pools.get(size);
    if (!pool) {
      pool = [];
      this.pools.set(size, pool);
    }
    const buffer = pool.pop();
    if (buffer) {
      return buffer;
    }
    return Buffer.allocUnsafe(size);
  }

  release(buffer: Buffer): void {
    const size = buffer.length;
    let pool = this.pools.get(size);
    if (!pool) {
      pool = [];
      this.pools.set(size, pool);
    }
    // Limit pool size per chunk size to prevent unbounded memory growth (e.g. max 64 buffers of the same size)
    if (pool.length < 64) {
      pool.push(buffer);
    }
  }

  clear(): void {
    this.pools.clear();
  }
}
