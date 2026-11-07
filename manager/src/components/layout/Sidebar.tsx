import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ProfileAvatar } from '../common/ProfileAvatar';
import {
  LayoutDashboard,
  Navigation,
  Users,
  ShoppingBag,
  Package,
  Clock,
  BarChart3,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  ShieldAlert,
  Fuel,
  ReceiptText,
  MapPin,
  Store,
} from 'lucide-react';
import { BrandLogo } from '../common/BrandLogo';
import { AppVersion } from '../common/AppVersion';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}) => {
  const { logout, user } = useAuth();

  const managerItems = [
    { label: 'Live Tracking', icon: Navigation, path: '/live-tracking' },
    { label: 'Agents', icon: Users, path: '/agents' },
    { label: 'Orders', icon: ShoppingBag, path: '/orders' },
    { label: 'Products', icon: Package, path: '/products' },
    { label: 'Attendance', icon: Clock, path: '/attendance' },
    { label: 'Fuel Management', icon: Fuel, path: '/fuel' },
    { label: 'Invoices', icon: ReceiptText, path: '/invoices' },
    { label: 'Shop Intelligence', icon: MapPin, path: '/shop-intelligence' },
    { label: 'Retailers', icon: Store, path: '/retailers' },
    { label: 'Reports', icon: BarChart3, path: '/reports' },
    { label: 'Settings', icon: Settings, path: '/settings' },
    { label: 'Chat & AI', icon: MessageCircle, path: '/chat' },
    { label: 'Safety', icon: ShieldAlert, path: '/safety' },
  ];

  // Administrators own the complete manager workspace as well as the
  // administration-only tools. Keep the admin dashboard URL so refreshes and
  // sign-in redirects continue to land in the administrator portal.
  const navItems = user?.role === 'admin' ? [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/admin/dashboard' },
    ...managerItems,
    { label: 'Contact Administration', icon: MessageCircle, path: '/admin/contacts' },
  ] : [
    { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    ...managerItems,
  ];

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-white/80 bg-white/72 text-slate-700 backdrop-blur-2xl select-none">
      {/* Brand Header */}
      <div className="flex items-center justify-between border-b border-slate-200/70 p-5">
        <div className="flex items-center gap-3 overflow-hidden">
          <BrandLogo compact={collapsed} className="[&>span]:!text-slate-900" />
        </div>

        {/* Desktop Collapse Toggle */}
        <button
          onClick={onToggleCollapse}
          className="hidden rounded-lg border border-slate-200 bg-white/70 p-1.5 text-slate-500 shadow-sm hover:border-indigo-200 hover:text-indigo-600 md:flex"
          title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
        {!collapsed && <AppVersion className="mt-1" />}
      </div>

      {/* Navigation Links */}
      <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onCloseMobile}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3.5 py-3 rounded-xl font-medium text-sm transition-all relative group ${
                isActive
                  ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-200 font-semibold'
                  : 'text-slate-600 hover:bg-white/80 hover:text-indigo-700'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <item.icon
                  className={`w-5 h-5 shrink-0 transition-transform ${
                    isActive ? 'text-white scale-105' : 'text-slate-400 group-hover:text-indigo-600'
                  }`}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}

                {/* Collapsed Tooltip */}
                {collapsed && (
                  <div className="absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 opacity-0 shadow-xl transition-all pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100">
                    {item.label}
                  </div>
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>

      {/* User Info & Logout */}
      <div className="border-t border-slate-200/70 bg-white/35 p-3">
        {!collapsed && user && (
          <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/80 bg-white/70 px-3 py-2 shadow-sm">
            <ProfileAvatar
              src={user.avatar}
              name={user.name}
              className="h-9 w-9 shrink-0 rounded-full border border-indigo-200 object-cover text-[10px]"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-slate-800">{user.name}</p>
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-indigo-600">
                {user.role === 'admin' ? 'Administrator Portal' : 'Manager Portal'}
              </p>
            </div>
          </div>
        )}

        <button
          onClick={logout}
          className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl font-medium text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
        >
          <LogOut className="w-5 h-5 shrink-0" />
          {!collapsed && <span>Logout</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden md:block fixed top-0 left-0 bottom-0 z-40 transition-all duration-300 ${
          collapsed ? 'w-20' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop & Sidebar */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onCloseMobile} />
          <div className="relative w-72 max-w-[80vw] h-full z-10">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
