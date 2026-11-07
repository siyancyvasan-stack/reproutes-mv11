import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { ManagerHeader } from './ManagerHeader';
import { useCriticalSafetyAlerts } from '../../hooks/useCriticalSafetyAlerts';
import { FloatingWhatsAppContact } from '../contacts/FloatingWhatsAppContact';

interface ManagerLayoutProps {
  children: React.ReactNode;
  wide?: boolean;
}

export const ManagerLayout: React.FC<ManagerLayoutProps> = ({ children, wide = false }) => {
  useCriticalSafetyAlerts();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-light enterprise-glass dashboard-shell min-h-[100dvh] text-slate-900 flex flex-col relative overflow-x-hidden">
      {/* Background soft ambient gradient lights */}
      <div className="ambient-orb fixed top-0 left-1/4 w-[600px] h-[600px] bg-indigo-600/10 rounded-full blur-[140px] pointer-events-none z-0" />
      <div className="ambient-orb fixed bottom-0 right-10 w-[500px] h-[500px] bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none z-0" />
      <div className="fixed inset-0 bg-grid-pattern opacity-40 pointer-events-none z-0" />

      {/* Sidebar */}
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      {/* Header */}
      <ManagerHeader
        collapsed={collapsed}
        onToggleMobileSidebar={() => setMobileOpen(true)}
      />

      {/* Main Content Body */}
      <main
        className={`flex-1 p-[var(--tf-space-page)] transition-all duration-300 relative z-10 ${
          collapsed ? 'md:ml-20' : 'md:ml-64'
        }`}
      >
        <div className={`${wide ? 'max-w-[1760px]' : 'max-w-[1600px]'} mx-auto min-w-0 space-y-[var(--tf-space-section)]`}>{children}</div>
      </main>
      <FloatingWhatsAppContact />
    </div>
  );
};
