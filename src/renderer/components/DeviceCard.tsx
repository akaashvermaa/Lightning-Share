import { Device } from '../../shared/types';

interface DeviceCardProps {
  device: Device;
  onSend: () => void;
  disabled?: boolean;
}

export default function DeviceCard({ device, onSend, disabled }: DeviceCardProps) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 hover:border-primary-300 hover:shadow-md transition-all">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
          <svg className="w-6 h-6 text-primary-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-slate-900 truncate">{device.name}</h4>
          <p className="text-sm text-slate-500">{device.ip}</p>
        </div>
        <span className="flex items-center gap-1.5 text-sm text-success">
          <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
          Online
        </span>
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={disabled ? undefined : onSend}
          disabled={disabled}
          title={disabled ? 'Run LightningShare on this device first to send files' : `Send files to ${device.name}`}
          className={`flex-1 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            disabled
              ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
              : 'bg-primary-600 text-white hover:bg-primary-700 cursor-pointer'
          }`}
        >
          {disabled ? 'Run server to send' : 'Send Files'}
        </button>
      </div>
    </div>
  );
}
