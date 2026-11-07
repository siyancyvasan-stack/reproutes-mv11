import React from 'react';
import { Loader2, MessageCircle, UserRoundX, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { Contact, loadContacts, loadWhatsappDestination, whatsappUrl } from '../../services/contactApi';
import { ApiError } from '../../services/apiClient';

// Reproutes support / manager WhatsApp destination. Keep this in international
// format so wa.me works on desktop, mobile, and the WhatsApp application.
const SUPPORT_WHATSAPP_NUMBER = '94729790397';

const roleLabel = (role: Contact['role']) =>
  role === 'AGENT' ? 'Sales Person' : role === 'MANAGER' ? 'Manager' : 'Factory Manager';

const WhatsAppMark = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" className={className} fill="currentColor">
    <path d="M16.04 3a12.7 12.7 0 0 0-10.9 19.23L3.35 28.8l6.72-1.76A12.72 12.72 0 1 0 16.04 3Zm0 22.87c-2 0-3.96-.54-5.66-1.56l-.4-.24-3.99 1.05 1.07-3.89-.26-.4a10.14 10.14 0 1 1 9.24 5.04Zm5.56-7.6c-.3-.16-1.8-.9-2.08-1-.28-.1-.48-.16-.69.15-.2.31-.79 1-.97 1.2-.18.2-.36.23-.67.08-.3-.16-1.29-.48-2.46-1.52a9.2 9.2 0 0 1-1.7-2.12c-.18-.31-.02-.47.14-.63.14-.14.3-.36.46-.54.15-.18.2-.31.3-.51.11-.21.06-.39-.02-.54-.08-.16-.69-1.66-.94-2.27-.25-.6-.5-.52-.69-.53h-.58c-.2 0-.53.08-.81.39-.28.3-1.06 1.04-1.06 2.54 0 1.49 1.09 2.93 1.24 3.14.15.2 2.14 3.26 5.18 4.57.72.31 1.29.5 1.73.64.73.23 1.39.2 1.91.12.58-.09 1.8-.74 2.05-1.45.25-.72.25-1.34.18-1.46-.08-.13-.28-.2-.59-.36Z" />
  </svg>
);

