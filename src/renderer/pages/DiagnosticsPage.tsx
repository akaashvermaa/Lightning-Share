import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LiveSpeedGraph, GaugeBar } from '../components/SpeedGraph';

interface DiagnosticsReport {
  generatedAt: string;
  app: { platform: string; arch: string; node: string; uptimeSeconds: number };
  process: { memory: { rss: number; heapUsed: number; heapTotal: number }; cpu: { user: number; system: number } };
  network: Record<string, Array<{ address: string; family: string; internal: boolean }>>;
  discovery: { deviceId: string; deviceName: string; isRunning: boolean; knownDevices: number; interfaces: Record<string, boolean> };
  tls: { certPath: string | null; keyPath: string | null; createdAt: number | null; isLoaded: boolean };
  transfers: Array<{
    id: string;
    deviceName: string;
    direction: string;
    status: string;
    speed: number;
    rttMs: number;
    windowSize: number;
    inFlightChunks: number;
    retryCount: number;
    compressionRatio: number;
    queuedBytes: number;
    speedHistory: Array<{ timestamp: number; bytesPerSecond: number }>;
  }>;
}

export default function DiagnosticsPage() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReport(await window.lightningshare.getDiagnostics());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Diagnostics unavailable');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1000); // 1s refresh for live graph
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/settings" className="text-sm text-slate-400 hover:text-primary-600">Settings</Link>
            <span className="text-slate-300">/</span>
            <h2 className="text-2xl font-semibold text-slate-900">Diagnostics</h2>
          </div>
          <p className="text-sm text-slate-500 mt-1">Live engine data for troubleshooting slow or interrupted transfers.</p>
        </div>
        <button
          onClick={() => window.lightningshare.exportDiagnostics()}
          className="px-3 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium hover:bg-primary-700 transition-colors shadow-sm"
        >
          Export report
        </button>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-8 bg-slate-50/50">
        {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm p-3 shadow-sm">{error}</div>}
        {!report ? (
          <div className="flex justify-center items-center h-32">
            <div className="text-sm text-slate-500 animate-pulse">Collecting diagnostics...</div>
          </div>
        ) : (
          <div className="max-w-6xl space-y-6 mx-auto pb-12">
            
            {/* 1. Live Speed Graphs */}
            {report.transfers.filter(t => t.status === 'transferring').length > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                {report.transfers.filter(t => t.status === 'transferring').map(t => (
                  <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                          {t.deviceName}
                          <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full uppercase tracking-wider ${t.direction === 'sending' ? 'bg-blue-500' : 'bg-purple-500'}`}>
                            {t.direction}
                          </span>
                        </h3>
                      </div>
                    </div>
                    <LiveSpeedGraph 
                      data={t.speedHistory || []} 
                      height={180} 
                      color={t.direction === 'sending' ? '#3b82f6' : '#a855f7'}
                    />
                    <div className="grid grid-cols-4 gap-4 mt-6 pt-4 border-t border-slate-100 bg-slate-50 -mx-5 -mb-5 p-4 rounded-b-xl">
                      <DiagnosticMetric label="RTT" value={`${Math.round(t.rttMs)} ms`} />
                      <DiagnosticMetric label="Window Size" value={`${t.windowSize}`} />
                      <DiagnosticMetric label="TCP Queued" value={formatBytes(t.queuedBytes)} />
                      <DiagnosticMetric label="Retries" value={`${t.retryCount}`} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid lg:grid-cols-3 gap-6">
              {/* Process & System */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <h3 className="font-semibold text-slate-800 mb-5 flex items-center gap-2">
                  <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>
                  System & Process
                </h3>
                <div className="space-y-6">
                  <GaugeBar 
                    label="CPU Usage (System)" 
                    value={(report.process.cpu.system / 1000) / (report.app.uptimeSeconds * 1000 || 1)} 
                    max={1} 
                    color="#f59e0b" 
                  />
                  <GaugeBar 
                    label="Memory (Heap)" 
                    value={report.process.memory.heapUsed} 
                    max={report.process.memory.heapTotal} 
                    color="#10b981" 
                  />
                  <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
                    <DiagnosticMetric label="RSS Memory" value={formatBytes(report.process.memory.rss)} />
                    <DiagnosticMetric label="Uptime" value={formatDuration(report.app.uptimeSeconds)} />
                    <DiagnosticMetric label="Platform" value={`${report.app.platform} ${report.app.arch}`} />
                    <DiagnosticMetric label="Node Version" value={report.app.node} />
                  </div>
                </div>
              </section>

              {/* Discovery & TLS */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <h3 className="font-semibold text-slate-800 mb-5 flex items-center gap-2">
                  <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><path d="M16.2 7.8l-2 6.3-6.4 2.1 2-6.3z"></path></svg>
                  Discovery & Security
                </h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm py-2 border-b border-slate-100">
                    <span className="text-slate-500">Service Status</span>
                    <span className={report.discovery?.isRunning ? 'text-green-600 font-medium' : 'text-slate-400'}>
                      {report.discovery?.isRunning ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm py-2 border-b border-slate-100">
                    <span className="text-slate-500">Known Devices</span>
                    <span className="font-mono text-slate-700">{report.discovery?.knownDevices || 0}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm py-2 border-b border-slate-100">
                    <span className="text-slate-500">Active Interfaces</span>
                    <div className="flex gap-2">
                      {report.discovery?.interfaces && Object.entries(report.discovery.interfaces).map(([name, active]) => (
                        <span key={name} className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-sm py-2 border-b border-slate-100">
                    <span className="text-slate-500">TLS Certificate</span>
                    <span className={report.tls?.isLoaded ? 'text-green-600 font-medium' : 'text-red-500'}>
                      {report.tls?.isLoaded ? 'Loaded' : 'Missing'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1 text-sm py-2">
                    <span className="text-slate-500">Device ID</span>
                    <span className="font-mono text-xs text-slate-400 break-all">{report.discovery?.deviceId || 'Unknown'}</span>
                  </div>
                </div>
              </section>

              {/* Network Interfaces */}
              <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col">
                <h3 className="font-semibold text-slate-800 mb-5 flex items-center gap-2">
                  <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect><rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect><line x1="6" y1="6" x2="6.01" y2="6"></line><line x1="6" y1="18" x2="6.01" y2="18"></line></svg>
                  Network Interfaces
                </h3>
                <div className="space-y-4 flex-1 overflow-y-auto pr-2" style={{ maxHeight: '250px' }}>
                  {Object.entries(report.network).map(([name, interfaces]) => {
                    const valid = interfaces.filter(i => !i.internal);
                    if (valid.length === 0) return null;
                    return (
                      <div key={name} className="bg-slate-50 rounded-lg p-3 border border-slate-100">
                        <p className="text-sm font-medium text-slate-700 mb-2">{name}</p>
                        <div className="space-y-1.5">
                          {valid.map((net, i) => (
                            <div key={i} className="flex items-center justify-between text-xs">
                              <span className="px-1.5 py-0.5 bg-white border border-slate-200 rounded text-slate-500 font-medium shadow-sm">{net.family}</span>
                              <span className="font-mono text-slate-600">{net.address}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Transfer Statistics Table */}
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                <h3 className="font-semibold text-slate-800">Transfer Statistics</h3>
                <span className="text-xs text-slate-400">Updated {new Date(report.generatedAt).toLocaleTimeString()}</span>
              </div>
              {report.transfers.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 text-center">No transfer sessions recorded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-slate-100 text-xs uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="text-left px-5 py-3">Session</th>
                        <th className="text-left px-5 py-3">Status</th>
                        <th className="text-right px-5 py-3">RTT</th>
                        <th className="text-right px-5 py-3">Window</th>
                        <th className="text-right px-5 py-3">In Flight</th>
                        <th className="text-right px-5 py-3">Retries</th>
                        <th className="text-right px-5 py-3">Compression</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.transfers.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-5 py-4 text-slate-700">
                            <span className="font-medium">{t.deviceName}</span>
                            <span className="block text-[10px] uppercase font-bold text-slate-400 mt-1">{t.direction}</span>
                          </td>
                          <td className="px-5 py-4">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide ${
                              t.status === 'transferring' ? 'bg-green-100 text-green-700' :
                              t.status === 'failed' || t.status === 'declined' || t.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                              t.status === 'completed' ? 'bg-emerald-50 text-emerald-600' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {t.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">{Math.round(t.rttMs)} ms</td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">{t.windowSize}</td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">{t.inFlightChunks}</td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">
                            <span className={t.retryCount > 0 ? 'text-amber-600 font-bold' : ''}>{t.retryCount}</span>
                          </td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">
                            {t.compressionRatio < 1 ? `${Math.round(t.compressionRatio * 100)}%` : 'off'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function DiagnosticMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1.5">{label}</span>
      <span className="font-semibold text-slate-700 truncate">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}
