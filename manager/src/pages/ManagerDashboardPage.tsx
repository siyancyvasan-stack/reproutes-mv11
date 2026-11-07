import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  Banknote,
  Bell,
  CalendarDays,
  ChevronRight,
  Coffee,
  Download,
  Eye,
  Lightbulb,
  MapPin,
  Navigation,
  PackageCheck,
  Radio,
  Route,
  ShoppingBag,
  Store,
  UserCheck,
  Users,
  UserX,
  WifiOff,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { Badge } from "../components/common/Badge";
import { DashboardDateFilter } from "../components/common/DashboardDateFilter";
import { Modal } from "../components/common/Modal";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { InteractiveCityMap } from "../components/map/InteractiveCityMap";
import {
  DashboardCard,
  EmptyState,
  PremiumKpi,
  SectionHeading,
  StatusDot,
} from "../components/dashboard/DashboardUI";
import { ManagerAnalyticsCommandCenter } from "../components/dashboard/ManagerAnalyticsCommandCenter";
import { Agent, AttendanceRecord, Order } from "../types";
import { useToast } from "../context/ToastContext";
import { apiRequest } from "../services/apiClient";
import { downloadExport } from "../services/exportApi";
import {
  loadAgents,
  loadAttendanceReport,
  loadDashboardKpis,
  loadOrders,
} from "../services/domainApi";
import {
  FieldAgent,
  Intelligence,
  loadFieldIntelligence,
} from "../services/fieldIntelligenceApi";
import { useLiveAgentTracking } from "../hooks/useLiveAgentTracking";