export const FloatingWhatsAppContact: React.FC<{ aboveMobileNav?: boolean }> = ({
  aboveMobileNav = false,
}) => {
  const { user } = useAuth();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const requestRef = React.useRef<Promise<Contact[] | null> | null>(null);
  const destinationRequestRef = React.useRef<Promise<string | null> | null>(null);
  const [open, setOpen] = React.useState(false);
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [salesWhatsappNumber, setSalesWhatsappNumber] = React.useState<string | null>(null);
  const isSalesPerson = user?.role === 'agent';

  const refresh = React.useCallback(async () => {
    if (requestRef.current) return requestRef.current;
    const request = (async (): Promise<Contact[] | null> => {
      setLoading(true);
      setError('');
      try {
        const result = await loadContacts();
        setContacts(result.contacts);
        return result.contacts;
      } catch (caught) {
        setError(caught instanceof ApiError && caught.status === 429
          ? 'WhatsApp contacts are temporarily busy. Please wait a moment and try again.'
          : caught instanceof Error ? caught.message : 'Unable to load WhatsApp contacts.');
        return null;
      } finally {
        setLoading(false);
        requestRef.current = null;
      }
    })();
    requestRef.current = request;
    return request;
  }, []);

  React.useEffect(() => {
    if (open && !isSalesPerson && !contacts.length && !loading && !error) void refresh();
  }, [contacts.length, error, isSalesPerson, loading, open, refresh]);

  const loadSalesDestination = React.useCallback(async () => {
    if (salesWhatsappNumber) return salesWhatsappNumber;
    if (destinationRequestRef.current) return destinationRequestRef.current;
    const request = loadWhatsappDestination()
      .then(({ whatsappNumber }) => {
        setSalesWhatsappNumber(whatsappNumber);
        return whatsappNumber;
      })
      .catch((caught) => {
        setError(caught instanceof ApiError && caught.status === 429
          ? 'WhatsApp contact is temporarily busy. Please wait a moment and try again.'
          : caught instanceof Error ? caught.message : 'Unable to load the WhatsApp contact.');
        return null;
      })
      .finally(() => { destinationRequestRef.current = null; });
    destinationRequestRef.current = request;
    return request;
  }, [salesWhatsappNumber]);

  React.useEffect(() => {
    if (isSalesPerson) void loadSalesDestination();
  }, [isSalesPerson, loadSalesDestination]);

  React.useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const openSupportWhatsApp = () => {
    const url = whatsappUrl(SUPPORT_WHATSAPP_NUMBER, user?.name ?? 'Reproutes user');
    const whatsappWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (whatsappWindow) whatsappWindow.opener = null;
    else window.location.assign(url);
  };

  return (
    <div
      ref={rootRef}
      className={`fixed right-4 z-[70] sm:right-6 ${aboveMobileNav ? 'bottom-[calc(5.75rem+env(safe-area-inset-bottom))] md:bottom-6' : 'bottom-5 sm:bottom-6'}`}
    >
      {open && (!isSalesPerson || Boolean(error)) && (
        <section
          role="dialog"
          aria-label="Contact on WhatsApp"
          className="absolute bottom-[4.5rem] right-0 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl shadow-slate-950/25"
        >
          <header className="flex items-center justify-between bg-emerald-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2.5">
              <WhatsAppMark className="h-7 w-7" />
              <div><h2 className="text-sm font-extrabold">Contact on WhatsApp</h2><p className="text-[11px] text-emerald-50">{isSalesPerson ? 'Manager contact unavailable' : 'Select an authorized contact'}</p></div>
            </div>
            <button type="button" aria-label="Close WhatsApp contacts" onClick={() => setOpen(false)} className="rounded-lg p-1.5 hover:bg-white/15"><X className="h-4 w-4" /></button>
          </header>

          <div className="max-h-[min(22rem,55vh)] overflow-y-auto p-3">
            {loading && <div className="grid min-h-28 place-items-center text-emerald-600"><Loader2 className="h-6 w-6 animate-spin" /></div>}
            {!loading && error && <div className="rounded-xl bg-rose-50 p-3 text-xs font-semibold text-rose-700"><p>{error}</p><button type="button" onClick={() => void (isSalesPerson ? loadSalesDestination() : refresh())} className="mt-2 font-extrabold underline">Try again</button></div>}
            {!loading && !error && contacts.length === 0 && <div className="p-5 text-center text-slate-500"><UserRoundX className="mx-auto mb-2 h-7 w-7" /><p className="text-xs font-semibold">No authorized WhatsApp contacts are available.</p></div>}
            {!loading && !error && contacts.map((contact) => (
              <div key={`${contact.assignmentType}-${contact.id}`} className="mb-2 last:mb-0">
                {contact.whatsappNumber ? (
                  <a
                    href={whatsappUrl(contact.whatsappNumber, user?.name ?? 'Reproutes user')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 transition hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <span className="min-w-0"><strong className="block truncate text-sm">{contact.name}</strong><span className="text-xs font-semibold text-slate-500">{roleLabel(contact.role)}</span></span>
                    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white"><MessageCircle className="h-3.5 w-3.5" />WhatsApp</span>
                  </a>
                ) : (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><strong className="block text-sm">{contact.name}</strong><span className="text-xs font-semibold text-amber-700">{roleLabel(contact.role)} · WhatsApp number unavailable</span></div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="group relative">
        <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-20 motion-safe:animate-ping [animation-duration:2.8s]" />
        <button
          type="button"
          aria-label="Contact on WhatsApp"
          aria-expanded={false}
          onClick={openSupportWhatsApp}
          className="relative grid h-14 w-14 place-items-center rounded-full border border-emerald-400/40 bg-emerald-600 text-white shadow-xl shadow-emerald-900/30 transition hover:scale-105 hover:bg-emerald-500 focus:outline-none focus:ring-4 focus:ring-emerald-300/50 sm:h-16 sm:w-16"
        >
          <WhatsAppMark className="h-8 w-8 sm:h-9 sm:w-9" />
        </button>
        <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-white opacity-0 shadow-lg transition group-hover:opacity-100 group-focus-within:opacity-100">Contact on WhatsApp</span>
      </div>
    </div>
  );
};
