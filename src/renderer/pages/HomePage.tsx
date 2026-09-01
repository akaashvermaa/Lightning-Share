import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { useTransferStore } from '../stores/transferStore';
import DeviceCard from '../components/DeviceCard';
import TransferModal from '../components/TransferModal';
import IncomingTransferToast from '../components/IncomingTransferToast';
import { formatSpeed } from '../components/SpeedGraph';

export default function HomePage() {
  const { devices, localIp, settings, setSettings } = useAppStore();
  const { sessions, incomingTransfers } = useTransferStore();
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [nextDevices, nextServerInfo] = await Promise.all([
        window.lightningshare.getDevices(),
        window.lightningshare.getServerInfo(),
      ]);
      useAppStore.getState().setDevices(nextDevices);
      setServerInfo(nextServerInfo);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const activeTransfers = sessions.filter(
    s => s.status === 'transferring' || s.status === 'paused' || s.status === 'reconnecting' || s.status === 'connecting' || s.status === 'pending'
  );
  const recentCompleted = sessions.filter(s => s.status === 'completed').slice(-3);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <header style={{
        padding: '20px 28px 18px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexShrink: 0,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.88)', letterSpacing: '-0.01em' }}>
              Nearby Devices
            </h2>
            <span style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 100,
              background: 'rgba(255,255,255,0.07)',
              color: 'rgba(255,255,255,0.38)',
              border: '1px solid rgba(255,255,255,0.09)',
            }}>
              {devices.length}
            </span>
          </div>
          {(localIp || serverInfo?.localIp) && (
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginTop: 4, fontFamily: 'monospace' }}>
              {localIp || serverInfo?.localIp}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Server status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              className="dot-online animate-pulse-dot"
              style={{ opacity: serverInfo?.running ? 1 : 0.3 }}
            />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
              {serverInfo?.running ? 'server running' : 'offline'}
            </span>
          </div>

          {/* Copy URL */}
          {serverInfo?.url && (
            <button
              onClick={handleCopyUrl}
              className="btn-ghost"
              style={{ fontSize: 12, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}
              title="Copy server URL"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
              {copied ? 'Copied' : 'Copy URL'}
            </button>
          )}

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="btn-ghost"
            style={{ padding: '7px 10px' }}
            title="Refresh devices"
            aria-label="Refresh devices"
          >
            <svg
              width="14" height="14"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ display: 'block', animation: isRefreshing ? 'spin 0.75s linear infinite' : 'none' }}
            >
              <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 13a8.1 8.1 0 0 0 15.5 2" />
              <polyline points="16 3 20 3 20 7" />
              <polyline points="8 21 4 21 4 17" />
            </svg>
          </button>
        </div>
      </header>

      {/* Remote browser warning */}
      {isRemoteBrowser && (
        <div style={{
          padding: '10px 28px',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
          background: 'rgba(255,200,50,0.05)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,200,50,0.60)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <p style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,200,50,0.75)' }}>
              Viewing another device's server
            </p>
            <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.32)', marginTop: 2 }}>
              Run <code style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.07)', padding: '1px 5px', borderRadius: 4 }}>npm start</code> on this machine to send or receive files.
            </p>
          </div>
        </div>
      )}

      {/* Device grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {devices.length === 0 ? (
          /* Empty state */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 400,
            textAlign: 'center',
          }}>
            <div style={{
              width: 60,
              height: 60,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 18,
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.60)', marginBottom: 8 }}>
              No devices found
            </h3>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.28)', maxWidth: 300, lineHeight: 1.6 }}>
              Make sure other devices are on the same network and running LightningShare.
            </p>

            {/* Quick guide */}
            <div
              className="glass"
              style={{
                marginTop: 24,
                padding: '16px 20px',
                borderRadius: 10,
                textAlign: 'left',
                maxWidth: 340,
                width: '100%',
              }}
            >
              <p className="text-label" style={{ marginBottom: 10 }}>Getting started</p>
              <ol style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  'Install LightningShare on another device',
                  'Run npm start on that device',
                  'Devices appear here automatically via mDNS',
                ].map((step, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'rgba(255,255,255,0.30)',
                      background: 'rgba(255,255,255,0.06)',
                      borderRadius: 4,
                      padding: '1px 6px',
                      flexShrink: 0,
                      marginTop: 1,
                    }}>
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{step}</span>
                  </li>
                ))}
              </ol>
              {serverInfo?.url && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.28)', marginBottom: 4 }}>Or share this URL with another browser on the same network:</p>
                  <p style={{ fontSize: 11.5, fontFamily: 'monospace', color: 'rgba(255,255,255,0.45)', wordBreak: 'break-all' }}>{serverInfo.url}</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Device grid */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.30)' }}>
                Select a device to start a transfer.
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="dot-online" style={{ width: 6, height: 6 }} />
                <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.30)' }}>network ready</span>
              </div>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
            }}>
              {devices.map(device => {
                const isTrusted = settings.trustedDevices?.includes(device.id);
                return (
                  <DeviceCard
                    key={device.id}
                    device={device}
                    onSend={() => handleSendFiles(device.id)}
                    disabled={isRemoteBrowser}
                    isTrusted={isTrusted}
                    onToggleTrust={() => {
                      const newTrusted = isTrusted
                        ? (settings.trustedDevices || []).filter(id => id !== device.id)
                        : [...(settings.trustedDevices || []), device.id];
                      setSettings({ trustedDevices: newTrusted });
                    }}
                  />
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Transfer activity bar */}
      {(activeTransfers.length > 0 || recentCompleted.length > 0) && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '14px 28px',
          maxHeight: 220,
          overflow: 'auto',
          flexShrink: 0,
          background: 'rgba(255,255,255,0.02)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p className="text-label">Transfer activity</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Link to="/transfers" style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', textDecoration: 'none' }}>
                View all
              </Link>
              <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.22)' }}>
                {activeTransfers.length} active · {recentCompleted.length} completed
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeTransfers.map(session => <ActivityRow key={session.id} session={session} />)}
            {recentCompleted.map(session => <ActivityRow key={session.id} session={session} />)}
          </div>
        </div>
      )}

      {incomingTransfers.map(transfer => (
        <IncomingTransferToast key={transfer.sessionId} transfer={transfer} />
      ))}

      {isModalOpen && selectedDevice && (
        <TransferModal deviceId={selectedDevice} onClose={handleModalClose} />
      )}
    </div>
  );
}

