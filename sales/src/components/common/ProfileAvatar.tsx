import React, { useEffect, useMemo, useState } from 'react';
import { apiBlob } from '../../services/apiClient';

interface ProfileAvatarProps {
  src?: string | null;
  name?: string | null;
  className?: string;
  fallbackClassName?: string;
}

export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({
  src,
  name,
  className = 'h-9 w-9 rounded-full',
  fallbackClassName = '',
}) => {
  const [failed, setFailed] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  useEffect(() => setFailed(false), [src]);
  useEffect(() => {
    let disposed = false;
    let objectUrl: string | undefined;
    setResolvedSrc(src && !src.startsWith('/api/') ? src : null);
    if (src?.startsWith('/api/')) {
      void apiBlob(src)
        .then((blob) => {
          if (disposed) return;
          objectUrl = URL.createObjectURL(blob);
          setResolvedSrc(objectUrl);
        })
        .catch(() => {
          if (!disposed) setFailed(true);
        });
    }
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  const initials = useMemo(
    () =>
      (name || 'Reproutes User')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join('') || 'TF',
    [name],
  );

  if (resolvedSrc && !failed) {
    return (
      <img
        src={resolvedSrc}
        alt={name ? `${name} profile` : 'User profile'}
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      role="img"
      aria-label={name ? `${name} profile` : 'User profile'}
      className={`${className} ${fallbackClassName} inline-grid shrink-0 place-items-center bg-gradient-to-br from-cyan-500 to-indigo-600 font-extrabold text-white shadow-md`}
    >
      {initials}
    </span>
  );
};
