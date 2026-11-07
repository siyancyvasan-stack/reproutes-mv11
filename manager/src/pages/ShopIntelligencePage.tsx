import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Gauge,
  Loader2,
  MapPin,
  Navigation,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Route,
  Search,
  Store,
  UserRound,
  X,
} from "lucide-react";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { FieldIntelligenceMap } from "../components/map/FieldIntelligenceMap";
import {
  loadFieldIntelligence,
  loadRouteReplay,
  type Intelligence,
  type PlannedStop,
} from "../services/fieldIntelligenceApi";
import { useToast } from "../context/ToastContext";

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) =>
  `LKR ${value.toLocaleString("en-LK", { maximumFractionDigits: 0 })}`;
const time = (value?: string | null) =>
  value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const age = (value?: string) => {
  if (!value) return "No GPS";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
};
const statusTone: Record<string, string> = {
  ONLINE: "bg-emerald-50 text-emerald-700",
  ON_VISIT: "bg-indigo-50 text-indigo-700",
  TRAVELLING: "bg-cyan-50 text-cyan-700",
  OFFLINE: "bg-slate-100 text-slate-500",
};

export const ShopIntelligencePage = () => {
  const { showToast } = useToast();
  const [date, setDate] = useState(today());
  const [territory, setTerritory] = useState("");
  const [visitStatus, setVisitStatus] = useState("");
  const [routeStatus, setRouteStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [data, setData] = useState<Intelligence>();
  const [loading, setLoading] = useState(true);
  const [selectedShopId, setSelectedShopId] = useState<string>();
  const [replay, setReplay] = useState<{
    points: Intelligence["selected"] extends infer _T
      ? Array<{
          latitude: number;
          longitude: number;
          capturedAt: string;
          speedKmH?: number;
        }>
      : never;
    index: number;
    playing: boolean;
  }>({ points: [], index: 0, playing: false });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await loadFieldIntelligence({
          date,
          territory,
          visitStatus,
          routeStatus,
          search: search.trim() || undefined,
          agentId: selectedAgentId,
        }),
      );
    } catch (error) {
      showToast(
        "Field intelligence unavailable",
        error instanceof Error ? error.message : "Please try again.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  }, [
    date,
    territory,
    visitStatus,
    routeStatus,
    search,
    selectedAgentId,
    showToast,
  ]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!selectedAgentId) {
      setReplay({ points: [], index: 0, playing: false });
      return;
    }
    void loadRouteReplay(selectedAgentId, date)
      .then((result) =>
        setReplay({ points: result.points, index: 0, playing: false }),
      )
      .catch(() => undefined);
  }, [date, selectedAgentId]);
  useEffect(() => {
    if (!replay.playing || replay.points.length < 2) return;
    const timer = window.setInterval(
      () =>
        setReplay((current) =>
          current.index >= current.points.length - 1
            ? { ...current, playing: false }
            : { ...current, index: current.index + 1 },
        ),
      350,
    );
    return () => window.clearInterval(timer);
  }, [replay.playing, replay.points.length]);
  const selectedAgent = data?.team.find(
    (agent) => agent.id === selectedAgentId,
  );
  const selected = data?.selected;
  const stops = selected?.plan?.stops ?? [];
  const selectedStop = stops.find((stop) => stop.shop.id === selectedShopId);
  const selectedVisit = selected?.report.visits.find(
    (visit) => visit.shopId === selectedShopId,
  );
  const territories = useMemo(
    () =>
      [
        ...new Set(
          (data?.team.map((agent) => agent.region).filter(Boolean) ??
            []) as string[],
        ),
      ].sort(),
    [data?.team],
  );
  const agentKpis = selected
    ? [
        [
          "Assigned Shops",
          stops.length || selected.report.kpis.uniqueShops,
          Store,
        ],
        ["Shops Visited", selected.report.kpis.uniqueShops, CheckCircle2],
        ["Remaining Shops", selected.comparison.remainingShops.length, Clock3],
        ["Route Complete", `${selected.comparison.completionPercent}%`, Route],
        ["Sales Today", money(selected.report.kpis.totalSalesLkr), Banknote],
        ["Distance", `${selected.report.kpis.distanceKm} km`, Navigation],
        [
          "Productive Time",
          `${selected.performance.productiveVisitMinutes} min`,
          Gauge,
        ],
      ]
    : [];
  const teamKpis = data
    ? [
        ["Active Agents", data.teamKpis.activeAgents, UserRound],
        ["Assigned Shops", data.teamKpis.assignedShops, Store],
        ["Completed Visits", data.teamKpis.completedVisits, CheckCircle2],
        ["Sales Today", money(data.teamKpis.salesLkr), Banknote],
        ["Distance", `${data.teamKpis.distanceKm} km`, Navigation],
      ]
    : [];
  const kpis = selected ? agentKpis : teamKpis;
  return (
    <ManagerLayout>
      <section className="space-y-5 pb-8">
        <header className="flex flex-col justify-between gap-4 py-2 sm:py-3 border-b border-slate-200/60 lg:flex-row lg:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[.2em] text-cyan-600">
              Field sales intelligence
            </p>
            <h1 className="text-3xl font-black">Shop Intelligence</h1>
            <p className="text-sm text-slate-500">
              Live field teams, verified shop visits, route compliance and sales
              productivity.
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-2.5 text-sm font-bold text-slate-600 shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh data
          </button>
        </header>
        <div className="glass-panel rounded-2xl p-4">
          <div className="flex flex-col gap-3 xl:flex-row">
            <label className="relative">
              <CalendarDays className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                type="date"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  setSelectedShopId(undefined);
                }}
                className="input min-w-40 pl-9"
              />
            </label>
            <select
              value={territory}
              onChange={(event) => setTerritory(event.target.value)}
              className="input min-w-40"
            >
              <option value="">All territories</option>
              {territories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <select
              value={selectedAgentId ?? ""}
              onChange={(event) => {
                setSelectedAgentId(event.target.value || undefined);
                setSelectedShopId(undefined);
              }}
              className="input min-w-44"
            >
              <option value="">All salespeople</option>
              {data?.team.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <select
              value={visitStatus}
              onChange={(event) => setVisitStatus(event.target.value)}
              className="input min-w-44"
            >
              <option value="">All visit statuses</option>
              <option value="VISITED">Visited</option>
              <option value="PENDING">Pending</option>
              <option value="MISSED">Missed</option>
              <option value="FOLLOW_UP">Follow-up Required</option>
            </select>
            <select
              value={routeStatus}
              onChange={(event) => setRouteStatus(event.target.value)}
              className="input min-w-40"
            >
              <option value="">All route statuses</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="DEVIATED">Deviated</option>
            </select>
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search salesperson or shop"
                className="input w-full pl-9"
              />
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
          {kpis.map(([label, value, Icon]) => (
            <article
              key={String(label)}
              className="glass-panel rounded-2xl p-4"
            >
              <span className="mb-2 grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                <Icon className="h-4 w-4" />
              </span>
              <p className="text-[10px] font-bold uppercase text-slate-400">
                {label as string}
              </p>
              <p className="mt-1 text-lg font-black text-slate-800">
                {value as string | number}
              </p>
            </article>
          ))}
        </div>
        <section className="glass-panel rounded-2xl p-4">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <h2 className="font-black text-slate-800">
                Today&apos;s Field Team
              </h2>
              <p className="text-xs text-slate-400">
                Agents with field sessions or assigned routes on {date}
              </p>
            </div>
            {selectedAgentId && (
              <button
                onClick={() => {
                  setSelectedAgentId(undefined);
                  setSelectedShopId(undefined);
                }}
                className="inline-flex items-center gap-1 text-xs font-bold text-slate-500"
              >
                <X className="h-3.5 w-3.5" />
                Team view
              </button>
            )}
          </div>
          {loading && !data ? (
            <div className="grid min-h-32 place-items-center">
              <Loader2 className="h-7 w-7 animate-spin text-indigo-600" />
            </div>
          ) : data?.team.length ? (
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {data.team.map((agent) => (
                <article
                  key={agent.id}
                  className={`rounded-xl border p-3 transition ${selectedAgentId === agent.id ? "border-indigo-400 bg-indigo-50/70 ring-2 ring-indigo-100" : "border-slate-100 bg-white/60 hover:border-indigo-200"}`}
                >
                  <div className="flex gap-3">
                    <ProfileAvatar
                      src={agent.avatarUrl}
                      name={agent.name}
                      className="h-11 w-11 rounded-xl"
                    />
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => {
                          setSelectedAgentId(agent.id);
                          setSelectedShopId(undefined);
                        }}
                        className="truncate text-left text-sm font-black text-indigo-700 hover:underline"
                      >
                        {agent.name}
                      </button>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[9px] font-black ${statusTone[agent.status]}`}
                        >
                          {agent.status.replaceAll("_", " ")}
                        </span>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-500">
                          Start {time(agent.startTime)}
                        </span>
                      </div>
                    </div>
                    <p className="text-right text-[10px] font-bold text-slate-400">
                      GPS
                      <br />
                      <span className="text-slate-600">
                        {age(agent.lastGpsAt)}
                      </span>
                    </p>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                    <div>
                      <b className="text-sm text-slate-800">
                        {agent.completedVisits}/{agent.assignedShops}
                      </b>
                      <p className="text-[9px] text-slate-400">Visited</p>
                    </div>
                    <div>
                      <b className="text-sm text-indigo-700">
                        {agent.routeCompletionPercent}%
                      </b>
                      <p className="text-[9px] text-slate-400">Route</p>
                    </div>
                    <div>
                      <b className="text-sm text-emerald-700">
                        {money(agent.salesLkr)}
                      </b>
                      <p className="text-[9px] text-slate-400">Sales</p>
                    </div>
                    <div>
                      <b className="text-sm text-cyan-700">
                        {agent.distanceKm} km
                      </b>
                      <p className="text-[9px] text-slate-400">Distance</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-slate-400">
              No field sessions or route assignments were found for this date.
            </p>
          )}
        </section>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(330px,.75fr)]">
          <section className="glass-panel relative overflow-hidden rounded-2xl">
            {loading && (
              <div className="absolute inset-0 z-[500] grid place-items-center bg-white/60">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
              </div>
            )}
            <FieldIntelligenceMap
              agent={selectedAgent}
              stops={stops}
              report={selected?.report}
              replayPoint={replay.points[replay.index]}
              onSelectShop={setSelectedShopId}
            />
            <div className="pointer-events-none absolute bottom-4 left-4 z-[400] flex flex-wrap gap-2 rounded-xl bg-white/90 p-2 text-[9px] font-bold text-slate-600 shadow">
              <span>🟢 Visited</span>
              <span>🟠 Pending</span>
              <span>🔴 Missed</span>
              <span className="text-violet-700">━ Actual</span>
              <span className="text-slate-500">┄ Planned</span>
            </div>
          </section>
          <aside className="glass-panel max-h-[500px] overflow-y-auto rounded-2xl p-4">
            {selectedShopId ? (
              <ShopDetails
                stop={selectedStop}
                visit={selectedVisit}
                agentName={selected?.report.agent.name}
                onClose={() => setSelectedShopId(undefined)}
              />
            ) : selected ? (
              <>
                <h2 className="font-black text-slate-800">Agent Performance</h2>
                <p className="text-xs text-slate-400">
                  Operational context for {selected.report.agent.name}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {[
                    [
                      "Visit completion",
                      `${selected.comparison.completionPercent}%`,
                    ],
                    [
                      "GPS verified",
                      `${selected.performance.gpsVerifiedVisits}/${selected.report.visits.length}`,
                    ],
                    [
                      "Sales generated",
                      money(selected.report.kpis.totalSalesLkr),
                    ],
                    [
                      "Average visit",
                      `${selected.performance.averageVisitMinutes} min`,
                    ],
                    [
                      "Productive visits",
                      selected.performance.productiveVisits,
                    ],
                    ["No-sale visits", selected.performance.noSaleVisits],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-xl bg-slate-50 p-3"
                    >
                      <p className="text-[9px] font-bold uppercase text-slate-400">
                        {label}
                      </p>
                      <b className="text-sm text-slate-800">{value}</b>
                    </div>
                  ))}
                </div>
                <h3 className="mt-5 text-xs font-black uppercase text-slate-400">
                  Alerts
                </h3>
                <div className="mt-2 space-y-2">
                  {selected.alerts.length ? (
                    selected.alerts.map((alert) => (
                      <div
                        key={alert.id}
                        className="flex gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800"
                      >
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        {alert.message}
                      </div>
                    ))
                  ) : (
                    <p className="rounded-lg bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
                      No operational alerts
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className="grid min-h-80 place-items-center text-center">
                <div>
                  <MapPin className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm font-bold text-slate-600">
                    Select a salesperson
                  </p>
                  <p className="text-xs text-slate-400">
                    Their live route and shop intelligence will appear here.
                  </p>
                </div>
              </div>
            )}
          </aside>
        </div>
        {selected && (
          <>
            <section className="glass-panel rounded-2xl p-4">
              <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
                <div>
                  <h2 className="font-black text-slate-800">Visited Shops</h2>
                  <p className="text-xs text-slate-400">
                    Complete activity for {selected.report.agent.name} on {date}
                  </p>
                </div>
                <p className="text-xs font-bold text-slate-500">
                  {selected.report.visits.length} visit
                  {selected.report.visits.length === 1 ? "" : "s"} · Signed out{" "}
                  {time(selected.report.kpis.punchOut)}
                </p>
              </div>
              {selected.report.visits.length ? (
                <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {selected.report.visits.map((visit) => (
                    <button
                      key={visit.id}
                      onClick={() => setSelectedShopId(visit.shopId)}
                      className={`rounded-xl border bg-white/70 p-3 text-left transition hover:border-indigo-300 hover:shadow-sm ${selectedShopId === visit.shopId ? "border-indigo-400 ring-2 ring-indigo-100" : "border-slate-100"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-800">
                            {visit.shopName}
                          </p>
                          <p className="truncate text-[11px] text-slate-500">
                            {visit.address}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${visit.gpsVerified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                        >
                          {visit.gpsVerified ? "GPS VERIFIED" : "GPS REVIEW"}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[10px] sm:grid-cols-4">
                        <div>
                          <p className="text-slate-400">Arrival</p>
                          <b className="text-slate-700">
                            {time(visit.arrivalAt)}
                          </b>
                        </div>
                        <div>
                          <p className="text-slate-400">Departure</p>
                          <b className="text-slate-700">
                            {time(visit.departureAt)}
                          </b>
                        </div>
                        <div>
                          <p className="text-slate-400">Duration</p>
                          <b className="text-slate-700">
                            {visit.durationMinutes} min
                          </b>
                        </div>
                        <div>
                          <p className="text-slate-400">Sales</p>
                          <b className="text-emerald-700">
                            {money(visit.salesLkr)}
                          </b>
                        </div>
                      </div>
                      <p className="mt-3 text-[10px] font-bold text-indigo-600">
                        View complete visit details →
                      </p>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-slate-50 py-8 text-center text-sm text-slate-500">
                  No completed shop visits were recorded for this salesperson on
                  this date.
                </p>
              )}
            </section>
            <section className="glass-panel rounded-2xl p-4">
              <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div>
                  <h2 className="font-black text-slate-800">Replay Route</h2>
                  <p className="text-xs text-slate-400">
                    Replay recorded GPS positions for {date}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setReplay((value) => ({
                        ...value,
                        playing: !value.playing,
                      }))
                    }
                    disabled={!replay.points.length}
                    className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 text-white disabled:opacity-40"
                  >
                    {replay.playing ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() =>
                      setReplay((value) => ({
                        ...value,
                        index: 0,
                        playing: false,
                      }))
                    }
                    className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <span className="min-w-20 text-xs font-bold text-slate-500">
                    {time(replay.points[replay.index]?.capturedAt)}
                  </span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0, replay.points.length - 1)}
                value={replay.index}
                onChange={(event) =>
                  setReplay((value) => ({
                    ...value,
                    index: Number(event.target.value),
                    playing: false,
                  }))
                }
                className="mt-4 w-full accent-indigo-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>{time(replay.points[0]?.capturedAt)}</span>
                <span>{replay.points.length} GPS points</span>
                <span>{time(replay.points.at(-1)?.capturedAt)}</span>
              </div>
            </section>
            <div className="grid gap-5 xl:grid-cols-2">
              <section className="glass-panel rounded-2xl p-5">
                <h2 className="font-black text-slate-800">
                  Planned vs Actual Route
                </h2>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["Completion", `${selected.comparison.completionPercent}%`],
                    ["Planned", `${selected.comparison.plannedDistanceKm} km`],
                    ["Actual", `${selected.comparison.actualDistanceKm} km`],
                    ["Deviation", `${selected.comparison.deviationKm} km`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[9px] uppercase text-slate-400">
                        {label}
                      </p>
                      <b className="text-sm text-slate-800">{value}</b>
                    </div>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  {stops.map((stop) => (
                    <button
                      key={stop.id}
                      onClick={() => setSelectedShopId(stop.shop.id)}
                      className="flex w-full items-center gap-3 rounded-lg border border-slate-100 p-2 text-left"
                    >
                      <span
                        className={`grid h-7 w-7 place-items-center rounded-full text-xs font-black text-white ${stop.status === "VISITED" ? "bg-emerald-500" : stop.status === "MISSED" ? "bg-red-500" : "bg-amber-500"}`}
                      >
                        {stop.sequence}
                      </span>
                      <span className="flex-1 text-xs font-bold text-slate-700">
                        {stop.shop.name}
                      </span>
                      <span className="text-[9px] font-bold text-slate-400">
                        {stop.status}
                      </span>
                    </button>
                  ))}
                </div>
                {selected.comparison.unplannedVisits.length > 0 && (
                  <p className="mt-3 rounded-lg bg-violet-50 p-2 text-xs text-violet-700">
                    Unplanned:{" "}
                    {selected.comparison.unplannedVisits
                      .map((visit) => visit.shopName)
                      .join(", ")}
                  </p>
                )}
              </section>
              <section className="glass-panel rounded-2xl p-5">
                <h2 className="font-black text-slate-800">
                  Today&apos;s Journey Timeline
                </h2>
                <p className="text-xs text-slate-400">
                  Generated from attendance, visits, GPS and sales records
                </p>
                <div className="mt-4 max-h-[520px] overflow-y-auto pr-2">
                  {selected.report.timeline.map((event, index) => (
                    <div key={event.id} className="flex gap-3 pb-4">
                      <div className="flex flex-col items-center">
                        <span className="mt-1 h-3 w-3 rounded-full border-2 border-cyan-300 bg-cyan-500" />
                        {index < selected.report.timeline.length - 1 && (
                          <span className="w-px flex-1 bg-slate-200" />
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] font-black text-cyan-600">
                          {time(event.at)}
                        </p>
                        <button
                          onClick={() =>
                            event.shopId && setSelectedShopId(event.shopId)
                          }
                          className="text-left text-xs font-bold text-slate-800 hover:text-indigo-600"
                        >
                          {event.title}
                        </button>
                        {event.detail && (
                          <p className="text-[11px] text-slate-400">
                            {event.detail}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </section>
    </ManagerLayout>
  );
};

const ShopDetails = ({
  stop,
  visit,
  agentName,
  onClose,
}: {
  stop?: PlannedStop;
  visit?: NonNullable<Intelligence["selected"]>["report"]["visits"][number];
  agentName?: string;
  onClose: () => void;
}) => {
  const shop = stop?.shop;
  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] font-black uppercase text-cyan-600">
            Shop visit details
          </p>
          <h2 className="font-black text-slate-800">
            {shop?.name ?? visit?.shopName ?? "Shop"}
          </h2>
          <p className="text-xs text-slate-400">
            {shop ? `${shop.address}, ${shop.city}` : visit?.address}
          </p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-4 space-y-2 text-xs">
        {[
          ["Assigned salesperson", agentName ?? "—"],
          ["Visit status", stop?.status ?? (visit ? "VISITED" : "—")],
          ["Arrival", time(visit?.arrivalAt)],
          ["Departure", time(visit?.departureAt)],
          ["Visit duration", visit ? `${visit.durationMinutes} min` : "—"],
          [
            "GPS verification",
            visit
              ? visit.gpsVerified
                ? "GPS Verified"
                : "Outside Shop Location"
              : "Pending",
          ],
          [
            "Distance at check-in",
            visit?.distanceFromShopMeters == null
              ? "—"
              : `${Math.round(visit.distanceFromShopMeters)} m`,
          ],
          ["Order value", money(visit?.salesLkr ?? 0)],
          ["Payment collected", money(visit?.collectedLkr ?? 0)],
          ["Outstanding", money(shop?.outstandingBalanceLkr ?? 0)],
          [
            "Next planned visit",
            stop?.plannedArrivalTime
              ? new Date(stop.plannedArrivalTime).toLocaleString()
              : "Not scheduled",
          ],
        ].map(([label, value]) => (
          <p
            key={String(label)}
            className="flex justify-between gap-3 border-b border-slate-100 py-2"
          >
            <span className="text-slate-400">{label}</span>
            <b className="text-right text-slate-700">{value}</b>
          </p>
        ))}
      </div>
      <div className="mt-4 rounded-xl bg-slate-50 p-3">
        <p className="text-[10px] font-black uppercase text-slate-400">
          Visit notes
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {visit?.notes || "No notes recorded."}
        </p>
      </div>
      {visit?.shopImageUrl && (
        <img
          src={visit.shopImageUrl}
          alt="Visit evidence"
          className="mt-4 h-36 w-full rounded-xl object-cover"
        />
      )}
    </>
  );
};
