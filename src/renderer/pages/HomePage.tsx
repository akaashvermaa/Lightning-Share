import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { useTransferStore } from '../stores/transferStore';
import DeviceCard from '../components/DeviceCard';
import TransferModal from '../components/TransferModal';
import IncomingTransferToast from '../components/IncomingTransferToast';
import { formatSpeed } from '../components/SpeedGraph';

export default function HomePage() {
  const { devices, localIp } = useAppStore();
  const { sessions, incomingTransfers } = useTransferStore();
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [copied, setCopied] = useState(false);

  // Detect if the user is accessing this server from a different device's browser.
  // In that case they can't send/receive files because they have no local transfer server.
  const isRemoteBrowser = serverInfo
    ? !serverInfo.allAddresses?.some((addr: string) => addr === window.location.hostname) &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    : false;

  useEffect(() => {
    window.lightningshare.getServerInfo().then(setServerInfo).catch(() => {});
    const interval = setInterval(() => {
      window.lightningshare.getServerInfo().then(setServerInfo).catch(() => {});
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSendFiles = useCallback((deviceId: string) => {
    setSelectedDevice(deviceId);
    setIsModalOpen(true);
  }, []);

  const handleModalClose = useCallback(() => {
    setIsModalOpen(false);
    setSelectedDevice(null);
  }, []);

  const handleCopyUrl = useCallback(() => {
    if (serverInfo?.url) {
      navigator.clipboard.writeText(serverInfo.url).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  }, [serverInfo]);

  const activeTransfers = sessions.filter(
    s => s.status === 'transferring' || s.status === 'paused' || s.status === 'reconnecting' || s.status === 'connecting' || s.status === 'pending'
  );
  const recentCompleted = sessions.filter(s => s.status === 'completed').slice(-3);
  const failedTransfers = sessions.filter(
    s => s.status === 'failed' || s.status === 'declined'
  );

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Nearby Devices</h2>
            <p className="text-sm text-slate-500 mt-1">
              Your IP: <span className="font-mono text-slate-600">{localIp || serverInfo?.localIp}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            {serverInfo && (
              <button
                onClick={handleCopyUrl}
                className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-full text-sm hover:bg-blue-100 transition-colors"
                title="Click to copy server URL"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                {copied ? 'Copied!' : serverInfo.url}
              </button>
            )}
            <span className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-600 rounded-full text-sm">
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              {serverInfo?.running ? 'Server Live' : 'Online'}
            </span>
          </div>
        </div>
      </header>

      {serverInfo && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b border-blue-100 px-8 py-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-slate-800">
                  LightningShare server is running
                </p>
                <p className="text-xs text-slate-500">
                  Other devices can find you at <span className="font-mono font-medium text-blue-600">{serverInfo.url}</span>
                  {serverInfo.allAddresses?.length > 1 && (
                    <span> or </span>
                  )}
                  {serverInfo.allAddresses?.slice(1).map((addr: string, i: number) => (
                    <span key={i} className="font-mono font-medium text-blue-600">
                      {i > 0 ? ', ' : ''}http://{addr}:{serverInfo.port}
                    </span>
                  ))}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyUrl}
                className="px-3 py-1.5 text-xs font-medium text-blue-600 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copied ? 'Copied!' : 'Copy URL'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remote browser warning: this device doesn't have a server running */}
      {isRemoteBrowser && (
        <div className="bg-amber-50 border-b border-amber-200 px-8 py-3">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-amber-800">You're viewing another device's server</p>
              <p className="text-xs text-amber-700 mt-0.5">
                To send or receive files <span className="font-semibold">from this device</span>, you must also run LightningShare on it.
                Download and run <code className="px-1 py-0.5 bg-amber-100 rounded font-mono">start.bat</code> on this machine, then open{' '}
                <code className="px-1 py-0.5 bg-amber-100 rounded font-mono">http://localhost:{serverInfo?.port || 51236}</code> in this browser.
              </p>
            </div>
          </div>
        </div>
      )}

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
            <div className="mt-6 p-4 bg-blue-50 rounded-lg max-w-md text-left">
              <p className="text-sm font-medium text-blue-900 mb-2">How to connect another device:</p>
              <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
                <li>Install LightningShare on the other device</li>
                <li>Run <code className="px-1.5 py-0.5 bg-blue-100 rounded font-mono text-xs">npm run launch</code> or double-click <code className="px-1.5 py-0.5 bg-blue-100 rounded font-mono text-xs">start.bat</code></li>
                <li>Or open this URL in the other device's browser: <span className="font-mono text-xs break-all">{serverInfo?.url}</span></li>
              </ol>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {devices.map(device => (
              <DeviceCard
                key={device.id}
                device={device}
                onSend={() => handleSendFiles(device.id)}
                disabled={isRemoteBrowser}
              />
            ))}
          </div>
        )}
      </div>

      {(activeTransfers.length > 0 || failedTransfers.length > 0 || recentCompleted.length > 0) && (
        <div className="border-t border-slate-200 bg-white p-4 max-h-64 overflow-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-slate-700 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
              Transfer Activity
            </h3>
            <span className="text-xs text-slate-400">
              {activeTransfers.length} active · {recentCompleted.length} completed · {failedTransfers.length} failed
            </span>
          </div>
          <div className="space-y-2">
            {activeTransfers.map(session => (
              <ActivityRow key={session.id} session={session} />
            ))}
            {failedTransfers.slice(-2).map(session => (
              <ActivityRow key={session.id} session={session} />
            ))}
            {recentCompleted.map(session => (
              <ActivityRow key={session.id} session={session} />
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

function ActivityRow({ session }: { session: any }) {
  const progress = session.totalSize > 0 ? (session.transferredBytes / session.totalSize) * 100 : 0;
  const isActive = session.status === 'transferring';
  const isPaused = session.status === 'paused';
  const isCompleted = session.status === 'completed';
  const isFailed = session.status === 'failed' || session.status === 'declined' || session.status === 'cancelled';
  const isSending = session.direction === 'sending';

  return (
    <div className={`bg-slate-50 rounded-lg p-3 border-l-2 ${
      isFailed ? 'border-red-400' : isCompleted ? 'border-green-400' : isSending ? 'border-blue-400' : 'border-purple-400'
    }`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <svg className={`w-3.5 h-3.5 flex-shrink-0 ${isSending ? 'text-blue-500' : 'text-purple-500'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isSending ? (
              <>
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </>
            ) : (
              <>
                <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
              </>
            )}
          </svg>
          <span className="text-sm font-medium text-slate-700 truncate">
            {session.files[0]?.name}
            {session.files.length > 1 && ` +${session.files.length - 1}`}
          </span>
          <span className="text-xs text-slate-400 flex-shrink-0">
            {isSending ? '→' : '←'} {session.deviceName}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs flex-shrink-0">
          {isActive && (
            <span className="text-green-600 font-medium">{formatSpeed(session.speed)}</span>
          )}
          {isPaused && <span className="text-amber-500 font-medium">Paused</span>}
          {isCompleted && <span className="text-green-600 font-medium">Done</span>}
          {isFailed && <span className="text-red-500 font-medium">{session.status}</span>}
          {!isActive && !isPaused && !isCompleted && !isFailed && (
            <span className="text-slate-500">{session.status}</span>
          )}
          {session.error && (
            <span className="text-red-400" title={session.error}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </span>
          )}
          <span className="text-slate-400 font-mono">
            {formatBytes(session.transferredBytes)}/{formatBytes(session.totalSize)}
          </span>
        </div>
      </div>
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${
            isCompleted ? 'bg-green-500' : isFailed ? 'bg-red-400' : isPaused ? 'bg-amber-400' : 'bg-blue-500'
          }`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>
      {isActive && session.remainingTime > 0 && (
        <div className="text-right text-xs text-slate-400 mt-0.5">
          {formatTime(session.remainingTime)} remaining · {progress.toFixed(0)}%
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (!bytes || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(seconds: number): string {
  if (seconds < 1) return '<1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}