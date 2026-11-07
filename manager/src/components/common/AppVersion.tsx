import React from 'react';

export const AppVersion: React.FC<{ className?: string; portal?: string }> = ({
  className = '',
  portal = 'manager',
}) => {
  const portalVersion =
    portal === 'manager'
      ? import.meta.env.VITE_MANAGER_APP_VERSION
      : portal === 'factory'
      ? import.meta.env.VITE_FACTORY_APP_VERSION
      : portal === 'sales'
      ? import.meta.env.VITE_SALES_APP_VERSION
      : '';

  const raw =
    portalVersion ||
    import.meta.env.VITE_MANAGER_APP_VERSION ||
    import.meta.env.VITE_APP_VERSION ||
    import.meta.env.APP_VERSION ||
    '';

  const version = typeof raw === 'string' ? raw.trim().replace(/^[vV]/, '') : String(raw || '').trim().replace(/^[vV]/, '');

  return (
    <p className={`text-center text-[10px] font-semibold tracking-wide text-slate-400 ${className}`}>
      Reproutes{version ? ` V${version}` : ''}
    </p>
  );
};
