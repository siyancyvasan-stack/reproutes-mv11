import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cloud,
  CloudOff,
  Coffee,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  Package,
  Pause,
  Phone,
  Play,
  RefreshCw,
  Repeat2,
  Route,
  ShoppingBag,
  Store,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { DailyRouteMap } from "../components/map/DailyRouteMap";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  loadAgentActivity,
  loadMyActivity,
  loadMyRouteReplay,
  requestActivityCorrection,
  requestGeofenceException,
  type AgentActivityReport,
} from "../services/agentActivityApi";
import {
  apiRequest,
  ensureAccessToken,
  getAccessToken,
} from "../services/apiClient";
import { downloadExport } from "../services/exportApi";
import { ExportButton } from "../components/common/ExportButton";
import {
  exportToCsv,
  exportToPdf,
  type ExportColumn,
} from "../services/exportService";
import { listQueuedGpsPoints } from "../services/gpsQueue";
import {
  flushFieldOperations,
  listFieldOperations,
  type QueuedFieldOperation,
} from "../services/fieldOperationQueue";

type Preset =
  | "today"
  | "yesterday"
  | "custom"
  | "this_week"
  | "last_week"
  | "this_month"
  | "previous_month"
  | "custom_range";
const key = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const datesFor = (preset: Preset) => {
  const now = new Date(),
    from = new Date(now),
    to = new Date(now);
  if (preset === "yesterday") {
    from.setDate(from.getDate() - 1);
    to.setDate(to.getDate() - 1);
  }
  if (preset === "this_week" || preset === "last_week") {
    const offset = (from.getDay() + 6) % 7;
    from.setDate(from.getDate() - offset - (preset === "last_week" ? 7 : 0));
    to.setTime(from.getTime());
    to.setDate(to.getDate() + 6);
  }
  if (preset === "this_month" || preset === "previous_month") {
    if (preset === "previous_month") from.setMonth(from.getMonth() - 1);
    from.setDate(1);
    to.setFullYear(from.getFullYear(), from.getMonth() + 1, 0);
  }
  return { from: key(from), to: key(to) };
};
const time = (value?: string) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const duration = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}h ${String(minutes % 60).padStart(2, "0")}m`;
const money = (value: number) =>
  `LKR ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const ago = (value?: string, now = Date.now()) => {
  if (!value) return "Never";
  const seconds = Math.max(
    0,
    Math.round((now - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds} sec ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
};
const eventIcon = (type: string) =>
  type.includes("ORDER")
    ? ShoppingBag
    : type.includes("PAYMENT")
      ? WalletCards
      : type.includes("BREAK")
        ? Coffee
        : type.includes("TRAVEL")
          ? Navigation
          : type.includes("VISIT") || type.includes("SHOP")
            ? Store
            : type.includes("GPS")
              ? MapPin
              : Clock3;
const visitColumns: ExportColumn<AgentActivityReport["visits"][number]>[] = [
  { header: "Shop", value: (v) => v.shopName },
  { header: "Address", value: (v) => v.address },
  { header: "Arrival", value: (v) => v.arrivalAt },
  { header: "Departure", value: (v) => v.departureAt },
  { header: "Duration Minutes", value: (v) => v.durationMinutes },
  { header: "GPS Verified", value: (v) => (v.gpsVerified ? "Yes" : "No") },
  { header: "Distance From Shop (m)", value: (v) => v.distanceFromShopMeters },
  { header: "Sales LKR", value: (v) => v.salesLkr },
  { header: "Collections LKR", value: (v) => v.collectedLkr },
  { header: "Outstanding LKR", value: (v) => v.outstandingBalanceLkr },
  { header: "Follow-up", value: (v) => (v.followUpRequired ? "Yes" : "No") },
];

function ActivitySkeleton() {
  return (
    <div className="space-y-4" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading agent activity</span>
      <GlassCard className="p-5">
        <div className="flex animate-pulse items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-indigo-100" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-48 rounded bg-slate-200" />
            <div className="h-4 w-64 max-w-full rounded bg-slate-100" />
          </div>
        </div>
      </GlassCard>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <GlassCard key={index} className="p-4">
            <div className="animate-pulse space-y-3">
              <div className="h-3 w-20 rounded bg-slate-200" />
              <div className="h-6 w-28 max-w-full rounded bg-indigo-100" />
            </div>
          </GlassCard>
        ))}
      </div>
      <GlassCard className="p-5">
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index}>
              <div className="mb-2 h-4 w-36 rounded bg-slate-200" />
              <div className="h-3 rounded-full bg-indigo-100" />
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}

