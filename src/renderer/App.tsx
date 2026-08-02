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
  const [completedNotice, setCompletedNotice] = useState<{ name: string } | null>(null);

  useEffect(() => {
    initialize();

    const unsubDeviceDiscovered = window.lightningshare.onDeviceDiscovered((device) => {
      addDevice(device);
    });

    const unsubDeviceLeft = window.lightningshare.onDeviceLeft((deviceId) => {
      removeDevice(deviceId);
    });

    const unsubSessionUpdated = window.lightningshare.onSessionUpdated((session) => {
      updateSession(session);
    });

    const unsubSessionCompleted = window.lightningshare.onSessionCompleted((session) => {
      updateSession(session);
      setCompletedNotice({
        name: session.files[0]?.name || 'Transfer',
      });
      window.setTimeout(() => setCompletedNotice(null), 5000);
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

    // Initial load
    window.lightningshare.getTransferSessions().then(setSessions);
    window.lightningshare.getDevices().then(setDevices);

    // Periodic refresh: keeps device list in sync even when WS events are missed
    // (e.g. if the other device started after this page loaded, or after a WS reconnect).
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
      <div className="app-shell flex h-screen bg-slate-50">
        <nav className="w-64 bg-white border-r border-slate-200 flex flex-col">
          <div className="p-6 border-b border-slate-200">
            <Link to="/" className="text-xl font-bold text-primary-600 flex items-center gap-2">
              <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
              <span>LightningShare</span>
            </Link>
          </div>
          <div className="flex-1 p-4">
            <NavLink to="/" icon="home" label="Home" />
            <NavLink to="/transfers" icon="transfer" label="Transfers" />
            <NavLink to="/settings" icon="settings" label="Settings" />
          </div>
          <div className="hidden lg:block p-4 border-t border-slate-100">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Private by design</p>
            <p className="text-xs leading-5 text-slate-500 mt-1">Files move directly across your local network.</p>
          </div>
        </nav>
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/transfers" element={<TransfersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/diagnostics" element={<DiagnosticsPage />} />
          </Routes>
        </main>
        <div className="mobile-nav">
          <NavLink to="/" icon="home" label="Home" />
          <NavLink to="/transfers" icon="transfer" label="Transfers" />
          <NavLink to="/settings" icon="settings" label="Settings" />
        </div>
        {completedNotice && (
          <div className="fixed top-4 right-4 z-40 w-[min(360px,calc(100vw-2rem))] bg-white border border-green-200 rounded-xl shadow-xl p-4 animate-slide-in">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-green-50 text-green-600 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-slate-800">Transfer complete</p>
                <p className="text-sm text-slate-500 truncate mt-0.5">{completedNotice.name}</p>
                <Link to="/transfers" className="inline-block text-xs font-medium text-primary-600 mt-2">View transfer</Link>
              </div>
              <button onClick={() => setCompletedNotice(null)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss notification">x</button>
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
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    transfer: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
      </svg>
    ),
    settings: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  };

  return (
    <Link
      to={to}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-2 transition-colors ${
        isActive
          ? 'bg-primary-50 text-primary-600'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icons[icon]}
      <span className="font-medium">{label}</span>
    </Link>
  );
}
