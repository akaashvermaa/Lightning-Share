import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LiveSpeedGraph } from '../components/SpeedGraph';

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
  const [benchmarkStatus, setBenchmarkStatus] = useState<string | null>(null);
  const [benchmarkResults, setBenchmarkResults] = useState<{ readSpeedMBps: number; writeSpeedMBps: number; networkSpeedMBps: number } | null>(null);

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

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-6">
              <h3 className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                <svg className="w-5 h-5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                System Benchmark
              </h3>
              <p className="text-sm text-slate-500 mb-4">Test your local disk and network speed to see if they are bottlenecking your transfers.</p>
              
              <button 
                onClick={async () => {
                  setBenchmarkStatus('Running benchmark...');
                  try {
                    const results = await window.lightningshare.runBenchmark();
                    setBenchmarkResults(results);
                    setBenchmarkStatus(null);
                  } catch (e) {
                    setBenchmarkStatus('Failed to run benchmark');
                  }
                }}
                disabled={!!benchmarkStatus}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {benchmarkStatus || 'Run Benchmark'}
              </button>

              {benchmarkResults && (
                <div className="grid grid-cols-3 gap-4 mt-6 pt-4 border-t border-slate-100">
                  <DiagnosticMetric label="Disk Read" value={`${Math.round(benchmarkResults.readSpeedMBps)} MB/s`} />
                  <DiagnosticMetric label="Disk Write" value={`${Math.round(benchmarkResults.writeSpeedMBps)} MB/s`} />
                  <DiagnosticMetric label="Network (Loopback)" value={`${Math.round(benchmarkResults.networkSpeedMBps)} MB/s`} />
                </div>
              )}
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
                        <th className="text-left px-5 py-3">Bottleneck</th>
                        <th className="text-right px-5 py-3">RTT</th>
                        <th className="text-right px-5 py-3">Window</th>
                        <th className="text-right px-5 py-3">In Flight</th>
                        <th className="text-right px-5 py-3">Retries</th>
                        <th className="text-right px-5 py-3">Compression</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.transfers.map((t: any) => (
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
                          <td className="px-5 py-4 text-xs font-mono text-slate-600">
                            {t.currentBottleneck || 'Idle'}
                          </td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">{Math.round(t.rttMs)} ms</td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">{t.windowSize}</td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">{t.inFlightChunks}</td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">
                            <span className={t.retryCount > 0 ? 'text-amber-600 font-bold' : ''}>{t.retryCount}</span>
                          </td>
                          <td className="px-5 py-4 text-right font-mono text-slate-600">
                            {t.compressionRatio < 1 ? `${Math.round(t.compressionRatio * 100)}%` : 'None'}
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
