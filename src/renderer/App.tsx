import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import TransfersPage from './pages/TransfersPage';
import SettingsPage from './pages/SettingsPage';
import DiagnosticsPage from './pages/DiagnosticsPage';
import { useAppStore } from './stores/appStore';
import { useTransferStore } from './stores/transferStore';

declare global {
  interface Window {
    lightningshare: import('./api').LightningShareAPI;
  }
}

export default function App() {
  const { initialize, setDevices, addDevice, removeDevice } = useAppStore();
  const { setSessions, updateSession } = useTransferStore();
  const [completedNotice, setCompletedNotice] = useState<{ name: string; duration: string; avgSpeed: string; filePath?: string } | null>(null);
  const [startedNotice, setStartedNotice] = useState<{ name: string; direction: 'sending' | 'receiving'; deviceName: string } | null>(null);

  useEffect(() => {
    initialize();

    const unsubDeviceDiscovered = window.lightningshare.onDeviceDiscovered((device) => {
      addDevice(device);
    });

    const unsubDeviceLeft = window.lightningshare.onDeviceLeft((deviceId) => {
      removeDevice(deviceId);
    });

    const unsubSessionUpdated = window.lightningshare.onSessionUpdated((session) => {
      const existing = useTransferStore.getState().sessions.find(s => s.id === session.id);
      if (existing && existing.status !== 'transferring' && session.status === 'transferring') {
        setStartedNotice({
          name: session.files[0]?.name || 'Transfer',
          direction: session.direction,
          deviceName: session.deviceName,
        });
        window.setTimeout(() => setStartedNotice(null), 4000);
      }
      updateSession(session);
    });

    const unsubSessionCompleted = window.lightningshare.onSessionCompleted((session) => {
      updateSession(session);

      const durationSecs = session.completedAt && session.startedAt
        ? Math.max(1, Math.round((session.completedAt - session.startedAt) / 1000))
        : 1;
      const avgSpeedMBps = (session.totalSize / durationSecs) / (1024 * 1024);

      let durationStr = `${durationSecs}s`;
      if (durationSecs >= 60) {
        durationStr = `${Math.floor(durationSecs / 60)}m ${durationSecs % 60}s`;
      }

      setCompletedNotice({
        name: session.files[0]?.name || 'Transfer',
        duration: durationStr,
        avgSpeed: `${Math.round(avgSpeedMBps)} MB/s`,
        filePath: session.files[0]?.path,
      });
      window.setTimeout(() => setCompletedNotice(null), 8000);
    });

    const unsubSessionError = window.lightningshare.onSessionError((sessionId, error) => {
      const session = useTransferStore.getState().sessions.find(s => s.id === sessionId);
      if (session) {
        updateSession({ ...session, status: 'failed', error });
      }
    });

    const unsubIncomingTransfer = window.lightningshare.onIncomingTransfer((transfer) => {
      useTransferStore.getState().setIncomingTransfer(transfer);
    });

    window.lightningshare.getTransferSessions().then(setSessions);
    window.lightningshare.getDevices().then(setDevices);

    const devicePollInterval = setInterval(() => {
      window.lightningshare.getDevices().then(setDevices).catch(() => {});
    }, 5000);

    return () => {
      unsubDeviceDiscovered();
      unsubDeviceLeft();
      unsubSessionUpdated();
      unsubSessionCompleted();
      unsubSessionError();
      unsubIncomingTransfer();
      clearInterval(devicePollInterval);
    };
  }, []);

  return (
    <HashRouter>
      <div className="app-shell" style={{ background: '#0e0e11' }}>

        {/* Sidebar */}
        <nav
          style={{
            width: 220,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            borderRight: '1px solid rgba(255,255,255,0.07)',
            background: 'rgba(255,255,255,0.025)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
          }}
        >
          {/* Wordmark */}
          <div style={{ padding: '22px 20px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 9 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.80)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.88)', letterSpacing: '-0.01em' }}>
                LightningShare
              </span>
            </Link>
          </div>

          {/* Nav */}
          <div style={{ flex: 1, padding: '14px 12px' }}>
            <NavLink to="/" icon="home" label="Devices" />
            <NavLink to="/transfers" icon="transfer" label="Transfers" />
            <NavLink to="/settings" icon="settings" label="Settings" />
          </div>

          {/* Footer note */}
          <div style={{ padding: '14px 20px 20px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-label" style={{ marginBottom: 4 }}>Private by design</p>
            <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.28)', lineHeight: 1.55 }}>
              Files move directly across your local network. Nothing leaves your subnet.
            </p>
          </div>
        </nav>

        {/* Main content */}
        <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <Routes>
            <Route path="/"           element={<HomePage />} />
            <Route path="/transfers"  element={<TransfersPage />} />
            <Route path="/settings"   element={<SettingsPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
          </Routes>
        </main>

        {/* Mobile bottom nav */}
        <div className="mobile-nav">
          <NavLink to="/" icon="home" label="Devices" />
          <NavLink to="/transfers" icon="transfer" label="Transfers" />
          <NavLink to="/settings" icon="settings" label="Settings" />
        </div>

        {/* Toast — Transfer Started */}
        {startedNotice && (
          <div
            className="animate-slide-in glass-heavy"
            style={{
              position: 'fixed',
              bottom: 80,
              right: 20,
              zIndex: 50,
              width: 'min(340px, calc(100vw - 40px))',
              borderRadius: 12,
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
                  {startedNotice.direction === 'sending' ? 'Sending' : 'Receiving'}
                </span>
                <button
                  onClick={() => setStartedNotice(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.30)', padding: 0 }}
                  aria-label="Dismiss"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.48)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {startedNotice.name}
              </p>
              <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.30)' }}>
                {startedNotice.direction === 'sending' ? 'To' : 'From'} {startedNotice.deviceName}
              </p>
              <Link
                to="/transfers"
                onClick={() => setStartedNotice(null)}
                className="btn-ghost"
                style={{ marginTop: 6, fontSize: 12, padding: '6px 12px' }}
              >
                View progress
              </Link>
            </div>
          </div>
        )}

        {/* Toast — Transfer Completed */}
        {completedNotice && (
          <div
            className="animate-slide-in glass-heavy"
            style={{
              position: 'fixed',
              bottom: 80,
              right: 20,
              zIndex: 50,
              width: 'min(340px, calc(100vw - 40px))',
              borderRadius: 12,
              padding: '14px 16px',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
                  Transfer complete
                </span>
                <button
                  onClick={() => setCompletedNotice(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.30)', padding: 0 }}
                  aria-label="Dismiss"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
              <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.48)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {completedNotice.name}
              </p>
              <div
                style={{
                  marginTop: 6,
                  padding: '10px 12px',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.07)',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.30)', marginBottom: 3 }}>Duration</p>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.80)' }}>{completedNotice.duration}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.30)', marginBottom: 3 }}>Avg Speed</p>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.80)' }}>{completedNotice.avgSpeed}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                {completedNotice.filePath && (
                  <button
                    onClick={() => window.lightningshare.showFileInFolder(completedNotice.filePath!)}
                    className="btn-ghost"
                    style={{ flex: 1, fontSize: 12, padding: '6px 12px' }}
                  >
                    Open folder
                  </button>
                )}
                <button
                  onClick={() => setCompletedNotice(null)}
                  className="btn-ghost"
                  style={{ flex: 1, fontSize: 12, padding: '6px 12px' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </HashRouter>
  );
}

function NavLink({ to, icon, label }: { to: string; icon: string; label: string }) {
  const { pathname } = useLocation();
  const isActive = pathname === to;

  const icons: Record<string, JSX.Element> = {
    home: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
      </svg>
    ),
    transfer: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
    settings: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  };

  return (
    <Link to={to} className={`nav-link${isActive ? ' active' : ''}`}>
      {icons[icon]}
      <span>{label}</span>
    </Link>
  );
}
