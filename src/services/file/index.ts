import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import log from '../../shared/logger';
import { FileInfo, ChunkInfo } from '../../shared/types';
import { getChunkSizeForFile } from '../../shared/constants';

export class FileService {
  async getFileInfo(filePath: string): Promise<FileInfo | null> {
    try {
      const stats = await fs.promises.stat(filePath);
      const name = path.basename(filePath);
      const ext = path.extname(name).toLowerCase();

      const mimeTypes: Record<string, string> = {
        '.txt': 'text/plain',
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.xml': 'application/xml',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.tar': 'application/x-tar',
        '.gz': 'application/gzip',
        '.rar': 'application/vnd.rar',
        '.7z': 'application/x-7z-compressed',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.webp': 'image/webp',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.ogg': 'audio/ogg',
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.avi': 'video/x-msvideo',
        '.mov': 'video/quicktime',
        '.exe': 'application/x-msdownload',
        '.dll': 'application/x-msdownload',
        '.iso': 'application/x-iso9660-image',
      };

      return {
        id: uuidv4(),
        name,
        path: filePath,
        size: stats.size,
        isDirectory: stats.isDirectory(),
        mimeType: mimeTypes[ext] || 'application/octet-stream',
      };
    } catch (err) {
      log.error(`Failed to get file info for ${filePath}:`, err);
      return null;
    }
  }

  async getFolderInfo(folderPath: string): Promise<FileInfo | null> {
    try {
      const stats = await fs.promises.stat(folderPath);
      if (!stats.isDirectory()) return null;

      const name = path.basename(folderPath);
      let totalSize = 0;

      const walkDir = async (dir: string): Promise<void> => {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walkDir(fullPath);
          } else {
            const fileStats = await fs.promises.stat(fullPath);
            totalSize += fileStats.size;
          }
        }
      };

      await walkDir(folderPath);

      return {
        id: uuidv4(),
        name,
        path: folderPath,
        size: totalSize,
        isDirectory: true,
        mimeType: 'application/x-directory',
      };
    } catch (err) {
      log.error(`Failed to get folder info for ${folderPath}:`, err);
      return null;
    }
  }

  createChunks(fileSize: number, fileId: string): ChunkInfo[] {
    const chunkSize = getChunkSizeForFile(fileSize);
    const chunks: ChunkInfo[] = [];
    let offset = 0;
    let index = 0;

    while (offset < fileSize) {
      const remaining = fileSize - offset;
      const size = Math.min(chunkSize, remaining);

      chunks.push({
        index,
        offset,
        size,
        checksum: '',
      });

      offset += size;
      index++;
    }

    return chunks;
  }

  async calculateFileChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('blake3');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async calculateChunkChecksum(chunk: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('blake3');
      hash.update(chunk);
      resolve(hash.digest('hex'));
    });
  }

  async verifyChunkChecksum(chunk: Buffer, expectedChecksum: string): Promise<boolean> {
    const actualChecksum = await this.calculateChunkChecksum(chunk);
    return actualChecksum === expectedChecksum;
  }

  async verifyFileChecksum(filePath: string, expectedChecksum: string): Promise<boolean> {
    const actualChecksum = await this.calculateFileChecksum(filePath);
    return actualChecksum === expectedChecksum;
  }

  createReadStream(
    filePath: string,
    options: { start?: number; end?: number } = {}
  ): fs.ReadStream {
    const chunkSize = options.end ? options.end - (options.start || 0) : 0;
    return fs.createReadStream(filePath, {
      highWaterMark: getChunkSizeForFile(chunkSize),
      ...options,
    });
  }

  createWriteStream(
    filePath: string,
    options: { flags?: string } = {}
  ): fs.WriteStream {
    return fs.createWriteStream(filePath, {
      flags: options.flags || 'ax',
      highWaterMark: 256 * 1024,
    });
  }

  async ensureDir(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  async getFileSize(filePath: string): Promise<number> {
    const stats = await fs.promises.stat(filePath);
    return stats.size;
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getUniqueFilePath(filePath: string): Promise<string> {
    if (!(await this.fileExists(filePath))) return filePath;

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);
    let counter = 1;
    let newPath = filePath;

    while (await this.fileExists(newPath)) {
      newPath = path.join(dir, `${baseName} (${counter})${ext}`);
      counter++;
    }

    return newPath;
  }
}
