import { useState, useEffect, useCallback } from 'react';
import { IncomingTransfer } from '../../shared/types';
import { useTransferStore } from '../stores/transferStore';

interface IncomingTransferToastProps {
  transfer: IncomingTransfer;
}

type ToastState = 'pending' | 'picking' | 'accepting' | 'accepted' | 'rejecting' | 'rejected' | 'error';

interface DirEntry {
  name: string;
  path: string;
}
interface BrowseResult {
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}
interface QuickDir {
  label: string;
  path: string;
}

export default function IncomingTransferToast({ transfer }: IncomingTransferToastProps) {
  const [state, setState] = useState<ToastState>('pending');
  const { acceptTransfer, rejectTransfer, clearIncomingTransfer } = useTransferStore();

  // Save location picker state
  const [currentPath, setCurrentPath] = useState('');
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [quickDirs, setQuickDirs] = useState<QuickDir[]>([]);
  const [customPath, setCustomPath] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');

  const totalSize = transfer.files.reduce((sum, f) => sum + f.size, 0);

  // Initialize save location when entering 'picking' state
  useEffect(() => {
    if (state !== 'picking') return;

    let cancelled = false;
    (async () => {
      try {
        const [quick, downloadPath] = await Promise.all([
          window.lightningshare.getQuickDirs(),
          window.lightningshare.getDownloadPath(),
        ]);
        if (cancelled) return;
        setQuickDirs(quick);
        setCurrentPath(downloadPath);
        setCustomPath(downloadPath);
        const browse = await window.lightningshare.browseDirs(downloadPath);
        if (cancelled) return;
        setBrowseResult(browse);
      } catch {
        setBrowseError('Failed to load directories');
      }
    })();
    return () => { cancelled = true; };
  }, [state]);

  const browseTo = useCallback(async (dirPath: string) => {
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const result = await window.lightningshare.browseDirs(dirPath);
      setBrowseResult(result);
      setCurrentPath(dirPath);
      setCustomPath(dirPath);
    } catch {
      setBrowseError('Cannot read this folder');
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const [errorMsg, setErrorMsg] = useState('');

  const handleAcceptClick = () => {
    setState('picking');
  };

  const handleConfirmAccept = async () => {
    setState('accepting');
    setErrorMsg('');
    const savePath = customPath || currentPath;
    console.log('[TOAST] handleConfirmAccept START', { sessionId: transfer.sessionId, savePath });
    try {
      await acceptTransfer(transfer.sessionId, savePath);
      console.log('[TOAST] acceptTransfer resolved OK');
      setState('accepted');
      setTimeout(() => clearIncomingTransfer(transfer.sessionId), 2000);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error('[TOAST] Accept FAILED:', msg, e);
      setErrorMsg(msg);
      setState('error');
      setTimeout(() => setState('picking'), 5000);
    }
  };

  const handleReject = async () => {
    setState('rejecting');
    setErrorMsg('');
    console.log('[TOAST] handleReject START', { sessionId: transfer.sessionId });
    try {
      await rejectTransfer(transfer.sessionId);
      console.log('[TOAST] rejectTransfer resolved OK');
      setState('rejected');
      setTimeout(() => clearIncomingTransfer(transfer.sessionId), 2000);
    } catch (e: any) {
      const msg = e?.message || String(e);
      console.error('[TOAST] Reject FAILED:', msg, e);
      setErrorMsg(msg);
      setState('rejected');
      setTimeout(() => clearIncomingTransfer(transfer.sessionId), 2000);
    }
  };

  const handleBack = () => {
    setState('pending');
    setBrowseResult(null);
    setBrowseError('');
  };

  const isAccepted = state === 'accepted';
  const isRejected = state === 'rejected' || state === 'rejecting';
  const isProcessing = state === 'accepting' || state === 'rejecting';
  const isPicking = state === 'picking';
  const isError = state === 'error';

  return (
    <div className="fixed bottom-4 right-4 w-[420px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-auto bg-white rounded-xl shadow-2xl border border-slate-200 z-50 animate-slide-in">
      <div className={`h-1 ${
        isAccepted ? 'bg-green-500' : isRejected ? 'bg-red-500' : isPicking ? 'bg-amber-400' : isError ? 'bg-red-400' : 'bg-blue-500'
      }`} />
      <div className="p-4">
        {/* Header section */}
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
            isAccepted ? 'bg-green-50' : isRejected ? 'bg-red-50' : isPicking ? 'bg-amber-50' : isError ? 'bg-red-50' : 'bg-blue-50'
          }`}>
            {isAccepted ? (
              <svg className="w-6 h-6 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : isRejected ? (
              <svg className="w-6 h-6 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            ) : isPicking ? (
              <svg className="w-6 h-6 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            ) : isError ? (
              <svg className="w-6 h-6 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-blue-500 animate-pulse" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-slate-900">
              {isAccepted
                ? 'Transfer Accepted'
                : isRejected
                ? 'Transfer Declined'
                : isPicking
                ? 'Choose Save Location'
                : isError
                ? 'Connection Error'
                : `${transfer.deviceName} wants to send`}
            </h4>
            <p className="text-sm text-slate-500 mt-1">
              {transfer.files.length} file{transfer.files.length > 1 ? 's' : ''}
              {' · '}
              {formatBytes(totalSize)}
            </p>
          </div>
          {isPicking && (
            <button
              onClick={handleBack}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex-shrink-0"
              title="Back"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="19" y1="12" x2="5" y2="12" />
                <polyline points="12 19 5 12 12 5" />
              </svg>
            </button>
          )}
        </div>

        {/* Accepted state */}
        {isAccepted && (
          <p className="text-sm text-green-600 mt-3 flex items-center gap-1.5">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Receiving to: <span className="font-mono text-xs">{customPath || currentPath}</span>
          </p>
        )}

        {/* Rejected state */}
        {isRejected && (
          <p className="text-sm text-red-500 mt-3">Transfer declined.</p>
        )}

        {/* Error state */}
        {isError && (
          <div className="mt-3">
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              Accept failed: {errorMsg || 'Unknown error'}
            </p>
          </div>
        )}

        {/* File list (pending + picking states) */}
        {(state === 'pending' || isPicking) && (
          <div className={`mt-3 ${isPicking ? 'max-h-24' : 'max-h-32'} overflow-auto border border-slate-100 rounded-lg`}>
            {transfer.files.map((file, index) => (
              <div key={index} className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-50 last:border-b-0">
                <span className="text-sm">
                  {file.isDirectory ? '📁' : getFileIcon(file.name)}
                </span>
                <p className="text-sm text-slate-600 truncate flex-1">{file.name}</p>
                <span className="text-xs text-slate-400">{formatBytes(file.size)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Save location picker (picking state) */}
        {isPicking && (
          <div className="mt-3 space-y-2">
            {/* Quick directories */}
            {quickDirs.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {quickDirs.map((qd) => (
                  <button
                    key={qd.path}
                    onClick={() => browseTo(qd.path)}
                    className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                      currentPath === qd.path
                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 border border-transparent'
                    }`}
                  >
                    {qd.label}
                  </button>
                ))}
              </div>
            )}

            {/* Current path breadcrumb */}
            {browseResult && (
              <div className="flex items-center gap-1 text-xs text-slate-500 bg-slate-50 rounded-lg px-2 py-1.5 overflow-x-auto whitespace-nowrap">
                {browseResult.parent && (
                  <button
                    onClick={() => browseTo(browseResult.parent!)}
                    className="text-slate-400 hover:text-slate-600 flex-shrink-0"
                    title="Go up"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                )}
                <span className="font-mono truncate">{browseResult.current}</span>
              </div>
            )}

            {/* Subdirectories list */}
            {browseLoading ? (
              <div className="flex items-center justify-center py-3">
                <svg className="w-4 h-4 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              </div>
            ) : browseResult && browseResult.dirs.length > 0 ? (
              <div className="max-h-32 overflow-auto border border-slate-100 rounded-lg">
                {browseResult.dirs.map((dir) => (
                  <button
                    key={dir.path}
                    onClick={() => browseTo(dir.path)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 border-b border-slate-50 last:border-b-0 hover:bg-blue-50 transition-colors text-left"
                  >
                    <svg className="w-4 h-4 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="text-sm text-slate-700 truncate flex-1">{dir.name}</span>
                    <svg className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>
            ) : browseResult && browseResult.dirs.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-2">No subfolders here</p>
            ) : null}

            {browseError && (
              <p className="text-xs text-red-400">{browseError}</p>
            )}

            {/* Custom path input */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Or type a custom path:</label>
              <input
                type="text"
                value={customPath}
                onChange={(e) => setCustomPath(e.target.value)}
                placeholder="C:\Users\...\Downloads"
                className="w-full text-sm px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
              />
            </div>
          </div>
        )}

        {/* Action buttons */}
        {state === 'pending' && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleReject}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors disabled:opacity-50"
            >
              Decline
            </button>
            <button
              onClick={handleAcceptClick}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              Accept
            </button>
          </div>
        )}

        {(isPicking || state === 'accepting') && (
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleBack}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
            >
              Back
            </button>
            <button
              onClick={handleConfirmAccept}
              disabled={isProcessing || !customPath.trim()}
              className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {state === 'accepting' ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Starting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Start Receiving
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function getFileIcon(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp'].includes(ext)) return '🖼️';
  if (['mp4', 'avi', 'mkv', 'mov', 'webm'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📄';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
  if (['doc', 'docx', 'txt', 'md', 'rtf'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📽️';
  if (['exe', 'msi', 'dmg', 'deb', 'appimage'].includes(ext)) return '⚙️';
  if (['js', 'ts', 'py', 'java', 'c', 'cpp', 'rs', 'go', 'rb', 'html', 'css'].includes(ext)) return '💻';
  return '📄';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
