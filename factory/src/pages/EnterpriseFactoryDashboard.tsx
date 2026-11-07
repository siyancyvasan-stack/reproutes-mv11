import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import {
  Activity,
  AlertTriangle,
  Bell,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Command,
  Factory,
  Gauge,
  Lightbulb,
  Loader2,
  PackageCheck,
  Search,
  ShieldCheck,
  Sparkles,
  Timer,
  Truck,
  UserRoundCheck,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { FactoryDashboard, factoryApi } from "../services/factoryApi";
import { ensureAccessToken, getAccessToken } from "../services/apiClient";
import { loadAgents } from "../services/domainApi";
import { useLiveAgentTracking } from "../hooks/useLiveAgentTracking";
import { Agent } from "../types";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { DashboardDateFilter } from "../components/common/DashboardDateFilter";
import { DashboardTone, PremiumKpi } from "../components/dashboard/DashboardUI";

const InteractiveCityMap = lazy(() =>
  import("../components/map/InteractiveCityMap").then((module) => ({
    default: module.InteractiveCityMap,
  })),
);
type AnyRow = Record<string, any>;
type CommandData = {
  dashboard: FactoryDashboard;
  production: AnyRow[];
  members: AnyRow[];
  dispatches: AnyRow[];
  inventory: AnyRow;
  notifications: AnyRow[];
};
const card =
  "rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md";
const number = (value: unknown) =>
  Number.isFinite(Number(value)) ? Number(value) : 0;
const title = (value?: string) =>
  (value ?? "Unknown")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (x) => x.toUpperCase());
const time = (value?: string) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const statusColor = (value?: string) =>
  /FAILED|REJECTED|CRITICAL|ABSENT/.test(value ?? "")
    ? "text-rose-700 bg-rose-50"
    : /BREAK|LOW|PAUSED|WAITING/.test(value ?? "")
      ? "text-amber-700 bg-amber-50"
      : /WORKING|COMPLETED|DELIVERED|GOOD|READY/.test(value ?? "")
        ? "text-emerald-700 bg-emerald-50"
        : "text-blue-700 bg-blue-50";
const Pill = ({ value }: { value?: string }) => (
  <span
    className={`inline-flex rounded-full px-3 py-1.5 text-xs font-extrabold uppercase leading-none ${statusColor(value)}`}
  >
    {title(value)}
  </span>
);
const PanelTitle = ({
  icon: Icon,
  children,
  hint,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  hint?: string;
}) => (
  <div className="flex min-h-14 items-center justify-between border-b border-slate-100 px-5 py-4 sm:px-6">
    <div className="flex items-center gap-2.5">
      <Icon className="h-5 w-5 text-indigo-600" />
      <h3 className="text-base font-extrabold text-slate-950">{children}</h3>
    </div>
    {hint && (
      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-blue-700">
        {hint}
      </span>
    )}
  </div>
);

const Progress = ({
  value,
  tone = "bg-indigo-600",
}: {
  value: number;
  tone?: string;
}) => (
  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
    <div
      className={`h-full rounded-full transition-all duration-700 ${tone}`}
      style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
    />
  </div>
);

