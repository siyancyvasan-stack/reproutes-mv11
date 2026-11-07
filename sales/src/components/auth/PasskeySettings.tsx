import { useEffect, useState } from 'react';
import { Fingerprint, Loader2, Smartphone, Trash2 } from 'lucide-react';
import {
  loadPasskeyDevices,
  PasskeyDevice,
  registerPasskey,
  removePasskeyDevice,
  supportsBiometricLogin,
} from '../../services/authApi';
import { useToast } from '../../context/ToastContext';

export const PasskeySettings = () => {
  const { showToast } = useToast();
  const [supported, setSupported] = useState<boolean>();
  const [devices, setDevices] = useState<PasskeyDevice[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = () => loadPasskeyDevices().then(setDevices);

  useEffect(() => {
    void supportsBiometricLogin().then(setSupported);
    void refresh().catch(() => undefined);
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      await registerPasskey(
        `${navigator.platform || 'Device'} · ${new Date().toLocaleDateString()}`,
      );
      await refresh();
      showToast('Fingerprint Login Enabled', 'This device can now sign in securely.', 'success');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      showToast(
        name === 'NotAllowedError' ? 'Setup Cancelled' : 'Setup Failed',
        name === 'NotAllowedError'
          ? 'The biometric prompt was cancelled or timed out.'
          : error instanceof Error ? error.message : 'Unable to register this device.',
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (device: PasskeyDevice) => {
    if (!window.confirm(`Remove ${device.deviceName}?`)) return;
    await removePasskeyDevice(device.credentialId);
    const remaining = devices.filter((item) => item.credentialId !== device.credentialId);
    setDevices(remaining);
    if (!remaining.length) localStorage.removeItem('tf_passkey_registered');
    showToast('Device Removed', 'Its biometric credential has been revoked.', 'info');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">
            Fingerprint & Passkey Login
          </h3>
          <p className="text-[10px] text-slate-500 mt-1">
            Uses this device's fingerprint, Face ID, Windows Hello, or secure device PIN.
          </p>
        </div>
        <button
          type="button"
          disabled={!supported || busy}
          onClick={() => void enable()}
          className="px-4 py-2.5 rounded-xl text-xs font-bold text-white glass-button-primary flex items-center gap-2 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
          {busy ? 'Verifying identity…' : supported === false ? 'Not supported' : 'Enable Fingerprint Login'}
        </button>
      </div>
      <div className="space-y-2">
        {devices.map((device) => (
          <div key={device.credentialId} className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Smartphone className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{device.deviceName}</p>
                <p className="text-[10px] text-slate-500">
                  Added {new Date(device.createdAt).toLocaleDateString()}
                  {device.lastUsedAt ? ` · Last used ${new Date(device.lastUsedAt).toLocaleDateString()}` : ''}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => void remove(device)} className="p-2 rounded-lg text-rose-400 bg-rose-500/10" title="Remove device">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {!devices.length && <p className="text-xs text-slate-500">No fingerprint/passkey registered.</p>}
      </div>
    </div>
  );
};
