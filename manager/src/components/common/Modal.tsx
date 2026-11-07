import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  stickyActions?: boolean;
  tone?: 'default' | 'light' | 'dark';
  scrollControls?: boolean;
  draggable?: boolean;
  footer?: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'lg',
  stickyActions = false,
  tone = 'default',
  scrollControls = false,
  draggable = false,
  footer,
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number }>();
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const isLight = tone === 'light';
  const isDark = tone === 'dark';
  const maxWidthMap = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
  };

  useEffect(() => {
    if (!isOpen) return;
    setPosition({ x: 0, y: 0 });
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.userSelect = '';
      dragRef.current = undefined;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !draggable) return;
    const clampToViewport = () => {
      const panel = panelRef.current;
      if (!panel) return;
      const rect = panel.getBoundingClientRect();
      const edge = 16;
      let dx = 0;
      let dy = 0;
      if (rect.left < edge) dx = edge - rect.left;
      else if (rect.right > window.innerWidth - edge) dx = window.innerWidth - edge - rect.right;
      if (rect.top < edge) dy = edge - rect.top;
      else if (rect.bottom > window.innerHeight - edge) dy = window.innerHeight - edge - rect.bottom;
      if (dx || dy) setPosition((current) => ({ x: current.x + dx, y: current.y + dy }));
    };
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, [draggable, isOpen]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable || window.innerWidth < 640 || event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.style.userSelect = 'none';
    setDragging(true);
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const panel = panelRef.current;
    if (!drag || !panel || drag.pointerId !== event.pointerId) return;
    const rect = panel.getBoundingClientRect();
    const baseLeft = rect.left - position.x;
    const baseTop = rect.top - position.y;
    const edge = 16;
    const desiredX = drag.originX + event.clientX - drag.startX;
    const desiredY = drag.originY + event.clientY - drag.startY;
    const x = Math.min(window.innerWidth - edge - baseLeft - rect.width, Math.max(edge - baseLeft, desiredX));
    const y = Math.min(window.innerHeight - edge - baseTop - rect.height, Math.max(edge - baseTop, desiredY));
    setPosition({ x, y });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.body.style.userSelect = '';
    setDragging(false);
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex h-[100dvh] w-screen items-center justify-center overflow-hidden p-3 sm:p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-md"
          />

          {/* Dialog Panel */}
          <div
            ref={panelRef}
            style={{ transform: `translate3d(${position.x}px, ${position.y}px, 0)` }}
            className={`relative z-10 w-full ${maxWidthMap[maxWidth]}`}
          >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className={`flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-2xl border shadow-2xl sm:max-h-[85dvh] ${isDark ? 'modal-solid-dark border-slate-600 bg-slate-900' : isLight ? 'border-slate-200 bg-slate-50' : 'glass-panel border-slate-700/60'}`}
          >
            {/* Header */}
            <div
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={`modal-header flex shrink-0 touch-none items-center justify-between gap-4 border-b px-4 py-3 sm:px-6 sm:py-4 ${draggable ? dragging ? 'cursor-grabbing' : 'cursor-grab' : ''} ${isLight ? 'border-slate-200 bg-white' : 'border-slate-800/80 bg-slate-900/50'}`}
            >
              <h3 id="modal-title" className={`min-w-0 text-lg font-bold tracking-wide ${isLight ? 'text-slate-900' : 'text-white'}`}>{title}</h3>
              <div className="flex shrink-0 items-center gap-1">
                {scrollControls && <>
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => bodyRef.current?.scrollBy({ top: -bodyRef.current.clientHeight * 0.75, behavior: 'smooth' })} aria-label="Scroll form up" title="Scroll up" className={`grid h-10 w-10 place-items-center rounded-lg transition-colors ${isLight ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-900' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><ChevronUp className="h-5 w-5" /></button>
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={() => bodyRef.current?.scrollBy({ top: bodyRef.current.clientHeight * 0.75, behavior: 'smooth' })} aria-label="Scroll form down" title="Scroll down" className={`grid h-10 w-10 place-items-center rounded-lg transition-colors ${isLight ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-900' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><ChevronDown className="h-5 w-5" /></button>
                </>}
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={onClose}
                  aria-label="Close dialog"
                  className={`grid h-11 w-11 place-items-center rounded-lg transition-colors ${isLight ? 'text-slate-500 hover:bg-slate-100 hover:text-slate-900' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div ref={bodyRef} className={`modal-body min-h-0 min-w-0 flex-1 scroll-smooth overscroll-contain overflow-x-hidden overflow-y-auto p-4 sm:p-6 ${scrollControls ? 'modal-scroll-controls' : ''} ${isLight ? 'bg-slate-50' : ''} ${stickyActions ? '[&>form]:min-w-0 [&>form]:pb-20 [&>form>div:last-child]:sticky [&>form>div:last-child]:bottom-0 [&>form>div:last-child]:z-10 [&>form>div:last-child]:-mx-4 [&>form>div:last-child]:-mb-20 [&>form>div:last-child]:border-t [&>form>div:last-child]:border-slate-200 [&>form>div:last-child]:bg-white/95 [&>form>div:last-child]:px-4 [&>form>div:last-child]:py-4 [&>form>div:last-child]:shadow-[0_-10px_24px_rgba(15,23,42,0.08)] sm:[&>form>div:last-child]:-mx-6 sm:[&>form>div:last-child]:px-6' : ''}`}>{children}</div>
            {footer && <div className={`shrink-0 border-t px-4 py-4 sm:px-6 ${isLight ? 'border-slate-200 bg-white' : 'border-slate-700 bg-slate-900'}`}>{footer}</div>}
          </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
