import React, { useEffect, useId, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { PrimaryButton, SecondaryButton } from './EnterpriseUI';
import { Modal } from './Modal';

export interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  side?: 'left' | 'right';
  className?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
  side = 'right',
  className = '',
}) => {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50">
          <motion.button
            type="button"
            aria-label={`Close ${title}`}
            className="absolute inset-0 h-full w-full bg-slate-950/55 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={{ x: side === 'right' ? '100%' : '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: side === 'right' ? '100%' : '-100%' }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute inset-y-0 ${side === 'right' ? 'right-0' : 'left-0'} flex w-[min(90vw,26rem)] flex-col border-slate-200 bg-white shadow-2xl ${side === 'right' ? 'border-l' : 'border-r'} ${className}`}
          >
            <header className="flex min-h-16 items-center justify-between border-b border-slate-200 px-5">
              <h2 id={titleId} className="text-base font-bold text-slate-950">{title}</h2>
              <button ref={closeRef} type="button" onClick={onClose} aria-label={`Close ${title}`} className="grid h-11 w-11 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
          </motion.aside>
        </div>
      )}
    </AnimatePresence>
  );
};

export interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  destructive?: boolean;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  busy = false,
  destructive = false,
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="sm">
    <div className="flex gap-3">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${destructive ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>
        <AlertTriangle aria-hidden="true" className="h-5 w-5" />
      </span>
      <p className="pt-1 text-sm leading-6 text-slate-600">{description}</p>
    </div>
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <SecondaryButton onClick={onClose} disabled={busy}>{cancelLabel}</SecondaryButton>
      <PrimaryButton
        loading={busy}
        onClick={() => void onConfirm()}
        className={destructive ? '!bg-rose-600 !shadow-rose-600/20' : ''}
      >
        {confirmLabel}
      </PrimaryButton>
    </div>
  </Modal>
);

export interface MobileNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export const MobileBottomNav: React.FC<{ items: MobileNavItem[]; ariaLabel?: string }> = ({
  items,
  ariaLabel = 'Primary navigation',
}) => (
  <nav
    aria-label={ariaLabel}
    className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/90 px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] shadow-[0_-12px_32px_-22px_rgba(15,23,42,.38)] backdrop-blur-xl md:hidden"
  >
    <div className="mx-auto flex max-w-lg items-stretch justify-around gap-1 overflow-x-auto">
      {items.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            `flex min-h-12 min-w-[3.75rem] flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-[10px] font-bold transition ${
              isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
            }`
          }
        >
          <item.icon aria-hidden="true" className="h-5 w-5" />
          <span className="max-w-16 truncate">{item.label}</span>
        </NavLink>
      ))}
    </div>
  </nav>
);
