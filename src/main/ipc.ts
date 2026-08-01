import { ipcMain, dialog, app, BrowserWindow } from 'electron';
import * as os from 'os';
import * as path from 'path';
import log from 'electron-log';
import { DiscoveryService } from '../services/discovery';
import { TransferService } from '../services/transfer';
import { FileService } from '../services/file';
import {
  Device,
  FileInfo,
  TransferSession,
  IncomingTransfer,
  AppSettings,
} from '../shared/types';
import { DEFAULT_APP_SETTINGS } from '../shared/constants';
import { getChunkSizeForFile, COMPRESSION_THRESHOLD } from '../shared/constants';

let settings: AppSettings = { ...DEFAULT_APP_SETTINGS, deviceName: os.hostname() };

export function setupIpcHandlers(
  discoveryService: DiscoveryService,
  transferService: TransferService,
  fileService: FileService
): void {
  ipcMain.handle('get-device-id', () => discoveryService.getDeviceId());

  ipcMain.handle('get-device-name', () => settings.deviceName);

  ipcMain.handle('set-device-name', (_, name: string) => {
    settings.deviceName = name;
    discoveryService.setDeviceName(name);
    return true;
  });

  ipcMain.handle('get-devices', () => discoveryService.getDevices());

  ipcMain.handle('get-local-ip', () => {
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
  });

  ipcMain.handle('get-settings', () => settings);

  ipcMain.handle('set-settings', (_, newSettings: Partial<AppSettings>) => {
    settings = { ...settings, ...newSettings };
    return settings;
  });

  ipcMain.handle('get-download-path', async () => {
    if (settings.downloadPath) return settings.downloadPath;
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Download Folder',
    });
    if (!result.canceled && result.filePaths[0]) {
      settings.downloadPath = result.filePaths[0];
      return result.filePaths[0];
    }
    return app.getPath('downloads');
  });

  ipcMain.handle('select-download-path', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Download Folder',
    });
    if (!result.canceled && result.filePaths[0]) {
      settings.downloadPath = result.filePaths[0];
      return result.filePaths[0];
    }
    return null;
  });

  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Select Files to Send',
    });
    if (result.canceled) return [];
    const files: FileInfo[] = [];
    for (const filePath of result.filePaths) {
      const info = await fileService.getFileInfo(filePath);
      if (info) files.push(info);
    }
    return files;
  });

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Folder to Send',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return fileService.getFolderInfo(result.filePaths[0]);
  });

  ipcMain.handle('start-transfer', async (_, deviceId: string, files: FileInfo[]) => {
    const device = discoveryService.getDevices().find(d => d.id === deviceId);
    if (!device) {
      log.error('Device not found:', deviceId);
      return { success: false, error: 'Device not found' };
    }
    const session = await transferService.createSession(device, files, 'sending');
    if (!session) {
      return { success: false, error: 'Failed to create session' };
    }
    await transferService.startSession(session.id);
    return { success: true, sessionId: session.id };
  });

  ipcMain.handle('accept-transfer', async (_, sessionId: string) => {
    const downloadPath = settings.downloadPath || app.getPath('downloads');
    await transferService.acceptSession(sessionId, downloadPath);
    return { success: true };
  });

  ipcMain.handle('reject-transfer', async (_, sessionId: string) => {
    await transferService.rejectSession(sessionId);
    return { success: true };
  });

  ipcMain.handle('cancel-transfer', async (_, sessionId: string) => {
    await transferService.cancelSession(sessionId);
    return { success: true };
  });

  ipcMain.handle('pause-transfer', async (_, sessionId: string) => {
    await transferService.pauseSession(sessionId);
    return { success: true };
  });

  ipcMain.handle('resume-transfer', async (_, sessionId: string) => {
    await transferService.resumeSession(sessionId);
    return { success: true };
  });

  ipcMain.handle('get-transfer-sessions', () => transferService.getSessions());

  ipcMain.handle('get-transfer-session', (_, sessionId: string) =>
    transferService.getSession(sessionId)
  );

  ipcMain.handle('open-file', async (_, filePath: string) => {
    const { shell } = await import('electron');
    return shell.openPath(filePath);
  });

  ipcMain.handle('show-file-in-folder', async (_, filePath: string) => {
    const { shell } = await import('electron');
    shell.showItemInFolder(filePath);
    return true;
  });

  discoveryService.on('device-discovered', (device: Device) => {
    const win = BrowserWindow.getFocusedWindow();
    win?.webContents.send('device-discovered', device);
  });

  discoveryService.on('device-left', (deviceId: string) => {
    const win = BrowserWindow.getFocusedWindow();
    win?.webContents.send('device-left', deviceId);
  });

  transferService.on('session-updated', (session: TransferSession) => {
    const win = BrowserWindow.getFocusedWindow();
    win?.webContents.send('session-updated', session);
  });

  transferService.on('session-completed', (session: TransferSession) => {
    const win = BrowserWindow.getFocusedWindow();
    win?.webContents.send('session-completed', session);
  });

  transferService.on('session-error', (sessionId: string, error: string) => {
    const win = BrowserWindow.getFocusedWindow();
    win?.webContents.send('session-error', sessionId, error);
  });

  transferService.on('incoming-transfer', (transfer: IncomingTransfer) => {
    const win = BrowserWindow.getFocusedWindow();
    win?.webContents.send('incoming-transfer', transfer);
  });

  log.info('IPC handlers registered');
}
