import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ProfileAvatar } from '../common/ProfileAvatar';
import { ManagerSearchResults, searchManagerRecords } from '../../services/managerSearchApi';
import { apiRequest, ensureAccessToken } from '../../services/apiClient';
import { io } from 'socket.io-client';
import {
  Menu,
  Search,
  Bell,
  Check,
  ChevronDown,
  Calendar,
  Sparkles,
  Loader2,
} from 'lucide-react';

interface ManagerHeaderProps {
  onToggleMobileSidebar: () => void;
  collapsed: boolean;
}

export const ManagerHeader: React.FC<ManagerHeaderProps> = ({ onToggleMobileSidebar, collapsed }) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ManagerSearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRequest = useRef(0);
  const [notifications, setNotifications] = useState<Array<{ id: string; type: string; title: string; message: string; readAt?: string; createdAt: string }>>([]);

  const loadNotifications = React.useCallback(() => {
    void apiRequest<typeof notifications>('/api/v1/notifications?limit=30').then(setNotifications).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadNotifications();
    window.addEventListener('reproutes:notifications-changed', loadNotifications);
    let socket: ReturnType<typeof io> | undefined;
    let disposed = false;
    void ensureAccessToken().then((token) => {
      if (disposed) return;
      const configured = (import.meta.env.VITE_TRACKING_SOCKET_URL as string | undefined)?.trim();
      socket = io(configured && configured !== 'same-origin' ? configured : undefined, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
        auth: { token },
      });
      const refreshRetailers = () => {
        loadNotifications();
        window.dispatchEvent(new Event('reproutes:notifications-changed'));
      };
      socket.on('notification:created', refreshRetailers);
      socket.on('sales:new-retailer', refreshRetailers);
    }).catch(() => undefined);
    return () => {
      disposed = true;
      socket?.disconnect();
      window.removeEventListener('reproutes:notifications-changed', loadNotifications);
    };
  }, [loadNotifications]);

  const unreadCount = notifications.filter((notification) => !notification.readAt).length;
  const markAllRead = () => {
    void Promise.all(notifications.filter((notification) => !notification.readAt).map((notification) =>
      apiRequest(`/api/v1/notifications/${notification.id}/read`, { method: 'PATCH' }),
    )).then(loadNotifications);
  };

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    const requestId = ++searchRequest.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchManagerRecords(query)
        .then((results) => {
          if (requestId === searchRequest.current) setSearchResults(results);
        })
        .catch(() => {
          if (requestId === searchRequest.current) {
            setSearchResults({ query, agents: [], orders: [], shops: [], products: [] });
          }
        })
        .finally(() => {
          if (requestId === searchRequest.current) setSearching(false);
        });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const resultCount = searchResults
    ? searchResults.agents.length + searchResults.orders.length +
      searchResults.shops.length + searchResults.products.length
    : 0;
  const openResult = (path: string) => {
    setSearchOpen(false);
    setSearchQuery('');
    navigate(path);
  };

  return (
    <header
      className={`dashboard-toolbar sticky top-0 z-30 flex min-h-[72px] flex-wrap items-center justify-between gap-2 border-b px-4 py-2 transition-all duration-300 sm:flex-nowrap sm:px-8 ${
        collapsed ? 'md:ml-20' : 'md:ml-64'
      }`}
    >
      {/* Left: Mobile Toggle & Dynamic Greeting */}
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onToggleMobileSidebar}
          className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 shadow-sm hover:text-indigo-600 md:hidden"
        >
          <Menu className="w-6 h-6" />
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-lg font-extrabold tracking-tight text-slate-950 sm:text-xl">
              Welcome back, {user?.name?.split(' ')[0] ?? 'Manager'}
            </h1>
            <span className="hidden items-center gap-1 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 sm:inline-flex">
              <span className="relative flex h-2 w-2"><span className="absolute h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50"/><span className="relative h-2 w-2 rounded-full bg-emerald-500"/></span> Live Ops
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <Calendar className="w-3.5 h-3.5 text-indigo-500" />
            <span className="truncate">{currentDate}</span>
            <span className="hidden sm:inline">• Here is today’s field sales performance.</span>
          </p>
        </div>
      </div>

      {/* Right Controls: Search, Notifications, Profile */}
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {/* Search Input */}
        <div className="hidden lg:flex items-center relative w-64">
          <Search className="w-4 h-4 absolute left-3 z-10 text-slate-400 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            placeholder="Search agents, orders, shops..."
            className="glass-input w-full rounded-xl py-2 pl-9 pr-4 text-xs placeholder-slate-400"
          />
          {searching && <Loader2 className="absolute right-3 h-3.5 w-3.5 animate-spin text-indigo-500" />}
          {searchOpen && searchQuery.trim().length >= 2 && (
            <div className="glass-panel absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-white/80 bg-white py-2 shadow-2xl">
              {searching && !searchResults ? (
                <p className="px-4 py-3 text-xs text-slate-400">Searching workspace…</p>
              ) : resultCount === 0 ? (
                <p className="px-4 py-3 text-xs text-slate-400">No matching records found.</p>
              ) : (
                <>
                  <SearchGroup title="Agents">
                    {searchResults?.agents.map((agent) => (
                      <SearchResult key={agent.id} title={agent.name} detail={agent.employeeCode || 'Field Agent'} onClick={() => openResult('/agents')} />
                    ))}
                  </SearchGroup>
                  <SearchGroup title="Orders">
                    {searchResults?.orders.map((order) => (
                      <SearchResult key={order.id} title={`${order.id} · ${order.shopName}`} detail={`${order.agent.name} · ${order.status}`} onClick={() => openResult('/orders')} />
                    ))}
                  </SearchGroup>
                  <SearchGroup title="Shops">
                    {searchResults?.shops.map((shop) => (
                      <SearchResult key={shop.id} title={shop.name} detail={`${shop.ownerName} · ${shop.city}`} onClick={() => openResult('/products')} />
                    ))}
                  </SearchGroup>
                  <SearchGroup title="Products">
                    {searchResults?.products.map((product) => (
                      <SearchResult key={product.id} title={product.name} detail={`${product.sku} · ${product.category}`} onClick={() => openResult('/products')} />
                    ))}
                  </SearchGroup>
                </>
              )}
            </div>
          )}
        </div>

        {/* Notification Bell Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="relative rounded-xl border border-slate-200 bg-white/75 p-2.5 text-slate-600 shadow-sm hover:border-indigo-200 hover:text-indigo-600"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && <><span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-400 animate-ping" /><span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-rose-500" /></>}
          </button>

          {showNotifications && (
            <div className="glass-panel absolute right-0 z-50 mt-3 w-80 rounded-2xl border border-white/80 bg-white py-3 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800">Live Alerts</span>
                <button onClick={markAllRead} className="cursor-pointer text-[10px] font-semibold text-indigo-600 hover:underline">
                  Mark all read
                </button>
              </div>
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
                {!notifications.length && <p className="p-4 text-xs text-slate-500">No notifications yet.</p>}
                {notifications.map((n) => (
                  <button key={n.id} onClick={() => { void apiRequest(`/api/v1/notifications/${n.id}/read`, { method: 'PATCH' }).then(loadNotifications); if (n.type.startsWith('SAFETY_')) navigate('/safety'); }} className={`block w-full p-3 text-left hover:bg-indigo-50/60 ${n.readAt ? 'opacity-65' : ''}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-800">{n.title}</span>
                      <span className="text-[10px] text-slate-400">{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{n.message}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Profile */}
        <div className="relative">
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/75 p-1.5 shadow-sm hover:border-indigo-200"
          >
            <div className="relative">
              <ProfileAvatar
                src={user?.avatar}
                name="Manager"
                className="h-8 w-8 rounded-full border border-indigo-200 object-cover text-[10px]"
              />
              <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-900" />
            </div>
            <span className="hidden max-w-[100px] truncate text-xs font-bold text-slate-800 sm:inline">
              {user?.name ?? 'Manager'}
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>

          {showProfileMenu && (
            <div className="glass-panel absolute right-0 z-50 mt-3 w-52 rounded-xl border border-white/80 bg-white py-2 shadow-2xl">
              <div className="border-b border-slate-200 px-4 py-2">
                <p className="text-xs font-bold text-slate-800">{user?.name ?? 'Manager'}</p>
                <p className="text-[10px] text-slate-400 truncate">Manager Portal</p>
              </div>
              <button
                onClick={logout}
                className="w-full text-left px-4 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-colors"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

const SearchGroup: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  if (!React.Children.count(children)) return null;
  return (
    <div className="py-1">
      <p className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-indigo-600">{title}</p>
      {children}
    </div>
  );
};

const SearchResult: React.FC<{ title: string; detail: string; onClick: () => void }> = ({ title, detail, onClick }) => (
  <button type="button" onClick={onClick} className="w-full px-3 py-2 text-left hover:bg-indigo-50/60">
    <p className="truncate text-xs font-bold text-slate-800">{title}</p>
    <p className="truncate text-[10px] text-slate-500">{detail}</p>
  </button>
);
