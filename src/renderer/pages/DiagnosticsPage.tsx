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
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <header style={{
        padding: '18px 28px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <Link to="/settings" style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', textDecoration: 'none' }}>Settings</Link>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.20)' }}>/</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.60)' }}>Diagnostics</span>
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.88)', letterSpacing: '-0.01em' }}>
            Engine Diagnostics
          </h2>
        </div>

        <button
          onClick={() => window.lightningshare.exportDiagnostics()}
          className="btn-primary"
          style={{ fontSize: 12.5, padding: '7px 14px' }}
        >
          Export report
        </button>
      </header>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(255,80,80,0.08)', border: '1px solid rgba(255,80,80,0.18)', color: 'rgba(255,120,120,0.85)', fontSize: 12.5, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {!report ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 160 }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.30)' }}>Collecting diagnostics...</span>
          </div>
        ) : (
          <div style={{ maxWidth: 900, display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Live speed graphs for active transfers */}
            {report.transfers.filter(t => t.status === 'transferring').length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
                {report.transfers.filter(t => t.status === 'transferring').map(t => (
                  <div key={t.id} className="glass" style={{ borderRadius: 12, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.82)' }}>
                        {t.deviceName}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 100, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.50)', textTransform: 'uppercase' }}>
                        {t.direction}
                      </span>
                    </div>

                    <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <LiveSpeedGraph data={t.speedHistory || []} height={140} color={t.direction === 'sending' ? 'rgba(255,255,255,0.70)' : 'rgba(234,179,8,0.70)'} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginTop: 12 }}>
                      <DiagnosticMetric label="ACK RTT" value={`${Math.round(t.rttMs)} ms`} />
                      <DiagnosticMetric label="Window" value={`${t.windowSize}`} />
                      <DiagnosticMetric label="Queued" value={formatBytes(t.queuedBytes)} />
                      <DiagnosticMetric label="Retries" value={`${t.retryCount}`} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* System Benchmark */}
            <div className="glass" style={{ borderRadius: 12, padding: '20px 22px' }}>
              <p style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.80)', marginBottom: 4 }}>
                System Benchmark
              </p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', marginBottom: 16, lineHeight: 1.5 }}>
                Test local disk read/write and network loopback speed to detect bottlenecks.
              </p>

              <button
                onClick={async () => {
                  setBenchmarkStatus('Running benchmark...');
                  try {
                    const results = await window.lightningshare.runBenchmark();
                    setBenchmarkResults(results);
                    setBenchmarkStatus(null);
                  } catch {
                    setBenchmarkStatus('Failed to run benchmark');
                  }
                }}
                disabled={!!benchmarkStatus}
                className="btn-primary"
                style={{ fontSize: 12.5 }}
              >
                {benchmarkStatus || 'Run Benchmark'}
              </button>

              {benchmarkResults && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <DiagnosticMetric label="Disk Read" value={`${Math.round(benchmarkResults.readSpeedMBps)} MB/s`} />
                  <DiagnosticMetric label="Disk Write" value={`${Math.round(benchmarkResults.writeSpeedMBps)} MB/s`} />
                  <DiagnosticMetric label="Network Loopback" value={`${Math.round(benchmarkResults.networkSpeedMBps)} MB/s`} />
                </div>
              )}
            </div>

            {/* Transfer Statistics Table */}
            <div className="glass" style={{ borderRadius: 12, overflow: 'hidden' }}>
              <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p className="text-label">Transfer session log</p>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>
                  {new Date(report.generatedAt).toLocaleTimeString()}
                </span>
              </div>

              {report.transfers.length === 0 ? (
                <p style={{ padding: '24px 20px', fontSize: 12.5, color: 'rgba(255,255,255,0.28)', textAlign: 'center' }}>
                  No transfer sessions recorded in this session.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', textAlign: 'left', color: 'rgba(255,255,255,0.28)' }}>
                        <th style={{ padding: '10px 16px', fontWeight: 600 }}>Device</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600 }}>Status</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600 }}>Bottleneck</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>ACK RTT</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Window</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>In Flight</th>
                        <th style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'right' }}>Retries</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.transfers.map((t: any) => (
                        <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.65)' }}>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{ fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>{t.deviceName}</span>
                            <span style={{ display: 'block', fontSize: 10, color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', marginTop: 1 }}>{t.direction}</span>
                          </td>
                          <td style={{ padding: '10px 16px' }}>
                            <span style={{ fontSize: 11, color: t.status === 'transferring' || t.status === 'completed' ? '#4ade80' : t.status === 'failed' ? 'rgba(255,100,100,0.80)' : 'rgba(255,255,255,0.38)' }}>
                              {t.status}
                            </span>
                          </td>
                          <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>
                            {t.currentBottleneck || 'Idle'}
                          </td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{Math.round(t.rttMs)} ms</td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{t.windowSize}</td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace' }}>{t.inFlightChunks}</td>
                          <td style={{ padding: '10px 16px', textAlign: 'right', fontFamily: 'monospace', color: t.retryCount > 0 ? 'rgba(234,179,8,0.80)' : 'inherit' }}>
                            {t.retryCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

function DiagnosticMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 10px' }}>
      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.28)', marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,0.75)' }}>{value}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}
