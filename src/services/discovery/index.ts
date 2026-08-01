import * as dgram from 'dgram';
import * as os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import log from '../../shared/logger';
import { DiscoveryMessage, Device } from '../../shared/types';
import {
  DISCOVERY_PORT,
  DISCOVERY_INTERVAL,
  DISCOVERY_TIMEOUT,
} from '../../shared/constants';

export class DiscoveryService extends EventEmitter {
  private deviceId: string;
  private deviceName: string;
  private socket: dgram.Socket | null = null;
  private broadcaster: dgram.Socket | null = null;
  private devices: Map<string, Device> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private localIp: string = '';

  constructor() {
    super();
    this.deviceId = uuidv4();
    this.deviceName = os.hostname();
    this.localIp = this.getLocalIp();
  }

  private getLocalIp(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;
      for (const info of netInterface) {
        if (info.family === 'IPv4' && !info.internal) {
          return info.address;
        }
      }
    }
    return '127.0.0.1';
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.localIp = this.getLocalIp();
    log.info(`Discovery starting on ${this.localIp}`);

    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.broadcaster = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    await this.bindSocket();
    this.startBroadcasting();
    this.startCleanup();

    this.isRunning = true;
    log.info('Discovery service started');
  }

  private async bindSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket) return reject(new Error('Socket not initialized'));

      this.socket.on('error', (err) => {
        log.error('Discovery socket error:', err);
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.bind(DISCOVERY_PORT, () => {
        this.socket?.setBroadcast(true);
        log.info(`Discovery listener bound to port ${DISCOVERY_PORT}`);
        resolve();
      });
    });
  }

  private startBroadcasting(): void {
    this.broadcast();

    this.intervalId = setInterval(() => {
      this.broadcast();
    }, DISCOVERY_INTERVAL);
  }

  private broadcast(): void {
    if (!this.broadcaster) return;

    const message: DiscoveryMessage = {
      type: 'announce',
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      port: 51235,
    };

    const buffer = Buffer.from(JSON.stringify(message));

    const broadcastAddresses = this.getBroadcastAddresses();

    for (const address of broadcastAddresses) {
      this.broadcaster.send(buffer, DISCOVERY_PORT, address, (err) => {
        if (err) {
          log.warn(`Failed to broadcast to ${address}:`, err.message);
        }
      });
    }
  }

  private getBroadcastAddresses(): string[] {
    const addresses: string[] = [];
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;

      for (const info of netInterface) {
        if (info.family === 'IPv4' && !info.internal && info.address === this.localIp) {
          const broadcastIp = this.calculateBroadcastAddress(info.address, info.netmask);
          if (broadcastIp) {
            addresses.push(broadcastIp);
          }
        }
      }
    }

    if (addresses.length === 0) {
      addresses.push('255.255.255.255');
    }

    return addresses;
  }

  private calculateBroadcastAddress(ip: string, netmask: string): string | null {
    const ipParts = ip.split('.').map(Number);
    const maskParts = netmask.split('.').map(Number);

    if (ipParts.length !== 4 || maskParts.length !== 4) return null;

    const broadcastParts: number[] = [];
    for (let i = 0; i < 4; i++) {
      broadcastParts.push(ipParts[i] | (~maskParts[i] & 255));
    }

    return broadcastParts.join('.');
  }

  private startCleanup(): void {
    this.cleanupIntervalId = setInterval(() => {
      const now = Date.now();
      for (const [deviceId, device] of this.devices) {
        if (now - device.lastSeen > DISCOVERY_TIMEOUT) {
          this.devices.delete(deviceId);
          this.emit('device-left', deviceId);
          log.info(`Device timed out: ${device.name} (${deviceId})`);
        }
      }
    }, DISCOVERY_TIMEOUT / 2);
  }

  private handleMessage(msg: Buffer, rinfo: dgram.RemoteInfo): void {
    try {
      const message: DiscoveryMessage = JSON.parse(msg.toString());

      if (message.deviceId === this.deviceId) return;

      if (message.type === 'bye') {
        const device = this.devices.get(message.deviceId);
        if (device) {
          this.devices.delete(message.deviceId);
          this.emit('device-left', message.deviceId);
          log.info(`Device left: ${message.deviceName} (${message.deviceId})`);
        }
        return;
      }

      const isLocal = rinfo.address === this.localIp;

      const device: Device = {
        id: message.deviceId,
        name: message.deviceName,
        ip: rinfo.address,
        port: message.port,
        lastSeen: Date.now(),
        isLocal,
      };

      const isNew = !this.devices.has(message.deviceId);

      this.devices.set(message.deviceId, device);

      if (isNew) {
        this.emit('device-discovered', device);
        log.info(`Device discovered: ${device.name} (${device.ip})`);
      }
    } catch (err) {
      log.warn('Failed to parse discovery message:', err);
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.broadcaster) {
      const byeMessage: DiscoveryMessage = {
        type: 'bye',
        deviceId: this.deviceId,
        deviceName: this.deviceName,
        port: 0,
      };
      const buffer = Buffer.from(JSON.stringify(byeMessage));

      for (const address of this.getBroadcastAddresses()) {
        this.broadcaster.send(buffer, DISCOVERY_PORT, address);
      }

      this.broadcaster.close();
      this.broadcaster = null;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.isRunning = false;
    log.info('Discovery service stopped');
  }

  getDeviceId(): string {
    return this.deviceId;
  }

  setDeviceName(name: string): void {
    this.deviceName = name;
  }

  getDevices(): Device[] {
    return Array.from(this.devices.values());
  }

  updateLocalIp(ip: string): void {
    if (ip && ip !== this.localIp) {
      log.info(`Local IP changed: ${this.localIp} -> ${ip}`);
      this.localIp = ip;
    }
  }
}
