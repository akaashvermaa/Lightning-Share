import * as dgram from 'dgram';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import log from '../../shared/logger';
import { DiscoveryMessage, Device, DeviceCapabilities } from '../../shared/types';
import {
  DISCOVERY_PORT,
  DISCOVERY_TIMEOUT,
  TRANSFER_PORT,
} from '../../shared/constants';
import mdns from 'multicast-dns';

const DATA_DIR = path.join(os.homedir(), '.lightningshare');
const DEVICE_ID_FILE = path.join(DATA_DIR, 'device-id');
const MDNS_SERVICE = '_lightningshare._tcp.local';
const REFRESH_INTERVAL = 60000;

export class DiscoveryService extends EventEmitter {
  private deviceId: string;
  private deviceName: string;
  private socket4: dgram.Socket | null = null;
  private socket6: dgram.Socket | null = null;
  private broadcaster4: dgram.Socket | null = null;
  private broadcaster6: dgram.Socket | null = null;
  private mdnsInstance: any = null;
  private devices: Map<string, Device> = new Map();
  private refreshIntervalId: NodeJS.Timeout | null = null;
  private cleanupIntervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private localIps: string[] = [];

  constructor() {
    super();
    this.deviceId = this.loadOrCreateDeviceId();
    this.deviceName = os.hostname();
    this.updateLocalIps();
  }

  getDiagnostics(): any {
    return {
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      isRunning: this.isRunning,
      knownDevices: this.devices.size,
      interfaces: {
        ipv4: !!this.socket4,
        ipv6: !!this.socket6,
        mdns: !!this.mdnsInstance,
      },
    };
  }

