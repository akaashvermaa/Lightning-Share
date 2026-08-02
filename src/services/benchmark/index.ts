import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

export interface BenchmarkResults {
  readSpeedMBps: number;
  writeSpeedMBps: number;
  networkSpeedMBps: number;
}

export class BenchmarkService {
  public async runBenchmark(downloadPath: string): Promise<BenchmarkResults> {
    const testFilePath = path.join(downloadPath, `.benchmark_${Date.now()}.tmp`);
    const sizeMB = 50; // 50MB
    const buffer = Buffer.alloc(1024 * 1024); // 1MB buffer

    let writeSpeedMBps = 0;
    let readSpeedMBps = 0;

    // 1. Write Benchmark
    try {
      const writeStart = Date.now();
      const fd = await fs.promises.open(testFilePath, 'w');
      for (let i = 0; i < sizeMB; i++) {
        await fd.write(buffer);
      }
      await fd.close();
      const writeTime = (Date.now() - writeStart) / 1000;
      writeSpeedMBps = sizeMB / writeTime;
    } catch (err) {
      console.error('Write benchmark failed:', err);
    }

    // 2. Read Benchmark
    try {
      const readStart = Date.now();
      const fd = await fs.promises.open(testFilePath, 'r');
      for (let i = 0; i < sizeMB; i++) {
        await fd.read(buffer, 0, buffer.length, i * buffer.length);
      }
      await fd.close();
      const readTime = (Date.now() - readStart) / 1000;
      readSpeedMBps = sizeMB / readTime;
    } catch (err) {
      console.error('Read benchmark failed:', err);
    } finally {
      try {
        await fs.promises.unlink(testFilePath);
      } catch (e) {}
    }

    // 3. Local Transfer Loopback (Test local socket throughput)
    let networkSpeedMBps = 0;
    try {
      networkSpeedMBps = await new Promise<number>((resolve) => {
        const net = require('net');
        let downloaded = 0;
        
        const server = net.createServer((socket: any) => {
          socket.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
          });
        });
        
        server.listen(0, '127.0.0.1', () => {
          const port = server.address().port;
          const client = new net.Socket();
          client.connect(port, '127.0.0.1', () => {
            const start = Date.now();
            let sent = 0;
            const targetSize = 100 * 1024 * 1024; // 100MB
            const dataBuffer = Buffer.alloc(64 * 1024); // 64KB chunk
            
            const write = () => {
              let ok = true;
              while (sent < targetSize && ok) {
                sent += dataBuffer.length;
                ok = client.write(dataBuffer);
              }
              if (sent >= targetSize) {
                client.end();
              }
            };
            
            client.on('drain', write);
            write();
            
            client.on('close', () => {
              const time = (Date.now() - start) / 1000;
              server.close();
              resolve((downloaded / (1024 * 1024)) / time);
            });
          });
          client.on('error', () => {
             server.close();
             resolve(0);
          });
        });
        
        server.on('error', () => resolve(0));
      });
    } catch (err) {
      console.error('Local loopback benchmark failed:', err);
    }

    return {
      readSpeedMBps,
      writeSpeedMBps,
      networkSpeedMBps,
    };
  }
}
