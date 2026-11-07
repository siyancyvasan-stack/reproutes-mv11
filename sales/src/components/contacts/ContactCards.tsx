import React from 'react';
import { Check, Copy, MessageCircle, Phone, UserRoundX } from 'lucide-react';
import { ProfileAvatar } from '../common/ProfileAvatar';
import { Contact, callUrl, whatsappUrl } from '../../services/contactApi';
import { useAuth } from '../../context/AuthContext';

const DEFAULT_SUPPORT_WHATSAPP_NUMBER = '94729790397';

const roleLabel = (role: Contact['role']) => role === 'AGENT' ? 'Sales Person' : role === 'MANAGER' ? 'Manager' : 'Factory Manager';

export const ContactCards: React.FC<{ contacts: Contact[]; emptyMessage?: string; dark?: boolean }> = ({ contacts, emptyMessage = 'No contacts have been assigned. Please contact administration.', dark = false }) => {
  const { user } = useAuth();
  const [copied, setCopied] = React.useState<string>();
  if (!contacts.length) return <div className={`rounded-2xl border p-8 text-center ${dark ? 'border-slate-800 bg-slate-900/60 text-slate-400' : 'border-slate-200 bg-white text-slate-500'}`}><UserRoundX className="mx-auto mb-3 h-9 w-9"/><p className="text-sm font-semibold">{emptyMessage}</p><a href={whatsappUrl(DEFAULT_SUPPORT_WHATSAPP_NUMBER, user?.name ?? 'Reproutes user')} target="_blank" rel="noopener noreferrer" className="mx-auto mt-5 flex min-h-12 max-w-xs items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-emerald-500"><MessageCircle className="h-5 w-5"/>Message on WhatsApp</a></div>;
  return <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{contacts.map((contact) => {
    const phone = contact.phone || contact.whatsappNumber;
    return <article key={`${contact.assignmentType}-${contact.id}`} className={`rounded-3xl border p-5 shadow-sm ${dark ? 'border-slate-800 bg-slate-900/70 text-white' : 'border-slate-200 bg-white text-slate-900'}`}>
      <div className="flex items-center gap-4"><ProfileAvatar src={contact.avatarUrl} name={contact.name} className="h-16 w-16 rounded-2xl"/><div className="min-w-0"><h3 className="truncate text-lg font-extrabold">{contact.name}</h3><p className="text-sm font-semibold text-cyan-500">{roleLabel(contact.role)}</p><span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${contact.availability === 'AVAILABLE' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-slate-500/15 text-slate-400'}`}>{contact.role === 'AGENT' && contact.presence ? contact.presence.replace('_', ' ') : contact.availability === 'AVAILABLE' ? 'Available' : 'Inactive'}</span></div></div>
      <p className={`mt-4 text-sm ${dark ? 'text-slate-300' : 'text-slate-600'}`}>{phone || 'Phone number not available'}</p>
      <div className="mt-5 grid gap-3">
        {contact.whatsappNumber ? <a href={whatsappUrl(contact.whatsappNumber, user?.name ?? 'Reproutes user')} target="_blank" rel="noopener noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white hover:bg-emerald-500"><MessageCircle className="h-5 w-5"/>WhatsApp</a> : <div className="rounded-xl bg-amber-500/10 p-3 text-xs font-semibold text-amber-600">WhatsApp number not available. Please contact administration.</div>}
        <div className="grid grid-cols-2 gap-2">{phone ? <a href={callUrl(phone)} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-cyan-500/30 px-3 py-3 text-sm font-bold text-cyan-500"><Phone className="h-4 w-4"/>Call</a> : <span className="grid min-h-12 place-items-center rounded-xl border border-slate-300 text-xs text-slate-400">No phone</span>}
        {phone ? <button type="button" onClick={async()=>{await navigator.clipboard.writeText(phone);setCopied(contact.id);setTimeout(()=>setCopied(undefined),1500)}} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-3 py-3 text-sm font-bold"><>{copied===contact.id?<Check className="h-4 w-4"/>:<Copy className="h-4 w-4"/>}{copied===contact.id?'Copied':'Copy'}</></button> : <span/>}</div>
      </div>
    </article>;
  })}</div>;
};
