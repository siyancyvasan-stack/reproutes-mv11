import React from 'react';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
  glow?: 'cyan' | 'indigo' | 'emerald' | 'amber' | 'none';
}

export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  className = '',
  interactive = false,
  glow = 'none',
  ...props
}) => {
  const glowClass =
    glow === 'cyan'
      ? 'glow-cyan'
      : glow === 'indigo'
      ? 'glow-indigo'
      : glow === 'emerald'
      ? 'glow-emerald'
      : '';

  return (
    <div
      className={`${
        interactive ? 'glass-panel-interactive cursor-pointer' : 'glass-panel'
      } rounded-2xl ${glowClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};
