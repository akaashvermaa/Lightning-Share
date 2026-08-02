import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';

export default function SettingsPage() {
  const { deviceName, settings, downloadPath, setSettings, setDeviceName, setDownloadPath } = useAppStore();
  const [localName, setLocalName] = useState(deviceName);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    setLocalName(deviceName);
  }, [deviceName]);

  const [localDownloadPath, setLocalDownloadPath] = useState(downloadPath);
  const [localBandwidthLimit, setLocalBandwidthLimit] = useState(settings.bandwidthLimit || 0);

  useEffect(() => {
    setLocalDownloadPath(downloadPath);
  }, [downloadPath]);

  useEffect(() => {
    setLocalBandwidthLimit(settings.bandwidthLimit || 0);
  }, [settings.bandwidthLimit]);

  const handleSaveName = async () => {
    if (!localName.trim() || localName.trim() === deviceName) return;
    setIsSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      await window.lightningshare.setDeviceName(localName.trim());
      setDeviceName(localName.trim());
      setSaveMessage('Device name updated');
    } catch {
      setSaveError('Could not update the device name');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectDownloadPath = async () => {
    if (!localDownloadPath || localDownloadPath === downloadPath) return;
    setSaveMessage(null);
    setSaveError(null);
    try {
      const result = await window.lightningshare.setSettings({ downloadPath: localDownloadPath });
      setDownloadPath(result.downloadPath);
      setSaveMessage('Download location updated');
    } catch {
      setSaveError('Could not update the download location');
    }
  };

  const handleSaveBandwidth = async () => {
    const limit = Math.max(0, Math.round(Number(localBandwidthLimit) || 0));
    try {
      await setSettings({ bandwidthLimit: limit });
      setSaveMessage(limit ? 'Bandwidth limit updated' : 'Bandwidth limit removed');
      setSaveError(null);
    } catch {
      setSaveError('Could not update the bandwidth limit');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-4">
        <h2 className="text-2xl font-semibold text-slate-900">Settings</h2>
      </header>

      <div className="flex-1 overflow-auto p-4 sm:p-8">
        <div className="max-w-2xl space-y-8">
          <div className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 flex items-start gap-3">
            <svg className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p className="text-sm text-primary-800">Changes are applied immediately to this device and visible to new connections.</p>
          </div>
          {(saveMessage || saveError) && (
            <p className={`text-sm ${saveError ? 'text-red-600' : 'text-green-600'}`} role="status">
              {saveError || saveMessage}
            </p>
          )}
          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-lg font-medium text-slate-900 mb-4">Device Name</h3>
            <p className="text-sm text-slate-500 mb-4">
              This name is shown to other devices on the network.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={localName}
                onChange={(e) => setLocalName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveName();
                }}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="Enter device name"
              />
              <button
                onClick={handleSaveName}
                disabled={isSaving || localName === deviceName}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-lg font-medium text-slate-900 mb-4">Download Location</h3>
            <p className="text-sm text-slate-500 mb-4">
              Files you receive will be saved to this folder.
            </p>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={localDownloadPath}
                onChange={(e) => setLocalDownloadPath(e.target.value)}
                className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder="C:\Users\Downloads"
              />
              <button
                onClick={handleSelectDownloadPath}
                disabled={localDownloadPath === downloadPath}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save
              </button>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-lg font-medium text-slate-900 mb-4">Transfer Settings</h3>
            <div className="space-y-4">
              <label className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-700">Compression</span>
                  <p className="text-sm text-slate-500">
                    Automatically compress compatible files during transfer
                  </p>
                </div>
                <button
                  onClick={() => setSettings({ compressionEnabled: !settings.compressionEnabled })}
                  role="switch"
                  aria-checked={settings.compressionEnabled}
                  aria-label="Toggle compression"
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    settings.compressionEnabled ? 'bg-primary-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      settings.compressionEnabled ? 'left-7' : 'left-1'
                    }`}
                  />
                </button>
              </label>

              <label className="flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-700">Auto-accept from trusted devices</span>
                  <p className="text-sm text-slate-500">
                    Automatically accept incoming transfers from known devices
                  </p>
                </div>
                <button
                  onClick={() => setSettings({ autoAcceptFromTrusted: !settings.autoAcceptFromTrusted })}
                  role="switch"
                  aria-checked={settings.autoAcceptFromTrusted}
                  aria-label="Toggle auto-accept from trusted devices"
                  className={`relative w-12 h-6 rounded-full transition-colors ${
                    settings.autoAcceptFromTrusted ? 'bg-primary-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
                      settings.autoAcceptFromTrusted ? 'left-7' : 'left-1'
                    }`}
                  />
                </button>
              </label>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2">
                <div>
                  <span className="font-medium text-slate-700">Bandwidth limit</span>
                  <p className="text-sm text-slate-500">Optional upload limit in megabytes per second. Use 0 for unlimited.</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={localBandwidthLimit ? Math.round(localBandwidthLimit / (1024 * 1024)) : 0}
                    onChange={(event) => setLocalBandwidthLimit(Math.max(0, Number(event.target.value) || 0) * 1024 * 1024)}
                    className="w-24 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    aria-label="Bandwidth limit in megabytes per second"
                  />
                  <button onClick={() => void handleSaveBandwidth()} className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200">Save</button>
                </div>
              </div>
            </div>
          </section>
          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-lg font-medium text-slate-900 mb-4">About</h3>
            <div className="text-sm text-slate-500 space-y-2">
              <p><span className="font-medium text-slate-700">Version:</span> 1.0.0</p>
              <p><span className="font-medium text-slate-700">Developer:</span> LightningShare Team</p>
              <p className="pt-2">
                LightningShare is a fast, reliable LAN file transfer application.
              </p>
            </div>
          </section>

          <section className="bg-slate-900 rounded-xl p-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-medium">Developer diagnostics</h3>
                <p className="text-sm text-slate-300 mt-1">Inspect RTT, retries, window size, compression, and runtime health.</p>
              </div>
              <Link to="/diagnostics" className="shrink-0 px-3 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-medium transition-colors">Open</Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
