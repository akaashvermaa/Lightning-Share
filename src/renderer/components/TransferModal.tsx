import { useRef, useState } from 'react';
import { FileInfo } from '../../shared/types';
import { UploadProgress } from '../api';
import DropZone from './DropZone';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface TransferModalProps {
  deviceId: string;
  onClose: () => void;
}

export default function TransferModal({ deviceId, onClose }: TransferModalProps) {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [isUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const lastUploadRender = useRef(0);
  const [sendStatus, setSendStatus] = useState<'idle' | 'uploading' | 'sent' | 'error'>('idle');
  const [streamProgress, setStreamProgress] = useState<{ sent: number; total: number; fileName: string } | null>(null);

  const handleSelectFolder = async () => {
    setUploadError(null);
    try {
      const folderFiles = await window.lightningshare.selectFolder();
      if (folderFiles && folderFiles.length > 0) {
        setFiles(folderFiles);
      }
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Failed to pick folder');
    }
  };

  const reportUploadProgress = (progress: UploadProgress) => {
    const now = Date.now();
    if (now - lastUploadRender.current >= 100 || progress.percentage >= 100) {
      lastUploadRender.current = now;
      setUploadProgress(progress);
    }
  };

  const handleSend = async () => {
    if (files.length === 0) return;
    setIsSending(true);
    setSendStatus('uploading');
    setStreamProgress(null);
    try {
      const result = await window.lightningshare.startTransfer(
        deviceId,
        files,
        (sentBytes, totalBytes, fileName) => {
          const now = Date.now();
          if (now - lastUploadRender.current >= 100 || sentBytes >= totalBytes) {
            lastUploadRender.current = now;
            setStreamProgress({ sent: sentBytes, total: totalBytes, fileName });
          }
        },
      );
      if (result.success) {
        setSendStatus('sent');
        setTimeout(() => {
          setIsSending(false);
          onClose();
        }, 1500);
      } else {
        setSendStatus('error');
        setTimeout(() => setIsSending(false), 2000);
      }
    } catch (e) {
      setSendStatus('error');
      setTimeout(() => setIsSending(false), 2000);
    }
  };

  const handleClearFiles = () => {
    setFiles([]);
    setSendStatus('idle');
  };

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-xl font-semibold text-slate-900">Send Files</h2>
          {!isSending && (
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-6">
          {sendStatus === 'sent' ? (
            <div className="flex flex-col items-center py-8">
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-900 mb-1">Transfer Request Sent</h3>
              <p className="text-sm text-slate-500">
                Waiting for the receiver to accept. You can track progress on the Transfers page.
              </p>
            </div>
          ) : sendStatus === 'error' ? (
            <div className="flex flex-col items-center py-8">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-900 mb-1">Transfer Failed</h3>
              <p className="text-sm text-slate-500">
                Could not connect to the device. Make sure it's online and try again.
              </p>
            </div>
          ) : sendStatus === 'uploading' ? (
            <div className="flex flex-col items-center py-6 w-full">
              {streamProgress && streamProgress.total > 0 ? (
                <>
                  <div className="w-full mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">Uploading to server…</span>
                    <span className="text-sm font-bold text-blue-600">
                      {Math.round((streamProgress.sent / streamProgress.total) * 100)}%
                    </span>
                  </div>
                  <div
                    className="w-full h-3 bg-slate-100 rounded-full overflow-hidden mb-3"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((streamProgress.sent / streamProgress.total) * 100)}
                  >
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-[width] duration-150"
                      style={{ width: `${Math.min((streamProgress.sent / streamProgress.total) * 100, 100)}%` }}
                    />
                  </div>
                  <div className="w-full flex items-center justify-between text-xs text-slate-500">
                    <span className="truncate pr-3 max-w-[70%]" title={streamProgress.fileName}>
                      {streamProgress.fileName.split('/').pop()}
                    </span>
                    <span className="shrink-0 font-mono">
                      {formatBytes(streamProgress.sent)} / {formatBytes(streamProgress.total)}
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center mb-4">
                    <svg className="w-8 h-8 text-blue-500 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-medium text-slate-900 mb-1">Connecting…</h3>
                  <p className="text-sm text-slate-500">Sending transfer request to device…</p>
                </>
              )}
            </div>
          ) : isUploading ? (
            <div className="py-8">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium text-slate-900">Uploading files...</h3>
                <span className="text-sm font-semibold text-primary-600">
                  {Math.round(uploadProgress?.percentage || 0)}%
                </span>
              </div>
              <div
                className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(uploadProgress?.percentage || 0)}
              >
                <div
                  className="h-full rounded-full bg-primary-600 transition-[width] duration-150"
                  style={{ width: `${Math.min(uploadProgress?.percentage || 0, 100)}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span className="truncate pr-3">{uploadProgress?.fileName || 'Preparing files...'}</span>
                <span className="shrink-0">
                  {uploadProgress?.currentFile || 0}/{uploadProgress?.totalFiles || 0} files
                </span>
              </div>
              <p className="mt-2 text-center text-sm text-slate-500">
                {formatBytes(uploadProgress?.loaded || 0)} of {formatBytes(uploadProgress?.total || 0)} uploaded
              </p>
            </div>
          ) : files.length === 0 ? (
            <div className="space-y-3">
              <DropZone
                onFilesSelected={(selected) => {
                  setFiles(selected);
                  setUploadProgress(null);
                }}
                onProgress={reportUploadProgress}
              />
              <button
                onClick={handleSelectFolder}
                disabled={isUploading}
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                Select Folder
              </button>
              {uploadProgress && (
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
                    <span className="truncate pr-2">{uploadProgress.fileName || 'Preparing files...'}</span>
                    <span className="font-medium text-primary-600">{Math.round(uploadProgress.percentage)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 rounded-full transition-[width]" style={{ width: `${uploadProgress.percentage}%` }} />
                  </div>
                </div>
              )}
              {uploadError && (
                <p className="text-sm text-center text-red-500">{uploadError}</p>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <span className="text-sm text-slate-500">
                    {files.length} file{files.length > 1 ? 's' : ''} selected
                  </span>
                  <span className="text-sm text-slate-500 ml-2">
                    ({formatBytes(totalSize)})
                  </span>
                </div>
              </div>
              <div className="max-h-48 overflow-auto border border-slate-200 rounded-lg">
                {files.map((file, index) => (
                  <div
                    key={file.id || index}
                    className="flex items-center gap-3 p-3 border-b border-slate-100 last:border-b-0"
                  >
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                      {file.isDirectory ? (
                        <svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                          <polyline points="13 2 13 9 20 9" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{file.name}</p>
                      <p className="text-xs text-slate-500">{formatBytes(file.size)}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={handleClearFiles}
                className="mt-3 text-sm text-primary-600 hover:text-primary-700"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>

        {sendStatus === 'idle' && (
          <div className="flex gap-3 p-6 border-t border-slate-200">
            <button
              onClick={onClose}
              disabled={isSending}
              className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={files.length === 0 || isSending}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {isSending ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  Sending...
                </>
              ) : (
                'Send'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
