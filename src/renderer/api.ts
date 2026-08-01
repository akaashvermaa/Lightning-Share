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

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  currentFile: number;
  totalFiles: number;
  fileName: string;
}

type UploadProgressCallback = (progress: UploadProgress) => void;

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

function uploadFile(
  file: File,
  onProgress: (loaded: number) => void,
): Promise<FileInfo> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/upload`);
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.setRequestHeader('X-File-Size', String(file.size));
    xhr.setRequestHeader('X-File-Id', crypto.randomUUID());
    xhr.setRequestHeader('X-Mime-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed: HTTP ${xhr.status}`));
        return;
      }

      try {
        onProgress(file.size);
        resolve(JSON.parse(xhr.responseText) as FileInfo);
      } catch (error) {
        reject(error);
      }
    };

    xhr.onerror = () => reject(new Error(`Upload failed for ${file.name}`));
    xhr.onabort = () => reject(new Error(`Upload cancelled for ${file.name}`));
    xhr.send(file);
  });
}

async function uploadFiles(
  files: File[],
  onProgress?: UploadProgressCallback,
): Promise<FileInfo[]> {
  const loadedByFile = files.map(() => 0);
  const total = files.reduce((sum, file) => sum + file.size, 0);

  const reportProgress = (fileIndex: number) => {
    const loaded = loadedByFile.reduce((sum, bytes) => sum + bytes, 0);
    onProgress?.({
      loaded,
      total,
      percentage: total > 0 ? (loaded / total) * 100 : 100,
      currentFile: fileIndex + 1,
      totalFiles: files.length,
      fileName: files[fileIndex].name,
    });
  };

  onProgress?.({
    loaded: 0,
    total,
    percentage: total > 0 ? 0 : 100,
    currentFile: 1,
    totalFiles: files.length,
    fileName: files[0]?.name || '',
  });

  return Promise.all(files.map((file, index) =>
    uploadFile(file, (loaded) => {
      loadedByFile[index] = Math.min(loaded, file.size);
      reportProgress(index);
    }).then((fileInfo) => {
      loadedByFile[index] = file.size;
      reportProgress(index);
      return fileInfo;
    })
  ));
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

  selectFiles: async (onProgress?: UploadProgressCallback): Promise<FileInfo[]> => {
    const files = await pickFiles_helper(true);
    if (files.length === 0) return [];
    return uploadFiles(files, onProgress);
  },

  selectFolder: async (onProgress?: UploadProgressCallback): Promise<FileInfo[] | null> => {
    const files = await pickFolder_helper();
    if (files.length === 0) return null;
    return uploadFiles(files, onProgress);
  },

  startTransfer: async (
    deviceId: string,
    files: FileInfo[]
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return apiPost('/transfer/start', { deviceId, files });
  },

  acceptTransfer: async (sessionId: string, downloadPath?: string) => {
    console.log('[API] acceptTransfer POST', { sessionId, downloadPath });
    try {
      const res = await fetch(`${API_BASE}/api/transfer/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, downloadPath }),
      });
      console.log('[API] acceptTransfer response status:', res.status);
      if (!res.ok) {
        const text = await res.text();
        console.error('[API] acceptTransfer HTTP error:', res.status, text);
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const json = await res.json();
      console.log('[API] acceptTransfer response body:', json);
      return { success: true, ...json };
    } catch (e: any) {
      console.error('[API] acceptTransfer FETCH FAILED:', e?.message || e);
      throw e;
    }
  },
  rejectTransfer: async (sessionId: string) => {
    console.log('[API] rejectTransfer POST', { sessionId });
    try {
      const res = await fetch(`${API_BASE}/api/transfer/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      console.log('[API] rejectTransfer response status:', res.status);
      if (!res.ok) {
        const text = await res.text();
        console.error('[API] rejectTransfer HTTP error:', res.status, text);
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const json = await res.json();
      console.log('[API] rejectTransfer response body:', json);
      return { success: true, ...json };
    } catch (e: any) {
      console.error('[API] rejectTransfer FETCH FAILED:', e?.message || e);
      throw e;
    }
  },
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
  browseDirs: (dirPath?: string) =>
    apiGet<{ current: string; parent: string | null; dirs: { name: string; path: string }[] }>(
      `/browse-dirs${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ''}`
    ),
  getQuickDirs: () =>
    apiGet<{ label: string; path: string }[]>('/quick-dirs'),

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
