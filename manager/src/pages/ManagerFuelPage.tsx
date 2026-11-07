import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  FileSearch,
  Fuel,
  Gauge,
  MapPinned,
  Plus,
  Search,
  WalletCards,
  XCircle,
} from "lucide-react";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { useToast } from "../context/ToastContext";
import {
  DailyFuelRecord,
  FuelEntry,
  FuelStatus,
  fuelApi,
} from "../services/fuelApi";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FuelFillMap } from "../components/map/FuelFillMap";
import { loadAgents } from "../services/domainApi";
import { useLiveAgentTracking } from "../hooks/useLiveAgentTracking";
import type { Agent } from "../types";
import { ExportButton } from "../components/common/ExportButton";

const money = (value: number) =>
  `LKR ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const badge: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-700",
  VERIFIED: "bg-violet-100 text-violet-700",
  REJECTED: "bg-rose-100 text-rose-700",
  FLAGGED: "bg-amber-100 text-amber-700",
  SUBMITTED: "bg-blue-100 text-blue-700",
  DRAFT: "bg-slate-100 text-slate-600",
};

export const ManagerFuelPage: React.FC = () => {
  const { showToast } = useToast();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fuelApi.dashboard>
  > | null>(null);
  const [directoryAgents, setDirectoryAgents] = useState<Agent[]>([]);
  const { agents: liveAgents } = useLiveAgentTracking(directoryAgents);
  const [selected, setSelected] = useState<FuelEntry | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fuelFilter, setFuelFilter] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<{
    receipt?: string;
    fuelPhoto?: string;
  }>({});
  const [showSetup, setShowSetup] = useState(false);
  const [budget, setBudget] = useState("250000");
  const [vehicle, setVehicle] = useState({
    vehicleNumber: "",
    vehicleType: "Car",
    fuelType: "PETROL",
    tankCapacity: "45",
    expectedKmL: "12",
    minimumKmL: "7",
    maximumKmL: "22",
    currentOdometer: "0",
  });
  const today = new Date().toISOString().slice(0, 10);
  const [dailyFrom, setDailyFrom] = useState(today);
  const [dailyTo, setDailyTo] = useState(today);
  const [daily, setDaily] = useState<DailyFuelRecord[]>([]);
  const load = () =>
    Promise.all([fuelApi.dashboard(), fuelApi.daily(dailyFrom, dailyTo)])
      .then(([dashboard, records]) => {
        setData(dashboard);
        setDaily(records);
      })
      .catch((e) => showToast("Fuel data unavailable", e.message, "error"));
  useEffect(() => {
    void load();
  }, [dailyFrom, dailyTo]);
  useEffect(() => {
    const refresh = () => {
      void loadAgents([])
        .then(setDirectoryAgents)
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setEvidenceUrls({});
    if (!selected) return;
    void Promise.all([
      selected.receipt
        ? fuelApi
            .receipt(selected.id)
            .then((blob) => ["receipt", blob] as const)
        : null,
      selected.fuelPhoto
        ? fuelApi
            .fuelPhoto(selected.id)
            .then((blob) => ["fuelPhoto", blob] as const)
        : null,
    ])
      .then((items) => {
        if (!active) return;
        const next: Record<string, string> = {};
        items.forEach((item) => {
          if (item) {
            const url = URL.createObjectURL(item[1]);
            urls.push(url);
            next[item[0]] = url;
          }
        });
        setEvidenceUrls(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selected?.id]);
  const rows = useMemo(
    () =>
      (data?.entries ?? []).filter(
        (entry) =>
          `${entry.salesperson?.name} ${entry.vehicle.vehicleNumber} ${entry.fuelStation}`
            .toLowerCase()
            .includes(search.toLowerCase()) &&
          (!statusFilter || entry.status === statusFilter) &&
          (!fuelFilter || entry.fuelType === fuelFilter),
      ),
    [data, search, statusFilter, fuelFilter],
  );
  const openReceipt = async () => {
    if (!selected?.receipt) return;
    try {
      const blob = await fuelApi.receipt(selected.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      showToast(
        "Receipt unavailable",
        e instanceof Error ? e.message : "Unable to open receipt.",
        "error",
      );
    }
  };
  const openQrImage = async () => {
    if (!selected?.qrEvidence) return;
    try {
      const blob = await fuelApi.qrImage(selected.id);
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      showToast(
        "QR image unavailable",
        e instanceof Error ? e.message : "Unable to open QR image.",
        "error",
      );
    }
  };
  const openClaim = async (entry: FuelEntry) => {
    try {
      setSelected(await fuelApi.detail(entry.id));
    } catch {
      setSelected(entry);
    }
  };
  const review = async (status: FuelStatus) => {
    if (!selected) return;
    setBusy(true);
    try {
      await fuelApi.review(selected.id, status, comment);
      showToast("Claim updated", `Status changed to ${status}.`, "success");
      setSelected(null);
      setComment("");
      await load();
    } catch (e) {
      showToast(
        "Review failed",
        e instanceof Error ? e.message : "Please try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveSetup = async () => {
    setBusy(true);
    try {
      await fuelApi.saveBudget(Number(budget));
      if (vehicle.vehicleNumber)
        await fuelApi.createVehicle({
          ...vehicle,
          tankCapacity: Number(vehicle.tankCapacity),
          expectedKmL: Number(vehicle.expectedKmL),
          minimumKmL: Number(vehicle.minimumKmL),
          maximumKmL: Number(vehicle.maximumKmL),
          currentOdometer: Number(vehicle.currentOdometer),
        });
      showToast(
        "Fuel settings saved",
        "Budget and vehicle configuration are active.",
        "success",
      );
      setShowSetup(false);
      await load();
    } catch (e) {
      showToast(
        "Could not save",
        e instanceof Error ? e.message : "Please check the values.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const k = data?.kpis;
  const budgetUsed = k?.monthlyBudget
    ? Math.min(100, ((k.totalCost ?? 0) / k.monthlyBudget) * 100)
    : 0;
  return (
    <ManagerLayout wide>
      <section className="space-y-5">
        <div className="flex flex-col justify-between gap-4 py-2 sm:py-3 border-b border-slate-200/60 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.24em] text-cyan-600">
              Fleet expense control
            </p>
            <h1 className="text-3xl font-black text-slate-900">
              Fuel Management
            </h1>
            <p className="text-slate-500 mt-1">
              Claims, vehicles, budgets and efficiency in one audit-ready
              workspace.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <ExportButton
              dataset="fuel"
              pdf
              formats={["xlsx", "csv", "pdf"]}
              filters={{
                from: dailyFrom,
                to: dailyTo,
                status: statusFilter,
                fuelType: fuelFilter,
                search,
              }}
              light
            />
            <button
              onClick={() => setShowSetup(!showSetup)}
              className="glass-button-primary flex min-h-11 items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white"
            >
              <Plus size={17} /> Budget & vehicle
            </button>
          </div>
        </div>
        {showSetup && (
          <GlassCard className="p-5 grid md:grid-cols-4 gap-3">
            <label className="text-xs font-bold text-slate-600">
              Monthly budget
              <input
                className="mt-1 w-full rounded-xl border p-2.5"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
            {Object.entries(vehicle).map(([key, value]) => (
              <label
                key={key}
                className="text-xs font-bold text-slate-600 capitalize"
              >
                {key.replace(/([A-Z])/g, " $1")}
                <input
                  className="mt-1 w-full rounded-xl border p-2.5"
                  value={value}
                  onChange={(e) =>
                    setVehicle((v) => ({ ...v, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
            <button
              disabled={busy}
              onClick={saveSetup}
              className="self-end rounded-xl bg-indigo-600 p-3 font-bold text-white"
            >
              Save configuration
            </button>
          </GlassCard>
        )}
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[
            [
              "Monthly Budget",
              money(k?.monthlyBudget ?? 0),
              WalletCards,
              "bg-indigo-100 text-indigo-600",
            ],
            [
              "Fuel Cost",
              money(k?.totalCost ?? 0),
              Fuel,
              "bg-cyan-100 text-cyan-600",
            ],
            [
              "Distance",
              `${(k?.distance ?? 0).toFixed(0)} km`,
              Gauge,
              "bg-emerald-100 text-emerald-600",
            ],
            [
              "Needs Attention",
              `${k?.pending ?? 0} pending · ${k?.suspicious ?? 0} flagged`,
              AlertTriangle,
              "bg-amber-100 text-amber-600",
            ],
          ].map(([label, value, Icon, color]) => (
            <GlassCard key={String(label)} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {label as string}
                  </p>
                  <p className="mt-1.5 text-xl font-black">{value as string}</p>
                </div>
                <span
                  className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${color as string}`}
                >
                  <Icon size={20} />
                </span>
              </div>
              {label === "Monthly Budget" && (
                <div className="mt-4">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-indigo-500"
                      style={{ width: `${budgetUsed}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] font-semibold text-slate-500">
                    {budgetUsed.toFixed(0)}% used this month
                  </p>
                </div>
              )}
            </GlassCard>
          ))}
        </div>
        <GlassCard className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-black text-lg">Daily tank & mileage</h2>
              <p className="text-xs text-slate-500">
                Vehicle shift readings, approved fuel additions and calculated
                efficiency.
              </p>
            </div>
            <div className="flex gap-2">
              <label className="text-xs font-bold text-slate-500">
                From
                <input
                  type="date"
                  value={dailyFrom}
                  onChange={(e) => setDailyFrom(e.target.value)}
                  className="input block"
                />
              </label>
              <label className="text-xs font-bold text-slate-500">
                To
                <input
                  type="date"
                  value={dailyTo}
                  onChange={(e) => setDailyTo(e.target.value)}
                  className="input block"
                />
              </label>
            </div>
          </div>
          {daily.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    {[
                      "Date",
                      "Vehicle",
                      "Salesperson",
                      "Opening Fuel",
                      "Fuel Added",
                      "Current / Closing",
                      "Fuel Used",
                      "KM Today",
                      "Average km/L",
                      "Opening Odometer",
                      "Closing Odometer",
                      "Status",
                      "Evidence",
                    ].map((h) => (
                      <th key={h} className="px-4 py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {daily.map((record) => (
                    <tr
                      key={record.id}
                      className="border-t hover:bg-cyan-50/40"
                    >
                      <td className="px-4 py-3">
                        {new Date(record.recordDate).toLocaleDateString()}
                      </td>
                      <td className="px-4 font-bold">
                        {record.vehicle.vehicleNumber}
                      </td>
                      <td className="px-4">{record.salesperson.name}</td>
                      <td className="px-4">
                        {record.openingFuelLiters.toFixed(1)} L
                      </td>
                      <td className="px-4 text-cyan-700 font-bold">
                        +{record.fuelAddedLiters.toFixed(1)} L
                      </td>
                      <td className="px-4">
                        {record.closingFuelLiters?.toFixed(1) ?? "Open"}
                        {record.closingFuelLiters != null ? " L" : ""}
                      </td>
                      <td className="px-4">
                        {record.fuelUsedLiters?.toFixed(1) ?? "—"} L
                      </td>
                      <td className="px-4">
                        {record.distanceTravelled?.toFixed(1) ?? "—"} km
                      </td>
                      <td className="px-4 font-bold">
                        {record.fuelEfficiencyKmL?.toFixed(2) ?? "—"}
                      </td>
                      <td className="px-4">
                        {record.openingOdometer.toLocaleString()}
                      </td>
                      <td className="px-4">
                        {record.closingOdometer?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-4">
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-black ${record.status === "FLAGGED" ? "bg-amber-100 text-amber-700" : record.status === "OPEN" ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}
                        >
                          {record.status}
                        </span>
                        {record.anomalyReasons?.map((reason) => (
                          <p
                            key={reason}
                            className="mt-1 text-[9px] font-bold text-amber-700"
                          >
                            {reason.replaceAll("_", " ")}
                          </p>
                        ))}
                      </td>
                      <td className="px-4">
                        <div className="flex gap-2">
                          {record.photos.map((photo) => (
                            <button
                              key={photo.kind}
                              onClick={async () => {
                                const blob = await fuelApi.dailyPhoto(
                                  record.id,
                                  photo.kind.toLowerCase() as
                                    "opening" | "closing",
                                );
                                const url = URL.createObjectURL(blob);
                                window.open(url, "_blank");
                                window.setTimeout(
                                  () => URL.revokeObjectURL(url),
                                  60000,
                                );
                              }}
                              className="font-bold text-cyan-700"
                            >
                              {photo.kind}
                            </button>
                          ))}
                          {record.photos.length > 0 && (
                            <button
                              onClick={async () => {
                                await fuelApi.flagDaily(
                                  record.id,
                                  "PHOTO_ENTRY_MISMATCH",
                                );
                                await load();
                              }}
                              className="font-bold text-amber-700"
                            >
                              Flag mismatch
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Gauge}
              title="No mileage records"
              description="Vehicle shift readings for the selected date range will appear here."
            />
          )}
        </GlassCard>
        <div className="grid xl:grid-cols-[1fr_320px] gap-5">
          <GlassCard className="overflow-hidden">
            <div className="p-5 border-b flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-3 justify-between">
                <div>
                  <h2 className="font-black text-lg">Fuel claims</h2>
                  <p className="text-xs text-slate-500">
                    Select a row to inspect and approve.
                  </p>
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-3 w-4 text-slate-400" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search claim"
                    className="rounded-xl border py-2.5 pl-9 pr-3 text-sm"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-xl border px-3 py-2 text-xs"
                >
                  <option value="">All statuses</option>
                  {[
                    "SUBMITTED",
                    "UNDER_REVIEW",
                    "APPROVED",
                    "REJECTED",
                    "FLAGGED",
                    "REIMBURSED",
                  ].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <select
                  value={fuelFilter}
                  onChange={(e) => setFuelFilter(e.target.value)}
                  className="rounded-xl border px-3 py-2 text-xs"
                >
                  <option value="">All fuel types</option>
                  <option>PETROL</option>
                  <option>DIESEL</option>
                  <option>OTHER</option>
                </select>
              </div>
            </div>
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      {[
                        "Date",
                        "Salesperson",
                        "Vehicle",
                        "Station",
                        "Liters",
                        "Tank fill",
                        "Amount",
                        "Receipt",
                        "Fuel Photo",
                        "QR Status",
                        "GPS",
                        "Odometer",
                        "Approval Status",
                      ].map((h) => (
                        <th key={h} className="px-4 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((entry) => (
                      <tr
                        key={entry.id}
                        onClick={() => void openClaim(entry)}
                        className="border-t hover:bg-cyan-50/50 cursor-pointer"
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          {new Date(
                            entry.purchasedAt ?? entry.createdAt,
                          ).toLocaleString()}
                        </td>
                        <td className="px-4 font-semibold">
                          {entry.salesperson?.name}
                        </td>
                        <td className="px-4">{entry.vehicle.vehicleNumber}</td>
                        <td className="px-4">{entry.fuelStation}</td>
                        <td className="px-4">{entry.liters.toFixed(1)} L</td>
                        <td className="px-4">
                          <span
                            className={`rounded-full px-2 py-1 text-[10px] font-black ${entry.isFullTank ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                          >
                            {entry.isFullTank ? "FULL TANK" : "PARTIAL"}
                          </span>
                        </td>
                        <td className="px-4 font-bold">
                          {money(Number(entry.totalAmount))}
                        </td>
                        <td className="px-4">
                          {entry.receipt ? "Attached" : "Missing"}
                        </td>
                        <td className="px-4">
                          {entry.fuelPhoto ? "Attached" : "Missing"}
                        </td>
                        <td className="px-4 font-bold">
                          {entry.qrStatus ?? "UNVERIFIED"}
                        </td>
                        <td className="px-4">
                          {entry.gpsStatus.replaceAll("_", " ")}
                        </td>
                        <td className="px-4">
                          {entry.odometerReading.toLocaleString()} km
                        </td>
                        <td className="px-4">
                          <span
                            className={`rounded-full px-2 py-1 text-[10px] font-black ${badge[entry.status]}`}
                          >
                            {entry.status === "SUBMITTED"
                              ? "PENDING"
                              : entry.status.replace("_", " ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon={FileSearch}
                title={
                  search || statusFilter || fuelFilter
                    ? "No matching claims"
                    : "No fuel claims yet"
                }
                description={
                  search || statusFilter || fuelFilter
                    ? "Try clearing your search or filters."
                    : "Claims submitted by sales agents will appear here for review."
                }
              />
            )}
          </GlassCard>
          <div className="space-y-5">
            <GlassCard className="p-5">
              <h2 className="font-black">Efficiency analytics</h2>
              <div className="mt-4 space-y-4">
                <Metric
                  label="Fleet average"
                  value={`${(k?.averageKmL ?? 0).toFixed(1)} km/L`}
                />
                <Metric
                  label="Cost per kilometre"
                  value={money(k?.costPerKm ?? 0)}
                />
                <Metric
                  label="Purchased / expected"
                  value={`${(k?.liters ?? 0).toFixed(1)} / ${(k?.estimatedConsumed ?? 0).toFixed(1)} L`}
                />
                <Metric
                  label="Budget remaining"
                  value={money(k?.remainingBudget ?? 0)}
                />
              </div>
            </GlassCard>
            <GlassCard className="p-5">
              <h2 className="font-black">Salesperson spend</h2>
              {data?.bySalesperson.map((person) => (
                <div
                  key={person.name}
                  className="mt-3 flex justify-between text-sm"
                >
                  <span>{person.name}</span>
                  <b>{money(person.cost)}</b>
                </div>
              ))}
            </GlassCard>
          </div>
        </div>
        <div className="grid xl:grid-cols-2 gap-5">
          <GlassCard className="p-4">
            <h2 className="font-black mb-3">Monthly fuel cost trend</h2>
            {data?.monthlyTrend?.length ? (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.monthlyTrend}>
                    <CartesianGrid
                      stroke="#e2e8f0"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <Tooltip formatter={(value) => money(Number(value))} />
                    <Bar dataKey="cost" fill="#4f46e5" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                compact
                icon={BarChart3}
                title="No cost trend yet"
                description="Monthly spending will appear after fuel claims are approved."
              />
            )}
          </GlassCard>
          <GlassCard className="p-4">
            <h2 className="font-black mb-3">Vehicle efficiency</h2>
            {data?.byVehicle?.length ? (
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.byVehicle}>
                    <CartesianGrid
                      stroke="#e2e8f0"
                      strokeDasharray="3 3"
                      vertical={false}
                    />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} />
                    <YAxis axisLine={false} tickLine={false} />
                    <Tooltip />
                    <Bar
                      dataKey="efficiencyKmL"
                      fill="#06b6d4"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState
                compact
                icon={Gauge}
                title="No efficiency data yet"
                description="Complete vehicle mileage records to calculate efficiency."
              />
            )}
          </GlassCard>
        </div>
        <GlassCard className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <MapPinned size={18} className="text-cyan-600" />
            <h2 className="font-black">Fuel purchase locations</h2>
          </div>
          <FuelFillMap entries={data?.entries ?? []} agents={liveAgents} />
        </GlassCard>
      </section>
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 grid place-items-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-auto p-6"
          >
            <div className="flex justify-between">
              <div>
                <p className="text-xs font-bold text-cyan-600">CLAIM REVIEW</p>
                <h2 className="text-xl font-black">
                  {selected.vehicle.vehicleNumber} ·{" "}
                  {selected.salesperson?.name}
                </h2>
                <p className="text-xs text-slate-500">
                  Submitted{" "}
                  {new Date(
                    selected.purchasedAt ?? selected.createdAt,
                  ).toLocaleString()}
                </p>
              </div>
              <button onClick={() => setSelected(null)}>×</button>
            </div>
            <div className="mt-5 grid sm:grid-cols-2 gap-4">
              <Evidence
                title="Receipt image"
                url={evidenceUrls.receipt}
                fallback={
                  selected.receipt ? "Loading secure image…" : "Missing"
                }
              />
              <Evidence
                title="Fuel filling image"
                url={evidenceUrls.fuelPhoto}
                fallback={
                  selected.fuelPhoto ? "Loading secure image…" : "Missing"
                }
              />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-5 text-sm">
              <Metric label="Station" value={selected.fuelStation} />
              <Metric
                label="Fuel"
                value={`${selected.fuelType} · ${selected.liters} L`}
              />
              <Metric
                label="Tank fill"
                value={selected.isFullTank ? "FULL TANK" : "PARTIAL FILL"}
              />
              <Metric
                label="Tank capacity"
                value={`${selected.vehicle.tankCapacity} L`}
              />
              <Metric
                label="Filled / capacity"
                value={`${selected.liters.toFixed(1)} / ${selected.vehicle.tankCapacity.toFixed(1)} L`}
              />
              <Metric label="Receipt" value={selected.receiptNumber} />
              <Metric
                label="QR status"
                value={selected.qrStatus ?? "UNVERIFIED"}
              />
              <Metric
                label="QR extracted data"
                value={
                  selected.qrExtractedData
                    ? JSON.stringify(selected.qrExtractedData)
                    : selected.qrRawValue || "—"
                }
              />
              <Metric
                label="Odometer"
                value={`${selected.odometerReading} km`}
              />
              <Metric
                label="Distance travelled"
                value={`${selected.odometerDistance?.toFixed(1) ?? "—"} km`}
              />
              <Metric
                label="Efficiency"
                value={`${selected.efficiencyKmL?.toFixed(2) ?? "—"} km/L`}
              />
              <Metric
                label="GPS"
                value={`${selected.gpsStatus.replaceAll("_", " ")}${selected.gpsAccuracy ? ` · ±${Math.round(selected.gpsAccuracy)}m` : ""}`}
              />
              <Metric
                label="Anomaly"
                value={selected.anomalyStatus.replaceAll("_", " ")}
              />
              <Metric
                label="Amount"
                value={money(Number(selected.totalAmount))}
              />
              <Metric
                label="Previous fill"
                value={
                  selected.previousEntry
                    ? `${new Date(selected.previousEntry.createdAt).toLocaleDateString()} · ${selected.previousEntry.odometerReading} km`
                    : "First recorded fill"
                }
              />
              {selected.qrEvidence && (
                <button
                  onClick={() => void openQrImage()}
                  className="text-left text-cyan-600 font-bold"
                >
                  Open QR evidence ↗
                </button>
              )}
            </div>
            {selected.latitude != null && selected.longitude != null && (
              <iframe
                title="Fuel purchase map"
                className="mt-5 h-56 w-full rounded-2xl border"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${selected.longitude - 0.01}%2C${selected.latitude - 0.01}%2C${selected.longitude + 0.01}%2C${selected.latitude + 0.01}&layer=mapnik&marker=${selected.latitude}%2C${selected.longitude}`}
              />
            )}
            <div className="mt-4 rounded-xl bg-slate-50 p-3">
              <p className="text-xs font-bold text-slate-500">
                Review comments
              </p>
              {(selected as any).comments?.map((x: any) => (
                <p key={x.id} className="mt-2 text-sm">
                  <b>{x.author.name}:</b> {x.comment}
                </p>
              ))}
              {!(selected as any).comments?.length && (
                <p className="mt-1 text-sm text-slate-400">No comments yet.</p>
              )}
            </div>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Review comment (required when rejecting or flagging)"
              className="mt-5 min-h-24 w-full rounded-xl border p-3"
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
              <button
                disabled={busy}
                onClick={() => void review("VERIFIED")}
                className="rounded-xl bg-indigo-600 p-3 text-white font-bold"
              >
                <CheckCircle2 className="inline w-4" /> Verify
              </button>
              <button
                disabled={busy}
                onClick={() => void review("APPROVED")}
                className="rounded-xl bg-emerald-600 p-3 text-white font-bold"
              >
                <CheckCircle2 className="inline w-4" /> Approve
              </button>
              <button
                disabled={busy || !comment.trim()}
                onClick={() => void review("FLAGGED")}
                className="rounded-xl bg-amber-500 p-3 text-white font-bold"
              >
                <AlertTriangle className="inline w-4" /> Flag
              </button>
              <button
                disabled={busy || !comment.trim()}
                onClick={() => void review("REJECTED")}
                className="rounded-xl bg-rose-600 p-3 text-white font-bold"
              >
                <XCircle className="inline w-4" /> Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </ManagerLayout>
  );
};

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs text-slate-500">{label}</p>
    <p className="font-bold text-slate-900">{value}</p>
  </div>
);
const Evidence = ({
  title,
  url,
  fallback,
}: {
  title: string;
  url?: string;
  fallback: string;
}) => (
  <div>
    <p className="mb-2 text-xs font-bold text-slate-500">{title}</p>
    <div className="grid h-52 place-items-center overflow-hidden rounded-2xl border bg-slate-50">
      {url ? (
        <img src={url} alt={title} className="h-full w-full object-contain" />
      ) : (
        <p className="text-sm text-slate-400">{fallback}</p>
      )}
    </div>
  </div>
);
const EmptyState = ({
  icon: Icon,
  title,
  description,
  compact = false,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  compact?: boolean;
}) => (
  <div
    className={`grid place-items-center px-6 text-center ${compact ? "min-h-52" : "min-h-36"}`}
  >
    <div>
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-500">
        <Icon size={21} />
      </span>
      <p className="mt-3 text-sm font-bold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500">
        {description}
      </p>
    </div>
  </div>
);
