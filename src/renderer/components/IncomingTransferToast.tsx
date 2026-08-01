import { useState } from 'react';
import { IncomingTransfer } from '../../shared/types';
import { useTransferStore } from '../stores/transferStore';

interface IncomingTransferToastProps {
  transfer: IncomingTransfer;
}

type ToastState = 'pending' | 'accepting' | 'accepted' | 'rejecting' | 'rejected';

export default function IncomingTransferToast({ transfer }: IncomingTransferToastProps) {
  const [state, setState] = useState<ToastState>('pending');
  const [expanded] = useState(true);
  const { acceptTransfer, rejectTransfer, clearIncomingTransfer } = useTransferStore();

  const totalSize = transfer.files.reduce((sum, f) => sum + f.size, 0);

  const handleAccept = async () => {
    setState('accepting');
    try {
      await acceptTransfer(transfer.sessionId);
      setState('accepted');
      setTimeout(() => clearIncomingTransfer(transfer.sessionId), 2000);
    } catch (e) {
      setState('pending');
    }
  };

  const handleReject = async () => {
    setState('rejecting');
    try {
      await rejectTransfer(transfer.sessionId);
      setState('rejected');
      setTimeout(() => clearIncomingTransfer(transfer.sessionId), 2000);
    } catch (e) {
      setState('pending');
    }
  };

  const isAccepted = state === 'accepted';
  const isRejected = state === 'rejected' || state === 'rejecting';
  const isProcessing = state === 'accepting' || state === 'rejecting';

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-slide-in">
      <div className={`h-1 ${
        isAccepted ? 'bg-green-500' : isRejected ? 'bg-red-500' : 'bg-blue-500'
      }`} />
      <div className="p-4">
        <div className="flex items-start gap-4">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${
            isAccepted ? 'bg-green-50' : isRejected ? 'bg-red-50' : 'bg-blue-50'
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
              {isAccepted ? 'Transfer Accepted' : isRejected ? 'Transfer Declined' : `${transfer.deviceName} wants to send`}
            </h4>
            <p className="text-sm text-slate-500 mt-1">
              {transfer.files.length} file{transfer.files.length > 1 ? 's' : ''}
              {' · '}
              {formatBytes(totalSize)}
            </p>

            {isAccepted && (
              <p className="text-sm text-green-600 mt-2 flex items-center gap-1.5">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Receiving... Check the Transfers page for progress.
              </p>
            )}
            {isRejected && (
              <p className="text-sm text-red-500 mt-2">
                Transfer declined.
              </p>
            )}
          </div>
        </div>

        {expanded && state === 'pending' && (
          <div className="mt-3 max-h-32 overflow-auto border border-slate-100 rounded-lg">
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
              onClick={handleAccept}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isProcessing && state === 'accepting' ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Accepting...
                </>
              ) : (
                'Accept'
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