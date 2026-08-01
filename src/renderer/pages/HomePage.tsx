import { useState, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { useTransferStore } from '../stores/transferStore';
import DeviceCard from '../components/DeviceCard';
import TransferModal from '../components/TransferModal';
import IncomingTransferToast from '../components/IncomingTransferToast';

export default function HomePage() {
  const { devices, localIp } = useAppStore();
  const { sessions, incomingTransfers } = useTransferStore();
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSendFiles = useCallback((deviceId: string) => {
    setSelectedDevice(deviceId);
    setIsModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setSelectedDevice(null);
  }, []);

  const activeTransfers = sessions.filter(
    s => s.status === 'transferring' || s.status === 'paused' || s.status === 'reconnecting'
  );

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Nearby Devices</h2>
            <p className="text-sm text-slate-500 mt-1">
              Your IP: {localIp}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-2 px-3 py-1.5 bg-success/10 text-success rounded-full text-sm">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
              Online
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        {devices.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6">
              <svg className="w-12 h-12 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">No devices found</h3>
            <p className="text-slate-500 max-w-sm">
              Make sure other devices are connected to the same Wi-Fi network and running LightningShare.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map(device => (
              <DeviceCard
                key={device.id}
                device={device}
                onSend={() => handleSendFiles(device.id)}
              />
            ))}
          </div>
        )}
      </div>

      {activeTransfers.length > 0 && (
        <div className="border-t border-slate-200 bg-white p-4">
          <h3 className="text-sm font-medium text-slate-700 mb-3">Active Transfers</h3>
          <div className="space-y-2">
            {activeTransfers.slice(0, 3).map(session => (
              <TransferProgressBar key={session.id} session={session} />
            ))}
          </div>
        </div>
      )}

      {incomingTransfers.map(transfer => (
        <IncomingTransferToast
          key={transfer.sessionId}
          transfer={transfer}
        />
      ))}

      {isModalOpen && selectedDevice && (
        <TransferModal
          deviceId={selectedDevice}
          onClose={handleModalClose}
        />
      )}
    </div>
  );
}

function TransferProgressBar({ session }: { session: any }) {
  const progress = (session.transferredBytes / session.totalSize) * 100;

  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700 truncate">
          {session.files[0]?.name}
          {session.files.length > 1 && ` (+${session.files.length - 1})`}
        </span>
        <span className="text-sm text-slate-500">
          {formatBytes(session.transferredBytes)} / {formatBytes(session.totalSize)}
        </span>
      </div>
      <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
