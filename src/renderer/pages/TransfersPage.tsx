import { useState } from 'react';
import { useTransferStore } from '../stores/transferStore';
import SpeedGraph, { formatSpeed, LiveSpeedGraph } from '../components/SpeedGraph';

const S = {
  page: { height: '100%', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  header: {
    padding: '18px 28px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    flexShrink: 0,
  } as React.CSSProperties,
  body: { flex: 1, overflow: 'auto', padding: '24px 28px' },
} as const;

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0 || isNaN(bytes)) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(seconds: number): string {
  if (seconds < 1)  return '<1s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}

function exportHistory(sessions: any[]): void {
  const payload = JSON.stringify(sessions, (_key, value) => {
    if (value instanceof Set) return Array.from(value);
    return value;
  }, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `lightningshare-transfers-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

const STATUS: Record<string, { label: string; dot: string }> = {
  pending:      { label: 'Pending',      dot: 'rgba(255,255,255,0.25)' },
  connecting:   { label: 'Connecting',   dot: 'rgba(255,255,255,0.55)' },
  transferring: { label: 'Transferring', dot: '#4ade80' },
  paused:       { label: 'Paused',       dot: 'rgba(234,179,8,0.70)' },
  reconnecting: { label: 'Reconnecting', dot: 'rgba(255,255,255,0.55)' },
  completed:    { label: 'Completed',    dot: '#4ade80' },
  failed:       { label: 'Failed',       dot: 'rgba(255,80,80,0.80)' },
  cancelled:    { label: 'Cancelled',    dot: 'rgba(255,255,255,0.22)' },
  declined:     { label: 'Declined',     dot: 'rgba(255,80,80,0.80)' },
};

export default function TransfersPage() {
  const { sessions, clearHistory } = useTransferStore();
  const [query,  setQuery]  = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'completed' | 'failed'>('all');

  const filtered = sessions.filter((s) => {
    const hay = `${s.deviceName} ${s.files.map((f: any) => f.name).join(' ')}`.toLowerCase();
    const matchQ = !query.trim() || hay.includes(query.trim().toLowerCase());
    const matchF =
      filter === 'all'       ||
      (filter === 'active'    && !['completed','cancelled','declined','failed'].includes(s.status)) ||
      (filter === 'completed' && s.status === 'completed') ||
      (filter === 'failed'    && ['failed','declined','cancelled'].includes(s.status));
    return matchQ && matchF;
  });

  const active    = filtered.filter(s => !['completed','cancelled','declined','failed'].includes(s.status));
  const failed    = filtered.filter(s => ['failed','declined','cancelled'].includes(s.status));
  const completed = filtered.filter(s => s.status === 'completed');
  const isEmpty   = active.length === 0 && failed.length === 0 && completed.length === 0;

  const FILTERS = ['all','active','completed','failed'] as const;

  return (
    <div style={S.page}>
      {/* Header */}
      <header style={S.header}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.88)', letterSpacing: '-0.01em' }}>
            Transfers
          </h2>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginTop: 3 }}>
            {sessions.length} total · track progress and history
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {sessions.length > 0 && (
            <>
              <button
                onClick={() => exportHistory(sessions)}
                className="btn-ghost"
                style={{ fontSize: 12, padding: '6px 14px' }}
              >
                Export
              </button>
              <button
                onClick={() => clearHistory()}
                className="btn-ghost"
                style={{ fontSize: 12, padding: '6px 14px', color: 'rgba(255,100,100,0.70)', borderColor: 'rgba(255,100,100,0.18)' }}
              >
                Clear history
              </button>
            </>
          )}
        </div>
      </header>

      {/* Body */}
      <div style={S.body}>
        {/* Search + filter */}
        {sessions.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Search */}
            <div style={{ position: 'relative', flex: 1, maxWidth: 340 }}>
              <svg
                width="14" height="14"
                viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              >
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search files or devices"
                className="input-field"
                style={{ paddingLeft: 34, fontSize: 13 }}
              />
            </div>

            {/* Filter tabs */}
            <div style={{ display: 'flex', gap: 4, padding: 3, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 9 }}>
              {FILTERS.map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  style={{
                    padding: '4px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 500,
                    border: 'none',
                    cursor: 'pointer',
                    transition: 'all 150ms ease',
                    background: filter === f ? 'rgba(255,255,255,0.10)' : 'transparent',
                    color: filter === f ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)',
                  }}
                >
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {isEmpty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, textAlign: 'center' }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="17 1 21 5 17 9" /><path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" /><path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.50)', marginBottom: 8 }}>
              {sessions.length === 0 ? 'No transfers yet' : 'Nothing matches'}
            </h3>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.25)', maxWidth: 280, lineHeight: 1.6 }}>
              {sessions.length === 0
                ? 'Send files from the Devices page to get started.'
                : 'Try adjusting your search or filter.'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            {active.length > 0 && (
              <Section label={`Active — ${active.length}`}>
                {active.map(s => <TransferCard key={s.id} session={s} />)}
              </Section>
            )}
            {failed.length > 0 && (
              <Section label={`Failed — ${failed.length}`} dimLabel>
                {failed.map(s => <TransferCard key={s.id} session={s} />)}
              </Section>
            )}
            {completed.length > 0 && (
              <Section label={`Completed — ${completed.length}`} dimLabel>
                {completed.map(s => <TransferCard key={s.id} session={s} />)}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ label, children, dimLabel }: { label: string; children: React.ReactNode; dimLabel?: boolean }) {
  return (
    <div>
      <p className="text-label" style={{ marginBottom: 12, color: dimLabel ? 'rgba(255,255,255,0.20)' : 'rgba(255,255,255,0.30)' }}>
        {label}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function TransferCard({ session }: { session: any }) {
  const { cancelTransfer, pauseTransfer, resumeTransfer, retryTransfer } = useTransferStore();
  const [expanded,  setExpanded]  = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  const progress    = session.totalSize > 0 ? (session.transferredBytes / session.totalSize) * 100 : 0;
  const isActive    = session.status === 'transferring';
  const isPaused    = session.status === 'paused';
  const isCompleted = session.status === 'completed';
  const isFailed    = ['failed','declined','cancelled'].includes(session.status);
  const isSending   = session.direction === 'sending';
  const status      = STATUS[session.status] || STATUS.pending;

  const handleRetry = async () => {
    setIsRetrying(true);
    try { await retryTransfer(session.id); }
    finally { setIsRetrying(false); }
  };

  return (
    <div
      className="glass animate-fade-in"
      style={{
        borderRadius: 12,
        padding: '16px 18px',
        borderLeft: `2px solid ${isCompleted ? '#4ade8050' : isFailed ? 'rgba(255,80,80,0.30)' : isActive ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
      }}
    >
      {/* Row 1: direction badge + name + device + actions */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        {/* Direction icon */}
        <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.50)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {isSending
              ? <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>
              : <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></>
            }
          </svg>
        </div>

        {/* Info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => setExpanded(!expanded)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', width: '100%', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.82)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {session.files.map((f: any) => f.name).join(', ')}
              {session.files.length > 1 && <span style={{ color: 'rgba(255,255,255,0.30)', fontWeight: 400 }}> ({session.files.length} files)</span>}
            </span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transition: 'transform 150ms ease', transform: expanded ? 'rotate(180deg)' : 'none', flexShrink: 0 }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)' }}>
              {isSending ? 'to' : 'from'} {session.deviceName}
            </span>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)' }}>·</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>{formatBytes(session.totalSize)}</span>
            {session.completedAt && session.startedAt && (
              <>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)' }}>·</span>
                <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)' }}>
                  {formatTime(Math.round((session.completedAt - session.startedAt) / 1000))}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Status + actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.dot, flexShrink: 0, ...(isActive ? { animation: 'pulse-dot 2.2s ease-in-out infinite' } : {}) }} />
            <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>{status.label}</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {isActive && (
              <IconButton title="Pause" onClick={() => pauseTransfer(session.id)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              </IconButton>
            )}
            {isPaused && (
              <IconButton title="Resume" onClick={() => resumeTransfer(session.id)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </IconButton>
            )}
            {!isCompleted && !isFailed && (
              <IconButton title="Cancel" onClick={() => cancelTransfer(session.id)} danger>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </IconButton>
            )}
            {isCompleted && (session as any).filePaths && (
              <IconButton title="Show in folder" onClick={() => window.lightningshare.showFileInFolder((session as any).filePaths?.[session.files[0]?.id] || '')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              </IconButton>
            )}
            {isFailed && isSending && (
              <button onClick={() => void handleRetry()} disabled={isRetrying} className="btn-ghost" style={{ fontSize: 11.5, padding: '4px 10px' }}>
                {isRetrying ? 'Retrying...' : 'Retry'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error message */}
      {session.error && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(255,80,80,0.07)', border: '1px solid rgba(255,80,80,0.15)', borderRadius: 8, fontSize: 12, color: 'rgba(255,120,120,0.85)' }}>
          {session.error}
        </div>
      )}

      {/* Progress */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {isActive ? (
              <>
                <span style={{ fontSize: 12.5, fontWeight: 500, color: '#4ade80' }}>{formatSpeed(session.speed)}</span>
                {session.speedHistory?.length > 1 && (
                  <SpeedGraph data={session.speedHistory} width={80} height={20} />
                )}
                {session.remainingTime > 0 && (
                  <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.28)' }}>{formatTime(session.remainingTime)} left</span>
                )}
              </>
            ) : (
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)' }}>{status.label}</span>
            )}
          </div>
          <span style={{ fontSize: 11.5, fontFamily: 'monospace', color: 'rgba(255,255,255,0.28)' }}>
            {formatBytes(session.transferredBytes)} / {formatBytes(session.totalSize)}
          </span>
        </div>

        <div className="progress-track">
          <div
            className={`progress-fill${isCompleted ? ' success' : isFailed ? ' error' : isPaused ? ' paused' : ''}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>

        <div style={{ textAlign: 'right', marginTop: 5 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.22)' }}>{progress.toFixed(1)}%</span>
        </div>
      </div>

      {/* Live throughput graph */}
      {isActive && session.speedHistory?.length > 1 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <p className="text-label" style={{ marginBottom: 8 }}>Live throughput</p>
          <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(255,255,255,0.06)' }}>
            <LiveSpeedGraph data={session.speedHistory} height={80} />
          </div>
        </div>
      )}

      {/* Network metrics */}
      {session.metrics && isActive && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginTop: 12 }}>
          {[
            { label: 'Speed',   value: formatSpeed(session.metrics.currentSpeed) },
            { label: 'ACK RTT', value: `${Math.round(session.metrics.rttMs)} ms` },
            { label: 'Window',  value: `${session.metrics.windowSize} chunks` },
            { label: 'Queued',  value: formatBytes(session.metrics.queuedBytes) },
          ].map(m => (
            <div key={m.label} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 10px' }}>
              <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.28)', marginBottom: 2 }}>{m.label}</p>
              <p style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,0.72)' }}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Expanded file list */}
      {expanded && session.files.length > 1 && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {session.files.map((file: any, index: number) => {
            const fp = (session as any).fileProgress?.[file.id];
            const transferred = fp?.transferred || 0;
            const pct = file.size > 0 ? (transferred / file.size) * 100 : 0;
            return (
              <div key={file.id || index} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round">
                    {file.isDirectory
                      ? <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                      : <><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></>
                    }
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.70)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</p>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.28)' }}>{formatBytes(file.size)}</p>
                </div>
                <span style={{ fontSize: 12, color: fp?.completed ? '#4ade80' : transferred > 0 ? 'rgba(255,255,255,0.50)' : 'rgba(255,255,255,0.20)' }}>
                  {fp?.completed ? 'Done' : transferred > 0 ? `${pct.toFixed(0)}%` : 'Waiting'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function IconButton({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        background: 'rgba(255,255,255,0.05)',
        border: `1px solid ${danger ? 'rgba(255,100,100,0.15)' : 'rgba(255,255,255,0.08)'}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: danger ? 'rgba(255,100,100,0.65)' : 'rgba(255,255,255,0.45)',
        transition: 'background 150ms ease, color 150ms ease',
      }}
      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = danger ? 'rgba(255,80,80,0.12)' : 'rgba(255,255,255,0.10)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
    >
      {children}
    </button>
  );
}
