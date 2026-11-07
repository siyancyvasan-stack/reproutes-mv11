import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ProfileAvatar } from '../common/ProfileAvatar';
import {
  Activity,
  Award,
  BatteryWarning,
  Bell,
  CalendarDays,
  CheckCircle2,
  Download,
  MapPin,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
} from 'lucide-react';
import { Agent, Order } from '../../types';
import { GlassCard } from '../common/GlassCard';
import { Badge } from '../common/Badge';

interface EnterpriseAnalyticsProps {
  agents: Agent[];
  orders: Order[];
  onExport: () => void | Promise<void>;
  onRefresh: () => void;
}

type DateRange = '7d' | '30d' | '90d';

const CHART_TOOLTIP_STYLE = {
  backgroundColor: 'rgba(7, 17, 31, 0.96)',
  border: '1px solid rgba(6, 182, 212, 0.3)',
  borderRadius: '12px',
  color: '#f8fafc',
  fontSize: '11px',
  boxShadow: '0 14px 32px rgba(2, 8, 23, 0.42)',
};

const ORDER_COLORS: Record<string, string> = {
  Approved: '#10b981',
  Pending: '#f59e0b',
  Processing: '#06b6d4',
  Delivered: '#4f46e5',
  Cancelled: '#ef4444',
};

const COMPARISON_DATA = [
  { label: 'W1', current: 1860, previous: 1620, target: 1750 },
  { label: 'W2', current: 2140, previous: 1840, target: 1950 },
  { label: 'W3', current: 2380, previous: 2210, target: 2200 },
  { label: 'W4', current: 2715, previous: 2450, target: 2500 },
];

const HEATMAP = [
  { day: 'Mon', values: [32, 48, 72, 58, 38] },
  { day: 'Tue', values: [38, 62, 86, 74, 45] },
  { day: 'Wed', values: [44, 70, 92, 81, 56] },
  { day: 'Thu', values: [35, 66, 78, 88, 61] },
  { day: 'Fri', values: [52, 79, 100, 94, 72] },
  { day: 'Sat', values: [28, 54, 68, 63, 40] },
  { day: 'Sun', values: [18, 30, 42, 36, 22] },
];

const HEATMAP_SLOTS = ['8 AM', '10 AM', '12 PM', '2 PM', '4 PM'];

