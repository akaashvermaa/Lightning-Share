import { useState } from 'react';
import { useTransferStore } from '../stores/transferStore';
import SpeedGraph, { formatSpeed } from '../components/SpeedGraph';

export default function TransfersPage() {
  const { sessions } = useTransferStore();

  const completedSessions = sessions.filter(s => s.status === 'completed');
  const failedSessions = sessions.filter(s => s.status === 'failed' || s.status === 'declined' || s.status === 'cancelled');
  const activeSessions = sessions.filter(
    s => s.status !== 'completed' && s.status !== 'cancelled' && s.status !== 'declined' && s.status !== 'failed'
  );

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4">
        <h2 className="text-2xl font-semibold text-slate-900">Transfers</h2>
      </header>

      <div className="flex-1 overflow-auto p-8">
        {activeSessions.length === 0 && completedSessions.length === 0 && failedSessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center mb-6">
              <svg className="w-12 h-12 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="17 1 21 5 17 9" />
                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                <polyline points="7 23 3 19 7 15" />
                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-slate-900 mb-2">No transfers yet</h3>
            <p className="text-slate-500 max-w-sm">
              Your file transfers will appear here. Send files from the Home page to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {activeSessions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">
                  Active ({activeSessions.length})
                </h3>
                <div className="space-y-3">
                  {activeSessions.map(session => (
                    <TransferCard key={session.id} session={session} />
                  ))}
                </div>
              </div>
            )}

            {failedSessions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-red-500 uppercase tracking-wide mb-4">
                  Failed ({failedSessions.length})
                </h3>
                <div className="space-y-3">
                  {failedSessions.map(session => (
                    <TransferCard key={session.id} session={session} />
                  ))}
                </div>
              </div>
            )}

            {completedSessions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">
                  Completed ({completedSessions.length})
                </h3>
                <div className="space-y-3">
                  {completedSessions.map(session => (
                    <TransferCard key={session.id} session={session} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_CONFIG: Record<string, { label: string; color: string; dotClass: string; icon: string }> = {
  pending: { label: 'Pending', color: 'text-slate-500', dotClass: 'bg-slate-400', icon: 'clock' },
  connecting: { label: 'Connecting', color: 'text-blue-500', dotClass: 'bg-blue-500 animate-pulse', icon: 'wifi' },
  transferring: { label: 'Transferring', color: 'text-green-500', dotClass: 'bg-green-500 animate-pulse', icon: 'arrow' },
  paused: { label: 'Paused', color: 'text-amber-500', dotClass: 'bg-amber-500', icon: 'pause' },
  reconnecting: { label: 'Reconnecting', color: 'text-blue-500', dotClass: 'bg-blue-500 animate-pulse', icon: 'wifi' },
  completed: { label: 'Completed', color: 'text-green-600', dotClass: 'bg-green-600', icon: 'check' },
  failed: { label: 'Failed', color: 'text-red-500', dotClass: 'bg-red-500', icon: 'x' },
  cancelled: { label: 'Cancelled', color: 'text-slate-500', dotClass: 'bg-slate-400', icon: 'x' },
  declined: { label: 'Declined', color: 'text-red-500', dotClass: 'bg-red-500', icon: 'x' },
};



function TransferCard({ session }: { session: any }) {
  const { cancelTransfer, pauseTransfer, resumeTransfer } = useTransferStore();
  const [expanded, setExpanded] = useState(false);

  const progress = session.totalSize > 0 ? (session.transferredBytes / session.totalSize) * 100 : 0;
  const isActive = session.status === 'transferring';
  const isPaused = session.status === 'paused';
  const isCompleted = session.status === 'completed';
  const isFailed = session.status === 'failed' || session.status === 'declined' || session.status === 'cancelled';
  const isSending = session.direction === 'sending';

  const statusConfig = STATUS_CONFIG[session.status] || STATUS_CONFIG.pending;

  const handleShowInFolder = async (filePath: string) => {
    await window.lightningshare.showFileInFolder(filePath);
  };

  return (
    <div className={`bg-white rounded-lg border p-4 transition-all ${
      isFailed ? 'border-red-200' : isCompleted ? 'border-green-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
              isSending ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
            }`}>
              {isSending ? (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              ) : (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
                  <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
                </svg>
              )}
              {isSending ? 'Sending' : 'Receiving'}
            </span>
            <span className={`flex items-center gap-1 text-xs font-medium ${statusConfig.color}`}>
              <span className={`w-2 h-2 rounded-full ${statusConfig.dotClass}`} />
              {statusConfig.label}
            </span>
          </div>
          <h4 className="font-medium text-slate-900 truncate mt-1.5 cursor-pointer hover:text-primary-600"
              onClick={() => setExpanded(!expanded)}>
            {session.files.map((f: any) => f.name).join(', ')}
            {session.files.length > 1 && (
              <span className="text-slate-400 font-normal ml-1">({session.files.length} files)</span>
            )}
            <svg className={`w-4 h-4 inline ml-1 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </h4>
          <p className="text-sm text-slate-500 mt-0.5">
            {isSending ? 'To' : 'From'} <span className="font-medium text-slate-600">{session.deviceName}</span>
            {' · '}
            {formatBytes(session.totalSize)}
            {session.completedAt && (
              <span className="text-slate-400 ml-1">
                · {(Math.round((session.completedAt - session.startedAt) / 100) / 10)}s
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 ml-4">
          {isActive && (
            <button
              onClick={() => pauseTransfer(session.id)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Pause"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          )}
          {isPaused && (
            <button
              onClick={() => resumeTransfer(session.id)}
              className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
              title="Resume"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}
          {!isCompleted && !isFailed && (
            <button
              onClick={() => cancelTransfer(session.id)}
              className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="Cancel"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
          {isCompleted && (session as any).filePaths && (
            <button
              onClick={() => handleShowInFolder((session as any).filePaths?.[session.files[0]?.id] || '')}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Show in folder"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {session.error && (
        <div className="mb-3 p-2 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
          <svg className="w-4 h-4 inline mr-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {session.error}
        </div>
      )}

      <div className="mb-2">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <div className="flex items-center gap-3">
            {isActive ? (
              <>
                <span className="text-green-600 font-medium">{formatSpeed(session.speed)}</span>
                {session.speedHistory.length > 1 && (
                  <SpeedGraph data={session.speedHistory} width={120} height={24} />
                )}
                {session.remainingTime > 0 && (
                  <span className="text-slate-400 text-xs">
                    {formatTime(session.remainingTime)} left
                  </span>
                )}
              </>
            ) : (
              <span className={statusConfig.color}>{statusConfig.label}</span>
            )}
          </div>
          <span className="text-slate-500 font-mono text-xs">
            {formatBytes(session.transferredBytes)} / {formatBytes(session.totalSize)}
          </span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isCompleted ? 'bg-green-500' :
              isFailed ? 'bg-red-400' :
              isPaused ? 'bg-amber-400' :
              'bg-blue-500'
            }`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        <div className="text-right text-xs text-slate-400 mt-0.5">
          {progress.toFixed(1)}%
        </div>
      </div>

      {expanded && session.files.length > 1 && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          {session.files.map((file: any, index: number) => {
            const fileProgress = (session as any).fileProgress?.[file.id];
            const fileTransferred = fileProgress?.transferred || 0;
            const filePercent = file.size > 0 ? (fileTransferred / file.size) * 100 : 0;
            return (
              <div key={file.id || index} className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded flex items-center justify-center flex-shrink-0">
                  {file.isDirectory ? (
                    <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-500">
                    {fileProgress?.completed ? (
                      <span className="text-green-600">Done</span>
                    ) : fileTransferred > 0 ? (
                      `${filePercent.toFixed(0)}%`
                    ) : (
                      'Waiting'
                    )}
                  </p>
                </div>
              </div>
            );
          })}
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