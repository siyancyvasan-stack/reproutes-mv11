import React, { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const validateImage = (file: File) => {
  if (!ALLOWED.has(file.type)) return 'Choose a JPG, JPEG, PNG, or WEBP image.';
  if (file.size > MAX_IMAGE_BYTES) return 'Images must be 5 MB or smaller.';
  return '';
};

export const ImageUploadField = ({ file, currentUrl, onChange, label = 'Product Image (Optional)', disabled = false, tone = 'default' }: {
  file?: File; currentUrl?: string; onChange: (file?: File) => void; label?: string; disabled?: boolean; tone?: 'default' | 'light' | 'dark';
  key?: React.Key;
}) => {
  const [error, setError] = useState('');
  const preview = useMemo(() => file ? URL.createObjectURL(file) : currentUrl, [file, currentUrl]);
  useEffect(() => () => { if (file && preview) URL.revokeObjectURL(preview); }, [file, preview]);
  const isLight = tone === 'light';
  const isDark = tone === 'dark';
  return <div className="image-upload-field">
    <span className={`mb-1 block text-xs font-bold uppercase ${isLight ? 'text-slate-700' : 'text-slate-300'}`}>{label}</span>
    <div className={`image-upload-surface flex flex-col gap-3 rounded-xl border border-dashed p-3 sm:flex-row sm:items-center ${isLight ? 'border-cyan-300 bg-cyan-50' : isDark ? 'border-cyan-500/70 bg-slate-800' : 'border-cyan-500/30 bg-cyan-500/5'}`}>
      <div className={`image-upload-preview grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border ${isLight ? 'border-cyan-200 bg-white' : isDark ? 'border-slate-600 bg-slate-950' : 'border-slate-600/40 bg-slate-900/20'}`}>
        {preview ? <img src={preview} alt="Selected image preview" className="h-full w-full object-cover"/> : <ImagePlus className="h-6 w-6 text-cyan-400"/>}
      </div>
      <div className="min-w-0 flex-1">
        <label className={`image-upload-trigger inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold ${isLight ? 'border-cyan-300 bg-white text-cyan-700' : isDark ? 'border-cyan-400 bg-slate-900 text-cyan-300' : 'border-cyan-500/30 text-cyan-300'}`}>
          <ImagePlus className="h-4 w-4"/>{file || currentUrl ? 'Replace Image' : 'Choose Image'}
          <input disabled={disabled} type="file" className="sr-only" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={(event) => { const next = event.target.files?.[0]; if (!next) return; const message = validateImage(next); setError(message); if (!message) onChange(next); event.target.value = ''; }}/>
        </label>
        {(file || currentUrl) && <button disabled={disabled} type="button" onClick={() => { setError(''); onChange(undefined); }} className={`ml-2 inline-flex items-center gap-1 px-2 py-2 text-xs font-bold ${isLight ? 'text-rose-700' : 'text-rose-400'}`}><Trash2 className="h-3.5 w-3.5"/>Remove</button>}
        <p className={`image-upload-hint mt-1 text-[10px] ${isLight ? 'text-slate-600' : 'text-slate-400'}`}>JPG, JPEG, PNG or WEBP · maximum 5 MB</p>
        {error && <p role="alert" className={`mt-1 text-xs font-semibold ${isLight ? 'text-rose-700' : 'text-rose-400'}`}>{error}</p>}
      </div>
    </div>
  </div>;
};
