import React from 'react';
import logoSrc from '../../assets/logo.png';

interface BrandLogoProps {
  className?: string;
  compact?: boolean;
  large?: boolean;
  suffix?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  className = '',
  compact = false,
  large = false,
  suffix,
}) => (
  <div
    className={`flex min-w-0 items-center ${compact ? 'justify-center' : 'gap-2.5'} ${className}`}
    aria-label={`Reproutes${suffix ? ` ${suffix}` : ''}`}
  >
    <img
      src={logoSrc}
      alt="Reproutes"
      className={`shrink-0 object-contain ${large ? 'h-24 w-24 sm:h-32 sm:w-32 lg:h-36 lg:w-36' : compact ? 'h-10 w-10 sm:h-11 sm:w-11' : 'h-12 w-12 sm:h-14 sm:w-14'}`}
    />
    {suffix && !compact && (
      <span className="text-sm font-bold text-slate-500">{suffix}</span>
    )}
  </div>
);
