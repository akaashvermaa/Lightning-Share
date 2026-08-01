import { useTransferStore } from '../stores/transferStore';
import SpeedGraph, { formatSpeed } from '../components/SpeedGraph';

export default function TransfersPage() {
  const { sessions } = useTransferStore();

  const completedSessions = sessions.filter(s => s.status === 'completed');
  const activeSessions = sessions.filter(
    s => s.status !== 'completed' && s.status !== 'cancelled' && s.status !== 'declined'
  );

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4">
        <h2 className="text-2xl font-semibold text-slate-900">Transfers</h2>
      </header>

      <div className="flex-1 overflow-auto p-8">
        {activeSessions.length === 0 && completedSessions.length === 0 ? (
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
              Your file transfers will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {activeSessions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">
                  Active
                </h3>
                <div className="space-y-3">
                  {activeSessions.map(session => (
                    <TransferCard key={session.id} session={session} />
                  ))}
                </div>
              </div>
            )}

            {completedSessions.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">
                  Completed
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

function TransferCard({ session }: { session: any }) {
  const { cancelTransfer, pauseTransfer, resumeTransfer } = useTransferStore();
  const progress = (session.transferredBytes / session.totalSize) * 100;
  const isActive = session.status === 'transferring';
  const isPaused = session.status === 'paused';
  const isCompleted = session.status === 'completed';

  const handleOpenFile = async (filePath: string) => {
    await window.lightningshare.openFile(filePath);
  };

  const handleShowInFolder = async (filePath: string) => {
    await window.lightningshare.showFileInFolder(filePath);
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${
              isActive ? 'bg-success animate-pulse' :
              isPaused ? 'bg-warning' :
              isCompleted ? 'bg-primary-500' :
              'bg-slate-300'
            }`} />
            <h4 className="font-medium text-slate-900 truncate">
              {session.files.map((f: any) => f.name).join(', ')}
            </h4>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            {session.direction === 'sending' ? 'To' : 'From'} {session.deviceName}
            {' · '}
            {formatBytes(session.totalSize)}
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
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              title="Resume"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            </button>
          )}
          {!isCompleted && (
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
          {isCompleted && (
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

      <div className="mb-2">
        <div className="flex items-center justify-between text-sm mb-1">
          <div className="flex items-center gap-3">
            <span className="text-slate-600">
              {isActive && formatSpeed(session.speed)}
              {isPaused && 'Paused'}
              {isCompleted && 'Completed'}
              {!isActive && !isPaused && !isCompleted && session.status}
            </span>
            {isActive && session.speedHistory.length > 1 && (
              <SpeedGraph data={session.speedHistory} width={100} height={24} />
            )}
          </div>
          <span className="text-slate-500">
            {formatBytes(session.transferredBytes)} / {formatBytes(session.totalSize)}
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isCompleted ? 'bg-success' : 'bg-primary-500'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {session.remainingTime > 0 && isActive && (
        <p className="text-xs text-slate-400">
          {formatTime(session.remainingTime)} remaining
        </p>
      )}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;
}
