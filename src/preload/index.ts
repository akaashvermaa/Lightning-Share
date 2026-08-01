import { contextBridge, ipcRenderer } from 'electron';
import {
  Device,
  FileInfo,
  TransferSession,
  IncomingTransfer,
  AppSettings,
} from '../shared/types';

const api = {
  getDeviceId: (): Promise<string> => ipcRenderer.invoke('get-device-id'),
  getDeviceName: (): Promise<string> => ipcRenderer.invoke('get-device-name'),
  setDeviceName: (name: string): Promise<boolean> => ipcRenderer.invoke('set-device-name', name),
  getDevices: (): Promise<Device[]> => ipcRenderer.invoke('get-devices'),
  getLocalIp: (): Promise<string> => ipcRenderer.invoke('get-local-ip'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  setSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('set-settings', settings),
  getDownloadPath: (): Promise<string> => ipcRenderer.invoke('get-download-path'),
  selectDownloadPath: (): Promise<string | null> => ipcRenderer.invoke('select-download-path'),
  selectFiles: (): Promise<FileInfo[]> => ipcRenderer.invoke('select-files'),
  selectFolder: (): Promise<FileInfo[] | null> => ipcRenderer.invoke('select-folder'),
  startTransfer: (deviceId: string, files: FileInfo[]): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke('start-transfer', deviceId, files),
  acceptTransfer: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('accept-transfer', sessionId),
  rejectTransfer: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('reject-transfer', sessionId),
  cancelTransfer: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('cancel-transfer', sessionId),
  pauseTransfer: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('pause-transfer', sessionId),
  resumeTransfer: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('resume-transfer', sessionId),
  getTransferSessions: (): Promise<TransferSession[]> => ipcRenderer.invoke('get-transfer-sessions'),
  getTransferSession: (sessionId: string): Promise<TransferSession | null> =>
    ipcRenderer.invoke('get-transfer-session', sessionId),
  openFile: (filePath: string): Promise<string> => ipcRenderer.invoke('open-file', filePath),
  showFileInFolder: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('show-file-in-folder', filePath),

  onDeviceDiscovered: (callback: (device: Device) => void) => {
    const handler = (_: Electron.IpcRendererEvent, device: Device) => callback(device);
    ipcRenderer.on('device-discovered', handler);
    return () => ipcRenderer.removeListener('device-discovered', handler);
  },
  onDeviceLeft: (callback: (deviceId: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, deviceId: string) => callback(deviceId);
    ipcRenderer.on('device-left', handler);
    return () => ipcRenderer.removeListener('device-left', handler);
  },
  onSessionUpdated: (callback: (session: TransferSession) => void) => {
    const handler = (_: Electron.IpcRendererEvent, session: TransferSession) => callback(session);
    ipcRenderer.on('session-updated', handler);
    return () => ipcRenderer.removeListener('session-updated', handler);
  },
  onSessionCompleted: (callback: (session: TransferSession) => void) => {
    const handler = (_: Electron.IpcRendererEvent, session: TransferSession) => callback(session);
    ipcRenderer.on('session-completed', handler);
    return () => ipcRenderer.removeListener('session-completed', handler);
  },
  onSessionError: (callback: (sessionId: string, error: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, sessionId: string, error: string) =>
      callback(sessionId, error);
    ipcRenderer.on('session-error', handler);
    return () => ipcRenderer.removeListener('session-error', handler);
  },
  onIncomingTransfer: (callback: (transfer: IncomingTransfer) => void) => {
    const handler = (_: Electron.IpcRendererEvent, transfer: IncomingTransfer) => callback(transfer);
    ipcRenderer.on('incoming-transfer', handler);
    return () => ipcRenderer.removeListener('incoming-transfer', handler);
  },
  onDownloadPathChanged: (callback: (path: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, path: string) => callback(path);
    ipcRenderer.on('download-path-changed', handler);
    return () => ipcRenderer.removeListener('download-path-changed', handler);
  },
};

contextBridge.exposeInMainWorld('lightningshare', api);

export type LightningShareAPI = typeof api;
