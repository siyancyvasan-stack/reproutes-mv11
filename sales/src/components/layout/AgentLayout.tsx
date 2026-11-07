import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  LayoutDashboard,
  PlusCircle,
  Store,
  User,
  LogOut,
  Battery,
  Coffee,
  Play,
  MessageCircle,
  ShieldAlert,
  Fuel,
  Activity,
  MapPin,
} from 'lucide-react';
import { Badge } from '../common/Badge';
import { useAgentLocationPublisher } from '../../hooks/useAgentLocationPublisher';
import { ProfileAvatar } from '../common/ProfileAvatar';
import { BrandLogo } from '../common/BrandLogo';
import { AppVersion } from '../common/AppVersion';
import { trackingLog } from '../../services/trackingLog';
import { apiRequest } from '../../services/apiClient';
import { FloatingWhatsAppContact } from '../contacts/FloatingWhatsAppContact';
import { flushFieldOperations } from '../../services/fieldOperationQueue';
import { AndroidAppInstall } from '../common/AndroidAppInstall';

interface AgentLayoutProps {
  children: React.ReactNode;
  agentStatus?: string;
  onToggleBreak?: () => void;
}

export const AgentLayout: React.FC<AgentLayoutProps> = ({
  children,
  agentStatus = 'Active',
  onToggleBreak,
}) => {
  const { user, logout } = useAuth();
  const location = useLocation();
  const portalBase = location.pathname.startsWith('/sales/') ? '/sales' : '/agent';
  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [batterySupported, setBatterySupported] = useState(true);

  useEffect(() => {
    let disposed = false;
    let battery: (EventTarget & { level: number; charging: boolean }) | undefined;

    const updateBattery = () => {
      if (!disposed && battery) setBatteryLevel(Math.round(battery.level * 100));
    };

    const loadBattery = async () => {
      const nav = navigator as Navigator & {
        getBattery?: () => Promise<EventTarget & { level: number; charging: boolean }>;
      };
      if (!nav.getBattery) {
        if (!disposed) setBatterySupported(false);
        return;
      }
      try {
        battery = await nav.getBattery();
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        return () => battery?.removeEventListener('levelchange', updateBattery);
      } catch {
        if (!disposed) setBatterySupported(false);
      }
    };

    let cleanup: (() => void) | undefined;
    void loadBattery().then((result) => {
      if (disposed) result?.();
      else cleanup = result;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    const syncCheckIn = () =>
      setIsCheckedIn(localStorage.getItem('tf_agent_checked_in') === 'true');
    void apiRequest<{ checkedIn: boolean }>('/api/v1/attendance/status')
      .then(({ checkedIn }) => {
        localStorage.setItem('tf_agent_checked_in', String(checkedIn));
        setIsCheckedIn(checkedIn);
      })
      .catch(() => {
        localStorage.setItem('tf_agent_checked_in', 'false');
        setIsCheckedIn(false);
      });
    window.addEventListener('reproutes:agent-check-in-changed', syncCheckIn);
    return () => window.removeEventListener('reproutes:agent-check-in-changed', syncCheckIn);
  }, []);
  const locationPublisher = useAgentLocationPublisher(
    Boolean(user?.id),
    user?.id,
    isCheckedIn,
  );
  useEffect(()=>{if(!user?.id)return;const flush=()=>void flushFieldOperations(user.id).catch(()=>undefined);flush();window.addEventListener('online',flush);return()=>window.removeEventListener('online',flush)},[user?.id]);
  const trackingStateLabels = {
    'tracking-stopped': 'Tracking stopped',
    'requesting-permission': 'Requesting permission',
    'gps-unavailable': 'GPS unavailable',
    'permission-denied': 'Permission denied',
    'gps-timeout': 'GPS timeout',
    'poor-accuracy': 'Poor accuracy',
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    offline: 'Offline',
    'tracking-active': 'Tracking active',
    error: 'GPS error',
  } as const;
  const trackingLabel = trackingStateLabels[locationPublisher.state];

  const handleLogout = () => {
    localStorage.setItem('tf_agent_checked_in', 'false');
    window.dispatchEvent(new Event('reproutes:agent-check-in-changed'));
    trackingLog('tracking-stop', { agentId: user?.id, reason: 'logout' });
    logout();
  };

  const navItems = [
    { label: 'Home', icon: LayoutDashboard, path: `${portalBase}/dashboard` },
    { label: 'Shops', icon: Store, path: `${portalBase}/shops` },
    { label: 'Activity', icon: Activity, path: `${portalBase}/activity` },
    { label: 'Chat & AI', icon: MessageCircle, path: `${portalBase}/chat` },
    { label: 'Profile', icon: User, path: `${portalBase}/profile` },
  ];

  return (
    <div className="app-light enterprise-glass min-h-[100dvh] bg-slate-50 text-slate-900 flex flex-col relative pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-8">
      {/* Subtle Background Lighting */}
      <div className="ambient-orb fixed top-0 left-1/3 w-[500px] h-[500px] bg-cyan-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="ambient-orb fixed bottom-0 right-1/4 w-[400px] h-[400px] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed inset-0 bg-grid-pattern opacity-30 pointer-events-none" />

      {/* Top Mobile/Desktop Header */}
      <header className="sticky top-0 z-30 flex min-h-20 flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-[#07111F]/90 px-4 py-3 backdrop-blur-xl sm:flex-nowrap">
        <div className="flex items-center gap-3">
          <BrandLogo suffix="Agent" />
          <div>
            <span className="text-[10px] text-slate-400 font-semibold block -mt-0.5">
              {user?.region || 'Field Sales Mobile Portal'}
            </span>
          </div>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          <AndroidAppInstall compact className="hidden sm:block" />
          {/* Status Badge */}
          <div
            title={`GPS: ${trackingLabel}${locationPublisher.accuracyMeters == null ? '' : ` (±${locationPublisher.accuracyMeters} m)`}`}
            aria-live="polite"
          >
            <Badge status={trackingLabel} />
          </div>

          {/* Break Toggle */}
          {onToggleBreak && (
            <button
              onClick={onToggleBreak}
              className={`p-2 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-all ${
                agentStatus === 'On Break'
                  ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                  : 'bg-amber-500/15 border-amber-500/30 text-amber-400 hover:bg-amber-500/25'
              }`}
              title={agentStatus === 'On Break' ? 'End Break' : 'Start 15m Tea Break'}
            >
              {agentStatus === 'On Break' ? (
                <>
                  <Play className="w-3.5 h-3.5 fill-emerald-400" />
                  <span className="hidden sm:inline">Resume Work</span>
                </>
              ) : (
                <>
                  <Coffee className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Take Break</span>
                </>
              )}
            </button>
          )}

          {/* Battery Indicator */}
          <div className="hidden sm:flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
            <Battery className={`w-4 h-4 ${batteryLevel !== null ? 'text-emerald-400' : 'text-slate-500'}`} />
            <span>{batterySupported && batteryLevel !== null ? `${batteryLevel}%` : 'Unavailable'}</span>
          </div>

          <ProfileAvatar
            src={user?.avatar}
            name={user?.name}
            className="w-8 h-8 rounded-full object-cover border border-cyan-500/50 text-[10px]"
          />

          <button
            onClick={handleLogout}
            className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 hover:bg-rose-500/20 transition-colors"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 mx-auto w-full min-w-0 max-w-4xl flex-1 p-[var(--tf-space-page)]">{children}</main>
      <AppVersion portal="sales" className="relative z-10 mb-2 hidden md:block" />

      <FloatingWhatsAppContact aboveMobileNav />

      {/* Mobile Sticky Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around gap-1 border-t border-slate-800/80 bg-[#07111F]/95 px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] shadow-2xl backdrop-blur-xl sm:px-4">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 transition-all sm:px-3 ${
                isActive ? 'text-cyan-400 font-bold scale-105' : 'text-slate-400 hover:text-slate-200'
              }`
            }
          >
            <item.icon className="w-5 h-5" />
            <span className="max-w-full truncate text-[10px] uppercase tracking-wide">{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
};