export const EnterpriseAnalytics: React.FC<EnterpriseAnalyticsProps> = ({
  agents,
  orders,
  onExport,
  onRefresh,
}) => {
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const regionData = useMemo(
    () => {
      const agentById = new Map<string, Agent>(
        agents.map((agent): [string, Agent] => [agent.id, agent]),
      );
      const totals = new Map<string, { region: string; sales: number; orders: number }>();
      orders.forEach((order) => {
        const agent = agentById.get(order.agentId);
        const assignedRoute = agent?.routeAssigned?.trim();
        const region = assignedRoute
          ? (assignedRoute.split(' - ')[1]?.split(' & ')[0]?.trim() || assignedRoute)
          : 'Unassigned';
        const current = totals.get(region) ?? { region, sales: 0, orders: 0 };
        current.sales += order.totalAmountLkr;
        current.orders += 1;
        totals.set(region, current);
      });
      return [...totals.values()].sort((a, b) => b.sales - a.sales).slice(0, 6);
    },
    [agents, orders],
  );

  const orderDistribution = useMemo(() => {
    const counts = orders.reduce((result: Record<string, number>, order: Order) => {
      result[order.status] = (result[order.status] ?? 0) + 1;
      return result;
    }, {} as Record<string, number>);
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [orders]);

  const rankedAgents = useMemo(
    () => [...agents].sort((a, b) => b.todayRevenueLkr - a.todayRevenueLkr).slice(0, 5),
    [agents],
  );

  const rangeMultiplier = dateRange === '7d' ? 0.25 : dateRange === '90d' ? 2.7 : 1;
  const comparisonData = COMPARISON_DATA.map((item) => ({
    ...item,
    current: Math.round(item.current * rangeMultiplier),
    previous: Math.round(item.previous * rangeMultiplier),
    target: Math.round(item.target * rangeMultiplier),
  }));

  const refresh = () => {
    setIsRefreshing(true);
    onRefresh();
    window.setTimeout(() => setIsRefreshing(false), 400);
  };

  return (
    <section aria-labelledby="enterprise-analytics-title" className="space-y-6">
      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>
              <h3 id="enterprise-analytics-title" className="text-lg font-bold text-white">
                Enterprise Analytics Command Center
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Revenue, regional performance, fulfilment health and live field signals
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-900/70 border border-slate-800">
              <CalendarDays className="w-3.5 h-3.5 text-cyan-400 ml-2" />
              {(['7d', '30d', '90d'] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  aria-pressed={dateRange === range}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-all duration-200 ${
                    dateRange === range ? 'bg-cyan-500 text-slate-950' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {range === '7d' ? '7 Days' : range === '30d' ? '30 Days' : '90 Days'}
                </button>
              ))}
            </div>
            <button
              onClick={refresh}
              className="p-2.5 rounded-xl bg-slate-900/70 hover:bg-slate-800 border border-slate-800 text-cyan-400 transition-all duration-200"
              aria-label="Refresh analytics"
              title="Refresh analytics"
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => void onExport()}
              className="px-3 py-2.5 rounded-xl glass-button-primary text-white text-xs font-bold flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
          </div>
        </div>
      </GlassCard>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <GlassCard className="xl:col-span-8 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3 mb-5">
            <div>
              <h4 className="text-sm font-bold text-white">Weekly & Monthly Revenue Comparison</h4>
              <p className="text-[11px] text-slate-400 mt-1">Current period against previous period and target</p>
            </div>
            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2.5 py-1">
              +10.8% growth
            </span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={comparisonData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,116,139,.13)" />
                <XAxis dataKey="label" stroke="#64748b" fontSize={10} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={10} tickLine={false} tickFormatter={(v) => `${v}k`} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />
                <Line type="monotone" dataKey="current" name="Current" stroke="#06b6d4" strokeWidth={3} dot={{ r: 3 }} animationDuration={200} />
                <Line type="monotone" dataKey="previous" name="Previous" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 5" dot={false} animationDuration={200} />
                <Line type="monotone" dataKey="target" name="Target" stroke="#10b981" strokeWidth={2} dot={false} animationDuration={200} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        <GlassCard className="xl:col-span-4 p-5 sm:p-6">
          <h4 className="text-sm font-bold text-white">Order Status Distribution</h4>
          <p className="text-[11px] text-slate-400 mt-1">Current fulfilment pipeline</p>
          {orderDistribution.length === 0 ? (
            <div className="h-64 mt-2 grid place-items-center text-center" role="status">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-500/20 bg-cyan-500/10">
                  <ShoppingBag className="h-5 w-5 text-cyan-400" />
                </span>
                <p className="mt-3 text-xs font-bold text-slate-700">No order data yet</p>
                <p className="mt-1 max-w-52 text-[10px] leading-relaxed text-slate-500">
                  Status distribution will appear after agents submit their first order.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="h-56 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={orderDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={54}
                      outerRadius={78}
                      paddingAngle={4}
                      animationDuration={200}
                    >
                      {orderDistribution.map((entry) => (
                        <Cell key={entry.name} fill={ORDER_COLORS[entry.name] ?? '#64748b'} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {orderDistribution.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-[10px] rounded-lg bg-slate-900/50 border border-slate-800 px-2.5 py-2">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      <span className="w-2 h-2 rounded-full" style={{ background: ORDER_COLORS[item.name] ?? '#64748b' }} />
                      {item.name}
                    </span>
                    <strong className="text-white">{item.value}</strong>
                  </div>
                ))}
              </div>
            </>
          )}
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard className="p-5 sm:p-6">
          <h4 className="text-sm font-bold text-white">Sales by Region</h4>
          <p className="text-[11px] text-slate-400 mt-1 mb-4">Revenue contribution across assigned territories</p>
          <div className="h-64">
            {regionData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regionData} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(100,116,139,.13)" />
                  <XAxis type="number" stroke="#64748b" fontSize={9} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                  <YAxis type="category" dataKey="region" width={90} stroke="#64748b" fontSize={9} tickLine={false} />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    formatter={(value: number, name: string, item) => [
                      `LKR ${value.toLocaleString()} · ${item.payload.orders} order${item.payload.orders === 1 ? '' : 's'}`,
                      'Sales',
                    ]}
                  />
                  <Bar dataKey="sales" radius={[0, 6, 6, 0]} fill="#7c3aed" animationDuration={500} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center px-6">
                <MapPin className="w-8 h-8 text-purple-400 mb-2" />
                <p className="text-sm font-bold text-slate-300">No regional sales yet</p>
                <p className="text-[11px] text-slate-500 mt-1">Sales will appear automatically after an order is created.</p>
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-white">Agent Performance Ranking</h4>
              <p className="text-[11px] text-slate-400 mt-1">Revenue, orders and route execution</p>
            </div>
            <Award className="w-5 h-5 text-amber-400" />
          </div>
          <div className="space-y-2.5 mt-4">
            {rankedAgents.map((agent, index) => {
              const maxRevenue = rankedAgents[0]?.todayRevenueLkr || 1;
              return (
                <div key={agent.id} className="rounded-xl bg-slate-900/50 border border-slate-800 p-3">
                  <div className="flex items-center gap-3">
                    <span className={`w-6 h-6 rounded-lg grid place-items-center text-[10px] font-extrabold ${
                      index === 0 ? 'bg-amber-400 text-slate-950' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {index + 1}
                    </span>
                    <ProfileAvatar src={agent.avatar} name={agent.name} className="w-8 h-8 rounded-lg object-cover text-[9px]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-bold text-white truncate">{agent.name}</p>
                        <p className="text-[10px] font-extrabold text-emerald-400">LKR {agent.todayRevenueLkr.toLocaleString()}</p>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-800 mt-2 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-all duration-200" style={{ width: `${(agent.todayRevenueLkr / maxRevenue) * 100}%` }} />
                      </div>
                    </div>
                    <span className="text-[9px] text-slate-500">{agent.ordersCount} orders</span>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <GlassCard className="xl:col-span-2 p-5 sm:p-6">
          <h4 className="text-sm font-bold text-white">Sales Activity Heatmap</h4>
          <p className="text-[11px] text-slate-400 mt-1">Order intensity by weekday and field hour</p>
          <div className="overflow-x-auto mt-5">
            <div className="min-w-[520px] grid grid-cols-[52px_repeat(5,1fr)] gap-2 text-center">
              <span />
              {HEATMAP_SLOTS.map((slot) => <span key={slot} className="text-[9px] font-bold text-slate-500">{slot}</span>)}
              {HEATMAP.map((row) => (
                <React.Fragment key={row.day}>
                  <span className="text-[10px] font-bold text-slate-400 self-center text-left">{row.day}</span>
                  {row.values.map((value, index) => (
                    <div
                      key={`${row.day}-${index}`}
                      className="h-9 rounded-lg border border-cyan-500/10 transition-transform duration-200 hover:scale-105"
                      style={{ backgroundColor: `rgba(6, 182, 212, ${0.08 + value / 125})` }}
                      title={`${row.day}, ${HEATMAP_SLOTS[index]}: ${value}% activity`}
                      aria-label={`${row.day} ${HEATMAP_SLOTS[index]} ${value}% activity`}
                    />
                  ))}
                </React.Fragment>
              ))}
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5 sm:p-6">
          <h4 className="text-sm font-bold text-white flex items-center gap-2">
            <Bell className="w-4 h-4 text-cyan-400" />
            Recent Notifications
          </h4>
          <div className="space-y-3 mt-4">
            {[
              { icon: TrendingUp, color: 'text-emerald-400 bg-emerald-500/10', title: 'Revenue target exceeded', detail: 'Western region reached 108.4% of target', time: '2 min' },
              { icon: BatteryWarning, color: 'text-amber-400 bg-amber-500/10', title: 'Low device battery', detail: 'Arun Perera device is at 15%', time: '8 min' },
              { icon: CheckCircle2, color: 'text-cyan-400 bg-cyan-500/10', title: 'Order approved', detail: `${orders[0]?.id ?? 'Latest order'} is ready for fulfilment`, time: '12 min' },
            ].map((notification) => (
              <div key={notification.title} className="flex gap-3 p-3 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-slate-700 transition-colors duration-200">
                <span className={`p-2 rounded-lg h-fit ${notification.color}`}><notification.icon className="w-4 h-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-white">{notification.title}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{notification.detail}</p>
                </div>
                <span className="text-[9px] text-slate-500 whitespace-nowrap">{notification.time}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      <GlassCard className="p-5 sm:p-6">
        <h4 className="text-sm font-bold text-white flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400" />
          Live Activity Timeline
        </h4>
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            { icon: ShoppingBag, color: 'bg-cyan-500', title: `${orders[0]?.id ?? 'Order'} submitted`, detail: orders[0]?.shopName ?? 'Field order', time: 'Just now' },
            { icon: MapPin, color: 'bg-indigo-500', title: `${agents[0]?.name ?? 'Agent'} location updated`, detail: agents[0]?.currentLocation ?? 'Field location', time: '1 min ago' },
            { icon: CheckCircle2, color: 'bg-emerald-500', title: 'Shop visit completed', detail: 'Order and GPS proof captured', time: '4 min ago' },
            { icon: TrendingUp, color: 'bg-amber-500', title: 'Sales milestone reached', detail: 'Daily revenue crossed LKR 450k', time: '9 min ago' },
          ].map((event) => (
            <div key={event.title} className="relative flex gap-3 p-3.5 rounded-xl bg-slate-900/50 border border-slate-800">
              <span className={`w-2.5 h-2.5 rounded-full ${event.color} shadow-lg mt-1.5 shrink-0`} />
              <div>
                <p className="text-xs font-bold text-white">{event.title}</p>
                <p className="text-[10px] text-slate-400 mt-1">{event.detail}</p>
                <p className="text-[9px] text-cyan-400 font-semibold mt-2">{event.time}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </section>
  );
};
