import { Device } from '../../shared/types';

interface DeviceCardProps {
  device: Device;
  onSend: () => void;
  disabled?: boolean;
  isTrusted?: boolean;
  onToggleTrust?: () => void;
}

export default function DeviceCard({ device, onSend, disabled, isTrusted, onToggleTrust }: DeviceCardProps) {
  return (
    <div
      className="glass glass-hover animate-fade-in"
      style={{ borderRadius: 12, padding: '18px 18px 16px' }}
    >
      {/* Top row: icon + name + online status */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        {/* Device icon */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.09)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>

        {/* Name and IP */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <h4 style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.88)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
              {device.name}
            </h4>
            {isTrusted && (
              <span className="badge badge-trusted">trusted</span>
            )}
          </div>
          <p style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(255,255,255,0.30)' }}>
            {device.addresses?.[0] || 'Unknown'}:{device.port}
          </p>
        </div>

        {/* Online dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 2 }}>
          <span className="dot-online animate-pulse-dot" />
          <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)' }}>online</span>
        </div>
      </div>

      {/* Divider */}
      <div className="divider" style={{ marginBottom: 14 }} />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={disabled ? undefined : onSend}
          disabled={disabled}
          title={disabled ? 'Run LightningShare on this device first' : `Send files to ${device.name}`}
          className="btn-primary"
          style={{ flex: 2 }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
          {disabled ? 'Unavailable' : 'Send files'}
        </button>

        {onToggleTrust && (
          <button
            onClick={onToggleTrust}
            className="btn-ghost"
            style={{ flex: 1 }}
            title={isTrusted ? 'Remove trust' : 'Mark as trusted device'}
          >
            {isTrusted ? 'Untrust' : 'Trust'}
          </button>
        )}
      </div>
    </div>
  );
}
