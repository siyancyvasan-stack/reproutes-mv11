import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  BarChart3, Bell, Boxes, ChevronLeft, ChevronRight, ClipboardList, Factory,
  LayoutDashboard, LogOut, Menu, Navigation, Package, Settings, Store, Truck, Users, Warehouse, X, ReceiptText,
} from 'lucide-react';
import { BrandLogo } from '../common/BrandLogo';
import { AppVersion } from '../common/AppVersion';
import { ProfileAvatar } from '../common/ProfileAvatar';
import { useAuth } from '../../context/AuthContext';
import { factoryApi } from '../../services/factoryApi';
import { ensureAccessToken, getAccessToken } from '../../services/apiClient';
import { useCriticalSafetyAlerts } from '../../hooks/useCriticalSafetyAlerts';
import { FloatingWhatsAppContact } from '../contacts/FloatingWhatsAppContact';

const items = [
  ['Dashboard', LayoutDashboard, '/factory/dashboard'], ['Orders', ClipboardList, '/factory/orders'],
  ['Production', Factory, '/factory/production'], ['Products', Package, '/factory/products'],
  ['Inventory', Warehouse, '/factory/inventory'], ['Factory Members', Users, '/factory/members'],
  ['Dispatch', Truck, '/factory/dispatch'], ['Sales Tracking', Navigation, '/factory/sales-tracking'],
  ['Sales Data', Store, '/factory/retailers'],
  ['Invoices', ReceiptText, '/factory/invoices'],
  ['Reports', BarChart3, '/factory/reports'], ['Notifications', Bell, '/factory/notifications'],
  ['Settings', Settings, '/factory/settings'],
] as const;

export const FactoryLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const unread = useMemo(() => notifications.filter((item) => !item.readAt).length, [notifications]);
  const refreshNotifications = React.useCallback(() => {
    void factoryApi.notifications().then(setNotifications).catch(() => undefined);
  }, []);
  useCriticalSafetyAlerts(refreshNotifications);

  useEffect(() => {
    const load = refreshNotifications;
    load();
    let socket: ReturnType<typeof io> | undefined;
    void ensureAccessToken().then(() => {
      socket = io(undefined, { transports: ['websocket'], withCredentials: true, auth: (callback) => callback({ token: getAccessToken() ?? undefined }) });
      ['factory:new-order', 'sales:new-retailer', 'shop:visited', 'factory:order-approved', 'factory:order-updated', 'factory:production-updated', 'factory:inventory-updated', 'factory:dispatch-updated'].forEach((event) => socket?.on(event, () => {
        load();
        window.dispatchEvent(new CustomEvent('reproutes:sales-data-updated', { detail: { event } }));
      }));
    });
    return () => socket?.disconnect();
  }, [refreshNotifications]);

  const sidebar = (
    <div className="flex h-full flex-col border-r border-white/80 bg-white/72 text-slate-700 backdrop-blur-2xl">
      <div className="flex h-20 items-center justify-between border-b border-slate-200/70 px-5">
        <BrandLogo compact={collapsed} className="[&>span]:!text-slate-900" />
        <button className="hidden rounded-lg border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm hover:text-indigo-600 md:block" onClick={() => setCollapsed((value) => !value)}>{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>
        <button className="md:hidden" onClick={() => setMobile(false)}><X className="h-5 w-5" /></button>
      </div>
      <div className="border-b border-slate-200/70 px-4 py-3">
        {!collapsed && <div className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700 ring-1 ring-indigo-100"><Factory className="h-4 w-4" /> Factory Manager Portal</div>}
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map(([label, Icon, path]) => <NavLink key={path} to={path} onClick={() => setMobile(false)} className={({ isActive }) => `group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-200' : 'text-slate-600 hover:bg-white/80 hover:text-indigo-700'}`}><Icon className="h-5 w-5 shrink-0" />{!collapsed && <span>{label}</span>}</NavLink>)}
      </nav>
      <div className="border-t border-slate-200/70 p-3">
        {!collapsed && <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/80 bg-white/70 p-3 shadow-sm"><ProfileAvatar src={user?.avatar} name={user?.name} className="h-9 w-9 rounded-full" /><div className="min-w-0"><p className="truncate text-xs font-bold text-slate-800">{user?.name}</p><p className="text-[10px] uppercase tracking-wider text-indigo-600">Factory operations</p></div></div>}
        <button onClick={() => { logout(); navigate('/factory/login'); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-rose-400 hover:bg-rose-500/10"><LogOut className="h-5 w-5" />{!collapsed && 'Logout'}</button>
        {!collapsed && <AppVersion portal="factory" className="mt-1" />}
      </div>
    </div>
  );

  return <div className="app-light enterprise-glass factory-glass dashboard-shell min-h-[100dvh] text-slate-900">
    <aside className={`fixed inset-y-0 left-0 z-40 hidden transition-all md:block ${collapsed ? 'w-20' : 'w-64'}`}>{sidebar}</aside>
    {mobile && <div className="fixed inset-0 z-50 md:hidden"><button aria-label="Close menu" className="absolute inset-0 bg-slate-950/70" onClick={() => setMobile(false)} /><aside className="relative h-full w-72">{sidebar}</aside></div>}
    <header className={`dashboard-toolbar sticky top-0 z-30 flex h-[72px] items-center justify-between border-b border-slate-200 px-4 transition-all sm:px-8 ${collapsed ? 'md:ml-20' : 'md:ml-64'}`}>
      <div className="flex items-center gap-3"><button className="rounded-xl border border-slate-200 p-2 md:hidden" onClick={() => setMobile(true)}><Menu className="h-5 w-5" /></button><div><h1 className="text-lg font-extrabold text-slate-950">Factory Operations</h1><p className="hidden text-xs text-slate-500 sm:block">Production, inventory and dispatch control centre</p></div></div>
      <button onClick={() => navigate('/factory/notifications')} className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm"><Bell className="h-5 w-5" />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{unread}</span>}</button>
    </header>
    <main className={`min-w-0 p-[var(--tf-space-page)] transition-all ${collapsed ? 'md:ml-20' : 'md:ml-64'}`}><div className="mx-auto min-w-0 max-w-[1600px] space-y-[var(--tf-space-section)]">{children}</div></main>
    <FloatingWhatsAppContact />
  </div>;
};
