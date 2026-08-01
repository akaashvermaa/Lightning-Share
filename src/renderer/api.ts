import {
  Device,
  FileInfo,
  TransferSession,
  IncomingTransfer,
  AppSettings,
} from '../shared/types';

const API_BASE = '';
const WS_URL = `ws://${location.host}/ws`;

let ws: WebSocket | null = null;
let wsReady: Promise<WebSocket> | null = null;
const wsEventHandlers = new Map<string, Set<Function>>();

function connectWS(): Promise<WebSocket> {
  if (ws && ws.readyState === WebSocket.OPEN) {
    return Promise.resolve(ws);
  }
  if (wsReady) return wsReady;

  wsReady = new Promise<WebSocket>((resolve) => {
    const socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      ws = socket;
      resolve(socket);
    };

    socket.onmessage = (event) => {
      try {
        const { event: eventName, data } = JSON.parse(event.data as string);
        const handlers = wsEventHandlers.get(eventName);
        if (handlers) {
          handlers.forEach((h) => h(data));
        }
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    socket.onclose = () => {
      ws = null;
      wsReady = null;
      setTimeout(() => {
        wsReady = null;
        connectWS();
      }, 2000);
    };

    socket.onerror = () => {
      socket.close();
    };

    ws = socket;
  });

  return wsReady;
}

connectWS();

function subscribeEvent(eventName: string, callback: Function): () => void {
  if (!wsEventHandlers.has(eventName)) {
    wsEventHandlers.set(eventName, new Set());
  }
  wsEventHandlers.get(eventName)!.add(callback);
  return () => {
    wsEventHandlers.get(eventName)?.delete(callback);
  };
}

async function apiGet<T>(pathSuffix: string): Promise<T> {
  const res = await fetch(`${API_BASE}/api/${pathSuffix}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiPost<T>(pathSuffix: string, body?: any): Promise<T> {
  const res = await fetch(`${API_BASE}/api/${pathSuffix}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function uploadFile(file: File): Promise<FileInfo> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    headers: {
      'X-File-Name': file.name,
      'X-File-Size': String(file.size),
      'X-File-Id': crypto.randomUUID(),
      'X-Mime-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });

  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

function pickFiles_helper(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      document.body.removeChild(input);
      resolve(files);
    });

    input.addEventListener('cancel', () => {
      document.body?.contains(input) && document.body.removeChild(input);
      resolve([]);
    });

    input.click();
  });
}

function pickFolder_helper(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    (input as any).webkitdirectory = true;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      document.body.removeChild(input);
      resolve(files);
    });

    input.addEventListener('cancel', () => {
      document.body?.contains(input) && document.body.removeChild(input);
      resolve([]);
    });

    input.click();
  });
}

function serializeSessionForClient(session: any): TransferSession {
  return {
    ...session,
    acknowledgedChunks: new Set(session.acknowledgedChunks || []),
  };
}

export const lightningshareAPI = {
  getServerInfo: () => apiGet<any>('/server-info'),
  getDeviceId: () => apiGet<{ id: string }>('/device-id').then((r) => r.id),
  getDeviceName: () => apiGet<{ name: string }>('/device-name').then((r) => r.name),
  setDeviceName: (name: string) => apiPost('/device-name', { name }).then(() => true),
  getDevices: () => apiGet<Device[]>('/devices'),
  getLocalIp: () => apiGet<{ ip: string }>('/local-ip').then((r) => r.ip),
  getSettings: () => apiGet<AppSettings>('/settings'),
  setSettings: (settings: Partial<AppSettings>) => apiPost<AppSettings>('/settings', settings),
  getDownloadPath: () =>
    apiGet<{ path: string }>('/download-path').then((r) => r.path),
  selectDownloadPath: () =>
    apiGet<{ path: string }>('/download-path').then((r) => r.path),

  selectFiles: async (): Promise<FileInfo[]> => {
    const files = await pickFiles_helper(true);
    if (files.length === 0) return [];
    const fileInfos = await Promise.all(files.map((f) => uploadFile(f)));
    return fileInfos;
  },

  selectFolder: async (): Promise<FileInfo[] | null> => {
    const files = await pickFolder_helper();
    if (files.length === 0) return null;
    const fileInfos = await Promise.all(files.map((f) => uploadFile(f)));
    return fileInfos;
  },

  startTransfer: async (
    deviceId: string,
    files: FileInfo[]
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return apiPost('/transfer/start', { deviceId, files });
  },

  acceptTransfer: (sessionId: string) =>
    apiPost('/transfer/accept', { sessionId }).then(() => ({ success: true })),
  rejectTransfer: (sessionId: string) =>
    apiPost('/transfer/reject', { sessionId }).then(() => ({ success: true })),
  cancelTransfer: (sessionId: string) =>
    apiPost('/transfer/cancel', { sessionId }).then(() => ({ success: true })),
  pauseTransfer: (sessionId: string) =>
    apiPost('/transfer/pause', { sessionId }).then(() => ({ success: true })),
  resumeTransfer: (sessionId: string) =>
    apiPost('/transfer/resume', { sessionId }).then(() => ({ success: true })),

  getTransferSessions: async (): Promise<TransferSession[]> => {
    const sessions = await apiGet<any[]>('/transfer/sessions');
    return sessions.map(serializeSessionForClient);
  },

  getTransferSession: async (sessionId: string): Promise<TransferSession | null> => {
    try {
      const session = await apiGet<any>(`/transfer/sessions/${sessionId}`);
      return serializeSessionForClient(session);
    } catch {
      return null;
    }
  },

  openFile: (filePath: string) =>
    apiPost('/open-file', { filePath }).then(() => ''),
  showFileInFolder: (filePath: string) =>
    apiPost('/show-in-folder', { filePath }).then(() => true),

  onDeviceDiscovered: (callback: (device: Device) => void) =>
    subscribeEvent('device-discovered', callback),
  onDeviceLeft: (callback: (deviceId: string) => void) =>
    subscribeEvent('device-left', callback),
  onSessionUpdated: (callback: (session: TransferSession) => void) =>
    subscribeEvent('session-updated', (data: any) =>
      callback(serializeSessionForClient(data))
    ),
  onSessionCompleted: (callback: (session: TransferSession) => void) =>
    subscribeEvent('session-completed', (data: any) =>
      callback(serializeSessionForClient(data))
    ),
  onSessionError: (callback: (sessionId: string, error: string) => void) =>
    subscribeEvent('session-error', (data: any) =>
      callback(data.sessionId, data.error)
    ),
  onIncomingTransfer: (callback: (transfer: IncomingTransfer) => void) =>
    subscribeEvent('incoming-transfer', callback),
  onDownloadPathChanged: (callback: (path: string) => void) =>
    subscribeEvent('download-path-changed', callback),
  onNetworkChange: (callback: (info: any) => void) =>
    subscribeEvent('network-change', callback),
};

export type LightningShareAPI = typeof lightningshareAPI;