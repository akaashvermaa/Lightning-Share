import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';

export default function SettingsPage() {
  const { deviceName, settings, downloadPath, setSettings, setDeviceName, setDownloadPath } = useAppStore();
  const [localName,       setLocalName]       = useState(deviceName);
  const [localDlPath,     setLocalDlPath]     = useState(downloadPath);
  const [localBandwidth,  setLocalBandwidth]  = useState(settings.bandwidthLimit || 0);
  const [isSaving,        setIsSaving]        = useState(false);
  const [saveMsg,         setSaveMsg]         = useState<string | null>(null);
  const [saveErr,         setSaveErr]         = useState<string | null>(null);

  useEffect(() => { setLocalName(deviceName); }, [deviceName]);
  useEffect(() => { setLocalDlPath(downloadPath); }, [downloadPath]);
  useEffect(() => { setLocalBandwidth(settings.bandwidthLimit || 0); }, [settings.bandwidthLimit]);

  const flash = (msg: string, err?: boolean) => {
    if (err) { setSaveErr(msg); setSaveMsg(null); }
    else     { setSaveMsg(msg); setSaveErr(null); }
    setTimeout(() => { setSaveMsg(null); setSaveErr(null); }, 3000);
  };

  const handleSaveName = async () => {
    if (!localName.trim() || localName.trim() === deviceName) return;
    setIsSaving(true);
    try {
      await window.lightningshare.setDeviceName(localName.trim());
      setDeviceName(localName.trim());
      flash('Device name updated');
    } catch { flash('Could not update device name', true); }
    finally  { setIsSaving(false); }
  };

  const handleSavePath = async () => {
    if (!localDlPath || localDlPath === downloadPath) return;
    try {
      const result = await window.lightningshare.setSettings({ downloadPath: localDlPath });
      setDownloadPath(result.downloadPath);
      flash('Download location updated');
    } catch { flash('Could not update download location', true); }
  };

  const handleSaveBandwidth = async () => {
    const limit = Math.max(0, Math.round(Number(localBandwidth) || 0));
    try {
      await setSettings({ bandwidthLimit: limit });
      flash(limit ? 'Bandwidth limit updated' : 'Bandwidth limit removed');
    } catch { flash('Could not update bandwidth limit', true); }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <header style={{
        padding: '18px 28px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'rgba(255,255,255,0.88)', letterSpacing: '-0.01em' }}>
            Settings
          </h2>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', marginTop: 3 }}>
            Changes apply immediately to this device.
          </p>
        </div>
        {/* Status feedback */}
        {(saveMsg || saveErr) && (
          <div style={{
            padding: '7px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            fontWeight: 500,
            background: saveErr ? 'rgba(255,80,80,0.08)' : 'rgba(74,222,128,0.08)',
            border: `1px solid ${saveErr ? 'rgba(255,80,80,0.18)' : 'rgba(74,222,128,0.18)'}`,
            color: saveErr ? 'rgba(255,120,120,0.85)' : '#4ade80',
          }}>
            {saveErr || saveMsg}
          </div>
        )}
      </header>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
        <div style={{ maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Device Name */}
          <SettingCard title="Device name" description="This name is shown to other devices on your network.">
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                value={localName}
                onChange={e => setLocalName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void handleSaveName(); }}
                placeholder="Enter device name"
                className="input-field"
                style={{ flex: 1 }}
              />
              <button
                onClick={handleSaveName}
                disabled={isSaving || localName === deviceName}
                className="btn-primary"
                style={{ flexShrink: 0 }}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </SettingCard>

          {/* Download location */}
          <SettingCard title="Download location" description="Received files are saved to this folder.">
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text"
                value={localDlPath}
                onChange={e => setLocalDlPath(e.target.value)}
                placeholder="/Users/you/Downloads"
                className="input-field"
                style={{ flex: 1 }}
              />
              <button
                onClick={handleSavePath}
                disabled={localDlPath === downloadPath}
                className="btn-primary"
                style={{ flexShrink: 0 }}
              >
                Save
              </button>
            </div>
          </SettingCard>

          {/* Transfer settings */}
          <SettingCard title="Transfer" description="Performance and connection options.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

              <ToggleRow
                label="Compression"
                detail="Compress compatible files during transfer to reduce transfer time."
                checked={settings.compressionEnabled}
                onToggle={() => setSettings({ compressionEnabled: !settings.compressionEnabled })}
                id="toggle-compression"
              />

              <div className="divider" />

              <ToggleRow
                label="Auto-accept from trusted devices"
                detail="Automatically accept incoming transfers from devices you have marked as trusted."
                checked={settings.autoAcceptFromTrusted}
                onToggle={() => setSettings({ autoAcceptFromTrusted: !settings.autoAcceptFromTrusted })}
                id="toggle-auto-accept"
              />

              <div className="divider" />

              {/* Bandwidth limit */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20 }}>
                <div>
                  <p style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.75)', marginBottom: 3 }}>Bandwidth limit</p>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', lineHeight: 1.5 }}>
                    Upload limit in MB/s. Set to 0 for unlimited.
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={localBandwidth ? Math.round(localBandwidth / (1024 * 1024)) : 0}
                    onChange={e => setLocalBandwidth(Math.max(0, Number(e.target.value) || 0) * 1024 * 1024)}
                    className="input-field"
                    style={{ width: 80, textAlign: 'center' }}
                    aria-label="Bandwidth limit in MB/s"
                  />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.28)', flexShrink: 0 }}>MB/s</span>
                  <button onClick={() => void handleSaveBandwidth()} className="btn-primary" style={{ padding: '8px 14px', fontSize: 12.5 }}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          </SettingCard>

          {/* About */}
          <SettingCard title="About" description="">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                ['Version',     '1.0.0'],
                ['License',     'MIT'],
                ['Protocol',    'TCP / TLS (mDNS discovery)'],
                ['Description', 'Local-network file transfer. No cloud, no relay, no accounts.'],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.28)', minWidth: 90, flexShrink: 0 }}>{k}</span>
                  <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.60)' }}>{v}</span>
                </div>
              ))}
            </div>
          </SettingCard>

          {/* Developer diagnostics */}
          <div
            className="glass"
            style={{ borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}
          >
            <div>
              <p style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.75)', marginBottom: 3 }}>Developer diagnostics</p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', lineHeight: 1.5 }}>
                Inspect RTT, window size, compression ratio, and network health.
              </p>
            </div>
            <Link to="/diagnostics" className="btn-ghost" style={{ textDecoration: 'none', fontSize: 12.5, flexShrink: 0 }}>
              Open
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────── */

function SettingCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="glass" style={{ borderRadius: 12, padding: '20px 22px' }}>
      <div style={{ marginBottom: description ? 16 : 14 }}>
        <p style={{ fontSize: 13.5, fontWeight: 600, color: 'rgba(255,255,255,0.80)', marginBottom: description ? 4 : 0 }}>{title}</p>
        {description && <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', lineHeight: 1.5 }}>{description}</p>}
      </div>
      {children}
    </div>
  );
}

function ToggleRow({ label, detail, checked, onToggle, id }: { label: string; detail: string; checked: boolean; onToggle: () => void; id: string }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, cursor: 'pointer' }}>
      <div>
        <p style={{ fontSize: 13.5, fontWeight: 500, color: 'rgba(255,255,255,0.75)', marginBottom: 3 }}>{label}</p>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.30)', lineHeight: 1.5 }}>{detail}</p>
      </div>
      <button
        id={id}
        onClick={onToggle}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        style={{
          position: 'relative',
          width: 40,
          height: 22,
          borderRadius: 100,
          background: checked ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.09)',
          border: '1px solid rgba(255,255,255,0.12)',
          cursor: 'pointer',
          transition: 'background 180ms ease',
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <span style={{
          position: 'absolute',
          top: 3,
          left: checked ? 20 : 3,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: checked ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.38)',
          transition: 'left 180ms ease, background 180ms ease',
        }} />
      </button>
    </label>
  );
}
