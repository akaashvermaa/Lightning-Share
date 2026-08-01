import { useState } from 'react';
import { IncomingTransfer } from '../../shared/types';
import { useTransferStore } from '../stores/transferStore';

interface IncomingTransferToastProps {
  transfer: IncomingTransfer;
}

export default function IncomingTransferToast({ transfer }: IncomingTransferToastProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { acceptTransfer, rejectTransfer } = useTransferStore();

  const totalSize = transfer.files.reduce((sum, f) => sum + f.size, 0);

  const handleAccept = async () => {
    await acceptTransfer(transfer.sessionId);
  };

  const handleReject = async () => {
    await rejectTransfer(transfer.sessionId);
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden z-50">
      <div className="p-4">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-slate-900">
              {transfer.deviceName} wants to send
            </h4>
            <p className="text-sm text-slate-500 mt-1">
              {transfer.files.length} file{transfer.files.length > 1 ? 's' : ''} ({formatBytes(totalSize)})
            </p>

            {isExpanded && (
              <div className="mt-3 space-y-1">
                {transfer.files.map((file, index) => (
                  <p key={index} className="text-sm text-slate-600 truncate">
                    {file.isDirectory ? '📁' : '📄'} {file.name}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={handleReject}
            className="flex-1 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="flex-1 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            Accept
          </button>
        </div>
      </div>
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