const LiveTracking = () => {
  const [directory, setDirectory] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string>();
  useEffect(() => {
    void loadAgents([]).then(setDirectory);
  }, []);
  const { agents, connectionState } = useLiveAgentTracking(directory);
  return (
    <section className={`${card} overflow-hidden xl:col-span-2`}>
      <PanelTitle icon={Gauge} hint={connectionState}>
        Live Salesperson Tracking
      </PanelTitle>
      <div className="grid lg:grid-cols-[minmax(0,66%)_minmax(280px,34%)]">
        <div className="dashboard-map order-1 h-[360px] border-b border-slate-100 sm:h-[420px] lg:h-[440px] lg:border-b-0 lg:border-r">
          <Suspense
            fallback={
              <div className="grid h-full place-items-center">
                <Loader2 className="animate-spin" />
              </div>
            }
          >
            <InteractiveCityMap
              agents={agents}
              selectedAgentId={selected}
              onSelectAgent={(a) => setSelected(a.id)}
              heightClass="h-full"
              connectionState={connectionState}
            />
          </Suspense>
        </div>
        <div className="order-2 max-h-[440px] space-y-2.5 overflow-y-auto p-4">
          {agents.slice(0, 8).map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelected(agent.id)}
              className={`flex min-h-20 w-full items-center gap-3 rounded-xl border p-3 text-left transition ${selected === agent.id ? "border-indigo-300 bg-indigo-50 shadow-sm ring-2 ring-indigo-100" : "border-slate-100 bg-white/60 hover:border-indigo-200 hover:bg-white"}`}
            >
              <ProfileAvatar
                src={agent.avatar}
                name={agent.name}
                className="h-10 w-10 shrink-0 rounded-full"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <b className="block truncate text-sm text-slate-950">
                    {agent.name}
                  </b>
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${agent.gpsStatus === "LIVE" ? "bg-emerald-500" : "bg-slate-300"}`}
                  />
                </div>
                <span className="mt-1 block text-[13px] text-slate-600">
                  {title(agent.gpsStatus)} ·{" "}
                  {Number.isFinite(Number(agent.speedKmH))
                    ? Number(agent.speedKmH).toFixed(1)
                    : "—"}{" "}
                  km/h
                </span>
                <span className="mt-1 block text-[13px] font-extrabold text-violet-600">
                  {Number.isFinite(Number(agent.distanceKm))
                    ? Number(agent.distanceKm).toFixed(2)
                    : "0.00"}{" "}
                  km travelled
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
};

const CommandPalette = ({
  open,
  close,
  data,
}: {
  open: boolean;
  close: () => void;
  data: CommandData;
}) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  if (!open) return null;
  const routes = [
    ["Orders", "/orders"],
    ["Production", "/production"],
    ["Products", "/products"],
    ["Inventory", "/inventory"],
    ["Factory Members", "/members"],
    ["Dispatch", "/dispatch"],
    ["Sales Tracking", "/sales-tracking"],
  ];
  const records = [
    ...data.production.map((x) => ({
      label: x.product?.name || x.id,
      meta: `Production ${x.status}`,
      path: "/production",
    })),
    ...data.members.map((x) => ({
      label: x.name,
      meta: `${x.department} · ${x.status}`,
      path: "/members",
    })),
    ...data.dispatches.map((x) => ({
      label: x.destination,
      meta: `Dispatch · ${x.status}`,
      path: "/dispatch",
    })),
    ...routes.map(([label, path]) => ({ label, meta: "Open page", path })),
  ]
    .filter((x) =>
      (x.label + " " + x.meta).toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 10);
  return (
    <div
      className="fixed inset-0 z-[70] flex justify-center bg-slate-950/50 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={close}
    >
      <div
        className="h-fit w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b p-4">
          <Search className="h-5 w-5 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search factory operations…"
            className="flex-1 outline-none"
          />
          <kbd className="rounded border px-2 py-1 text-xs">ESC</kbd>
        </div>
        <div className="max-h-96 overflow-y-auto p-2">
          {records.map((item, i) => (
            <button
              key={`${item.label}-${i}`}
              onClick={() => {
                navigate(item.path);
                close();
              }}
              className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left hover:bg-slate-50"
            >
              <div>
                <b className="text-sm">{item.label}</b>
                <p className="text-xs text-slate-500">{item.meta}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export const EnterpriseFactoryDashboard = () => {
  const [data, setData] = useState<CommandData>();
  const [now, setNow] = useState(new Date());
  const [palette, setPalette] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [dashboardQuery, setDashboardQuery] = useState("");
  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [
        dashboard,
        production,
        members,
        dispatches,
        inventory,
        notifications,
      ] = await Promise.all([
        factoryApi.dashboard(dashboardQuery),
        factoryApi.production("limit=8"),
        factoryApi.members("limit=8"),
        factoryApi.dispatches("limit=8"),
        factoryApi.inventory(),
        factoryApi.notifications(),
      ]);
      setData({
        dashboard,
        production: production.items,
        members: members.items,
        dispatches: dispatches.items,
        inventory,
        notifications,
      });
    } catch {
      setLoadError(true);
    }
  }, [dashboardQuery]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    let socket: ReturnType<typeof io> | undefined;
    void ensureAccessToken().then(() => {
      socket = io(undefined, {
        transports: ["websocket"],
        withCredentials: true,
        auth: (cb) => cb({ token: getAccessToken() ?? undefined }),
      });
      [
        "factory:new-order",
        "factory:order-approved",
        "factory:order-updated",
        "factory:production-updated",
        "factory:inventory-updated",
        "factory:dispatch-updated",
      ].forEach((event) => socket?.on(event, load));
    });
    return () => {
      clearInterval(timer);
      socket?.disconnect();
    };
  }, [load]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
      if (event.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const derived = useMemo(() => {
    if (!data) return null;
    const prod = data.production;
    const running = prod.filter((x) => x.status === "IN_PROGRESS");
    const workers = data.members.filter((x) => x.status === "WORKING");
    const onBreak = data.members.filter((x) => x.status === "ON_BREAK");
    const target = prod.reduce((n, x) => n + number(x.targetQuantity), 0);
    const completed = prod.reduce((n, x) => n + number(x.producedQuantity), 0);
    const rejected = prod.reduce((n, x) => n + number(x.rejectedQuantity), 0);
    const damaged = prod.reduce((n, x) => n + number(x.damagedQuantity), 0);
    const efficiency = target ? Math.round((completed / target) * 100) : 0;
    const available = data.inventory.finishedGoods.reduce(
      (n: number, x: AnyRow) => n + number(x.availableQuantity),
      0,
    );
    const reserved = data.inventory.finishedGoods.reduce(
      (n: number, x: AnyRow) => n + number(x.reservedStock),
      0,
    );
    const critical = data.inventory.finishedGoods.filter(
      (x: AnyRow) => x.stockStatus === "CRITICAL",
    ).length;
    const low = data.inventory.finishedGoods.filter(
      (x: AnyRow) => x.stockStatus === "LOW",
    ).length;
    return {
      running,
      workers,
      onBreak,
      target,
      completed,
      rejected,
      damaged,
      efficiency,
      available,
      reserved,
      critical,
      low,
    };
  }, [data]);
  if (loadError)
    return (
      <section
        className="rounded-2xl border border-rose-200 bg-white p-6"
        role="alert"
      >
        <p className="font-bold text-rose-800">
          Unable to load factory operations.
        </p>
        <p className="mt-1 text-sm text-slate-600">
          Existing data is safe. Retry the dashboard request.
        </p>
        <button
          onClick={() => void load()}
          className="mt-4 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Retry
        </button>
      </section>
    );
  if (!data || !derived)
    return (
      <div
        className="grid h-80 grid-cols-2 gap-4"
        aria-label="Loading factory dashboard"
      >
        <div className="animate-pulse rounded-2xl bg-slate-200" />
        <div className="animate-pulse rounded-2xl bg-slate-200" />
      </div>
    );
  const shift =
    now.getHours() < 6
      ? "Night"
      : now.getHours() < 14
        ? "Morning"
        : now.getHours() < 22
          ? "Evening"
          : "Night";
  const ready = data.dispatches.filter((x) => x.status === "WAITING").length;
  const delivered = data.dispatches.filter(
    (x) => x.status === "DELIVERED",
  ).length;
  const failed = data.dispatches.filter((x) => x.status === "FAILED").length;
  const kpis: Array<{
    label: string;
    value: number;
    unit: string;
    spark?: number[];
    icon: any;
    tone: DashboardTone;
    status: string;
  }> = [
    {
      label: "Today’s Production",
      value: data.dashboard.kpis.todayProduction,
      unit: "Units",
      spark: [
        data.dashboard.production.monthly / 30,
        data.dashboard.production.weekly / 7,
        data.dashboard.production.daily,
      ],
      icon: Factory,
      tone: "indigo",
      status: "Current output",
    },
    {
      label: "Orders Waiting",
      value: data.dashboard.kpis.pendingOrders,
      unit: "Orders",
      icon: Clock3,
      tone: "amber",
      status: "Current queue",
    },
    {
      label: "Production Running",
      value: data.dashboard.kpis.inProduction,
      unit: "Lines",
      icon: Activity,
      tone: "blue",
      status: "Live operations",
    },
    {
      label: "Dispatch Ready",
      value: data.dashboard.kpis.readyToDispatch,
      unit: "Orders",
      icon: Truck,
      tone: "violet",
      status: "Ready now",
    },
    {
      label: "Workers Online",
      value: data.dashboard.kpis.activeFactoryMembers,
      unit: "People",
      icon: Users,
      tone: "emerald",
      status: "On shift",
    },
    {
      label: "Inventory Alerts",
      value: data.dashboard.kpis.lowStockItems,
      unit: "Items",
      icon: AlertTriangle,
      tone: data.dashboard.kpis.lowStockItems ? "rose" : "cyan",
      status: data.dashboard.kpis.lowStockItems
        ? "Review stock"
        : "Stock healthy",
    },
  ];
  const activity = data.notifications.slice(0, 7);
  const qualityTotal = derived.completed + derived.rejected + derived.damaged;
  const quality = Math.round(
    (derived.completed / Math.max(qualityTotal, 1)) * 100,
  );
  return (
    <div className="space-y-7 text-[14px] text-slate-700">
      <div className="flex justify-end">
        <DashboardDateFilter
          onChange={(range) => setDashboardQuery(range.query)}
        />
      </div>
      <CommandPalette
        open={palette}
        close={() => setPalette(false)}
        data={data}
      />
      {drawer && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/30"
          onClick={() => setDrawer(false)}
        >
          <aside
            className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-black">Notification Center</h2>
              <button onClick={() => setDrawer(false)}>
                <X />
              </button>
            </div>
            {activity.map((item) => (
              <div key={item.id} className="mb-2 rounded-xl border p-4">
                <b className="text-sm">{item.title}</b>
                <p className="mt-1 text-xs text-slate-500">{item.message}</p>
              </div>
            ))}
          </aside>
        </div>
      )}
      <section className={`${card} overflow-hidden`}>
        <div className="flex flex-col justify-between gap-5 p-5 sm:p-6 lg:flex-row lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-black leading-tight text-slate-950 sm:text-2xl">
                Live Factory Operations Center
              </h1>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700">
                <i className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />{" "}
                LIVE
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Real-time production, workforce, inventory and fulfilment command
              center
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setPalette(true)}
              className="flex min-h-10 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-bold text-slate-600"
            >
              <Command className="h-4 w-4" />
              Search <kbd>Ctrl K</kbd>
            </button>
            <button
              onClick={() => setDrawer(true)}
              className="relative rounded-xl border p-2.5"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-xs text-white">
                {activity.filter((x) => !x.readAt).length}
              </span>
            </button>
            <div className="rounded-xl bg-slate-950 px-4 py-2.5 text-right text-white">
              <b className="block text-base tabular-nums">
                {now.toLocaleTimeString()}
              </b>
              <span className="text-xs text-slate-300">{shift} Shift</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t sm:grid-cols-4 xl:grid-cols-8">
          {[
            ["Factory Status", "Operational"],
            ["Current Shift", shift],
            ["Running Lines", derived.running.length],
            ["Workers Online", derived.workers.length],
            ["Stations Running", derived.running.length],
            ["Orders Waiting", data.dashboard.kpis.pendingOrders],
            ["Dispatch Ready", ready],
            ["System Status", "Connected"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="min-h-20 border-r border-t p-4 first:border-t-0 sm:border-t-0"
            >
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {label}
              </p>
              <b className="mt-1.5 block text-sm text-slate-900">{value}</b>
            </div>
          ))}
        </div>
      </section>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((item) => (
          <PremiumKpi
            key={item.label}
            label={item.label}
            value={number(item.value).toLocaleString()}
            unit={item.unit}
            icon={item.icon}
            tone={item.tone}
            comparison={{ label: item.status }}
            sparkline={item.spark}
          />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <section className={`${card} overflow-hidden xl:col-span-2`}>
          <PanelTitle icon={Activity} hint="Live">
            Production Monitor
          </PanelTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-extrabold uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "Production",
                    "Product",
                    "Target",
                    "Completed",
                    "Remaining",
                    "Progress",
                    "Members",
                    "ETA",
                    "Status",
                  ].map((x) => (
                    <th key={x} className="h-12 px-4">
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.production.map((row) => {
                  const progress = Math.round(
                    (number(row.producedQuantity) /
                      Math.max(number(row.requiredQuantity), 1)) *
                      100,
                  );
                  return (
                    <tr
                      key={row.id}
                      className="h-14 border-b border-slate-100 transition hover:bg-slate-50/70"
                    >
                      <td className="px-4 font-extrabold text-slate-900">
                        PR-{row.id.slice(-5).toUpperCase()}
                      </td>
                      <td className="px-4 font-semibold">
                        {row.product?.name}
                      </td>
                      <td className="px-4 tabular-nums">
                        {row.requiredQuantity}
                      </td>
                      <td className="px-4 font-bold tabular-nums">
                        {row.producedQuantity}
                      </td>
                      <td className="px-4 tabular-nums">
                        {Math.max(
                          0,
                          number(row.requiredQuantity) -
                            number(row.producedQuantity),
                        )}
                      </td>
                      <td className="w-32 px-4">
                        <div className="mb-1 text-xs font-bold">
                          {progress}%
                        </div>
                        <Progress value={progress} />
                      </td>
                      <td className="max-w-36 truncate px-4">
                        {row.tasks
                          ?.map((x: AnyRow) => x.factoryMember.name)
                          .join(", ") || "Unassigned"}
                      </td>
                      <td className="px-4 tabular-nums">
                        {time(row.expectedFinishAt)}
                      </td>
                      <td className="px-4">
                        <Pill value={row.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.production.length === 0 && (
              <div className="grid min-h-56 place-items-center px-6 py-10 text-center">
                <div>
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-indigo-50 text-indigo-600">
                    <Factory className="h-6 w-6" />
                  </span>
                  <h4 className="mt-4 text-base font-extrabold text-slate-900">
                    No production runs scheduled
                  </h4>
                  <p className="mt-1 text-sm text-slate-500">
                    New production activity will appear here automatically.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className={card}>
          <PanelTitle icon={Activity} hint="Live">
            Live Activity Feed
          </PanelTitle>
          <div className="max-h-[390px] overflow-y-auto p-5">
            {activity.map((item, index) => (
              <div key={item.id} className="relative flex gap-4 pb-6">
                <div className="relative z-10 mt-1.5 h-3 w-3 shrink-0 rounded-full bg-blue-500 ring-4 ring-blue-50" />
                {index < activity.length - 1 && (
                  <div className="absolute left-[5px] top-5 h-full w-px bg-slate-200" />
                )}
                <div className="min-w-0">
                  <b className="block text-sm font-extrabold text-slate-900">
                    {item.title}
                  </b>
                  <p className="mt-1 text-[13px] leading-5 text-slate-600">
                    {item.message}
                  </p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                    <Clock3 className="h-3.5 w-3.5" />
                    {time(item.createdAt)}
                  </span>
                </div>
              </div>
            ))}
            {activity.length === 0 && (
              <div className="grid min-h-56 place-items-center text-center">
                <div>
                  <Activity className="mx-auto h-8 w-8 text-slate-300" />
                  <b className="mt-3 block text-sm text-slate-800">
                    No recent activity
                  </b>
                  <p className="mt-1 text-[13px] text-slate-500">
                    Live factory events will appear here.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <section className={`${card} p-5`}>
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-indigo-600" />
            <b className="text-base">Live Operations</b>
          </div>
          {[
            [
              "Lines running",
              Math.round(
                (derived.running.length / Math.max(data.production.length, 1)) *
                  100,
              ),
            ],
            [
              "Worker utilization",
              Math.round(
                (derived.workers.length / Math.max(data.members.length, 1)) *
                  100,
              ),
            ],
            ["Factory efficiency", derived.efficiency],
            ["Target completion", derived.efficiency],
          ].map(([label, value]) => (
            <div key={label} className="mt-4">
              <div className="mb-1.5 flex justify-between text-sm">
                <span>{label}</span>
                <b>{value}%</b>
              </div>
              <Progress value={number(value)} />
            </div>
          ))}
        </section>
        <section className={`${card} p-5`}>
          <div className="flex items-center gap-2">
            <Warehouse className="h-5 w-5 text-cyan-600" />
            <b className="text-base">Inventory Health</b>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[
              ["Available", derived.available, "GOOD"],
              ["Reserved", derived.reserved, "WAITING"],
              ["Low Stock", derived.low, "LOW"],
              ["Critical", derived.critical, "CRITICAL"],
            ].map(([label, value, status]) => (
              <div
                key={label}
                className={`rounded-xl p-3.5 ${statusColor(String(status))}`}
              >
                <p className="text-[13px] font-bold">{label}</p>
                <b className="text-2xl">{value}</b>
              </div>
            ))}
          </div>
          <div className="mt-4 border-t pt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
              Stock status
            </p>
            <p className="mt-1 text-sm">
              {derived.low + derived.critical
                ? `${derived.low + derived.critical} items require replenishment review.`
                : "No immediate shortages reported."}
            </p>
          </div>
        </section>
        <section className={`${card} p-5`}>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            <b className="text-base">Quality Control</b>
          </div>
          <div
            className="mx-auto mt-5 grid h-28 w-28 place-items-center rounded-full"
            style={{
              background: `conic-gradient(#10b981 ${quality}%,#e2e8f0 0)`,
            }}
          >
            <div className="grid h-20 w-20 place-items-center rounded-full bg-white">
              <div className="text-center">
                <b className="text-2xl">{quality}%</b>
                <p className="text-xs text-slate-400">Quality rate</p>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-around text-center text-sm">
            <span>
              <b className="block text-emerald-600">{derived.completed}</b>
              Passed
            </span>
            <span>
              <b className="block text-rose-600">{derived.rejected}</b>Rejected
            </span>
            <span>
              <b className="block text-amber-600">{derived.damaged}</b>Damaged
            </span>
          </div>
        </section>
        <section className={`${card} p-5`}>
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-violet-600" />
            <b className="text-base">Performance Score</b>
          </div>
          {[
            ["Efficiency", derived.efficiency],
            ["Production accuracy", quality],
            [
              "Dispatch success",
              Math.round(
                (delivered / Math.max(data.dispatches.length, 1)) * 100,
              ),
            ],
            [
              "Inventory health",
              Math.max(0, 100 - (derived.low * 8 + derived.critical * 15)),
            ],
          ].map(([label, value]) => (
            <div className="mt-4" key={label}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{label}</span>
                <b>{value}%</b>
              </div>
              <Progress
                value={number(value)}
                tone={number(value) > 75 ? "bg-emerald-500" : "bg-amber-500"}
              />
            </div>
          ))}
        </section>
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <LiveTracking />
        <section className={card}>
          <PanelTitle icon={Truck}>Dispatch Command Center</PanelTitle>
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
            {[
              ["Waiting", ready],
              [
                "In Transit",
                data.dispatches.filter((x) => x.status === "IN_TRANSIT").length,
              ],
              ["Delivered", delivered],
              ["Failed", failed],
              [
                "Loading",
                data.dispatches.filter((x) => x.status === "DISPATCHED").length,
              ],
              [
                "Arrived",
                data.dispatches.filter((x) => x.status === "ARRIVED").length,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-xl bg-slate-50 p-4 text-center"
              >
                <b className="block text-2xl text-slate-950">{value}</b>
                <span className="text-[13px] text-slate-500">{label}</span>
              </div>
            ))}
          </div>
          {data.dispatches.slice(0, 3).map((row) => (
            <div key={row.id} className="mx-5 mb-3 rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm">{row.salesperson?.name}</b>
                <Pill value={row.status} />
              </div>
              <p className="mt-2 text-[13px] leading-5 text-slate-500">
                {row.product?.name} · {row.destination}
              </p>
            </div>
          ))}
        </section>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <section className={`${card} lg:col-span-2`}>
          <PanelTitle icon={Users}>Factory Member Monitor</PanelTitle>
          <div className="grid gap-4 p-5 sm:grid-cols-2 2xl:grid-cols-4">
            {data.members.map((member) => (
              <div
                key={member.id}
                className="min-h-40 rounded-xl border border-slate-200 p-4 transition hover:border-indigo-200 hover:shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <ProfileAvatar
                    src={member.profileImage}
                    name={member.name}
                    className="h-11 w-11 shrink-0 rounded-full"
                  />
                  <div className="min-w-0">
                    <b className="block truncate text-sm font-extrabold text-slate-950">
                      {member.name}
                    </b>
                    <span className="mt-0.5 block text-[13px] text-slate-500">
                      {member.department}
                    </span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2">
                  <Pill value={member.status} />
                  <span className="text-[13px] font-semibold text-slate-500">
                    {member.workload || 0} tasks
                  </span>
                </div>
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    Current task
                  </p>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-slate-600">
                    {member.currentTask || "No current task assigned"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className={card}>
          <PanelTitle icon={Lightbulb}>Smart Insights</PanelTitle>
          <div className="space-y-3 p-5">
            {[
              derived.efficiency >= 100
                ? `Production is ${derived.efficiency - 100}% above target.`
                : `Production is at ${derived.efficiency}% of target.`,
              derived.low + derived.critical
                ? `Low stock detected for ${derived.low + derived.critical} products.`
                : "Inventory levels are healthy.",
              failed
                ? `${failed} dispatches require attention.`
                : `${delivered} deliveries completed successfully.`,
              derived.onBreak.length
                ? `${derived.onBreak.length} factory members are currently on break.`
                : `${derived.workers.length} factory members are working.`,
            ].map((insight) => (
              <div
                key={insight}
                className="flex gap-3 rounded-xl bg-indigo-50/60 p-4"
              >
                <Sparkles className="h-5 w-5 shrink-0 text-indigo-500" />
                <p className="text-sm leading-5 text-slate-700">{insight}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className={card}>
        <PanelTitle icon={CalendarDays}>Factory Operations Summary</PanelTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6">
          {[
            [
              "Selected range production",
              `${data.dashboard.production.selectedRange} units`,
            ],
            ["Today’s production", `${data.dashboard.production.daily} units`],
            [
              "Target remaining",
              `${Math.max(0, derived.target - derived.completed)} units`,
            ],
            ["Orders waiting", `${data.dashboard.kpis.pendingOrders} orders`],
            ["Delayed orders", `${data.dashboard.kpis.delayedOrders} orders`],
            ["Dispatch ready", `${data.dashboard.kpis.readyToDispatch} orders`],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-r border-slate-100 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                {label}
              </p>
              <b className="mt-2 block text-sm text-slate-900">{value}</b>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