export const AgentActivityPage: React.FC = () => {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const manager = location.pathname.startsWith("/");
  const agentId = manager ? id : user?.id;
  const [preset, setPreset] = useState<Preset>("today");
  const initial = datesFor("today");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [report, setReport] = useState<AgentActivityReport>();
  const [loading, setLoading] = useState(true);
  const [selectedVisit, setSelectedVisit] =
    useState<AgentActivityReport["visits"][number]>();
  const [replay, setReplay] = useState<AgentActivityReport["route"]["points"]>(
    [],
  );
  const [replayIndex, setReplayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [pendingGps, setPendingGps] = useState(0);
  const [operations, setOperations] = useState<QueuedFieldOperation[]>([]);
  const requestId = useRef(0);
  useEffect(() => {
    if (preset === "custom" || preset === "custom_range") return;
    const range = datesFor(preset);
    setFrom(range.from);
    setTo(range.to);
  }, [preset]);
  const load = useCallback(
    async (silent = false) => {
      if (!agentId) return;
      const current = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const next = await (manager
          ? loadAgentActivity(agentId, from, to)
          : loadMyActivity(from, to));
        if (current === requestId.current) setReport(next);
      } catch (error) {
        if (current === requestId.current)
          showToast(
            "Activity unavailable",
            error instanceof Error ? error.message : "Unable to load activity.",
            "error",
          );
      } finally {
        if (current === requestId.current) setLoading(false);
      }
    },
    [agentId, from, to, manager, showToast],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!agentId) return;
    let socket: ReturnType<typeof io> | undefined, timer: number | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => void load(true), 500);
    };
    void ensureAccessToken()
      .then(() => {
        socket = io(undefined, {
          transports: ["websocket"],
          withCredentials: true,
          auth: (callback) =>
            callback({ token: getAccessToken() ?? undefined }),
        });
        socket.on(
          "activity:updated",
          (event: { agentId?: string }) =>
            event.agentId === agentId && refresh(),
        );
        socket.on(
          "tracking:agent-location",
          (event: { agentId?: string }) =>
            event.agentId === agentId && refresh(),
        );
      })
      .catch(() => undefined);
    return () => {
      clearTimeout(timer);
      socket?.disconnect();
    };
  }, [agentId, load]);
  const refreshSync = useCallback(async () => {
    if (!agentId) return;
    const [gps, queued] = await Promise.all([
      listQueuedGpsPoints(agentId).catch(() => []),
      listFieldOperations(agentId).catch(() => []),
    ]);
    setPendingGps(gps.length);
    setOperations(queued);
  }, [agentId]);
  useEffect(() => {
    void refreshSync();
    const update = () => void refreshSync();
    window.addEventListener("online", update);
    window.addEventListener("reproutes:sync-changed", update);
    const timer = window.setInterval(update, 15000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("reproutes:sync-changed", update);
      clearInterval(timer);
    };
  }, [refreshSync]);
  useEffect(() => {
    if (!playing || replay.length < 2) return;
    const timer = window.setInterval(
      () =>
        setReplayIndex((index) => {
          if (index >= replay.length - 1) {
            setPlaying(false);
            return index;
          }
          return index + 1;
        }),
      Math.max(100, 800 / speed),
    );
    return () => clearInterval(timer);
  }, [playing, replay.length, speed]);
  useEffect(() => {
    if (!mapExpanded) return;
    const close = (event: KeyboardEvent) =>
      event.key === "Escape" && setMapExpanded(false);
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", close);
    };
  }, [mapExpanded]);
  const startReplay = async () => {
    if (manager || from !== to) return;
    try {
      const result = await loadMyRouteReplay(from, 1200);
      setReplay(result.points);
      setReplayIndex(0);
      setPlaying(Boolean(result.points.length));
    } catch (error) {
      showToast(
        "Replay unavailable",
        error instanceof Error
          ? error.message
          : "No recorded route is available.",
        "error",
      );
    }
  };
  const toggleBreak = async () => {
    if (manager || !report) return;
    try {
      await apiRequest(
        `/api/v1/attendance/break/${report.status.onBreak ? "end" : "start"}`,
        { method: "POST", body: "{}" },
      );
      showToast(
        report.status.onBreak ? "Work resumed" : "Break started",
        report.status.onBreak
          ? "Your break has ended."
          : "Your break timer is running.",
        "success",
      );
      await load(true);
    } catch (error) {
      showToast(
        "Break update failed",
        error instanceof Error ? error.message : "Please try again.",
        "error",
      );
    }
  };
  const doExport = async (format: "pdf" | "xlsx" | "csv") => {
    if (!report) throw new Error("NO_EXPORT_DATA");
    const filename = `agent_activity_${from}_${to}.${format}`;
    if (format === "xlsx")
      return downloadExport("daily_activity", "xlsx", {
        from,
        to,
        ...(manager ? { agentId } : {}),
      });
    if (format === "csv")
      return exportToCsv(report.visits, { columns: visitColumns }, filename);
    await exportToPdf(
      report.visits,
      {
        title: "Daily Field Operations & Performance",
        filters: { From: from, To: to },
        metadata: [
          ["Agent", report.agent.name],
          ["Employee ID", report.agent.employeeCode],
          ["Territory", report.routePlan?.territory ?? report.agent.region],
          ["Status", report.kpis.currentStatus],
        ],
        kpis: [
          ["Shift", duration(report.kpis.workingMinutes)],
          ["Visited", `${report.kpis.shopsVisited}/${report.targets.shops}`],
          ["Orders", report.kpis.orders],
          ["Sales", money(report.kpis.totalSalesLkr)],
          ["Collections", money(report.kpis.paymentCollectionsLkr)],
          ["Distance", `${report.kpis.distanceKm} km`],
        ],
        columns: visitColumns,
      },
      filename,
    );
  };
  const maxSales = useMemo(
    () =>
      Math.max(
        1,
        ...(report?.performance.daily.map((day) => day.salesLkr) ?? [1]),
      ),
    [report],
  );
  const syncCount = pendingGps + operations.length;
  const currentNow = report ? new Date(report.serverNow).getTime() : Date.now();
  const body = (
    <div className="agent-activity-page space-y-5 rounded-[28px] bg-gradient-to-br from-slate-50 via-blue-50/70 to-violet-50/70 p-3 text-slate-900 sm:space-y-6 sm:p-5 lg:p-7">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() =>
              navigate(
                manager
                  ? "/agents"
                  : location.pathname.startsWith("/sales/")
                    ? "/sales/dashboard"
                    : "/agent/dashboard",
              )
            }
            aria-label="Back to dashboard"
            className="grid min-h-11 min-w-11 place-items-center rounded-xl border border-slate-300 bg-white text-slate-700 shadow-sm transition hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-extrabold text-white">
              <UserRound className="h-6 w-6 text-cyan-400" />
              {manager
                ? "Agent Activity & Performance"
                : "My Activity & Performance"}
            </h2>
            <p className="text-xs text-slate-400">
              Daily field operations, route, visits, sales and collections
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!manager && (
            <button
              onClick={() =>
                navigate(
                  location.pathname.startsWith("/sales/")
                    ? "/sales/visits/new"
                    : "/agent/visits/new",
                )
              }
              className="min-h-11 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-2.5 text-sm font-black text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-indigo-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Record Shop Visit
            </button>
          )}
          <ExportButton
            dataset="daily_activity"
            pdf
            formats={["pdf", "xlsx", "csv"]}
            filters={{ from, to, ...(manager ? { agentId } : {}) }}
            disabled={loading || !report}
            onExport={(format) => doExport(format as "pdf" | "xlsx" | "csv")}
          />
        </div>
      </div>
      <GlassCard className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["today", "Today"],
                ["yesterday", "Yesterday"],
                ["custom", "Custom Date"],
                ["this_week", "This Week"],
                ["last_week", "Last Week"],
                ["this_month", "This Month"],
                ["previous_month", "Previous Month"],
                ["custom_range", "Custom Range"],
              ] as Array<[Preset, string]>
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={preset === value}
                onClick={() => setPreset(value)}
                className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-extrabold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${preset === value ? "border-indigo-600 bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-indigo-500/20" : "border-slate-300 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CalendarDays className="h-4 w-4 text-cyan-400" />
            <input
              aria-label="From date"
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                if (preset === "custom") setTo(event.target.value);
              }}
              className="glass-input rounded-lg px-2 py-1.5 text-xs"
            />
            {preset === "custom_range" && (
              <>
                <span className="text-xs text-slate-500">to</span>
                <input
                  aria-label="To date"
                  type="date"
                  value={to}
                  min={from}
                  onChange={(event) => setTo(event.target.value)}
                  className="glass-input rounded-lg px-2 py-1.5 text-xs"
                />
              </>
            )}
          </div>
        </div>
      </GlassCard>
      {loading && !report ? (
        <ActivitySkeleton />
      ) : !report ? (
        <Empty title="No authorized activity report is available." />
      ) : (
        <>
          <GlassCard
            className={`p-5 transition-opacity ${loading ? "opacity-60" : ""}`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <ProfileAvatar
                src={report.agent.avatarUrl}
                name={report.agent.name}
                className="h-16 w-16 rounded-2xl border-2 border-cyan-500/30"
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-extrabold text-white">
                  {report.agent.name}
                </h3>
                <p className="text-xs font-semibold text-cyan-400">
                  {report.agent.employeeCode || report.agent.id}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {report.agent.email}
                  {report.agent.phone ? ` · ${report.agent.phone}` : ""}
                </p>
                <p className="text-xs text-slate-400">
                  {report.routePlan?.territory ??
                    report.agent.region ??
                    "No route assigned"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 sm:max-w-xs sm:justify-end">
                <Pill tone={report.status.working ? "green" : "slate"}>
                  {report.status.onBreak
                    ? "On Break"
                    : report.status.working
                      ? "Working"
                      : report.kpis.punchOut
                        ? "Shift Ended"
                        : "Offline"}
                </Pill>
                <Pill
                  tone={
                    report.status.trackingState === "ACTIVE" ? "cyan" : "amber"
                  }
                >
                  {report.status.trackingState === "ACTIVE"
                    ? "GPS Active"
                    : report.status.trackingState.replaceAll("_", " ")}
                </Pill>
                <button
                  type="button"
                  aria-label="Open sync status"
                  onClick={() => setSyncOpen(true)}
                  className="min-h-11 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Pill tone={syncCount ? "amber" : "green"}>
                    {syncCount ? `${syncCount} Sync Pending` : "Synced"}
                  </Pill>
                </button>
                <p className="w-full text-right text-[10px] text-slate-500">
                  Last GPS: {ago(report.status.lastGpsAt, currentNow)} · Last
                  Sync: {ago(report.status.lastSyncAt, currentNow)}
                </p>
              </div>
            </div>
          </GlassCard>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["Shift Time", duration(report.kpis.workingMinutes), Clock3],
              [
                "Shops Visited",
                `${report.kpis.shopsVisited} / ${report.targets.shops || report.kpis.shopsVisited}`,
                Store,
              ],
              ["Orders", report.kpis.orders, ShoppingBag],
              ["Sales", money(report.kpis.totalSalesLkr), TrendingUp],
              [
                "Collections",
                money(report.kpis.paymentCollectionsLkr),
                WalletCards,
              ],
              ["Distance", `${report.kpis.distanceKm} km`, Route],
              [
                "Route Completion",
                `${report.progress.routePercent}%`,
                Navigation,
              ],
              [
                "GPS Verified",
                `${report.quality.gpsVerifiedVisits} / ${report.kpis.shopsVisited}`,
                CheckCircle2,
              ],
            ].map(([label, value, Icon]) => (
              <GlassCard
                key={String(label)}
                className="group p-4 transition duration-200 hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[9px] font-bold uppercase tracking-wider text-slate-500">
                      {String(label)}
                    </p>
                    <p className="mt-1 text-base font-extrabold text-white sm:text-lg">
                      {String(value)}
                    </p>
                  </div>
                  {React.createElement(Icon as React.ElementType, {
                    className: "h-4 w-4 text-cyan-400",
                  })}
                </div>
              </GlassCard>
            ))}
          </div>
          <GlassCard className="p-5">
            <h3 className="mb-4 text-sm font-extrabold text-white">
              Today’s Progress
            </h3>
            <div className="space-y-4">
              <Progress
                label="Shops"
                value={report.kpis.shopsVisited}
                target={report.targets.shops}
                percent={report.progress.shopsPercent}
              />
              <Progress
                label="Sales Target"
                value={report.kpis.totalSalesLkr}
                target={report.targets.salesLkr}
                percent={report.progress.salesPercent}
                currency
              />
              <Progress
                label="Collections"
                value={report.kpis.paymentCollectionsLkr}
                target={report.targets.collectionsLkr}
                percent={report.progress.collectionsPercent}
                currency
              />
              <Progress
                label="Route Completion"
                value={report.progress.routePercent}
                target={100}
                percent={report.progress.routePercent}
                suffix="%"
              />
            </div>
          </GlassCard>
          <GlassCard
            className={`${mapExpanded ? "fixed inset-0 z-[60] rounded-none bg-[#07111F] p-3 sm:p-5" : "overflow-hidden p-3"}`}
          >
            <div className="mb-3 flex items-start justify-between gap-2 px-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-extrabold text-white">
                  <Navigation className="h-4 w-4 text-cyan-400" />
                  Daily Route Map
                </h3>
                <p className="text-[11px] text-slate-400">
                  {report.route.rawPointCount} raw ·{" "}
                  {report.route.retainedPointCount} retained GPS points
                </p>
              </div>
              <div className="flex items-center gap-2">
                {!manager && from === to && (
                  <button
                    onClick={() => void startReplay()}
                    className="rounded-lg border border-indigo-500/30 px-3 py-2 text-[10px] font-bold text-indigo-300"
                  >
                    <Repeat2 className="mr-1 inline h-3.5" />
                    Replay Route
                  </button>
                )}
                <button
                  onClick={() => setMapExpanded((value) => !value)}
                  aria-label={
                    mapExpanded
                      ? "Close full screen map"
                      : "Open full screen map"
                  }
                  className="rounded-lg border border-cyan-500/30 p-2 text-cyan-300"
                >
                  {mapExpanded ? (
                    <Minimize2 className="h-4 w-4" />
                  ) : (
                    <Maximize2 className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            <DailyRouteMap
              className={
                mapExpanded
                  ? "h-[calc(100dvh-7rem)]"
                  : "h-[65dvh] min-h-[460px] sm:min-h-[620px]"
              }
              route={report.route}
              visits={report.visits}
              routePlan={report.routePlan}
              replayPoint={replay[replayIndex]}
            />
            {replay.length > 0 && (
              <div
                className={`${mapExpanded ? "absolute inset-x-5 bottom-5 rounded-xl bg-slate-950/90" : "p-2"} space-y-2 p-2`}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPlaying((value) => !value)}
                    className="rounded-lg bg-indigo-600 p-2 text-white"
                  >
                    {playing ? (
                      <Pause className="h-4" />
                    ) : (
                      <Play className="h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setPlaying(false);
                      setReplayIndex(0);
                    }}
                    className="rounded-lg border border-slate-700 p-2 text-slate-300"
                  >
                    <RefreshCw className="h-4" />
                  </button>
                  <input
                    aria-label="Route replay timeline"
                    className="flex-1"
                    type="range"
                    min="0"
                    max={replay.length - 1}
                    value={replayIndex}
                    onChange={(event) => {
                      setPlaying(false);
                      setReplayIndex(Number(event.target.value));
                    }}
                  />
                  <select
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                    className="glass-input rounded-lg p-2 text-xs"
                  >
                    <option value="1">1×</option>
                    <option value="2">2×</option>
                    <option value="4">4×</option>
                  </select>
                </div>
                <p className="text-center text-[10px] text-slate-400">
                  {time(replay[replayIndex]?.capturedAt)}
                </p>
              </div>
            )}
          </GlassCard>
          <GlassCard className="p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-extrabold text-white">
              <Activity className="h-4 w-4 text-cyan-400" />
              Daily Activity Timeline
            </h3>
            <div className="max-h-[620px] overflow-y-auto pr-2">
              {report.timeline.length ? (
                report.timeline.map((event, index) => {
                  const Icon = eventIcon(event.type);
                  return (
                    <div key={event.id} className="relative flex gap-3 pb-5">
                      <div className="flex flex-col items-center">
                        <span className="grid h-7 w-7 place-items-center rounded-full border border-cyan-400/30 bg-cyan-500/10">
                          <Icon className="h-3.5 w-3.5 text-cyan-300" />
                        </span>
                        {index < report.timeline.length - 1 && (
                          <span className="w-px flex-1 bg-slate-700" />
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-cyan-400">
                          {new Date(event.at).toLocaleString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            month: report.range.days > 1 ? "short" : undefined,
                            day: report.range.days > 1 ? "numeric" : undefined,
                          })}
                        </p>
                        <p className="text-xs font-bold text-white">
                          {event.title}
                        </p>
                        {event.detail && (
                          <p className="text-[11px] text-slate-400">
                            {event.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <ContextEmpty report={report} navigate={navigate} />
              )}
            </div>
          </GlassCard>
          <GlassCard className="p-5">
            <h3 className="mb-3 text-sm font-extrabold text-white">
              Planned vs Actual Route
            </h3>
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              {[
                ["Planned shops", report.routeComparison.plannedShops],
                ["Completed", report.routeComparison.completedShops],
                ["Missed", report.routeComparison.missedShops],
                ["Unplanned", report.routeComparison.unplannedShops],
                [
                  "Planned distance",
                  `${report.routeComparison.plannedDistanceKm} km`,
                ],
                [
                  "Actual distance",
                  `${report.routeComparison.actualDistanceKm} km`,
                ],
                ["Deviation", `${report.routeComparison.deviationKm} km`],
                ["Completion", `${report.routeComparison.completionPercent}%`],
              ].map(([label, value]) => (
                <Mini key={String(label)} label={String(label)} value={value} />
              ))}
            </div>
          </GlassCard>
          {report.nextAction && (
            <GlassCard className="p-5">
              <h3 className="text-sm font-extrabold text-white">
                What’s Next?
              </h3>
              <div className="mt-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <b className="text-white">{report.nextAction.shop.name}</b>
                  <p className="text-xs text-slate-400">
                    {report.nextAction.shop.address} · Planned{" "}
                    {time(report.nextAction.plannedArrivalTime)}
                  </p>
                </div>
                <div className="flex gap-2">
                  {report.nextAction.shop.latitude != null && (
                    <a
                      target="_blank"
                      rel="noreferrer"
                      href={`https://www.google.com/maps/dir/?api=1&destination=${report.nextAction.shop.latitude},${report.nextAction.shop.longitude}`}
                      className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white"
                    >
                      Navigate
                    </a>
                  )}
                  <a
                    href={`tel:${report.nextAction.shop.phone}`}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-cyan-300"
                  >
                    <Phone className="mr-1 inline h-3.5" />
                    Call
                  </a>
                  <button
                    onClick={() =>
                      navigate(
                        `${location.pathname.startsWith("/sales/") ? "/sales" : "/agent"}/shops`,
                      )
                    }
                    className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-cyan-300"
                  >
                    View Shop
                  </button>
                </div>
              </div>
            </GlassCard>
          )}
          <section>
            <h3 className="mb-3 text-sm font-extrabold text-white">
              Shop Visit Sessions
            </h3>
            {report.visits.length ? (
              <div className="grid gap-4 lg:grid-cols-2">
                {report.visits.map((visit) => (
                  <button
                    key={visit.id}
                    onClick={() => setSelectedVisit(visit)}
                    className="text-left"
                  >
                    <GlassCard className="h-full p-5 transition hover:ring-2 hover:ring-cyan-400/50">
                      <div className="flex items-start gap-3">
                        <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-500/15 font-extrabold text-indigo-300">
                          {visit.sequence}
                        </span>
                        <div className="min-w-0 flex-1">
                          <h4 className="font-extrabold text-white">
                            {visit.shopName}
                          </h4>
                          <p className="text-[11px] text-slate-400">
                            {visit.address}
                          </p>
                        </div>
                        <Pill tone={visit.gpsVerified ? "green" : "amber"}>
                          {visit.gpsVerified
                            ? "GPS Verified"
                            : "Outside Location"}
                        </Pill>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                        <Mini
                          label="Time"
                          value={`${time(visit.arrivalAt)}–${time(visit.departureAt)}`}
                        />
                        <Mini
                          label="Duration"
                          value={`${visit.durationMinutes} min`}
                        />
                        <Mini
                          label="Status"
                          value={visit.departureAt ? "Visited" : "Active"}
                        />
                        <Mini label="Order" value={money(visit.salesLkr)} />
                        <Mini
                          label="Collected"
                          value={money(visit.collectedLkr)}
                        />
                        <Mini
                          label="Outstanding"
                          value={money(visit.outstandingBalanceLkr)}
                        />
                      </div>
                      {!visit.departureAt && visit.durationMinutes > 180 && (
                        <p className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs font-bold text-amber-300">
                          Check-out required
                        </p>
                      )}
                    </GlassCard>
                  </button>
                ))}
              </div>
            ) : (
              <ContextEmpty report={report} navigate={navigate} />
            )}
          </section>
          <div className="grid gap-6 xl:grid-cols-2">
            <GlassCard className="p-5">
              <h3 className="mb-4 text-sm font-extrabold text-white">
                Sales & Collection
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  ["Total Sales", money(report.performance.totalSalesLkr)],
                  ["Orders", report.performance.totalOrders],
                  [
                    "Average Order",
                    money(
                      report.performance.totalOrders
                        ? report.performance.totalSalesLkr /
                            report.performance.totalOrders
                        : 0,
                    ),
                  ],
                  ["Collections", money(report.performance.collectionsLkr)],
                  [
                    "Outstanding",
                    money(
                      report.visits.reduce(
                        (sum, visit) => sum + visit.outstandingBalanceLkr,
                        0,
                      ),
                    ),
                  ],
                  ["Productive Visits", report.quality.productiveVisits],
                ].map(([label, value]) => (
                  <Mini
                    key={String(label)}
                    label={String(label)}
                    value={value}
                  />
                ))}
              </div>
            </GlassCard>
            <GlassCard className="p-5">
              <h3 className="mb-4 text-sm font-extrabold text-white">
                Visit Quality
              </h3>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {[
                  [
                    "GPS Verified",
                    `${report.quality.gpsVerifiedVisits}/${report.kpis.shopsVisited}`,
                  ],
                  ["Avg Visit", `${report.quality.averageVisitMinutes} min`],
                  ["Productive", report.quality.productiveVisits],
                  ["No-Sale", report.quality.noSaleVisits],
                  ["Orders/Visit", report.quality.ordersPerVisit],
                  [
                    "Collections/Visit",
                    money(report.quality.collectionsPerVisit),
                  ],
                  ["Follow-ups", report.quality.followUpsRequired],
                ].map(([label, value]) => (
                  <Mini
                    key={String(label)}
                    label={String(label)}
                    value={value}
                  />
                ))}
              </div>
            </GlassCard>
          </div>
          <GlassCard className="p-5">
            <h3 className="mb-4 text-sm font-extrabold text-white">
              Weekly / Monthly Performance
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Days worked", report.performance.workingDays],
                ["Shops", report.performance.totalVisits],
                ["Orders", report.performance.totalOrders],
                ["Sales", money(report.performance.totalSalesLkr)],
                ["Collections", money(report.performance.collectionsLkr)],
                ["Distance", `${report.performance.distanceKm} km`],
                ["Avg shops/day", report.performance.averageShopsPerDay],
                ["Avg visit", `${report.performance.averageVisitMinutes} min`],
              ].map(([label, value]) => (
                <Mini key={String(label)} label={String(label)} value={value} />
              ))}
            </div>
            <div className="mt-5 space-y-3">
              {report.performance.daily.map((day) => (
                <div key={day.date}>
                  <div className="mb-1 flex justify-between text-[10px]">
                    <span className="text-slate-400">{day.date}</span>
                    <span className="font-bold text-white">
                      {money(day.salesLkr)} · {day.visits} shops ·{" "}
                      {day.distanceKm.toFixed(1)} km
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-900">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-indigo-500"
                      style={{
                        width: `${Math.max(day.salesLkr ? 4 : 0, (day.salesLkr / maxSales) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </>
      )}
      {selectedVisit && (
        <VisitDrawer
          visit={selectedVisit}
          close={() => setSelectedVisit(undefined)}
          correction={async (reason) => {
            await requestActivityCorrection({
              visitId: selectedVisit.id,
              reason,
            });
            showToast(
              "Correction requested",
              "A manager can now review the request.",
              "success",
            );
          }}
          exception={async (reason, note) => {
            await requestGeofenceException(selectedVisit.id, { reason, note });
            showToast(
              "Exception submitted",
              "The GPS exception is pending review.",
              "success",
            );
            await load(true);
          }}
        />
      )}
      {syncOpen && (
        <SyncDrawer
          count={syncCount}
          gps={pendingGps}
          operations={operations}
          close={() => setSyncOpen(false)}
          retry={async () => {
            if (agentId) {
              await flushFieldOperations(agentId);
              await refreshSync();
            }
          }}
        />
      )}{" "}
    </div>
  );
  return <ManagerLayout>{body}</ManagerLayout>;
};

const Pill = ({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "green" | "cyan" | "amber" | "slate";
}) => (
  <span
    className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase ${tone === "green" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : tone === "cyan" ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300" : tone === "amber" ? "border-amber-500/30 bg-amber-500/10 text-amber-300" : "border-slate-600 bg-slate-800 text-slate-300"}`}
  >
    {children}
  </span>
);
const Mini = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
  key?: React.Key;
}) => (
  <div className="rounded-xl bg-slate-900/60 p-3">
    <p className="text-[9px] font-bold uppercase text-slate-500">{label}</p>
    <b className="mt-1 block text-xs text-white">{value}</b>
  </div>
);
const Progress = ({
  label,
  value,
  target,
  percent,
  currency,
  suffix,
}: {
  label: string;
  value: number;
  target: number;
  percent: number;
  currency?: boolean;
  suffix?: string;
}) => (
  <div
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={Math.max(0, Math.min(100, percent))}
  >
    <div className="mb-1 flex flex-col gap-1 text-xs sm:flex-row sm:justify-between">
      <b className="text-slate-300">{label}</b>
      <span className="text-slate-400">
        {currency
          ? `${money(value)} / ${target ? money(target) : "No target"}`
          : `${value}${suffix ?? ""} / ${target || "—"}${suffix ?? ""}`}{" "}
        — {percent}%
      </span>
    </div>
    <div className="h-2.5 overflow-hidden rounded-full bg-slate-900">
      <div
        className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 transition-all"
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  </div>
);
const Empty = ({ title }: { title: string }) => (
  <GlassCard className="p-8 text-center text-slate-400">{title}</GlassCard>
);
const ContextEmpty = ({
  report,
  navigate,
}: {
  report: AgentActivityReport;
  navigate: (path: string) => void;
}) => (
  <div className="py-10 text-center">
    <p className="font-bold text-white">
      {!report.kpis.punchIn
        ? "Your shift has not started"
        : report.targets.shops
          ? `No visits yet — ${report.targets.shops} assigned shops remaining`
          : "No activity recorded for this period"}
    </p>
    <button
      onClick={() =>
        navigate(!report.kpis.punchIn ? "/sales/dashboard" : "/sales/shops")
      }
      className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white"
    >
      {!report.kpis.punchIn ? "Start Shift" : "View Assigned Shops"}
    </button>
  </div>
);
const VisitDrawer = ({
  visit,
  close,
  correction,
  exception,
}: {
  visit: AgentActivityReport["visits"][number];
  close: () => void;
  correction: (reason: string) => Promise<void>;
  exception: (reason: string, note: string) => Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  const askCorrection = async () => {
    const reason = window.prompt(
      "Explain the requested manual correction (minimum 10 characters):",
    );
    if (reason && reason.trim().length >= 10) {
      setBusy(true);
      try {
        await correction(reason.trim());
      } finally {
        setBusy(false);
      }
    }
  };
  const askException = async () => {
    const reason = window.prompt(
      "Reason: GPS_INACCURATE, SHOP_ENTRANCE_MOVED, or ROADSIDE_MEETING",
    );
    const note = window.prompt("Explain the business exception:");
    if (reason && note && note.trim().length >= 10) {
      setBusy(true);
      try {
        await exception(reason, note.trim());
      } finally {
        setBusy(false);
      }
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70" onMouseDown={close}>
      <aside
        onMouseDown={(event) => event.stopPropagation()}
        className="ml-auto h-full w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-[#07111F] p-5 shadow-2xl"
      >
        <div className="flex justify-between">
          <div>
            <p className="text-xs font-bold text-cyan-400">VISIT DETAILS</p>
            <h2 className="text-xl font-extrabold text-white">
              {visit.shopName}
            </h2>
            <p className="text-xs text-slate-400">{visit.address}</p>
          </div>
          <button onClick={close}>
            <X className="text-slate-400" />
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {[
            ["Contact", visit.contactPerson ?? "—"],
            ["Phone", visit.phone ?? "—"],
            ["Arrival", time(visit.arrivalAt)],
            ["Check-out", time(visit.departureAt)],
            ["Duration", `${visit.durationMinutes} min`],
            [
              "GPS accuracy",
              visit.accuracy ? `±${Math.round(visit.accuracy)} m` : "—",
            ],
            [
              "Distance from shop",
              visit.distanceFromShopMeters == null
                ? "—"
                : `${Math.round(visit.distanceFromShopMeters)} m`,
            ],
            ["Allowed radius", `${visit.allowedRadiusMeters} m`],
            ["Order", money(visit.salesLkr)],
            ["Collected", money(visit.collectedLkr)],
            ["Outstanding", money(visit.outstandingBalanceLkr)],
            ["Follow-up", visit.followUpRequired ? "Required" : "No"],
          ].map(([label, value]) => (
            <Mini key={String(label)} label={String(label)} value={value} />
          ))}
        </div>
        <div className="mt-4 rounded-xl bg-slate-900/60 p-4 text-xs text-slate-300">
          <b>Check-in GPS</b>
          <p>
            {visit.latitude.toFixed(6)}, {visit.longitude.toFixed(6)}
          </p>
          <b className="mt-3 block">Check-out GPS</b>
          <p>
            {visit.checkoutLatitude == null
              ? "Not recorded"
              : `${visit.checkoutLatitude.toFixed(6)}, ${visit.checkoutLongitude?.toFixed(6)}`}
          </p>
          <b className="mt-3 block">Notes</b>
          <p>{visit.notes || "No notes recorded."}</p>
        </div>
        {visit.shopImageUrl && (
          <img
            className="mt-4 h-52 w-full rounded-xl object-cover"
            src={visit.shopImageUrl}
            alt={visit.shopName}
          />
        )}
        <div className="mt-4 space-y-2">
          {visit.orders.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border border-slate-700 p-3 text-xs text-slate-300"
            >
              <b className="text-white">Order {order.id}</b>
              <span className="float-right text-emerald-300">
                {money(order.totalLkr)}
              </span>
              <p>
                {order.products
                  .map((product) => `${product.name} × ${product.cases}`)
                  .join(", ")}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {!visit.gpsVerified && (
            <button
              disabled={busy}
              onClick={() => void askException()}
              className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white"
            >
              Request GPS Exception
            </button>
          )}
          {!visit.departureAt && visit.durationMinutes > 180 && (
            <button
              disabled={busy}
              onClick={() => void askCorrection()}
              className="rounded-xl border border-cyan-500/40 px-4 py-2 text-xs font-bold text-cyan-300"
            >
              Request Manual Correction
            </button>
          )}
        </div>
      </aside>
    </div>
  );
};
const SyncDrawer = ({
  count,
  gps,
  operations,
  close,
  retry,
}: {
  count: number;
  gps: number;
  operations: QueuedFieldOperation[];
  close: () => void;
  retry: () => Promise<void>;
}) => {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70" onMouseDown={close}>
      <aside
        onMouseDown={(event) => event.stopPropagation()}
        className="ml-auto h-full w-full max-w-md overflow-y-auto border-l border-slate-700 bg-[#07111F] p-5"
      >
        <div className="flex justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-white">Sync Center</h2>
            <p className="text-xs text-slate-400">
              Field data is retained until the server confirms it.
            </p>
          </div>
          <button onClick={close}>
            <X className="text-slate-400" />
          </button>
        </div>
        <div className="mt-5 rounded-xl bg-slate-900/60 p-4">
          <div className="flex items-center gap-3">
            {count ? (
              <CloudOff className="text-amber-400" />
            ) : (
              <Cloud className="text-emerald-400" />
            )}
            <div>
              <b className="text-white">{count ? "Sync Pending" : "Synced"}</b>
              <p className="text-xs text-slate-400">
                {count
                  ? `${count} records waiting`
                  : "All field records are synchronized"}
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <Mini label="Pending GPS points" value={gps} />
          {operations.map((operation) => (
            <div
              key={operation.id}
              className="rounded-xl border border-slate-700 p-3 text-xs"
            >
              <b className="text-white">
                {operation.kind.replaceAll("_", " ")}
              </b>
              <p
                className={
                  operation.status === "FAILED"
                    ? "text-rose-300"
                    : "text-slate-400"
                }
              >
                {operation.error ?? "Waiting to sync"} · {operation.attempts}{" "}
                retries
              </p>
            </div>
          ))}
        </div>
        {count > 0 && (
          <button
            disabled={busy || !navigator.onLine}
            onClick={async () => {
              setBusy(true);
              try {
                await retry();
              } finally {
                setBusy(false);
              }
            }}
            className="mt-5 w-full rounded-xl bg-indigo-600 p-3 text-sm font-black text-white disabled:opacity-50"
          >
            {busy ? "Retrying…" : "Retry Sync"}
          </button>
        )}
      </aside>
    </div>
  );
};
