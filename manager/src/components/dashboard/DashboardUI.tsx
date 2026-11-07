import React from 'react';
import { LucideIcon, TrendingDown, TrendingUp } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';

export type DashboardTone = 'blue' | 'cyan' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'violet';

const tones: Record<DashboardTone, { icon: string; badge: string; chart: string; glow: string }> = {
  blue: { icon: 'from-blue-500 to-indigo-500 text-white', badge: 'bg-blue-50 text-blue-700 ring-blue-100', chart: '#2563eb', glow: 'bg-blue-400' },
  cyan: { icon: 'from-cyan-400 to-sky-500 text-white', badge: 'bg-cyan-50 text-cyan-700 ring-cyan-100', chart: '#06b6d4', glow: 'bg-cyan-400' },
  indigo: { icon: 'from-indigo-500 to-blue-600 text-white', badge: 'bg-indigo-50 text-indigo-700 ring-indigo-100', chart: '#4f46e5', glow: 'bg-indigo-400' },
  emerald: { icon: 'from-emerald-400 to-cyan-500 text-white', badge: 'bg-emerald-50 text-emerald-700 ring-emerald-100', chart: '#10b981', glow: 'bg-emerald-400' },
  amber: { icon: 'from-amber-400 to-orange-500 text-white', badge: 'bg-amber-50 text-amber-700 ring-amber-100', chart: '#f59e0b', glow: 'bg-amber-400' },
  rose: { icon: 'from-rose-400 to-red-500 text-white', badge: 'bg-rose-50 text-rose-700 ring-rose-100', chart: '#f43f5e', glow: 'bg-rose-400' },
  violet: { icon: 'from-violet-500 to-purple-500 text-white', badge: 'bg-violet-50 text-violet-700 ring-violet-100', chart: '#8b5cf6', glow: 'bg-violet-400' },
};

export const DashboardCard = ({ children, className = '', interactive = false, ...props }: React.HTMLAttributes<HTMLElement> & { interactive?: boolean }) => (
  <section className={`dashboard-card ${interactive ? 'dashboard-card-interactive' : ''} ${className}`} {...props}>{children}</section>
);

export const SectionHeading = ({ icon: Icon, title, subtitle, action }: { icon?: LucideIcon; title: string; subtitle?: string; action?: React.ReactNode }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        {Icon && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-indigo-100"><Icon className="h-4.5 w-4.5" /></span>}
        <h2 className="text-lg font-extrabold tracking-tight text-slate-950 sm:text-xl">{title}</h2>
      </div>
      {subtitle && <p className={`${Icon ? 'sm:pl-11' : ''} mt-1 text-sm text-slate-500`}>{subtitle}</p>}
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export type PremiumKpiProps = {
  label: string;
  value: React.ReactNode;
  unit?: string;
  icon: LucideIcon;
  tone: DashboardTone;
  comparison?: { label: string; direction?: 'up' | 'down' | 'neutral' };
  sparkline?: number[];
  loading?: boolean;
};

export const PremiumKpi: React.FC<PremiumKpiProps> = ({ label, value, unit, icon: Icon, tone, comparison, sparkline, loading = false }) => {
  const palette = tones[tone];
  const chartData = (sparkline ?? []).map((metric, index) => ({ index, metric }));
  const direction = comparison?.direction ?? 'neutral';
  return (
    <DashboardCard interactive className="group relative min-h-40 overflow-hidden p-5" aria-label={`${label}: ${String(value)}${unit ? ` ${unit}` : ''}`}>
      <span className={`pointer-events-none absolute -right-9 -top-9 h-28 w-28 rounded-full ${palette.glow} opacity-[0.08] blur-2xl`} />
      {loading ? <div className="space-y-4" role="status"><div className="h-10 w-10 animate-pulse rounded-xl bg-slate-200"/><div className="h-4 w-28 animate-pulse rounded bg-slate-200"/><div className="h-8 w-24 animate-pulse rounded bg-slate-200"/></div> : <>
        <div className="flex items-start justify-between gap-3">
          <span className={`grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br shadow-lg shadow-slate-200/70 transition-transform duration-200 group-hover:scale-105 ${palette.icon}`}><Icon className="h-5 w-5" /></span>
          {comparison && <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${palette.badge}`}>
            {direction === 'up' && <TrendingUp className="h-3 w-3"/>}{direction === 'down' && <TrendingDown className="h-3 w-3"/>}{comparison.label}
          </span>}
        </div>
        <p className="mt-4 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div className="min-w-0"><strong className="block truncate text-3xl font-black leading-tight tracking-tight text-slate-950">{value}</strong>{unit && <span className="text-xs font-semibold text-slate-400">{unit}</span>}</div>
          {chartData.length > 1 && <div className="h-10 w-20 shrink-0" aria-hidden="true"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id={`kpi-${tone}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={palette.chart} stopOpacity=".35"/><stop offset="1" stopColor={palette.chart} stopOpacity="0"/></linearGradient></defs><Area type="monotone" dataKey="metric" stroke={palette.chart} strokeWidth={2.2} fill={`url(#kpi-${tone})`} isAnimationActive animationDuration={350}/></AreaChart></ResponsiveContainer></div>}
        </div>
      </>}
    </DashboardCard>
  );
};

export const StatusDot = ({ tone = 'slate', pulse = false }: { tone?: 'emerald' | 'amber' | 'rose' | 'slate' | 'cyan' | 'violet'; pulse?: boolean }) => {
  const color = { emerald: 'bg-emerald-500', amber: 'bg-amber-500', rose: 'bg-rose-500', slate: 'bg-slate-400', cyan: 'bg-cyan-500', violet: 'bg-violet-500' }[tone];
  return <span className="relative flex h-2.5 w-2.5 shrink-0">{pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${color} opacity-50`}/>}<span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`}/></span>;
};

export const EmptyState = ({ icon: Icon, title, message }: { icon: LucideIcon; title: string; message: string }) => <div className="grid min-h-48 place-items-center px-6 py-10 text-center" role="status"><div><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-500 ring-1 ring-indigo-100"><Icon className="h-5 w-5"/></span><h3 className="mt-3 text-sm font-extrabold text-slate-800">{title}</h3><p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{message}</p></div></div>;
