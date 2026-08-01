import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import log from '../shared/logger';
import { createHash } from 'crypto';

const TEMP_DIR = path.join(os.tmpdir(), 'lightningshare-uploads');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export class UploadManager {
  private tempDir: string;

  constructor() {
    this.tempDir = TEMP_DIR;
  }

  getTempPath(fileId: string, fileName: string): string {
    return path.join(this.tempDir, `${fileId}_${fileName}`);
  }

  async saveUpload(
    fileId: string,
    fileName: string,
    readStream: NodeJS.ReadableStream
  ): Promise<string> {
    const tempPath = this.getTempPath(fileId, fileName);
    const writeStream = fs.createWriteStream(tempPath, {
      highWaterMark: 1024 * 1024,
    });

    return new Promise((resolve, reject) => {
      readStream.pipe(writeStream);
      writeStream.on('finish', () => resolve(tempPath));
      writeStream.on('error', reject);
      readStream.on('error', reject);
    });
  }

  async cleanupFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
      log.debug(`Cleaned up temp file: ${filePath}`);
    } catch (err) {
      log.warn(`Failed to cleanup temp file ${filePath}:`, err);
    }
  }

  async cleanupSession(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      await this.cleanupFile(filePath);
    }
  }

  getTempDir(): string {
    return this.tempDir;
  }
}

export const uploadManager = new UploadManager();
