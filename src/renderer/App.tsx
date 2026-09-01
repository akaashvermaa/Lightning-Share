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

    const unsubDeviceDiscovered = window.lightningshare.onDeviceDiscovered((device) => addDevice(device));
    const unsubDeviceLeft = window.lightningshare.onDeviceLeft((deviceId) => removeDevice(deviceId));

    const unsubSessionUpdated = window.lightningshare.onSessionUpdated((session) => {
      const existing = useTransferStore.getState().sessions.find(s => s.id === session.id);
      if (existing && existing.status !== 'transferring' && session.status === 'transferring') {
        setStartedNotice({ name: session.files[0]?.name || 'Transfer', direction: session.direction, deviceName: session.deviceName });
        window.setTimeout(() => setStartedNotice(null), 4000);
      }
      updateSession(session);
    });

    const unsubSessionCompleted = window.lightningshare.onSessionCompleted((session) => {
      updateSession(session);
      const durationSecs = session.completedAt && session.startedAt
        ? Math.max(1, Math.round((session.completedAt - session.startedAt) / 1000)) : 1;
      const avgSpeedMBps = (session.totalSize / durationSecs) / (1024 * 1024);
      let durationStr = `${durationSecs}s`;
      if (durationSecs >= 60) durationStr = `${Math.floor(durationSecs / 60)}m ${durationSecs % 60}s`;
      setCompletedNotice({ name: session.files[0]?.name || 'Transfer', duration: durationStr, avgSpeed: `${Math.round(avgSpeedMBps)} MB/s`, filePath: session.files[0]?.path });
      window.setTimeout(() => setCompletedNotice(null), 8000);
    });

    const unsubSessionError = window.lightningshare.onSessionError((sessionId, error) => {
      const session = useTransferStore.getState().sessions.find(s => s.id === sessionId);
      if (session) updateSession({ ...session, status: 'failed', error });
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
      unsubDeviceDiscovered(); unsubDeviceLeft(); unsubSessionUpdated();
      unsubSessionCompleted(); unsubSessionError(); unsubIncomingTransfer();
      clearInterval(devicePollInterval);
    };
  }, []);

  return (
    <HashRouter>
      <div
        style={{
          height: '100dvh',
          width: '100vw',
          display: 'flex',
          flexDirection: 'column',
          background: '#0c0c0f',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* ── Background: yellow radial from bottom-left corner ── */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 0,
            background: `
              radial-gradient(ellipse 55% 45% at 0% 100%, rgba(234, 179, 8, 0.13) 0%, transparent 70%),
              radial-gradient(ellipse 30% 30% at 0% 100%, rgba(234, 179, 8, 0.07) 0%, transparent 55%)
            `,
          }}
        />

        {/* ── Top navbar ── */}
        <header
          style={{
            position: 'relative',
            zIndex: 10,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 28px',
            height: 54,
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            background: 'rgba(255,255,255,0.025)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
          }}
        >
          {/* Left: Wordmark */}
          <Link
            to="/"
            style={{
              textDecoration: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(234,179,8,0.85)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            <span style={{ fontSize: 13.5, fontWeight: 650, color: 'rgba(255,255,255,0.85)', letterSpacing: '-0.01em' }}>
              LightningShare
            </span>
          </Link>

          {/* Center: Nav links */}
          <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <TopNavLink to="/" label="Devices" />
            <TopNavLink to="/transfers" label="Transfers" />
            <TopNavLink to="/settings" label="Settings" />
          </nav>

          {/* Right: private tag */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: 'rgba(255,255,255,0.22)',
                letterSpacing: '0.02em',
              }}
            >
              Local-only
            </span>
            <div style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'rgba(234,179,8,0.55)',
            }} />
          </div>
        </header>

        {/* ── Main content ── */}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative', zIndex: 1 }}>
          <Routes>
            <Route path="/"            element={<HomePage />} />
            <Route path="/transfers"   element={<TransfersPage />} />
            <Route path="/settings"    element={<SettingsPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
          </Routes>
        </main>

        {/* ── Mobile bottom nav ── */}
        <div className="mobile-nav" style={{ zIndex: 10 }}>
          <TopNavLink to="/" label="Devices" />
          <TopNavLink to="/transfers" label="Transfers" />
          <TopNavLink to="/settings" label="Settings" />
        </div>

        {/* ── Toast: transfer started ── */}
        {startedNotice && (
          <div
            className="animate-slide-in glass-heavy"
            style={{ position: 'fixed', bottom: 24, right: 20, zIndex: 50, width: 'min(320px, calc(100vw - 40px))', borderRadius: 12, padding: '14px 16px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>
                {startedNotice.direction === 'sending' ? 'Sending' : 'Receiving'}
              </span>
              <button onClick={() => setStartedNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.28)', padding: 0, lineHeight: 1 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{startedNotice.name}</p>
            <p style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.25)', marginBottom: 10 }}>{startedNotice.direction === 'sending' ? 'To' : 'From'} {startedNotice.deviceName}</p>
            <Link to="/transfers" onClick={() => setStartedNotice(null)} className="btn-ghost" style={{ display: 'block', textAlign: 'center', fontSize: 12, padding: '6px 12px', textDecoration: 'none' }}>
              View progress
            </Link>
          </div>
        )}

        {/* ── Toast: transfer completed ── */}
        {completedNotice && (
          <div
            className="animate-slide-in glass-heavy"
            style={{ position: 'fixed', bottom: 24, right: 20, zIndex: 50, width: 'min(320px, calc(100vw - 40px))', borderRadius: 12, padding: '14px 16px' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.88)' }}>Transfer complete</span>
              <button onClick={() => setCompletedNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.28)', padding: 0, lineHeight: 1 }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 10 }}>{completedNotice.name}</p>
            <div style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, padding: '9px 12px', marginBottom: 10 }}>
              <div>
                <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.28)', marginBottom: 2 }}>Duration</p>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.78)' }}>{completedNotice.duration}</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.28)', marginBottom: 2 }}>Avg Speed</p>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,0.78)' }}>{completedNotice.avgSpeed}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {completedNotice.filePath && (
                <button onClick={() => window.lightningshare.showFileInFolder(completedNotice.filePath!)} className="btn-ghost" style={{ flex: 1, fontSize: 12, padding: '6px 12px' }}>Open folder</button>
              )}
              <button onClick={() => setCompletedNotice(null)} className="btn-ghost" style={{ flex: 1, fontSize: 12, padding: '6px 12px' }}>Dismiss</button>
            </div>
          </div>
        )}
      </div>
    </HashRouter>
  );
}

function TopNavLink({ to, label }: { to: string; label: string }) {
  const { pathname } = useLocation();
  const isActive = pathname === to;

  return (
    <Link
      to={to}
      style={{
        textDecoration: 'none',
        padding: '5px 14px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 500,
        color: isActive ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.38)',
        background: isActive ? 'rgba(255,255,255,0.08)' : 'transparent',
        border: isActive ? '1px solid rgba(255,255,255,0.10)' : '1px solid transparent',
        transition: 'all 150ms ease',
        display: 'inline-block',
      }}
    >
      {label}
    </Link>
  );
}
