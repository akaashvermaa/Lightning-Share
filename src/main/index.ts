import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { createWindow, getMainWindow } from './window';
import { setupMenu } from './menu';
import { setupIpcHandlers } from './ipc';
import { DiscoveryService } from '../services/discovery';
import { TransferService } from '../services/transfer';
import { FileService } from '../services/file';

log.initialize();
log.transports.file.level = 'info';
log.transports.console.level = 'debug';

log.info('LightningShare starting...');

process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
  app.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason);
});

let discoveryService: DiscoveryService;
let transferService: TransferService;
let fileService: FileService;

async function initializeServices(): Promise<void> {
  fileService = new FileService();
  transferService = new TransferService(fileService);
  discoveryService = new DiscoveryService();

  await discoveryService.start();
  log.info('Services initialized');
}

app.whenReady().then(async () => {
  log.info('App ready');

  setupMenu();
  createWindow();

  await initializeServices();
  setupIpcHandlers(discoveryService, transferService, fileService);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  log.info('App quitting...');
  if (discoveryService) {
    await discoveryService.stop();
  }
  if (transferService) {
    await transferService.stop();
  }
});

export { discoveryService, transferService, fileService };
