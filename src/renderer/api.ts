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

// ---------------------------------------------------------------------------
// Async generator: lazily yields FileInfo entries from a FileSystemDirectoryHandle.
// Ordering: small files first (README, configs, source), then large files.
// ---------------------------------------------------------------------------
async function* scanDirectory(
  dirHandle: FileSystemDirectoryHandle,
  relativePath = '',
): AsyncGenerator<{ relativePath: string; isDirectory: boolean; file?: File }> {
  const entries: FileSystemHandle[] = [];
  for await (const entry of (dirHandle as any).values()) {
    entries.push(entry);
  }

  const files: FileSystemFileHandle[] = [];
  const dirs: FileSystemDirectoryHandle[] = [];
  for (const entry of entries) {
    if (entry.kind === 'file') {
      files.push(entry as FileSystemFileHandle);
    } else {
      dirs.push(entry as FileSystemDirectoryHandle);
    }
  }

  // Yield the directory itself if it's an empty folder
  if (files.length === 0 && dirs.length === 0 && relativePath) {
    yield { relativePath: relativePath.replace(/\\/g, '/'), isDirectory: true };
    return;
  }

  // Sort files: large files last so the receiver sees progress immediately.
  const fileObjects: { handle: FileSystemFileHandle; file: File }[] = [];
  for (const handle of files) {
    const file = await handle.getFile();
    fileObjects.push({ handle, file });
  }
  fileObjects.sort((a, b) => a.file.size - b.file.size);

  for (const { handle, file } of fileObjects) {
    const p = relativePath ? `${relativePath}/${handle.name}` : handle.name;
    yield {
      relativePath: p.replace(/\\/g, '/'),
      isDirectory: false,
      file,
    };
  }

  for (const subDir of dirs) {
    const subPath = relativePath ? `${relativePath}/${subDir.name}` : subDir.name;
    yield* scanDirectory(subDir, subPath);
  }
}

