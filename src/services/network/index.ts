import * as os from 'os';
import { EventEmitter } from 'events';
import log from '../../shared/logger';

export interface NetworkInterface {
  name: string;
  address: string;
  family: string;
  internal: boolean;
  broadcast?: string;
}

export interface NetworkChangeEvent {
  type: 'added' | 'removed' | 'changed';
  interface: string;
  address?: string;
  oldAddress?: string;
}

export class NetworkMonitor extends EventEmitter {
  private interfaces: Map<string, NetworkInterface[]> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor() {
    super();
  }

  start(): void {
    if (this.isRunning) return;

    this.checkInterfaces();
    this.intervalId = setInterval(() => {
      this.checkInterfaces();
    }, 2000);

    this.isRunning = true;
    log.info('Network monitor started');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    log.info('Network monitor stopped');
  }

  private getNetworkInterfaces(): Map<string, NetworkInterface[]> {
    const result = new Map<string, NetworkInterface[]>();
    const rawInterfaces = os.networkInterfaces();

    for (const [name, addrs] of Object.entries(rawInterfaces)) {
      if (!addrs) continue;

      const interfaces: NetworkInterface[] = [];
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          interfaces.push({
            name: name,
            address: addr.address,
            family: addr.family,
            internal: addr.internal,
          });
        }
      }

      if (interfaces.length > 0) {
        result.set(name, interfaces);
      }
    }

    return result;
  }

  private checkInterfaces(): void {
    const currentInterfaces = this.getNetworkInterfaces();
    const now = Date.now();

    for (const [name, addrs] of currentInterfaces) {
      const previous = this.interfaces.get(name);

      if (!previous) {
        this.emit('network-change', {
          type: 'added',
          interface: name,
          address: addrs[0]?.address,
        } as NetworkChangeEvent);
      } else {
        const prevAddr = previous[0]?.address;
        const currAddr = addrs[0]?.address;

        if (prevAddr !== currAddr) {
          this.emit('network-change', {
            type: 'changed',
            interface: name,
            oldAddress: prevAddr,
            address: currAddr,
          } as NetworkChangeEvent);
        }
      }
    }

    for (const [name, previous] of this.interfaces) {
      if (!currentInterfaces.has(name)) {
        this.emit('network-change', {
          type: 'removed',
          interface: name,
          oldAddress: previous[0]?.address,
        } as NetworkChangeEvent);
      }
    }

    this.interfaces = currentInterfaces;
  }

  getCurrentIp(): string {
    const interfaces = this.getNetworkInterfaces();
    for (const addrs of interfaces.values()) {
      if (addrs.length > 0 && addrs[0].address) {
        return addrs[0].address;
      }
    }
    return '127.0.0.1';
  }

  getAllAddresses(): string[] {
    const addresses: string[] = [];
    const interfaces = this.getNetworkInterfaces();
    for (const addrs of interfaces.values()) {
      for (const addr of addrs) {
        if (addr.address && !addresses.includes(addr.address)) {
          addresses.push(addr.address);
        }
      }
    }
    return addresses;
  }
}

export const networkMonitor = new NetworkMonitor();
