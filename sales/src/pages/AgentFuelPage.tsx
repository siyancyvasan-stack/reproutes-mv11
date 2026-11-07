import React, { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Fuel,
  Gauge,
  Loader2,
  LocateFixed,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { AgentLayout } from "../components/layout/AgentLayout";
import { GlassCard } from "../components/common/GlassCard";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { capturePreciseGpsPoint } from "../services/deviceGps";
import {
  DailyFuelRecord,
  FuelEntry,
  Vehicle,
  fuelApi,
} from "../services/fuelApi";

const localNow = () => {
  const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
};
const initial = {
  vehicleId: "",
  vehicleNumber: "",
  fuelType: "PETROL",
  liters: "",
  totalAmount: "",
  fuelStation: "",
  receiptNumber: "",
  odometerReading: "",
  purchasedAt: localNow(),
  paymentMethod: "Company card",
  notes: "",
  qrRawValue: "",
  qrType: "RECEIPT",
  stationLatitude: "",
  stationLongitude: "",
  isFullTank: false,
};
type ClaimGps = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};
type GpsState = "detecting" | "verified" | "error";
export const AgentFuelPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [form, setForm] = useState(initial);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [entries, setEntries] = useState<FuelEntry[]>([]);
  const [wallet, setWallet] = useState({
    allowance: 0,
    used: 0,
    remaining: 0,
    liters: 0,
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState("");
  const [gps, setGps] = useState<ClaimGps | null>(null);
  const [gpsState, setGpsState] = useState<GpsState>("detecting");
  const [gpsError, setGpsError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fuelPhoto, setFuelPhoto] = useState<File | null>(null);
  const [fuelPhotoPreview, setFuelPhotoPreview] = useState("");
  const [qrImage, setQrImage] = useState<File | null>(null);
  const [qrPreview, setQrPreview] = useState("");
  const [qrMessage, setQrMessage] = useState("");
  const [historyReceipts, setHistoryReceipts] = useState<
    Record<string, string>
  >({});
  const [daily, setDaily] = useState<DailyFuelRecord[]>([]);
  const [shift, setShift] = useState({
    vehicleId: "",
    fuelLiters: "",
    odometer: "",
  });
  const [shiftPhoto, setShiftPhoto] = useState<File | null>(null);
  const total = Number(form.totalAmount) || 0;
  const pricePerLiter =
    Number(form.liters) > 0 ? total / Number(form.liters) : 0;
  const load = async () => {
    const [v, e, w, d] = await Promise.all([
      fuelApi.vehicles(),
      fuelApi.entries(),
      fuelApi.wallet(),
      fuelApi.daily(),
    ]);
    setVehicles(v);
    setEntries(e.items);
    setWallet(w);
    setDaily(d);
    if (!form.vehicleId && v[0])
      setForm((old) => ({
        ...old,
        vehicleId: v[0].id,
        vehicleNumber: v[0].vehicleNumber,
        fuelType: v[0].fuelType,
      }));
    setShift((old) => ({ ...old, vehicleId: old.vehicleId || v[0]?.id || "" }));
  };
  useEffect(() => {
    void load().catch((e) =>
      showToast("Fuel module unavailable", e.message, "error"),
    );
  }, []);
  useEffect(() => {
    if (user?.id) void locate();
  }, [user?.id]);
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void Promise.all(
      entries
        .filter((entry) => entry.receipt)
        .map(async (entry) => {
          try {
            const blob = await fuelApi.receipt(entry.id);
            const url = URL.createObjectURL(blob);
            urls.push(url);
            return [entry.id, url] as const;
          } catch {
            return null;
          }
        }),
    ).then((rows) => {
      if (!cancelled)
        setHistoryReceipts(
          Object.fromEntries(
            rows.filter(Boolean) as Array<readonly [string, string]>,
          ),
        );
    });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [entries]);
  const selected = useMemo(
    () => vehicles.find((v) => v.id === form.vehicleId),
    [vehicles, form.vehicleId],
  );
  const field =
    (name: Exclude<keyof typeof form, "isFullTank">) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) =>
      setForm((old) => ({ ...old, [name]: e.target.value }));
  const locate = async () => {
    if (!user?.id) return;
    setGps(null);
    setGpsState("detecting");
    setGpsError("");
    try {
      const point = await capturePreciseGpsPoint(user.id);
      setGps(point);
      setGpsState("verified");
    } catch (e) {
      setGpsState("error");
      setGpsError(
        e instanceof Error
          ? e.message
          : "Enable location permission and try again.",
      );
    }
  };
  const openShift = daily.find((record) => !record.closedAt);
  const submitShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setBusy(true);
    try {
      const point = await capturePreciseGpsPoint(user.id);
      if (openShift) {
        const record = await fuelApi.endDaily(openShift.id, {
          closingFuelLiters: Number(shift.fuelLiters),
          closingOdometer: Number(shift.odometer),
          ...point,
        });
        if (shiftPhoto)
          await fuelApi.uploadDailyPhoto(record.id, "closing", shiftPhoto);
        showToast(
          "Shift closed",
          `${record.distanceTravelled?.toFixed(1) ?? 0} km · ${record.fuelEfficiencyKmL?.toFixed(2) ?? "—"} km/L`,
          "success",
        );
      } else {
        const record = await fuelApi.startDaily({
          vehicleId: shift.vehicleId,
          openingFuelLiters: Number(shift.fuelLiters),
          openingOdometer: Number(shift.odometer),
          ...point,
        });
        if (shiftPhoto)
          await fuelApi.uploadDailyPhoto(record.id, "opening", shiftPhoto);
        showToast(
          "Shift started",
          "Fuel, odometer, GPS and timestamp recorded.",
          "success",
        );
      }
      setShift((old) => ({ ...old, fuelLiters: "", odometer: "" }));
      setShiftPhoto(null);
      await load();
    } catch (error) {
      showToast(
        "Shift update failed",
        error instanceof Error ? error.message : "Please verify the readings.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const parseQrData = (raw: string) => {
    const values: Record<string, string> = {};
    try {
      const json = JSON.parse(raw);
      if (json && typeof json === "object")
        Object.entries(json).forEach(
          ([k, v]) => (values[k.toLowerCase()] = String(v)),
        );
    } catch {
      try {
        const url = new URL(raw);
        url.searchParams.forEach((v, k) => (values[k.toLowerCase()] = v));
      } catch {
        raw.split(/[\n;&|]/).forEach((part) => {
          const match = part.match(/^\s*([^:=]+)\s*[:=]\s*(.+)\s*$/);
          if (match) values[match[1].trim().toLowerCase()] = match[2].trim();
        });
      }
    }
    return values;
  };
  const applyQrData = (raw: string) => {
    const values = parseQrData(raw);
    const pick = (...keys: string[]) =>
      keys.map((k) => values[k]).find(Boolean);
    setForm((old) => ({
      ...old,
      qrRawValue: raw,
      receiptNumber:
        pick("receipt", "receiptno", "receipt_no", "invoice", "invoice_no") ??
        old.receiptNumber,
      fuelStation:
        pick("station", "merchant", "petrol_station") ?? old.fuelStation,
      liters: pick("liters", "litres", "qty", "quantity") ?? old.liters,
      totalAmount: pick("total", "amount", "total_amount") ?? old.totalAmount,
      fuelType:
        pick("fuel", "fuel_type")?.toUpperCase() === "DIESEL"
          ? "DIESEL"
          : pick("fuel", "fuel_type")?.toUpperCase() === "PETROL"
            ? "PETROL"
            : old.fuelType,
      stationLatitude:
        pick("station_latitude", "station_lat", "latitude", "lat") ??
        old.stationLatitude,
      stationLongitude:
        pick(
          "station_longitude",
          "station_lng",
          "station_lon",
          "longitude",
          "lng",
          "lon",
        ) ?? old.stationLongitude,
    }));
    return values;
  };
  const decodeQr = async (file: File) => {
    if (qrPreview) URL.revokeObjectURL(qrPreview);
    setQrImage(file);
    setQrPreview(URL.createObjectURL(file));
    setQrMessage("QR image saved for verification.");
    try {
      const Detector = (window as any).BarcodeDetector;
      if (!Detector) {
        setQrMessage(
          "Automatic QR decoding is unavailable on this browser. Paste the QR result below.",
        );
        return;
      }
      const bitmap = await createImageBitmap(file);
      const results = await new Detector({ formats: ["qr_code"] }).detect(
        bitmap,
      );
      bitmap.close();
      const raw = results[0]?.rawValue;
      if (raw) {
        applyQrData(raw);
        setQrMessage(
          "QR detected. Matching receipt fields were filled; please confirm them.",
        );
      } else
        setQrMessage(
          "No QR was detected. Retake the photo or paste the value.",
        );
    } catch {
      setQrMessage(
        "QR could not be decoded. The image will still be attached for manager review.",
      );
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receipt) {
      showToast(
        "Receipt required",
        "Attach a JPG, PNG or PDF receipt.",
        "error",
      );
      return;
    }
    if (!fuelPhoto) {
      showToast(
        "Fuel photo required",
        "Take a photo of the pump or filling activity.",
        "error",
      );
      return;
    }
    if (!gps) {
      showToast(
        "GPS verification required",
        "Wait for location verification or retry GPS.",
        "error",
      );
      return;
    }
    setBusy(true);
    try {
      const { stationLatitude, stationLongitude, ...claimForm } = form;
      const entry = await fuelApi.createEntry({
        ...claimForm,
        liters: Number(form.liters),
        pricePerLiter,
        totalAmount: total,
        odometerReading: Number(form.odometerReading),
        purchasedAt: new Date(form.purchasedAt).toISOString(),
        qrExtractedData: form.qrRawValue
          ? parseQrData(form.qrRawValue)
          : undefined,
        ...gps,
        gpsAccuracy: gps.accuracy,
        ...(stationLatitude && stationLongitude
          ? {
              stationLatitude: Number(stationLatitude),
              stationLongitude: Number(stationLongitude),
            }
          : {}),
      });
      await fuelApi.uploadReceipt(entry.id, receipt);
      await fuelApi.uploadFuelPhoto(entry.id, fuelPhoto);
      if (qrImage) await fuelApi.uploadQrImage(entry.id, qrImage);
      await fuelApi.submit(entry.id);
      showToast(
        "Fuel claim submitted",
        "Your manager has been notified.",
        "success",
      );
      setForm({
        ...initial,
        purchasedAt: localNow(),
        vehicleId: vehicles[0]?.id ?? "",
        vehicleNumber: vehicles[0]?.vehicleNumber ?? "",
        fuelType: vehicles[0]?.fuelType ?? "PETROL",
      });
      setReceipt(null);
      setFuelPhoto(null);
      if (receiptPreview) URL.revokeObjectURL(receiptPreview);
      if (fuelPhotoPreview) URL.revokeObjectURL(fuelPhotoPreview);
      setReceiptPreview("");
      setFuelPhotoPreview("");
      if (qrPreview) URL.revokeObjectURL(qrPreview);
      setQrImage(null);
      setQrPreview("");
      setQrMessage("");
      void locate();
      await load();
    } catch (error) {
      showToast(
        "Submission failed",
        error instanceof Error ? error.message : "Please verify the details.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <AgentLayout>
      <section className="space-y-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[.2em] text-cyan-600">
            Field expense
          </p>
          <h1 className="text-2xl font-black">Fuel Wallet</h1>
          <p className="text-sm text-slate-500">
            Capture every fill-up with receipt, odometer and GPS proof.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ["Allowance", wallet.allowance, WalletCards],
            ["Used", wallet.used, Fuel],
            ["Remaining", wallet.remaining, WalletCards],
            ["Litres", wallet.liters, Fuel],
          ].map(([label, value, Icon]) => (
            <GlassCard key={String(label)} className="p-4">
              <Icon className="w-5 text-cyan-600" />
              <p className="text-[10px] font-bold uppercase text-slate-500 mt-2">
                {label as string}
              </p>
              <p className="font-black">
                {label === "Litres"
                  ? `${Number(value).toFixed(1)} L`
                  : `LKR ${Number(value).toLocaleString()}`}
              </p>
            </GlassCard>
          ))}
        </div>
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Gauge className="text-emerald-600" />
            <div>
              <h2 className="font-black">Daily tank & mileage</h2>
              <p className="text-xs text-slate-500">
                {openShift
                  ? `Shift opened ${new Date(openShift.openedAt).toLocaleTimeString()} · ${openShift.vehicle.vehicleNumber}`
                  : "Record readings before starting your route."}
              </p>
            </div>
          </div>
          <form
            onSubmit={submitShift}
            className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"
          >
            {!openShift && (
              <Label title="Vehicle">
                <select
                  required
                  className="input"
                  value={shift.vehicleId}
                  onChange={(e) =>
                    setShift((old) => ({ ...old, vehicleId: e.target.value }))
                  }
                >
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vehicleNumber}
                    </option>
                  ))}
                </select>
              </Label>
            )}
            <Label title={`${openShift ? "Closing" : "Opening"} fuel (L)`}>
              <input
                required
                min="0"
                step="0.1"
                type="number"
                className="input"
                value={shift.fuelLiters}
                onChange={(e) =>
                  setShift((old) => ({ ...old, fuelLiters: e.target.value }))
                }
              />
            </Label>
            <Label title={`${openShift ? "Closing" : "Opening"} odometer (km)`}>
              <input
                required
                min="0"
                step="0.1"
                type="number"
                className="input"
                value={shift.odometer}
                onChange={(e) =>
                  setShift((old) => ({ ...old, odometer: e.target.value }))
                }
              />
            </Label>
            <Label title="Dashboard / gauge photo (optional)">
              <label className="input flex cursor-pointer gap-2">
                <Camera className="w-5" />
                <span className="truncate">
                  {shiftPhoto?.name ?? "Take photo"}
                </span>
                <input
                  hidden
                  type="file"
                  capture="environment"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setShiftPhoto(e.target.files?.[0] ?? null)}
                />
              </label>
            </Label>
            <button
              disabled={busy || !vehicles.length}
              className="rounded-xl bg-emerald-600 px-4 py-3 font-black text-white sm:col-span-2 lg:col-span-4"
            >
              {busy
                ? "Capturing GPS…"
                : openShift
                  ? "End shift"
                  : "Start shift"}
            </button>
          </form>
          {openShift && (
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
              <MetricMini
                label="Opening fuel"
                value={`${openShift.openingFuelLiters} L`}
              />
              <MetricMini
                label="Fuel added"
                value={`${openShift.fuelAddedLiters} L`}
              />
              <MetricMini
                label="Opening odometer"
                value={`${openShift.openingOdometer} km`}
              />
            </div>
          )}
        </GlassCard>
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-5">
            <ReceiptText className="text-indigo-600" />
            <div>
              <h2 className="font-black">New fuel entry</h2>
              <p className="text-xs text-slate-500">
                Confirm all receipt values before submission.
              </p>
            </div>
          </div>
          {!vehicles.length && (
            <div className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">
              No assigned vehicle yet. Enter the vehicle number below; it will
              be registered and flagged for manager verification.
            </div>
          )}
          <form onSubmit={submit} className="grid sm:grid-cols-2 gap-4">
            <Label title="Vehicle number">
              {vehicles.length ? (
                <select
                  required
                  value={form.vehicleId}
                  onChange={(e) => {
                    const v = vehicles.find((x) => x.id === e.target.value);
                    setForm((old) => ({
                      ...old,
                      vehicleId: e.target.value,
                      vehicleNumber: v?.vehicleNumber ?? "",
                      fuelType: v?.fuelType ?? old.fuelType,
                    }));
                  }}
                  className="input"
                >
                  <option value="">Select vehicle</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.vehicleNumber} · {v.vehicleType}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  required
                  minLength={2}
                  value={form.vehicleNumber}
                  onChange={field("vehicleNumber")}
                  className="input uppercase"
                  placeholder="e.g. CAB-1234"
                />
              )}
            </Label>
            <Label title="Fuel type">
              <select
                value={form.fuelType}
                onChange={field("fuelType")}
                className="input"
              >
                <option>PETROL</option>
                <option>DIESEL</option>
              </select>
            </Label>
            <Label title="Litres">
              <input
                required
                min="0.1"
                max={selected?.tankCapacity}
                step="0.01"
                type="number"
                value={form.liters}
                onChange={field("liters")}
                className="input"
                placeholder={`Tank max ${selected?.tankCapacity ?? "—"} L`}
              />
            </Label>
            <Label title="Total amount (LKR)">
              <input
                required
                min="1"
                step="0.01"
                type="number"
                value={form.totalAmount}
                onChange={field("totalAmount")}
                className="input"
              />
            </Label>
            <Label title="Fuel station">
              <input
                required
                value={form.fuelStation}
                onChange={field("fuelStation")}
                className="input"
              />
            </Label>
            <Label title="Receipt number">
              <input
                required
                value={form.receiptNumber}
                onChange={field("receiptNumber")}
                className="input"
              />
            </Label>
            <Label title="Fuel date & time">
              <input
                required
                max={localNow()}
                type="datetime-local"
                value={form.purchasedAt}
                onChange={field("purchasedAt")}
                className="input"
              />
            </Label>
            <Label title="Odometer (km)">
              <input
                required
                min={selected?.currentOdometer}
                step="0.1"
                type="number"
                value={form.odometerReading}
                onChange={field("odometerReading")}
                className="input"
                placeholder={`At least ${selected?.currentOdometer ?? 0}`}
              />
            </Label>
            <Label title="Payment method">
              <select
                value={form.paymentMethod}
                onChange={field("paymentMethod")}
                className="input"
              >
                <option>Company card</option>
                <option>Cash</option>
                <option>Personal card</option>
                <option>QR payment</option>
              </select>
            </Label>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <input
                type="checkbox"
                checked={form.isFullTank}
                onChange={(e) =>
                  setForm((old) => ({ ...old, isFullTank: e.target.checked }))
                }
                className="h-5 w-5 accent-emerald-600"
              />
              <span>
                <span className="block font-black text-emerald-800">
                  Tank filled completely
                </span>
                <span className="text-xs text-emerald-700">
                  Select this when the vehicle was filled up to full tank.
                </span>
              </span>
            </label>
            <div className="sm:col-span-2 rounded-xl bg-indigo-50 p-4 flex justify-between">
              <span className="font-bold text-slate-600">Calculated total</span>
              <strong className="text-xl text-indigo-700">
                LKR{" "}
                {total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </strong>
            </div>
            <Label title="Receipt (JPG, PNG or PDF)">
              <label className="input flex gap-2 cursor-pointer">
                <Camera className="w-5 text-cyan-600" />
                <span className="truncate">
                  {receipt?.name ?? "Take photo or choose receipt"}
                </span>
                <input
                  hidden
                  required
                  type="file"
                  capture="environment"
                  accept="image/jpeg,image/png,application/pdf"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (receiptPreview) URL.revokeObjectURL(receiptPreview);
                    setReceipt(file);
                    setReceiptPreview(file ? URL.createObjectURL(file) : "");
                  }}
                />
              </label>
              {receiptPreview && (
                <div className="mt-2 rounded-xl border bg-slate-50 p-2">
                  {receipt?.type.startsWith("image/") ? (
                    <img
                      src={receiptPreview}
                      alt="Receipt preview"
                      className="max-h-48 mx-auto rounded-lg object-contain"
                    />
                  ) : (
                    <p className="p-4 text-center text-sm font-bold text-slate-600">
                      PDF ready: {receipt?.name}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-500 mt-2 text-center">
                    You can choose another file before submitting.
                  </p>
                </div>
              )}
            </Label>
            <Label title="Fuel filling / pump photo">
              <label className="input flex gap-2 cursor-pointer">
                <Camera className="w-5 text-indigo-600" />
                <span className="truncate">
                  {fuelPhoto?.name ?? "Take pump photo"}
                </span>
                <input
                  hidden
                  required
                  type="file"
                  capture="environment"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (fuelPhotoPreview) URL.revokeObjectURL(fuelPhotoPreview);
                    setFuelPhoto(file);
                    setFuelPhotoPreview(file ? URL.createObjectURL(file) : "");
                  }}
                />
              </label>
              {fuelPhotoPreview && (
                <img
                  src={fuelPhotoPreview}
                  alt="Fuel filling preview"
                  className="mt-2 max-h-48 mx-auto rounded-xl border object-contain"
                />
              )}
            </Label>
            <div>
              <p className="label">GPS verification</p>
              <div
                className={`input flex w-full items-center gap-2 font-bold ${gpsState === "verified" ? "text-emerald-700" : gpsState === "error" ? "text-rose-700" : "text-indigo-700"}`}
              >
                {gpsState === "detecting" ? (
                  <Loader2 className="w-5 animate-spin" />
                ) : (
                  <LocateFixed className="w-5" />
                )}
                <span className="flex-1">
                  {gpsState === "detecting"
                    ? "Detecting your location..."
                    : gpsState === "verified"
                      ? `Location verified ✓${gps ? ` · Accuracy ±${Math.round(gps.accuracy)} m` : ""}`
                      : gpsError}
                </span>
                {gpsState === "error" && (
                  <button
                    type="button"
                    onClick={() => void locate()}
                    className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-xs text-indigo-700 shadow-sm"
                  >
                    Retry GPS
                  </button>
                )}
              </div>
            </div>
            <div className="sm:col-span-2 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="label">QR verification (optional)</p>
                  <p className="text-[10px] text-slate-500">
                    Scan with the phone camera or upload a QR image. Confirm
                    decoded data yourself.
                  </p>
                </div>
                <select
                  value={form.qrType}
                  onChange={field("qrType")}
                  className="rounded-xl border bg-white px-3 py-2 text-xs font-bold"
                >
                  <option value="RECEIPT">Receipt QR</option>
                  <option value="AUTHORIZATION">Company authorization</option>
                </select>
              </div>
              <div className="mt-3 grid sm:grid-cols-2 gap-3">
                <label className="input flex cursor-pointer items-center justify-center gap-2 font-bold text-indigo-700">
                  <Camera className="h-5" />
                  Scan QR with camera
                  <input
                    hidden
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void decodeQr(f);
                    }}
                  />
                </label>
                <label className="input flex cursor-pointer items-center justify-center gap-2 font-bold text-cyan-700">
                  <ReceiptText className="h-5" />
                  Upload QR image
                  <input
                    hidden
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void decodeQr(f);
                    }}
                  />
                </label>
              </div>
              {qrPreview && (
                <img
                  src={qrPreview}
                  alt="QR preview"
                  className="mx-auto mt-3 max-h-40 rounded-xl border bg-white object-contain p-2"
                />
              )}
              <input
                value={form.qrRawValue}
                onChange={field("qrRawValue")}
                className="input mt-3 w-full"
                placeholder="Detected QR result — review or paste here"
              />
              <p className="mt-2 text-[10px] font-semibold text-indigo-700">
                {qrMessage ||
                  "Status will be verified securely by the backend."}
              </p>
            </div>
            <Label title="Notes">
              <textarea
                value={form.notes}
                onChange={field("notes")}
                className="input min-h-20"
              />
            </Label>
            <button
              disabled={busy || gpsState !== "verified" || !gps}
              className="sm:col-span-2 rounded-xl bg-gradient-to-r from-indigo-600 to-cyan-600 p-3.5 font-black text-white disabled:opacity-50"
            >
              {busy
                ? "Submitting securely…"
                : gpsState === "detecting"
                  ? "Detecting your location..."
                  : "Submit fuel claim"}
            </button>
          </form>
        </GlassCard>
        <GlassCard className="overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="font-black">Fuel History</h2>
            <p className="text-xs text-slate-500">
              Submitted entries and their securely stored receipts.
            </p>
          </div>
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="p-4 border-b last:border-0 flex items-center justify-between gap-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                {historyReceipts[entry.id] ? (
                  entry.receipt?.file.mimeType.startsWith("image/") ? (
                    <button
                      onClick={() =>
                        window.open(historyReceipts[entry.id], "_blank")
                      }
                      className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border bg-white"
                    >
                      <img
                        src={historyReceipts[entry.id]}
                        alt={`Receipt ${entry.receiptNumber}`}
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        window.open(historyReceipts[entry.id], "_blank")
                      }
                      className="grid h-16 w-16 shrink-0 place-items-center rounded-xl border bg-rose-50 text-[10px] font-black text-rose-600"
                    >
                      PDF
                    </button>
                  )
                ) : (
                  <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-slate-100 text-[10px] text-slate-400">
                    Receipt
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate font-bold">
                    {entry.vehicle.vehicleNumber} · {entry.fuelStation}
                  </p>
                  <p className="text-xs text-slate-500">
                    {new Date(
                      entry.purchasedAt ?? entry.createdAt,
                    ).toLocaleDateString()}{" "}
                    · {entry.liters} L ·{" "}
                    {entry.odometerDistance?.toFixed(1) ?? 0} km since previous
                    fill
                  </p>
                  <p className="text-[10px] text-slate-400">
                    Receipt #{entry.receiptNumber}
                  </p>
                  {entry.reviewComment && (
                    <p className="text-xs text-rose-600 mt-1">
                      {entry.reviewComment}
                    </p>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-black">
                  LKR {Number(entry.totalAmount).toLocaleString()}
                </p>
                <span className="text-[10px] font-black text-indigo-600">
                  {entry.status.replace("_", " ")}
                </span>
              </div>
            </div>
          ))}
          {!entries.length && (
            <p className="p-8 text-center text-slate-500">
              No fuel claims submitted.
            </p>
          )}
        </GlassCard>
      </section>
    </AgentLayout>
  );
};
const Label = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <label>
    <span className="label">{title}</span>
    {children}
  </label>
);
const MetricMini = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[10px] font-bold uppercase text-slate-500">{label}</p>
    <p className="font-black">{value}</p>
  </div>
);