// ---------------------------------------------------------------------------
// startStreamingSession: streams all files from a directory handle over the
// existing ws-stream WebSocket to the backend.
// ---------------------------------------------------------------------------
async function startStreamingSession(
  ws: WebSocket,
  sessionId: string,
  files: FileInfo[],
  onProgress?: (sentBytes: number, totalBytes: number, fileName: string) => void,
): Promise<void> {
  const CHUNK_SIZE = 512 * 1024; // 512 KB

  // Pre-compute total bytes so we can report accurate progress.
  // Folders via FileSystemDirectoryHandle have size=0 in the FileInfo,
  // so we scan them first to get the real total.
  let totalBytes = 0;
  for (const fi of files) {
    if (!fi.isDirectory) {
      totalBytes += (fi.fileRef as File)?.size ?? fi.size;
    } else if (Array.isArray(fi.fileRef)) {
      totalBytes += (fi.fileRef as File[]).reduce((s, f) => s + f.size, 0);
    }
    // FileSystemDirectoryHandle size is tallied dynamically below
  }
  let sentBytes = 0;

  for (const fileInfo of files) {
    const fileRef = fileInfo.fileRef;
    if (!fileRef) continue;

    if (fileInfo.isDirectory) {
      if (Array.isArray(fileRef)) {
        // Fallback: webkitdirectory gave us a flat Array<File> with webkitRelativePath set.
        for (const file of fileRef as File[]) {
          const entryId = crypto.randomUUID();
          const relativePath = (file as any).webkitRelativePath
            ? (file as any).webkitRelativePath.replace(/\\/g, '/')
            : file.name;

          ws.send(JSON.stringify({
            type: 'manifest-entry',
            sessionId,
            fileId: entryId,
            path: relativePath,
            size: file.size,
            mtime: file.lastModified,
            mimeType: file.type || 'application/octet-stream',
            isDirectory: false,
          }));

          if (file.size > 0) {
            let offset = 0;
            while (offset < file.size) {
              const slice = file.slice(offset, offset + CHUNK_SIZE);
              const buffer = await slice.arrayBuffer();

              const fileIdBytes = new TextEncoder().encode(entryId);
              const chunkIndex = Math.floor(offset / CHUNK_SIZE);
              const header = new ArrayBuffer(4 + fileIdBytes.byteLength + 4);
              const view = new DataView(header);
              view.setUint32(0, fileIdBytes.byteLength, false);
              new Uint8Array(header, 4, fileIdBytes.byteLength).set(fileIdBytes);
              view.setUint32(4 + fileIdBytes.byteLength, chunkIndex, false);

              const combined = new Uint8Array(header.byteLength + buffer.byteLength);
              combined.set(new Uint8Array(header), 0);
              combined.set(new Uint8Array(buffer), header.byteLength);

              ws.send(combined.buffer);
              sentBytes += buffer.byteLength;
              onProgress?.(sentBytes, totalBytes, relativePath);
              offset += buffer.byteLength;
            }
          }

          ws.send(JSON.stringify({ type: 'file-complete', sessionId, fileId: entryId }));
        }
      } else {
        // FileSystemDirectoryHandle — use async generator.
        // Seed relativePath with the folder name so all paths are like "FolderName/file.ext".
        const dirHandle = fileRef as FileSystemDirectoryHandle;

        for await (const { relativePath, isDirectory, file } of scanDirectory(dirHandle, dirHandle.name)) {
          // Dynamically add this file's size to the running total for directory handles
          if (!isDirectory && file) totalBytes += file.size;

          const entryId = crypto.randomUUID();

          // Send manifest-entry control message
          ws.send(JSON.stringify({
            type: 'manifest-entry',
            sessionId,
            fileId: entryId,
            path: relativePath,
            size: file ? file.size : 0,
            mtime: file ? file.lastModified : Date.now(),
            mimeType: file ? (file.type || 'application/octet-stream') : '',
            isDirectory,
          }));

          if (!isDirectory && file && file.size > 0) {
            // Stream raw binary chunks
            let offset = 0;
            while (offset < file.size) {
              const slice = file.slice(offset, offset + CHUNK_SIZE);
              const buffer = await slice.arrayBuffer();

              // Header: [4-byte fileId length][fileId UTF-8][4-byte chunkIndex][raw chunk]
              const fileIdBytes = new TextEncoder().encode(entryId);
              const chunkIndex = Math.floor(offset / CHUNK_SIZE);
              const header = new ArrayBuffer(4 + fileIdBytes.byteLength + 4);
              const view = new DataView(header);
              view.setUint32(0, fileIdBytes.byteLength, false);
              new Uint8Array(header, 4, fileIdBytes.byteLength).set(fileIdBytes);
              view.setUint32(4 + fileIdBytes.byteLength, chunkIndex, false);

              const combined = new Uint8Array(header.byteLength + buffer.byteLength);
              combined.set(new Uint8Array(header), 0);
              combined.set(new Uint8Array(buffer), header.byteLength);

              ws.send(combined.buffer);
              sentBytes += buffer.byteLength;
              onProgress?.(sentBytes, totalBytes, relativePath);
              offset += buffer.byteLength;
            }
          }

          // Signal end of this file
          ws.send(JSON.stringify({ type: 'file-complete', sessionId, fileId: entryId }));
        }
      } // end FileSystemDirectoryHandle branch
    } else {
      // Regular File object
      const file = fileRef as File;
      const entryId = fileInfo.id;
      const normalizedPath = file.name.replace(/\\/g, '/');

      ws.send(JSON.stringify({
        type: 'manifest-entry',
        sessionId,
        fileId: entryId,
        path: normalizedPath,
        size: file.size,
        mtime: file.lastModified,
        mimeType: file.type || 'application/octet-stream',
        isDirectory: false,
      }));

      if (file.size > 0) {
        let offset = 0;
        while (offset < file.size) {
          const slice = file.slice(offset, offset + CHUNK_SIZE);
          const buffer = await slice.arrayBuffer();

          const fileIdBytes = new TextEncoder().encode(entryId);
          const chunkIndex = Math.floor(offset / CHUNK_SIZE);
          const header = new ArrayBuffer(4 + fileIdBytes.byteLength + 4);
          const view = new DataView(header);
          view.setUint32(0, fileIdBytes.byteLength, false);
          new Uint8Array(header, 4, fileIdBytes.byteLength).set(fileIdBytes);
          view.setUint32(4 + fileIdBytes.byteLength, chunkIndex, false);

          const combined = new Uint8Array(header.byteLength + buffer.byteLength);
          combined.set(new Uint8Array(header), 0);
          combined.set(new Uint8Array(buffer), header.byteLength);

          ws.send(combined.buffer);
          offset += buffer.byteLength;
        }
      }

      ws.send(JSON.stringify({ type: 'file-complete', sessionId, fileId: entryId }));
    }
  }

  // Signal end of entire session manifest
  ws.send(JSON.stringify({ type: 'manifest-done', sessionId }));
}

function serializeSessionForClient(session: any): TransferSession {
  return {
    ...session,
    acknowledgedChunks: new Set(session.acknowledgedChunks || []),
  };
}

