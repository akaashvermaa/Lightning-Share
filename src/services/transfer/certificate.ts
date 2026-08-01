import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { app } from 'electron';
import log from 'electron-log';

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
    this.certDir = path.join(app.getPath('userData'), 'certs');
    this.ensureDir();
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

    const key = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const certPath = path.join(this.certDir, 'server.crt');
    const keyPath = path.join(this.certDir, 'server.key');

    const cert = this.createSelfSignedCert(key.publicKey, key.privateKey);

    fs.writeFileSync(keyPath, key.privateKey);
    fs.writeFileSync(certPath, cert);

    this.certInfo = {
      certPath,
      keyPath,
      createdAt: Date.now(),
    };

    log.info('Certificate generated successfully');
    return this.certInfo;
  }

  private createSelfSignedCert(publicKey: string, privateKey: string): string {
    const cert = crypto.createSign('RSA-SHA256');

    const info = {
      countryName: 'US',
      stateOrProvinceName: 'LightningShare',
      localityName: 'Local',
      organizationName: 'LightningShare',
      commonName: 'LightningShare',
    };

    const tbsCertificate = this.buildTbsCertificate(info);
    const signature = cert.sign(privateKey);

    return this.encodeCertificate(tbsCertificate, signature, publicKey);
  }

  private buildTbsCertificate(info: Record<string, string>): Buffer {
    const components: Buffer[] = [];

    components.push(this.encodeInteger(1));
    components.push(this.encodeInteger(1));
    components.push(this.encodeString('sha256WithRSAEncryption'));
    components.push(this.encodeString('LightningShare'));
    components.push(this.encodeString(info.countryName));
    components.push(this.encodeString(info.stateOrProvinceName));
    components.push(this.encodeString(info.localityName));
    components.push(this.encodeString(info.organizationName));
    components.push(this.encodeString(info.commonName));

    return Buffer.concat(components);
  }

  private encodeInteger(value: number): Buffer {
    const hex = value.toString(16);
    const padded = hex.length % 2 === 0 ? hex : '0' + hex;
    const bytes = Buffer.from(padded, 'hex');

    const len = bytes.length + 2;
    const result = Buffer.alloc(len);
    result[0] = 0x02;
    result[1] = bytes.length;
    bytes.copy(result, 2);

    return result;
  }

  private encodeString(str: string): Buffer {
    const bytes = Buffer.from(str, 'utf8');
    const len = bytes.length + 2;
    const result = Buffer.alloc(len);
    result[0] = 0x0c;
    result[1] = bytes.length;
    bytes.copy(result, 2);

    return result;
  }

  private encodeCertificate(
    tbsCertificate: Buffer,
    signature: Buffer,
    publicKey: string
  ): string {
    const lines = [
      '-----BEGIN CERTIFICATE-----',
      this.base64Encode(Buffer.concat([tbsCertificate, signature])),
      '-----END CERTIFICATE-----',
    ];
    return lines.join('\n');
  }

  private base64Encode(buffer: Buffer): string {
    return buffer.toString('base64').match(/.{1,64}/g)!.join('\n');
  }
}

export const certificateManager = new CertificateManager();
