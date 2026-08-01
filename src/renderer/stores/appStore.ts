import { create } from 'zustand';
import { Device, AppSettings } from '../../shared/types';

const DEFAULT_APP_SETTINGS: AppSettings = {
  deviceName: '',
  downloadPath: '',
  autoAcceptFromTrusted: false,
  trustedDevices: [],
  compressionEnabled: true,
  theme: 'system',
};

interface AppState {
  deviceId: string;
  deviceName: string;
  localIp: string;
  devices: Device[];
  settings: AppSettings;
  downloadPath: string;
  isInitialized: boolean;

  initialize: () => Promise<void>;
  setDevices: (devices: Device[]) => void;
  addDevice: (device: Device) => void;
  removeDevice: (deviceId: string) => void;
  setSettings: (settings: Partial<AppSettings>) => Promise<void>;
  setDownloadPath: (path: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  deviceId: '',
  deviceName: '',
  localIp: '',
  devices: [],
  settings: DEFAULT_APP_SETTINGS,
  downloadPath: '',
  isInitialized: false,

  initialize: async () => {
    const [deviceId, deviceName, localIp, settings, downloadPath] = await Promise.all([
      window.lightningshare.getDeviceId(),
      window.lightningshare.getDeviceName(),
      window.lightningshare.getLocalIp(),
      window.lightningshare.getSettings(),
      window.lightningshare.getDownloadPath(),
    ]);

    set({
      deviceId,
      deviceName,
      localIp,
      settings,
      downloadPath,
      isInitialized: true,
    });
  },

  setDevices: (devices) => set({ devices }),

  addDevice: (device) => {
    const exists = get().devices.some(d => d.id === device.id);
    if (!exists) {
      set({ devices: [...get().devices, device] });
    } else {
      set({
        devices: get().devices.map(d =>
          d.id === device.id ? { ...device, lastSeen: d.lastSeen } : d
        ),
      });
    }
  },

  removeDevice: (deviceId) => {
    set({ devices: get().devices.filter(d => d.id !== deviceId) });
  },

  setSettings: async (newSettings) => {
    const settings = await window.lightningshare.setSettings(newSettings);
    set({ settings });
  },

  setDownloadPath: (path) => set({ downloadPath: path }),
}));