function ActivityRow({ session }: { session: any }) {
  const progress = session.totalSize > 0 ? (session.transferredBytes / session.totalSize) * 100 : 0;
  const isActive    = session.status === 'transferring';
  const isPaused    = session.status === 'paused';
  const isCompleted = session.status === 'completed';
  const isFailed    = ['failed', 'declined', 'cancelled'].includes(session.status);
  const isSending   = session.direction === 'sending';

  return (
    <div
      className="glass"
      style={{ borderRadius: 8, padding: '10px 14px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isSending ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.35)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,0.72)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.files[0]?.name}
            {session.files.length > 1 && ` +${session.files.length - 1}`}
          </span>
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>
            {isSending ? 'to' : 'from'} {session.deviceName}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, flexShrink: 0 }}>
          {isActive    && <span style={{ color: '#4ade80', fontWeight: 500 }}>{formatSpeed(session.speed)}</span>}
          {isPaused    && <span style={{ color: 'rgba(255,200,50,0.70)' }}>paused</span>}
          {isCompleted && <span style={{ color: '#4ade80' }}>done</span>}
          {isFailed    && <span style={{ color: 'rgba(255,80,80,0.75)' }}>{session.status}</span>}
          <span style={{ color: 'rgba(255,255,255,0.22)', fontFamily: 'monospace' }}>
            {formatBytes(session.transferredBytes)}/{formatBytes(session.totalSize)}
          </span>
        </div>
      </div>

      {/* Progress track */}
      <div className="progress-track">
        <div
          className={`progress-fill${isCompleted ? ' success' : isFailed ? ' error' : isPaused ? ' paused' : ''}`}
          style={{ width: `${Math.min(progress, 100)}%` }}
        />
      </div>

      {isActive && session.remainingTime > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>
            {formatTime(session.remainingTime)} remaining · {progress.toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B';
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
