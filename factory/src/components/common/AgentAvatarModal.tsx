import React, { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { Camera, Trash2, Upload } from 'lucide-react';
import { removeAgentAvatar, uploadAgentAvatar } from '../../services/domainApi';
import { useToast } from '../../context/ToastContext';
import { Modal } from './Modal';
import { ProfileAvatar } from './ProfileAvatar';

interface AgentAvatarModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentId: string;
  agentName: string;
  currentAvatar?: string | null;
  onChanged: (avatarUrl: string) => void;
}

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxBytes = 5 * 1024 * 1024;

export const AgentAvatarModal: React.FC<AgentAvatarModalProps> = ({
  isOpen,
  onClose,
  agentId,
  agentName,
  currentAvatar,
  onChanged,
}) => {
  const { showToast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!isOpen) {
      setFile(null);
      setError('');
    }
  }, [isOpen]);

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!selected) return;
    if (!allowedTypes.has(selected.type)) {
      setError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (selected.size > maxBytes) {
      setError('The image must be 5 MB or smaller.');
      return;
    }
    setError('');
    setFile(selected);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError('Choose an image before uploading.');
      return;
    }
    setSaving(true);
    try {
      const result = await uploadAgentAvatar(agentId, file);
      onChanged(result.avatarUrl);
      showToast('Profile Image Updated', `${agentName}'s profile image was saved.`, 'success');
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to upload the image.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await removeAgentAvatar(agentId);
      onChanged('');
      showToast('Profile Image Removed', `${agentName} will now use their initials.`, 'success');
      onClose();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to remove the image.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Profile Image — ${agentName}`} maxWidth="sm">
      <form onSubmit={save} className="space-y-5">
        <div className="flex justify-center">
          <div className="relative">
            <ProfileAvatar
              src={preview || currentAvatar}
              name={agentName}
              className="w-28 h-28 rounded-2xl object-cover border-4 border-cyan-400/50 shadow-2xl text-xl"
            />
            <span className="absolute -bottom-2 -right-2 p-2 rounded-xl bg-cyan-500 text-slate-950 border-2 border-slate-900">
              <Camera className="w-4 h-4" />
            </span>
          </div>
        </div>

        <label className="block">
          <span className="sr-only">Choose profile image</span>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={chooseFile} className="sr-only" />
          <span className="w-full px-4 py-2.5 rounded-xl text-xs font-bold text-white glass-button-primary flex items-center justify-center gap-2 cursor-pointer">
            <Upload className="w-4 h-4" />
            {file ? 'Choose Different Image' : currentAvatar ? 'Change Image' : 'Choose Image'}
          </span>
        </label>
        <p className="text-[10px] text-center text-slate-400">JPG, PNG or WebP · Maximum 5 MB</p>
        {error && <p role="alert" className="text-xs font-semibold text-rose-400 text-center">{error}</p>}

        <div className="flex items-center justify-between gap-3 pt-1">
          {currentAvatar ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={saving}
              className="px-4 py-2 rounded-xl text-xs font-bold text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 disabled:opacity-60"
            >
              <Trash2 className="w-4 h-4" />
              Remove
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white">Cancel</button>
            <button type="submit" disabled={!file || saving} className="px-5 py-2.5 rounded-xl text-xs font-bold text-white glass-button-primary disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Image'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
};