  private loadOrCreateDeviceId(): string {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(DEVICE_ID_FILE)) {
        const id = fs.readFileSync(DEVICE_ID_FILE, 'utf8').trim();
        if (id) return id;
      }
    } catch (err) {
      log.warn('Failed to load device ID:', err);
    }
    const newId = uuidv4();
    try {
      fs.writeFileSync(DEVICE_ID_FILE, newId, 'utf8');
    } catch (err) {
      log.warn('Failed to persist device ID:', err);
    }
    return newId;
  }

  private updateLocalIps(): void {
    const interfaces = os.networkInterfaces();
    this.localIps = [];
    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;
      for (const info of netInterface) {
        if (!info.internal) {
          this.localIps.push(info.address);
        }
      }
    }
  }

  private getCapabilities(): DeviceCapabilities {
    return {
      version: '1.0.0',
      protocolVersion: 1,
      tls: true,
      compression: true,
      chunkVersion: 1,
      os: process.platform,
      architecture: process.arch,
      appVersion: '1.0.0'
    };
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.updateLocalIps();
    log.info(`Discovery starting with IPs: ${this.localIps.join(', ')}`);

    this.socket4 = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.broadcaster4 = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket6 = dgram.createSocket({ type: 'udp6', reuseAddr: true });
    this.broadcaster6 = dgram.createSocket({ type: 'udp6', reuseAddr: true });

    this.mdnsInstance = mdns();

    this.broadcaster4.on('error', (err) => log.error('Broadcaster4 error:', err));
    this.broadcaster6.on('error', (err) => log.error('Broadcaster6 error:', err));

    await Promise.all([
      this.bindSocket(this.socket4, 'udp4'),
      this.bindSocket(this.socket6, 'udp6')
    ]);

    this.broadcaster4.bind(() => this.broadcaster4?.setBroadcast(true));
    this.broadcaster6.bind(() => this.broadcaster6?.setBroadcast(true));

    this.setupMdns();

    this.refresh();

    this.refreshIntervalId = setInterval(() => {
      this.refresh();
    }, REFRESH_INTERVAL);

    this.startCleanup();

    this.isRunning = true;
    log.info('Discovery service started');
  }

  private async bindSocket(socket: dgram.Socket, type: 'udp4' | 'udp6'): Promise<void> {
    return new Promise((resolve) => {
      socket.on('error', (err) => {
        log.error(`Discovery socket error (${type}):`, err);
      });

      socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo.address, type);
      });

      socket.bind(DISCOVERY_PORT, type === 'udp6' ? '::' : '0.0.0.0', () => {
        socket.setBroadcast(true);
        log.info(`Discovery listener bound to port ${DISCOVERY_PORT} (${type})`);
        resolve();
      });
    });
  }

  private setupMdns(): void {
    if (!this.mdnsInstance) return;

    this.mdnsInstance.on('query', (query: any) => {
      if (query.questions.some((q: any) => q.name === MDNS_SERVICE)) {
        this.mdnsInstance.respond({
          answers: [{
            name: MDNS_SERVICE,
            type: 'TXT',
            data: Buffer.from(JSON.stringify(this.createDiscoveryMessage()))
          }]
        });
      }
    });

    this.mdnsInstance.on('response', (response: any) => {
      for (const answer of response.answers) {
        if (answer.name === MDNS_SERVICE && answer.type === 'TXT') {
          try {
            const data = answer.data.toString();
            this.handleMessage(Buffer.from(data), 'mdns-discovered', 'mdns');
          } catch (err) {
            log.warn('Failed to parse mDNS response:', err);
          }
        }
      }
    });
  }

  private createDiscoveryMessage(type: 'announce' | 'bye' = 'announce'): DiscoveryMessage {
    return {
      type,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      port: TRANSFER_PORT,
      capabilities: this.getCapabilities()
    };
  }

  private refresh(): void {
    if (!this.isRunning) return;

    const message = this.createDiscoveryMessage();
    const buffer = Buffer.from(JSON.stringify(message));

    // Broadcast IPv4
    const broadcast4Addresses = this.getBroadcastAddresses4();
    for (const address of broadcast4Addresses) {
      this.broadcaster4?.send(buffer, DISCOVERY_PORT, address, (err) => {
        if (err) log.warn(`Failed to broadcast to ${address}:`, err.message);
      });
    }

    // Broadcast IPv6 (ff02::1 is all nodes on local network)
    this.broadcaster6?.send(buffer, DISCOVERY_PORT, 'ff02::1', (err) => {
      if (err) log.warn(`Failed to broadcast IPv6 to ff02::1:`, err.message);
    });

    // mDNS query and advertise
    this.mdnsInstance?.query({
      questions: [{ name: MDNS_SERVICE, type: 'TXT' }]
    });
    this.mdnsInstance?.respond({
      answers: [{
        name: MDNS_SERVICE,
        type: 'TXT',
        data: buffer
      }]
    });
  }

  private getBroadcastAddresses4(): string[] {
    const addresses: string[] = ['255.255.255.255'];
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;

      for (const info of netInterface) {
        if (info.family === 'IPv4' && !info.internal) {
          const broadcastIp = this.calculateBroadcastAddress(info.address, info.netmask);
          if (broadcastIp && !addresses.includes(broadcastIp)) {
            addresses.push(broadcastIp);
          }
        }
      }
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

  private async measureRtt(ip: string, port: number): Promise<number | undefined> {
    if (ip === 'mdns-discovered' || !ip) return undefined;
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();
      const timeout = setTimeout(() => {
        socket.destroy();
        resolve(undefined);
      }, 2000);

      socket.connect(port, ip, () => {
        const rtt = Date.now() - start;
        clearTimeout(timeout);
        socket.destroy();
        resolve(rtt);
      });

      socket.on('error', () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(undefined);
      });
    });
  }

  private async handleMessage(msg: Buffer, sourceIp: string, method: 'udp4' | 'udp6' | 'mdns'): Promise<void> {
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

      let device = this.devices.get(message.deviceId);
      const isNew = !device;

      if (!device) {
        device = {
          id: message.deviceId,
          name: message.deviceName,
          addresses: [],
          port: message.port,
          lastSeen: Date.now(),
          isLocal: this.localIps.includes(sourceIp),
          discoveryMethods: [],
          capabilities: message.capabilities
        };
        this.devices.set(message.deviceId, device);
      }

      device.lastSeen = Date.now();
      device.name = message.deviceName;
      device.port = message.port;
      
      if (message.capabilities) {
        device.capabilities = message.capabilities;
      }

      if (sourceIp !== 'mdns-discovered' && !device.addresses.includes(sourceIp)) {
        device.addresses.push(sourceIp);
        device.isLocal = device.isLocal || this.localIps.includes(sourceIp);
      }

      if (!device.discoveryMethods.includes(method)) {
        device.discoveryMethods.push(method);
      }

      if (isNew || device.rtt === undefined) {
        // Measure RTT if we have a valid IP
        const ipToMeasure = device.addresses[0];
        if (ipToMeasure) {
          const rtt = await this.measureRtt(ipToMeasure, message.port);
          if (rtt !== undefined) {
            device.rtt = rtt;
          }
        }
      }

      if (isNew) {
        this.emit('device-discovered', device);
        log.info(`Device discovered: ${device.name} (methods: ${device.discoveryMethods.join(', ')}, rtt: ${device.rtt}ms)`);
      } else {
        this.emit('device-updated', device);
      }
    } catch (err) {
      log.warn('Failed to parse discovery message:', err);
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;

    const byeMessage = this.createDiscoveryMessage('bye');
    const buffer = Buffer.from(JSON.stringify(byeMessage));

    if (this.broadcaster4) {
      for (const address of this.getBroadcastAddresses4()) {
        this.broadcaster4.send(buffer, DISCOVERY_PORT, address);
      }
      this.broadcaster4.close();
      this.broadcaster4 = null;
    }

    if (this.broadcaster6) {
      this.broadcaster6.send(buffer, DISCOVERY_PORT, 'ff02::1');
      this.broadcaster6.close();
      this.broadcaster6 = null;
    }

    if (this.mdnsInstance) {
      this.mdnsInstance.respond({
        answers: [{
          name: MDNS_SERVICE,
          type: 'TXT',
          data: buffer
        }]
      });
      this.mdnsInstance.destroy();
      this.mdnsInstance = null;
    }

    if (this.refreshIntervalId) {
      clearInterval(this.refreshIntervalId);
      this.refreshIntervalId = null;
    }

    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    if (this.socket4) {
      this.socket4.close();
      this.socket4 = null;
    }

    if (this.socket6) {
      this.socket6.close();
      this.socket6 = null;
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
    this.updateLocalIps();
  }
}