export const lightningshareAPI = {
  getServerInfo: () => apiGet<any>('/server-info'),
  getDiagnostics: () => apiGet<any>('/diagnostics'),
  exportDiagnostics: () => {
    window.open(`${API_BASE}/api/diagnostics/export`, '_blank', 'noopener,noreferrer');
  },
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

  // Returns FileInfo[] with fileRef attached — no pre-upload.
  selectFiles: async (_onProgress?: UploadProgressCallback): Promise<FileInfo[]> => {
    const files = await pickFiles_helper(true);
    if (files.length === 0) return [];
    return files.map((f) => ({
      id: crypto.randomUUID(),
      name: f.name,
      path: f.name,
      size: f.size,
      isDirectory: false,
      mimeType: f.type || 'application/octet-stream',
      mtime: f.lastModified,
      fileRef: f,
    }));
  },

  // Legacy helper still used by DropZone drag-and-drop.
  uploadFiles: (files: File[], onProgress?: UploadProgressCallback) =>
    uploadFiles(files, onProgress),

  // Prefer showDirectoryPicker (lazy, streaming). Falls back to webkitdirectory.
  selectFolder: async (_onProgress?: UploadProgressCallback): Promise<FileInfo[] | null> => {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({ mode: 'read' });
        return [{
          id: crypto.randomUUID(),
          name: handle.name,
          path: handle.name,
          size: 0,
          isDirectory: true,
          mimeType: 'application/x-directory',
          fileRef: handle,
        }];
      } catch (err) {
        if ((err as Error).name === 'AbortError') return null;
        // Permission/SecurityError — fall through to legacy picker
      }
    }

    // Fallback: webkitdirectory loads all File objects into memory upfront.
    const files = await pickFolder_helper();
    if (files.length === 0) return null;
    return [{
      id: crypto.randomUUID(),
      name: files[0]?.webkitRelativePath?.split('/')[0] || 'Selected Folder',
      path: 'Selected Folder',
      size: files.reduce((acc, f) => acc + f.size, 0),
      isDirectory: true,
      mimeType: 'application/x-directory',
      fileRef: files, // Array<File> instead of FileSystemDirectoryHandle
    }];
  },

  startTransfer: async (
    deviceId: string,
    files: FileInfo[],
    onProgress?: (sentBytes: number, totalBytes: number, fileName: string) => void,
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return new Promise((resolve) => {
      const wsUrl = `ws://${location.host}/ws-stream`;
      const streamWs = new WebSocket(wsUrl);
      streamWs.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Connection timed out' });
        streamWs.close();
      }, 10000);

      streamWs.onopen = () => {
        streamWs.send(JSON.stringify({ type: 'start', deviceId, fileCount: files.length }));
      };

      streamWs.onmessage = async (event) => {
        if (typeof event.data === 'string') {
          const msg = JSON.parse(event.data);

          if (msg.type === 'ready') {
            // Connection is alive — clear the handshake timeout so it doesn't
            // kill large file streams that take longer than 10 seconds.
            clearTimeout(timeout);
            // Start streaming files but do not resolve yet
            startStreamingSession(streamWs, msg.sessionId, files, onProgress).catch((err) => {
              console.error('[StreamTransfer] Streaming error:', err);
              resolve({ success: false, error: 'Streaming to backend failed' });
            });
          } else if (msg.type === 'transfer-started') {
            // Backend has completed streaming and created the session
            clearTimeout(timeout);
            resolve({ success: true, sessionId: msg.sessionId });
            streamWs.close();
          } else if (msg.type === 'error') {
            clearTimeout(timeout);
            resolve({ success: false, error: msg.error });
            streamWs.close();
          }
        }
      };

      streamWs.onerror = () => {
        clearTimeout(timeout);
        resolve({ success: false, error: 'WebSocket connection failed — falling back to HTTP' });
        streamWs.close();
        // Fallback: old HTTP upload + REST start
        apiPost<{ success: boolean; sessionId?: string; error?: string }>(
          '/transfer/start',
          { deviceId, files: files.map((f) => ({ ...f, fileRef: undefined })) }
        ).then(resolve).catch(() => resolve({ success: false, error: 'Transfer start failed' }));
      };

      streamWs.onclose = () => {
        // If we haven't resolved yet
        clearTimeout(timeout);
      };
    });
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
  clearHistory: () =>
    apiPost('/transfer/clear-history').then(() => ({ success: true })),
  
  runBenchmark: async (): Promise<{ readSpeedMBps: number; writeSpeedMBps: number; networkSpeedMBps: number }> => {
    return apiPost('/benchmark/run');
  },

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
