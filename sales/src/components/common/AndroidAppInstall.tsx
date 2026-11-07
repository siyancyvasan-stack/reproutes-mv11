import React, { useState } from 'react';
import { Download, Info, ShieldCheck, Smartphone, X } from 'lucide-react';
import { getAndroidApkConfig } from '../../services/androidApp';

interface AndroidAppInstallProps {
  compact?: boolean;
  className?: string;
}

export const AndroidAppInstall: React.FC<AndroidAppInstallProps> = ({ compact = false, className = '' }) => {
  const [showInstructions, setShowInstructions] = useState(false);
  const [downloadRequested, setDownloadRequested] = useState(false);
  const startInstallation = () => {
    setDownloadRequested(true);
    setShowInstructions(true);
  };
  const apk = getAndroidApkConfig(import.meta.env.VITE_ANDROID_APK_URL);

  return (
    <div className={className}>
      <div className={`flex ${compact ? 'items-center gap-1.5' : 'flex-col gap-2'}`}>
        {apk.available ? (
          <a
            href={apk.url}
            download
            target="_blank"
            rel="noopener noreferrer"
            onClick={startInstallation}
            className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 font-extrabold text-white shadow-lg shadow-cyan-950/20 transition hover:from-cyan-500 hover:to-blue-500 focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 ${compact ? 'gap-1.5 px-3 py-2 text-xs focus:ring-offset-slate-950' : 'w-full gap-2 px-4 py-3 text-sm focus:ring-offset-white'}`}
            aria-label="Download Reporuteus Android APK"
          >
            <Download className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
            <span>{compact ? 'Android App' : 'Download Android App'}</span>
          </a>
        ) : (
          <button
            type="button"
            disabled
            title={'reason' in apk ? apk.reason : undefined}
            className={`inline-flex cursor-not-allowed items-center justify-center rounded-xl border border-slate-300 bg-slate-100 font-extrabold text-slate-500 ${compact ? 'gap-1.5 px-3 py-2 text-xs' : 'w-full gap-2 px-4 py-3 text-sm'}`}
          >
            <Smartphone className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
            <span>{compact ? 'App unavailable' : 'Android App Coming Soon'}</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowInstructions(true)}
          className={`inline-flex items-center justify-center gap-1 text-xs font-bold transition ${compact ? 'rounded-lg px-2 py-2 text-slate-300 hover:bg-white/10 hover:text-white' : 'text-slate-600 hover:text-cyan-700'}`}
        >
          <Info className="h-3.5 w-3.5" />
          {compact ? <span className="sr-only">Installation instructions</span> : 'Android installation help'}
        </button>
      </div>
      {!compact && apk.available && <p className="mt-1 text-center text-xs text-slate-600">After downloading, tap Open → Install on your phone.</p>}
      {!compact && 'reason' in apk && <p className="mt-1 text-center text-[11px] font-medium text-slate-500">{apk.reason}</p>}

      {showInstructions && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="android-install-title">
          <div className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-100 text-cyan-700"><Smartphone className="h-6 w-6" /></span>
                <div>
                  <h2 id="android-install-title" className="text-lg font-black">Install Reporuteus on Android</h2>
                  <p className="text-xs text-slate-500">Finish installation on your Android phone</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowInstructions(false)} className="rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="Close installation instructions"><X className="h-5 w-5" /></button>
            </div>
            {downloadRequested && (
              <div role="status" className="mt-5 rounded-2xl bg-cyan-50 p-4 text-sm text-cyan-950">
                <p className="font-extrabold">Next: tap Open in your browser, then Install.</p>
                <p className="mt-2">If you see “file already exists”, tap Open in that message. Your APK is already in Downloads—you do not need to download it again.</p>
              </div>
            )}
            <ol className="mt-5 space-y-3 text-sm text-slate-700">
              {[
                downloadRequested ? 'Wait for the APK download to finish, or use the copy already in Downloads.' : 'Tap Download APK below and wait for the download to finish.',
                'Open the downloaded Reporuteus APK from your browser notification or Downloads folder.',
                'If Android asks, tap Settings and allow installation from the browser or file manager you used. Then return to the installer.',
                'Tap Install, then Open. Sign in with your existing salesperson account.',
                'Allow notifications and precise location. Choose “Allow all the time” when asked for shift tracking.',
              ].map((step, index) => (
                <li key={step} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-100 text-xs font-black text-cyan-800">{index + 1}</span><span>{step}</span></li>
              ))}
            </ol>
            <div className="mt-5 flex items-start gap-2 rounded-2xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              Android requires you to confirm Install. This website cannot open files in your Downloads folder or confirm installation for you.
            </div>
            {apk.available && (
              <a href={apk.url} download target="_blank" rel="noopener noreferrer" onClick={startInstallation} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-cyan-500">
                <Download className="h-5 w-5" /> {downloadRequested ? 'Download APK again' : 'Download APK'}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
