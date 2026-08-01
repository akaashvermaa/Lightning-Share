import { Menu, shell, app, BrowserWindow } from 'electron';
import log from 'electron-log';

export function setupMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Select Download Folder',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const { dialog } = await import('electron');
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths[0]) {
              const win = BrowserWindow.getFocusedWindow();
              win?.webContents.send('download-path-changed', result.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About LightningShare',
          click: async () => {
            const { dialog } = await import('electron');
            dialog.showMessageBox({
              type: 'info',
              title: 'About LightningShare',
              message: 'LightningShare v1.0.0',
              detail: 'Fast, reliable LAN file transfer application.',
            });
          },
        },
        {
          label: 'Open Logs Folder',
          click: () => {
            shell.openPath(log.transports.file.getFile().path.replace(/[^\\\/]+$/, ''));
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
