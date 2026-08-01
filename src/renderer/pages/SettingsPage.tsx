import { useState, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';

export default function SettingsPage() {
  const { deviceName, settings, downloadPath, setSettings, setDownloadPath } = useAppStore();
  const [localName, setLocalName] = useState(deviceName);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLocalName(deviceName);
  }, [deviceName]);

  const [localDownloadPath, setLocalDownloadPath] = useState(downloadPath);

  useEffect(() => {
    setLocalDownloadPath(downloadPath);
  }, [downloadPath]);

  const handleSaveName = async () => {
    if (localName.trim() && localName !== deviceName) {
      setIsSaving(true);
      await window.lightningshare.setDeviceName(localName.trim());
      setIsSaving(false);
    }
  };

  const handleSelectDownloadPath = async () => {
    if (localDownloadPath && localDownloadPath !== downloadPath) {
      const result = await window.lightningshare.setSettings({ downloadPath: localDownloadPath });
      setDownloadPath(result.downloadPath);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <header className="bg-white border-b border-slate-200 px-8 py-4">
        <h2 className="text-2xl font-semibold text-slate-900">Settings</h2>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-2xl space-y-8">
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
            </div>
          </section>

          <section className="bg-white rounded-lg border border-slate-200 p-6">
            <h3 className="text-lg font-medium text-slate-900 mb-4">About</h3>
            <div className="text-sm text-slate-500 space-y-2">
              <p><span className="font-medium text-slate-700">Version:</span> 1.0.0</p>
              <p><span className="font-medium text-slate-700">Developer:</span> LightningShare Team</p>
              <p className="pt-2">
                LightningShare is a fast, reliable LAN file transfer application built with Electron.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