const emptyKpis = {
  totalAgents: 0,
  activeAgents: 0,
  agentsOnBreak: 0,
  offlineAgents: 0,
  todayOrdersCount: 0,
  totalCasesSold: 0,
  todaySalesLkr: 0,
  totalDistanceKm: 0,
};
const money = (value: number) =>
  new Intl.NumberFormat("en-LK", {
    notation: value >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
const relativeTime = (value?: string) => {
  if (!value) return "Awaiting location";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return value;
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  return `${Math.floor(elapsed / 3_600_000)}h ago`;
};
const statusTone = (agent: Agent) =>
  agent.status === "Active"
    ? "emerald"
    : agent.status === "On Break"
      ? "amber"
      : "slate";
const safeSeries = (values: number[]) =>
  values.some(Boolean) ? values : undefined;

type RetailerAnalytics = {
  total: number;
  active: number;
  pending: number;
  newThisMonth: number;
  visitedToday: number;
  notVisited: number;
  withOrders: number;
  withoutOrders: number;
};
type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  readAt?: string;
  createdAt: string;
};

export const ManagerDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [directoryAgents, setDirectoryAgents] = useState<Agent[]>([]);
  const { agents, connectionState } = useLiveAgentTracking(directoryAgents);
  const [orders, setOrders] = useState<Order[]>([]);
  const [kpis, setKpis] = useState(emptyKpis);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dashboardQuery, setDashboardQuery] = useState("");
  const [attendance, setAttendance] = useState<{
    today?: {
      present: number;
      absent: number;
      late: number;
      onLeave: number;
      attendancePercentage: number;
    };
    records: AttendanceRecord[];
  }>({ records: [] });
  const [intelligence, setIntelligence] = useState<Intelligence>();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [retailers, setRetailers] = useState<RetailerAnalytics>({
    total: 0,
    active: 0,
    pending: 0,
    newThisMonth: 0,
    visitedToday: 0,
    notVisited: 0,
    withOrders: 0,
    withoutOrders: 0,
  });

  useEffect(() => {
    let firstLoad = true;
    const refresh = async () => {
      try {
        const [nextAgents, nextOrders, nextKpis] = await Promise.all([
          loadAgents([]),
          loadOrders([]),
          loadDashboardKpis(emptyKpis, dashboardQuery),
        ]);
        setDirectoryAgents(nextAgents);
        setOrders(nextOrders);
        setKpis(nextKpis);
      } catch {
        if (firstLoad)
          showToast(
            "Dashboard unavailable",
            "Unable to load live database data.",
            "error",
          );
      } finally {
        firstLoad = false;
        setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("reproutes:agent-created", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("reproutes:agent-created", refresh);
    };
  }, [dashboardQuery, showToast]);

  useEffect(() => {
    const date = new Date().toISOString().slice(0, 10);
    void Promise.allSettled([
      apiRequest<RetailerAnalytics>("/api/v1/shops/retailer-analytics").then(
        (r) =>
          setRetailers(
            r || {
              total: 0,
              active: 0,
              pending: 0,
              newThisMonth: 0,
              visitedToday: 0,
              notVisited: 0,
              withOrders: 0,
              withoutOrders: 0,
            },
          ),
      ),
      apiRequest<Notification[]>("/api/v1/notifications?limit=20").then((r) =>
        setNotifications(r || []),
      ),
      loadAttendanceReport().then((report) =>
        setAttendance({
          today: report?.today,
          records: (report?.records || []) as unknown as AttendanceRecord[],
        }),
      ),
      loadFieldIntelligence({ date }).then(setIntelligence),
    ]);
  }, []);

  useEffect(() => {
    setKpis((current) => ({
      ...current,
      totalAgents: agents.length,
      activeAgents: agents.filter((a) => a.status === "Active").length,
      agentsOnBreak: agents.filter((a) => a.status === "On Break").length,
      offlineAgents: agents.filter((a) => a.status === "Offline").length,
      totalCasesSold: orders.reduce((sum, order) => sum + order.casesCount, 0),
      totalDistanceKm: Number(
        agents
          .reduce((sum, agent) => sum + Number(agent.distanceKm || 0), 0)
          .toFixed(1),
      ),
    }));
    if (!selectedAgentId && agents.length) setSelectedAgentId(agents[0].id);
  }, [agents, orders, selectedAgentId]);

  const salesSeries = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      const key = date.toISOString().slice(0, 10);
      const rows = orders.filter((order) => order.date === key);
      return {
        day: formatter.format(date),
        sales: rows.reduce((sum, order) => sum + order.totalAmountLkr, 0),
        orders: rows.length,
        cases: rows.reduce((sum, order) => sum + order.casesCount, 0),
      };
    });
  }, [orders]);
  const yesterday = salesSeries.at(-2);
  const today = salesSeries.at(-1);
  const orderChange = yesterday?.orders
    ? Math.round(
        (((today?.orders ?? 0) - yesterday.orders) / yesterday.orders) * 100,
      )
    : undefined;
  const salesChange = yesterday?.sales
    ? Math.round(
        (((today?.sales ?? 0) - yesterday.sales) / yesterday.sales) * 100,
      )
    : undefined;

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      await downloadExport(
        "sales_summary",
        "pdf",
        Object.fromEntries(new URLSearchParams(dashboardQuery)),
      );
      showToast(
        "PDF downloaded",
        "Sales operations report downloaded successfully.",
        "success",
      );
    } catch (error) {
      showToast(
        "Download failed",
        error instanceof Error
          ? error.message
          : "Unable to generate the report.",
        "error",
      );
    } finally {
      setIsExporting(false);
    }
  };

  const inactiveAgents = agents.filter(
    (agent) => agent.status === "Offline" || agent.trackingStatus === "idle_1h",
  );
  const missedShops =
    intelligence?.team?.reduce(
      (sum, agent) => sum + agent.remainingVisits,
      0,
    ) ??
    retailers?.notVisited ??
    0;
  const insights = [
    inactiveAgents.length
      ? {
          tone: "rose" as const,
          text: `${inactiveAgents.length} agent${inactiveAgents.length === 1 ? "" : "s"} require a connectivity or inactivity review.`,
        }
      : {
          tone: "emerald" as const,
          text: "All connected field agents are reporting normally.",
        },
    missedShops
      ? {
          tone: "amber" as const,
          text: `${missedShops} assigned shop visit${missedShops === 1 ? "" : "s"} remain today.`,
        }
      : {
          tone: "emerald" as const,
          text: "All currently reported shop visits are complete.",
        },
    {
      tone: "cyan" as const,
      text: `${retailers?.visitedToday ?? 0} shops visited today, with ${retailers?.withOrders ?? 0} retailers currently linked to orders.`,
    },
    salesChange == null
      ? {
          tone: "violet" as const,
          text: "Sales comparison will appear when both today and yesterday contain orders.",
        }
      : {
          tone: salesChange >= 0 ? ("emerald" as const) : ("amber" as const),
          text: `Today’s sales are ${Math.abs(salesChange)}% ${salesChange >= 0 ? "above" : "below"} yesterday.`,
        },
  ];

  return (
    <ManagerLayout wide>
      <DashboardCard className="relative overflow-hidden p-5 sm:p-6">
        <span className="pointer-events-none absolute -right-24 -top-32 h-72 w-72 rounded-full bg-violet-300/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
                <StatusDot tone="emerald" pulse />
                Live field operations
              </span>
              <span className="text-xs font-semibold text-slate-400">
                Updated continuously
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-950 sm:text-3xl">
              Sales Intelligence Overview
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              Live sales, routes, attendance and customer activity in one
              operational workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DashboardDateFilter
              onChange={(range) => setDashboardQuery(range.query)}
            />
            <button
              onClick={() => navigate("/live-tracking")}
              className="glass-button-primary inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold text-white"
            >
              <Navigation className="h-4 w-4" />
              View Live Tracking
            </button>
            <button
              disabled={isExporting}
              onClick={() => void handleExport()}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-4 text-sm font-bold text-slate-700 shadow-sm hover:border-indigo-200 hover:text-indigo-700"
            >
              <Download className="h-4 w-4" />
              {isExporting ? "Preparing…" : "Download Report"}
            </button>
          </div>
        </div>
      </DashboardCard>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        <PremiumKpi
          label="Total Agents"
          value={kpis.totalAgents}
          icon={Users}
          tone="indigo"
          comparison={{ label: "Team total" }}
          sparkline={safeSeries(agents.map((_, i) => i + 1))}
          loading={loading}
        />
        <PremiumKpi
          label="Active Agents"
          value={kpis.activeAgents}
          icon={UserCheck}
          tone="emerald"
          comparison={{
            label: `${kpis.totalAgents ? Math.round((kpis.activeAgents / kpis.totalAgents) * 100) : 0}% active`,
          }}
          loading={loading}
        />
        <PremiumKpi
          label="On Break"
          value={kpis.agentsOnBreak}
          icon={Coffee}
          tone="amber"
          comparison={{ label: "Live status" }}
          loading={loading}
        />
        <PremiumKpi
          label="Offline"
          value={kpis.offlineAgents}
          icon={UserX}
          tone="rose"
          comparison={{ label: kpis.offlineAgents ? "Review" : "All clear" }}
          loading={loading}
        />
        <PremiumKpi
          label="Today Orders"
          value={kpis.todayOrdersCount}
          icon={ShoppingBag}
          tone="cyan"
          comparison={
            orderChange == null
              ? { label: "Current period" }
              : {
                  label: `${Math.abs(orderChange)}% vs yesterday`,
                  direction: orderChange >= 0 ? "up" : "down",
                }
          }
          sparkline={safeSeries(salesSeries.map((x) => x.orders))}
          loading={loading}
        />
        <PremiumKpi
          label="Total Cases"
          value={kpis.totalCasesSold}
          icon={PackageCheck}
          tone="blue"
          comparison={{ label: "Loaded orders" }}
          sparkline={safeSeries(salesSeries.map((x) => x.cases))}
          loading={loading}
        />
        <PremiumKpi
          label="Today Sales"
          value={`LKR ${money(kpis.todaySalesLkr)}`}
          icon={Banknote}
          tone="emerald"
          comparison={
            salesChange == null
              ? { label: "Current period" }
              : {
                  label: `${Math.abs(salesChange)}% vs yesterday`,
                  direction: salesChange >= 0 ? "up" : "down",
                }
          }
          sparkline={safeSeries(salesSeries.map((x) => x.sales))}
          loading={loading}
        />

        <PremiumKpi
          label="Distance"
          value={kpis.totalDistanceKm.toLocaleString()}
          unit="KM travelled"
          icon={Route}
          tone="violet"
          comparison={{ label: "Live routes" }}
          sparkline={safeSeries(agents.map((a) => a.distanceKm))}
          loading={loading}
        />
      </div>

      <ManagerAnalyticsCommandCenter
        agents={agents}
        orders={orders}
        attendance={attendance.records}
      />

      <DashboardCard className="overflow-hidden">
        <div className="border-b border-slate-100 p-5 sm:p-6">
          <SectionHeading
            icon={Navigation}
            title="Live Salesperson Tracking"
            subtitle="Select a salesperson to focus their location, route and assigned stops."
            action={
              <button
                onClick={() => navigate("/live-tracking")}
                className="inline-flex items-center gap-1 text-sm font-bold text-indigo-600 hover:text-indigo-800"
              >
                Open full tracking <ChevronRight className="h-4 w-4" />
              </button>
            }
          />
        </div>
        <div className="grid min-h-[520px] xl:grid-cols-[minmax(0,65%)_minmax(320px,35%)]">
          <div className="dashboard-map min-h-[420px] border-b border-slate-100 xl:border-b-0 xl:border-r">
            <InteractiveCityMap
              agents={agents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={(agent) => setSelectedAgentId(agent.id)}
              connectionState={connectionState}
              heightClass="h-full min-h-[420px]"
            />
          </div>
          <div className="max-h-[560px] overflow-y-auto bg-white/30 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-[.14em] text-slate-400">
                Salespeople
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                <Radio className="h-3.5 w-3.5 text-emerald-500" />
                {connectionState === "live" ? "Live GPS" : "Awaiting GPS"}
              </span>
            </div>
            <div className="space-y-2.5">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className={`w-full rounded-2xl border p-3.5 text-left transition duration-200 ${selectedAgentId === agent.id ? "border-indigo-200 bg-indigo-50/80 shadow-sm ring-2 ring-indigo-100" : "border-white/80 bg-white/65 hover:border-indigo-100 hover:bg-white"}`}
                >
                  <div className="flex items-center gap-3">
                    <ProfileAvatar
                      src={agent.avatar}
                      name={agent.name}
                      className="h-11 w-11 shrink-0 rounded-full ring-2 ring-white"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="truncate text-sm text-slate-900">
                          {agent.name}
                        </strong>
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                          <StatusDot
                            tone={statusTone(agent)}
                            pulse={agent.status === "Active"}
                          />
                          {agent.status}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {agent.currentLocation}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50/80 p-2.5 text-center">
                    <span>
                      <b className="block text-sm text-slate-800">
                        {Number(agent.speedKmH || 0).toFixed(0)}
                      </b>
                      <small className="text-[10px] text-slate-400">km/h</small>
                    </span>
                    <span>
                      <b className="block text-sm text-violet-700">
                        {Number(agent.distanceKm || 0).toFixed(1)}
                      </b>
                      <small className="text-[10px] text-slate-400">km</small>
                    </span>
                    <span>
                      <b className="block text-sm text-cyan-700">
                        {agent.visitedShopsCount}
                      </b>
                      <small className="text-[10px] text-slate-400">
                        shops
                      </small>
                    </span>
                  </div>
                  <p className="mt-2 text-[11px] font-medium text-slate-400">
                    Last update ·{" "}
                    {relativeTime(agent.lastLocationAt ?? agent.lastUpdatedAt)}
                  </p>
                </button>
              ))}
            </div>
            {!agents.length && (
              <EmptyState
                icon={WifiOff}
                title="No agents available"
                message="Salespeople will appear when the directory and live tracking service respond."
              />
            )}
          </div>
        </div>
      </DashboardCard>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <DashboardCard className="p-5 sm:p-6">
          <SectionHeading
            icon={Activity}
            title="Sales Performance"
            subtitle="Revenue generated during the last seven calendar days."
          />
          <div className="mt-5 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={salesSeries}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="managerSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#6366f1" stopOpacity=".3" />
                    <stop offset="1" stopColor="#06b6d4" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="#e2e8f0"
                  strokeDasharray="4 6"
                />
                <XAxis
                  dataKey="day"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#64748b", fontSize: 12 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#94a3b8", fontSize: 11 }}
                  tickFormatter={(value) => `${Math.round(value / 1000)}k`}
                />
                <Tooltip
                  contentStyle={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    background: "rgba(255,255,255,.96)",
                    boxShadow: "0 16px 38px -20px #64748b",
                  }}
                  formatter={(value) => [
                    `LKR ${Number(value).toLocaleString()}`,
                    "Sales",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke="#4f46e5"
                  strokeWidth={3}
                  fill="url(#managerSales)"
                  animationDuration={500}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </DashboardCard>
        <DashboardCard className="p-5 sm:p-6">
          <SectionHeading
            icon={Users}
            title="Agent Performance"
            subtitle="Ranked by today’s recorded revenue."
          />
          <div className="mt-5 space-y-3">
            {[...agents]
              .sort((a, b) => b.todayRevenueLkr - a.todayRevenueLkr)
              .slice(0, 6)
              .map((agent, index) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-100 bg-white/55 p-3 text-left hover:border-indigo-100 hover:bg-white"
                >
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-black ${index === 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}
                  >
                    {index + 1}
                  </span>
                  <ProfileAvatar
                    src={agent.avatar}
                    name={agent.name}
                    className="h-9 w-9 rounded-full"
                  />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-sm text-slate-800">
                      {agent.name}
                    </b>
                    <small className="text-xs text-slate-400">
                      {agent.ordersCount} orders · {agent.visitedShopsCount}{" "}
                      shops
                    </small>
                  </span>
                  <strong className="text-xs text-emerald-700">
                    LKR {money(agent.todayRevenueLkr)}
                  </strong>
                </button>
              ))}
            {!agents.length && (
              <EmptyState
                icon={Users}
                title="No agent performance yet"
                message="Performance appears when live agent data is available."
              />
            )}
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <DashboardCard className="p-5 sm:p-6">
          <SectionHeading
            icon={Store}
            title="Shop Visits"
            subtitle="Today’s reported retail coverage."
          />
          <div className="mt-5 grid grid-cols-2 gap-3">
            {[
              [
                "Visited today",
                retailers?.visitedToday ?? 0,
                "text-emerald-700 bg-emerald-50",
              ],
              [
                "Not visited",
                retailers?.notVisited ?? 0,
                "text-amber-700 bg-amber-50",
              ],
              [
                "With orders",
                retailers?.withOrders ?? 0,
                "text-indigo-700 bg-indigo-50",
              ],
              [
                "Total retailers",
                retailers?.total ?? 0,
                "text-cyan-700 bg-cyan-50",
              ],
            ].map(([label, value, tone]) => (
              <div key={String(label)} className={`rounded-2xl p-4 ${tone}`}>
                <strong className="block text-2xl font-black">{value}</strong>
                <span className="text-xs font-semibold">{label}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => navigate("/retailers")}
            className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-indigo-600"
          >
            View retailers <ChevronRight className="h-4 w-4" />
          </button>
        </DashboardCard>
        <DashboardCard className="p-5 sm:p-6">
          <SectionHeading
            icon={CalendarDays}
            title="Attendance"
            subtitle="Today’s field workforce availability."
          />
          <div className="mt-5 flex items-center gap-5">
            <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-indigo-50 ring-8 ring-indigo-100/60">
              <span className="text-center">
                <b className="block text-2xl font-black text-indigo-700">
                  {attendance.today?.attendancePercentage ?? 0}%
                </b>
                <small className="text-[10px] font-bold text-indigo-500">
                  PRESENT
                </small>
              </span>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-3 text-sm">
              {[
                ["Present", attendance.today?.present ?? 0, "emerald"],
                ["Late", attendance.today?.late ?? 0, "amber"],
                ["Absent", attendance.today?.absent ?? 0, "rose"],
                ["On leave", attendance.today?.onLeave ?? 0, "slate"],
              ].map(([label, value, tone]) => (
                <div key={String(label)} className="flex items-center gap-2">
                  <StatusDot
                    tone={tone as "emerald" | "amber" | "rose" | "slate"}
                  />
                  <span className="text-slate-500">{label}</span>
                  <b className="ml-auto text-slate-800">{value}</b>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => navigate("/attendance")}
            className="mt-5 inline-flex items-center gap-1 text-sm font-bold text-indigo-600"
          >
            View attendance <ChevronRight className="h-4 w-4" />
          </button>
        </DashboardCard>
        <DashboardCard className="p-5 sm:p-6">
          <SectionHeading
            icon={Lightbulb}
            title="Smart Insights"
            subtitle="Signals derived from current operating data."
          />
          <div className="mt-5 space-y-3">
            {insights.map((insight) => (
              <div
                key={insight.text}
                className="flex gap-3 rounded-xl border border-slate-100 bg-white/55 p-3.5"
              >
                <StatusDot tone={insight.tone} />
                <p className="text-sm leading-5 text-slate-600">
                  {insight.text}
                </p>
              </div>
            ))}
          </div>
        </DashboardCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
        <DashboardCard className="overflow-hidden">
          <div className="p-5 sm:p-6">
            <SectionHeading
              icon={ShoppingBag}
              title="Recent Orders"
              subtitle="Latest submissions from the field team."
              action={
                <button
                  onClick={() => navigate("/orders")}
                  className="text-sm font-bold text-indigo-600"
                >
                  View all
                </button>
              }
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3">Order</th>
                  <th className="px-5 py-3">Shop</th>
                  <th className="px-5 py-3">Salesperson</th>
                  <th className="px-5 py-3">Cases</th>
                  <th className="px-5 py-3">Value</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 6).map((order) => (
                  <tr key={order.id}>
                    <td className="px-5 py-3 font-mono text-xs font-bold text-indigo-600">
                      #{order.id.slice(-7).toUpperCase()}
                    </td>
                    <td className="px-5 py-3 font-semibold text-slate-800">
                      {order.shopName}
                    </td>
                    <td className="px-5 py-3 text-slate-500">
                      {order.agentName}
                    </td>
                    <td className="px-5 py-3">{order.casesCount}</td>
                    <td className="px-5 py-3 font-bold text-emerald-700">
                      LKR {order.totalAmountLkr.toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <Badge status={order.status} />
                    </td>
                    <td className="px-5 py-3">
                      <button
                        aria-label={`View order ${order.id}`}
                        onClick={() => setSelectedOrder(order)}
                        className="rounded-lg p-2 text-slate-400 hover:bg-indigo-50 hover:text-indigo-600"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!orders.length && (
              <EmptyState
                icon={ShoppingBag}
                title="No orders submitted"
                message="New orders will appear here as salespeople submit them."
              />
            )}
          </div>
        </DashboardCard>
        <DashboardCard className="p-5 sm:p-6">
          <SectionHeading
            icon={Bell}
            title="Alerts & Activity"
            subtitle="Recent operational notifications."
          />
          <div className="mt-5 space-y-3">
            {notifications.slice(0, 7).map((item) => (
              <div
                key={item.id}
                className="flex gap-3 border-b border-slate-100 pb-3 last:border-0"
              >
                <StatusDot
                  tone={
                    item.type.includes("SAFETY") || item.type.includes("SOS")
                      ? "rose"
                      : item.readAt
                        ? "slate"
                        : "cyan"
                  }
                  pulse={!item.readAt}
                />
                <div className="min-w-0">
                  <b className="block truncate text-sm text-slate-800">
                    {item.title}
                  </b>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-slate-500">
                    {item.message}
                  </p>
                  <span className="mt-1 block text-[11px] text-slate-400">
                    {relativeTime(item.createdAt)}
                  </span>
                </div>
              </div>
            ))}
            {!notifications.length && (
              <EmptyState
                icon={Bell}
                title="No recent alerts"
                message="Operational notifications will appear here."
              />
            )}
          </div>
        </DashboardCard>
      </div>

      <Modal
        isOpen={Boolean(selectedAgent)}
        onClose={() => setSelectedAgent(null)}
        title="Agent Performance Details"
      >
        {selectedAgent && (
          <div className="space-y-5">
            <div className="flex items-center gap-4 rounded-2xl bg-indigo-50 p-4">
              <ProfileAvatar
                src={selectedAgent.avatar}
                name={selectedAgent.name}
                className="h-16 w-16 rounded-2xl"
              />
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  {selectedAgent.name}
                </h3>
                <p className="text-sm text-indigo-600">
                  {selectedAgent.employeeCode} · {selectedAgent.routeAssigned}
                </p>
                <div className="mt-2">
                  <Badge status={selectedAgent.status} />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Distance", `${selectedAgent.distanceKm} km`],
                ["Orders", selectedAgent.ordersCount],
                ["Cases", selectedAgent.casesSold],
                ["Revenue", `LKR ${money(selectedAgent.todayRevenueLkr)}`],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-xl bg-slate-50 p-3 text-center"
                >
                  <small className="font-bold uppercase text-slate-400">
                    {label}
                  </small>
                  <b className="mt-1 block text-slate-800">{value}</b>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setSelectedAgentId(selectedAgent.id);
                setSelectedAgent(null);
                navigate("/live-tracking");
              }}
              className="glass-button-primary flex w-full items-center justify-center gap-2 rounded-xl p-3 font-bold text-white"
            >
              <Navigation className="h-4 w-4" />
              Track Agent Live
            </button>
          </div>
        )}
      </Modal>
      <Modal
        isOpen={Boolean(selectedOrder)}
        onClose={() => setSelectedOrder(null)}
        title="Order Details"
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="flex items-start justify-between rounded-xl bg-slate-50 p-4">
              <div>
                <b className="text-slate-900">{selectedOrder.shopName}</b>
                <p className="text-sm text-slate-500">
                  {selectedOrder.shopAddress}
                </p>
              </div>
              <Badge status={selectedOrder.status} />
            </div>
            {selectedOrder.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between border-b border-slate-100 pb-3 text-sm"
              >
                <span>
                  <b className="block text-slate-800">{item.productName}</b>
                  <small className="text-slate-400">
                    {item.casesQuantity} cases · {item.sku}
                  </small>
                </span>
                <b className="text-indigo-700">
                  LKR {item.totalLkr.toLocaleString()}
                </b>
              </div>
            ))}
            <div className="flex justify-between rounded-xl bg-emerald-50 p-4 font-bold text-emerald-800">
              <span>Total</span>
              <span>LKR {selectedOrder.totalAmountLkr.toLocaleString()}</span>
            </div>
          </div>
        )}
      </Modal>
    </ManagerLayout>
  );
};
