import React, { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, BarChart3, CalendarDays, PieChartIcon, Sparkles, TrendingUp } from 'lucide-react';
import { Agent, AttendanceRecord, Order } from '../../types';
import { DashboardCard, SectionHeading } from './DashboardUI';

type Period = 7 | 30 | 90;
type Metric = 'sales' | 'orders' | 'cases';
const colors = ['#4f46e5', '#06b6d4', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'];
const tooltip = { border: '1px solid #e2e8f0', borderRadius: 14, background: 'rgba(255,255,255,.98)', boxShadow: '0 18px 45px -22px #475569', fontSize: 12 };
const metrics = {
  sales: { label: 'Revenue', color: '#4f46e5', format: (n: number) => `LKR ${n.toLocaleString()}` },
  orders: { label: 'Orders', color: '#06b6d4', format: (n: number) => n.toLocaleString() },
  cases: { label: 'Cases', color: '#10b981', format: (n: number) => n.toLocaleString() },
};
const Empty = ({ text }: { text: string }) => <div className="grid h-full min-h-52 place-items-center px-5 text-center"><div><BarChart3 className="mx-auto h-8 w-8 text-slate-300"/><p className="mt-3 text-sm font-bold text-slate-700">{text}</p><p className="mt-1 text-xs text-slate-400">New activity will appear automatically.</p></div></div>;

export const ManagerAnalyticsCommandCenter = ({ agents, orders, attendance }: { agents: Agent[]; orders: Order[]; attendance: AttendanceRecord[] }) => {
  const [period, setPeriod] = useState<Period>(30);
  const [metric, setMetric] = useState<Metric>('sales');
  const daily = useMemo(() => Array.from({ length: period }, (_, index) => {
    const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - (period - 1 - index));
    const key = day.toISOString().slice(0, 10); const rows = orders.filter((order) => order.date === key);
    return { key, label: new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(day), sales: rows.reduce((n, o) => n + o.totalAmountLkr, 0), orders: rows.length, cases: rows.reduce((n, o) => n + o.casesCount, 0) };
  }), [orders, period]);
  const statuses = useMemo(() => Object.entries(orders.reduce<Record<string, number>>((all, order) => { all[order.status] = (all[order.status] ?? 0) + 1; return all; }, {})).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value), [orders]);
  const performers = useMemo(() => [...agents].sort((a, b) => b.todayRevenueLkr - a.todayRevenueLkr).slice(0, 7).map((agent) => ({ name: agent.name.split(' ')[0], fullName: agent.name, revenue: agent.todayRevenueLkr, orders: agent.ordersCount })), [agents]);
  const total = daily.reduce((n, item) => n + item[metric], 0); const middle = Math.floor(daily.length / 2);
  const before = daily.slice(0, middle).reduce((n, item) => n + item[metric], 0); const now = daily.slice(middle).reduce((n, item) => n + item[metric], 0);
  const change = before ? Math.round((now - before) / before * 100) : undefined;
  const present = attendance.filter((row) => row.status === 'Present' || row.status === 'Late').length;
  const attendanceRate = attendance.length ? Math.round(present / attendance.length * 100) : 0; const best = performers[0];

  return <section className="space-y-5" aria-labelledby="manager-analytics-title">
    <DashboardCard className="p-4 sm:p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <SectionHeading icon={Activity} title="Sales Analytics Command Center" subtitle="Explore revenue, orders and team performance from one responsive workspace."/>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex min-h-11 rounded-xl border border-slate-200 bg-slate-50 p-1">{(Object.keys(metrics) as Metric[]).map((item) => <button key={item} onClick={() => setMetric(item)} aria-pressed={metric === item} className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-bold sm:flex-none ${metric === item ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500'}`}>{metrics[item].label}</button>)}</div>
        <div className="flex min-h-11 rounded-xl border border-slate-200 bg-slate-50 p-1">{([7, 30, 90] as Period[]).map((item) => <button key={item} onClick={() => setPeriod(item)} aria-pressed={period === item} className={`min-h-9 flex-1 rounded-lg px-3 text-xs font-bold sm:flex-none ${period === item ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'text-slate-500'}`}>{item}D</button>)}</div>
      </div>
    </div></DashboardCard>

    <div className="grid gap-5 xl:grid-cols-12">
      <DashboardCard className="min-w-0 p-4 sm:p-6 xl:col-span-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div><div className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-indigo-600"/><h3 id="manager-analytics-title" className="font-extrabold text-slate-950">{metrics[metric].label} Trend</h3></div><p className="mt-1 text-xs text-slate-500">Daily movement across the selected {period}-day period</p></div><div className="rounded-xl bg-indigo-50 px-3 py-2 text-right ring-1 ring-indigo-100"><span className="block text-[10px] font-bold uppercase text-indigo-500">Period total</span><b className="text-sm text-indigo-800">{metrics[metric].format(total)}</b></div></div>
        <div className="mt-5 h-64 min-w-0 sm:h-80">{daily.some((item) => item[metric] > 0) ? <ResponsiveContainer width="100%" height="100%"><LineChart data={daily} margin={{ top: 8, right: 8, left: -16 }}><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 5"/><XAxis dataKey="label" axisLine={false} tickLine={false} minTickGap={period === 90 ? 34 : 20} tick={{ fontSize: 10, fill: '#64748b' }}/><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(value) => metric === 'sales' ? `${Math.round(value / 1000)}k` : value}/><Tooltip contentStyle={tooltip} formatter={(value) => [metrics[metric].format(Number(value)), metrics[metric].label]} labelFormatter={(_, rows) => rows?.[0]?.payload?.key ?? ''}/><Line type="monotone" dataKey={metric} stroke={metrics[metric].color} strokeWidth={3} dot={period === 7 ? { r: 4, fill: '#fff', strokeWidth: 3 } : false} activeDot={{ r: 6 }}/></LineChart></ResponsiveContainer> : <Empty text={`No ${metrics[metric].label.toLowerCase()} in this period`}/>}</div>
      </DashboardCard>

      <DashboardCard className="min-w-0 p-4 sm:p-6 xl:col-span-4">
        <div className="flex items-center gap-2"><PieChartIcon className="h-5 w-5 text-cyan-600"/><h3 className="font-extrabold text-slate-950">Order Pipeline</h3></div><p className="mt-1 text-xs text-slate-500">Live distribution by fulfilment status</p>
        <div className="mt-2 h-60 sm:h-64">{statuses.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statuses} dataKey="value" nameKey="name" innerRadius="48%" outerRadius="72%" paddingAngle={3} stroke="white" strokeWidth={3}>{statuses.map((item, index) => <Cell key={item.name} fill={colors[index % colors.length]}/>)}</Pie><Tooltip contentStyle={tooltip}/><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }}/></PieChart></ResponsiveContainer> : <Empty text="No order pipeline data"/>}</div>
        <div className="grid grid-cols-2 gap-2">{statuses.slice(0, 6).map((item, index) => <div key={item.name} className="flex min-w-0 justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2"><span className="flex min-w-0 items-center gap-2 text-xs text-slate-500"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: colors[index % colors.length] }}/><span className="truncate">{item.name}</span></span><b className="text-xs">{item.value}</b></div>)}</div>
      </DashboardCard>
    </div>

    <div className="grid gap-5 xl:grid-cols-12">
      <DashboardCard className="min-w-0 p-4 sm:p-6 xl:col-span-8">
        <div className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-emerald-600"/><h3 className="font-extrabold text-slate-950">Salesperson Revenue Ranking</h3></div><p className="mt-1 text-xs text-slate-500">Today’s revenue contribution by top field performers</p>
        <div className="mt-5 h-72 sm:h-80">{performers.some((item) => item.revenue > 0) ? <ResponsiveContainer width="100%" height="100%"><BarChart data={performers} margin={{ left: -12, right: 8 }}><defs><linearGradient id="managerRevenueBars" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#10b981"/><stop offset="1" stopColor="#06b6d4"/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 5"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }}/><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8' }} tickFormatter={(value) => `${Math.round(value / 1000)}k`}/><Tooltip contentStyle={tooltip} labelFormatter={(_, rows) => rows?.[0]?.payload?.fullName ?? ''} formatter={(value, _name, row) => [`LKR ${Number(value).toLocaleString()} · ${row.payload.orders} orders`, 'Revenue']}/><Bar dataKey="revenue" fill="url(#managerRevenueBars)" radius={[8, 8, 2, 2]} maxBarSize={54}/></BarChart></ResponsiveContainer> : <Empty text="No salesperson revenue yet"/>}</div>
      </DashboardCard>

      <DashboardCard className="relative overflow-hidden p-5 sm:p-6 xl:col-span-4">
        <span className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-violet-300/20 blur-3xl"/><div className="relative"><div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-600"/><h3 className="font-extrabold text-slate-950">Executive Snapshot</h3></div><p className="mt-1 text-xs text-slate-500">Fast signals for the current operation</p>
        <div className="mt-5 space-y-3"><div className="rounded-2xl bg-indigo-50 p-4 ring-1 ring-indigo-100"><span className="text-xs font-bold text-indigo-500">PERIOD MOMENTUM</span><b className="mt-1 block text-xl text-indigo-900">{change == null ? 'Building baseline' : `${change >= 0 ? '+' : ''}${change}%`}</b><p className="mt-1 text-xs text-indigo-700">Compared with the first half of this period.</p></div>
        <div className="grid grid-cols-2 gap-3"><div className="rounded-2xl bg-emerald-50 p-4"><span className="text-[10px] font-bold uppercase text-emerald-600">Attendance</span><b className="mt-1 block text-xl text-emerald-900">{attendanceRate}%</b></div><div className="rounded-2xl bg-cyan-50 p-4"><span className="text-[10px] font-bold uppercase text-cyan-600">Active team</span><b className="mt-1 block text-xl text-cyan-900">{agents.filter((agent) => agent.status === 'Active').length}/{agents.length}</b></div></div>
        <div className="rounded-2xl border border-slate-100 bg-white/70 p-4"><div className="flex items-center gap-2 text-xs font-bold uppercase text-slate-400"><CalendarDays className="h-4 w-4"/>Top performer</div><b className="mt-2 block truncate text-sm text-slate-900">{best?.fullName ?? 'Awaiting sales activity'}</b><p className="mt-1 text-xs text-slate-500">{best ? `LKR ${best.revenue.toLocaleString()} from ${best.orders} orders today` : 'Performance signals will populate automatically.'}</p></div></div></div>
      </DashboardCard>
    </div>
  </section>;
};

