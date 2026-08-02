import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from '../../shared/logger';
import * as selfsigned from 'selfsigned';

export interface CertificateInfo {
  certPath: string;
  keyPath: string;
  createdAt: number;
}

const CERT_VALIDITY_DAYS = 365 * 10;

export class CertificateManager {
  private certDir: string;
  private certInfo: CertificateInfo | null = null;

  constructor() {
    this.certDir = path.join(os.homedir(), '.lightningshare', 'certs');
    this.ensureDir();
  }

  getDiagnostics(): any {
    return {
      certPath: this.certInfo?.certPath || null,
      keyPath: this.certInfo?.keyPath || null,
      createdAt: this.certInfo?.createdAt || null,
      isLoaded: !!this.certInfo,
    };
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.certDir)) {
      fs.mkdirSync(this.certDir, { recursive: true });
    }
  }

  async getCertificate(): Promise<CertificateInfo> {
    if (this.certInfo) {
      return this.certInfo;
    }

    const certPath = path.join(this.certDir, 'server.crt');
    const keyPath = path.join(this.certDir, 'server.key');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      const stats = fs.statSync(certPath);
      this.certInfo = {
        certPath,
        keyPath,
        createdAt: stats.mtimeMs,
      };
      return this.certInfo;
    }

    return this.generateCertificate();
  }

  async generateCertificate(): Promise<CertificateInfo> {
    log.info('Generating new self-signed certificate...');

    const certPath = path.join(this.certDir, 'server.crt');
    const keyPath = path.join(this.certDir, 'server.key');

    const attrs = [
      { name: 'commonName', value: 'LightningShare' },
      { name: 'organizationName', value: 'LightningShare' },
    ];

    const pems = await selfsigned.generate(attrs, {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: new Date(Date.now() + CERT_VALIDITY_DAYS * 24 * 60 * 60 * 1000),
    });

    fs.writeFileSync(keyPath, pems.private);
    fs.writeFileSync(certPath, pems.cert);

    this.certInfo = {
      certPath,
      keyPath,
      createdAt: Date.now(),
    };

    log.info('Certificate generated successfully');
    return this.certInfo;
  }
}

export const certificateManager = new CertificateManager();