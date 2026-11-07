import React, { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Camera, Clock3, MapPin, Save, Store } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AgentLayout } from "../components/layout/AgentLayout";
import { GlassCard } from "../components/common/GlassCard";
import { ImageUploadField } from "../components/common/ImageUploadField";
import { capturePreciseGpsPoint } from "../services/deviceGps";
import { loadShops } from "../services/domainApi";
import {
  checkoutVisit,
  loadActiveVisit,
  startVisit,
  updateVisit,
  uploadVisitImage,
  type ActiveVisit,
} from "../services/shopVisitApi";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const blank = {
  shopId: "",
  name: "",
  ownerName: "",
  phone: "",
  address: "",
  city: "",
  purpose: "",
  productsDiscussed: "",
  notes: "",
};
export const SalesVisitEntryPage = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [visit, setVisit] = useState<ActiveVisit | null>();
  const [shops, setShops] = useState<any[]>([]);
  const [form, setForm] = useState(blank);
  const [isNew, setIsNew] = useState(false);
  const [front, setFront] = useState<File>();
  const [interior, setInterior] = useState<File>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void Promise.all([loadActiveVisit(), loadShops([])])
      .then(([active, list]) => {
        setVisit(active);
        setShops(list);
        if (active)
          setForm((current) => ({
            ...current,
            purpose: active.purpose ?? "",
            productsDiscussed: (active.productsDiscussed ?? []).join(", "),
            notes: active.notes ?? "",
          }));
      })
      .catch(() =>
        showToast(
          "Visit unavailable",
          "Could not load saved visit data.",
          "error",
        ),
      );
  }, [showToast]);
  const field =
    (key: string) =>
    (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));
  const details = () => ({
    purpose: form.purpose.trim() || undefined,
    productsDiscussed: form.productsDiscussed
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    notes: form.notes.trim() || undefined,
  });
  const checkIn = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const gps = await capturePreciseGpsPoint(user.id);
      const selected = isNew
        ? {
            id: `local-shop-${crypto.randomUUID()}`,
            name: form.name,
            ownerName: form.ownerName,
            phone: form.phone,
            address: form.address,
            city: form.city,
            images: [],
          }
        : shops.find((shop) => shop.id === form.shopId);
      const row = await startVisit(
        {
          ...(isNew
            ? {
                newShop: {
                  name: form.name,
                  ownerName: form.ownerName,
                  phone: form.phone,
                  address: form.address,
                  city: form.city,
                },
              }
            : { shopId: form.shopId }),
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracy: gps.accuracy,
          ...details(),
        },
        { agentId: user.id, shop: selected },
      );
      setVisit(row);
      showToast(
        navigator.onLine ? "Checked in" : "Saved offline",
        navigator.onLine
          ? `Visit to ${row.shop.name} is now active${(row.shop as any).retailerCode ? ` · Shop ID: ${(row.shop as any).retailerCode}` : ""}.`
          : "This visit will sync when internet is available.",
        "success",
      );
    } catch (error) {
      showToast(
        "Check-in failed",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!visit || !user) return;
    setBusy(true);
    try {
      await updateVisit(visit.id, details(), user.id);
      if (front)
        await uploadVisitImage(visit.shopId, visit.id, front, "FRONT", user.id);
      if (interior)
        await uploadVisitImage(
          visit.shopId,
          visit.id,
          interior,
          "INTERIOR",
          user.id,
        );
      setFront(undefined);
      setInterior(undefined);
      showToast(
        navigator.onLine ? "Visit saved" : "Saved offline",
        navigator.onLine
          ? "Work details and images are permanently stored."
          : "Changes will sync automatically.",
        "success",
      );
    } catch (error) {
      showToast(
        "Save failed",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const checkout = async () => {
    if (!visit || !user) return;
    setBusy(true);
    try {
      await save();
      const gps = await capturePreciseGpsPoint(user.id);
      await checkoutVisit(
        visit.shopId,
        visit.id,
        {
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracy: gps.accuracy,
          notes: form.notes,
        },
        user.id,
      );
      showToast(
        navigator.onLine ? "Checked out" : "Checkout saved offline",
        navigator.onLine
          ? "Visit duration was calculated and saved."
          : "This checkout will sync automatically.",
        "success",
      );
      navigate("/sales/activity");
    } catch (error) {
      showToast(
        "Checkout failed",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <AgentLayout>
      <div className="mx-auto max-w-3xl space-y-5">
        <header className="flex items-center gap-3">
          <button
            onClick={() => navigate("/sales/activity")}
            className="rounded-xl border border-slate-700 p-2 text-slate-300"
          >
            <ArrowLeft className="h-4" />
          </button>
          <div>
            <h2 className="text-2xl font-extrabold text-white">
              Record Shop Visit
            </h2>
            <p className="text-xs text-slate-400">
              GPS-verified field visit stored permanently
            </p>
          </div>
        </header>
        {visit ? (
          <>
            <GlassCard className="p-5">
              <div className="flex items-start gap-3">
                <Store className="h-6 text-cyan-400" />
                <div>
                  <p className="text-xs font-bold text-emerald-300">
                    ACTIVE VISIT
                  </p>
                  <h3 className="font-extrabold text-white">
                    {visit.shop.name}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Checked in {new Date(visit.visitedAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            </GlassCard>
            <GlassCard className="space-y-4 p-5">
              <Field label="Visit purpose">
                <input
                  value={form.purpose}
                  onChange={field("purpose")}
                  className="input w-full"
                  placeholder="Sales call, collection, merchandising…"
                />
              </Field>
              <Field label="Products discussed / sold">
                <input
                  value={form.productsDiscussed}
                  onChange={field("productsDiscussed")}
                  className="input w-full"
                  placeholder="Comma separated products"
                />
              </Field>
              <Field label="Visit notes">
                <textarea
                  value={form.notes}
                  onChange={field("notes")}
                  className="input min-h-28 w-full"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <ImageUploadField
                  label="Shop Front"
                  file={front}
                  onChange={setFront}
                  disabled={busy}
                />
                <ImageUploadField
                  label="Inside Shop"
                  file={interior}
                  onChange={setInterior}
                  disabled={busy}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <button
                  disabled={busy}
                  onClick={() => void save()}
                  className="flex items-center justify-center gap-2 rounded-xl border border-cyan-500/30 p-3 text-sm font-bold text-cyan-300"
                >
                  <Save className="h-4" />
                  Save Details
                </button>
                <button
                  onClick={() =>
                    navigate(
                      `/sales/new-order?shopId=${visit.shopId}&visitId=${visit.id}`,
                    )
                  }
                  className="rounded-xl border border-indigo-500/30 p-3 text-sm font-bold text-indigo-300"
                >
                  Create Order / Invoice
                </button>
                <button
                  disabled={busy}
                  onClick={() => void checkout()}
                  className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 p-3 text-sm font-black text-white"
                >
                  <Clock3 className="h-4" />
                  Check Out
                </button>
              </div>
            </GlassCard>
          </>
        ) : (
          <GlassCard className="p-5">
            <form onSubmit={checkIn} className="space-y-4">
              <div className="grid grid-cols-2 rounded-xl bg-slate-900/70 p-1">
                <button
                  type="button"
                  onClick={() => setIsNew(false)}
                  className={`rounded-lg p-2 text-xs font-bold ${!isNew ? "bg-cyan-500 text-slate-950" : "text-slate-400"}`}
                >
                  Existing Shop
                </button>
                <button
                  type="button"
                  onClick={() => setIsNew(true)}
                  className={`rounded-lg p-2 text-xs font-bold ${isNew ? "bg-cyan-500 text-slate-950" : "text-slate-400"}`}
                >
                  New Shop
                </button>
              </div>
              {isNew ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["name", "Shop name"],
                    ["ownerName", "Owner / contact"],
                    ["phone", "Phone"],
                    ["city", "City"],
                    ["address", "Address"],
                  ].map(([key, label]) => (
                    <Field key={key} label={label}>
                      <input
                        required
                        value={(form as any)[key]}
                        onChange={field(key)}
                        className="input w-full"
                      />
                    </Field>
                  ))}
                </div>
              ) : (
                <Field label="Select assigned shop">
                  <select
                    required
                    value={form.shopId}
                    onChange={field("shopId")}
                    className="input w-full"
                  >
                    <option value="">Choose shop…</option>
                    {shops.map((shop) => (
                      <option key={shop.id} value={shop.id}>
                        {shop.retailerCode ? `${shop.retailerCode} · ` : ""}{shop.name} · {shop.city}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Visit purpose">
                <input
                  value={form.purpose}
                  onChange={field("purpose")}
                  className="input w-full"
                />
              </Field>
              <Field label="Products discussed">
                <input
                  value={form.productsDiscussed}
                  onChange={field("productsDiscussed")}
                  className="input w-full"
                  placeholder="Comma separated"
                />
              </Field>
              <Field label="Notes">
                <textarea
                  value={form.notes}
                  onChange={field("notes")}
                  className="input min-h-24 w-full"
                />
              </Field>
              <button
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 p-3 font-black text-white"
              >
                <MapPin className="h-4" />
                {busy ? "Capturing GPS…" : "Capture GPS & Check In"}
              </button>
            </form>
          </GlassCard>
        )}
      </div>
    </AgentLayout>
  );
};
const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
  key?: React.Key;
}) => (
  <label>
    <span className="mb-1 block text-xs font-bold text-slate-300">{label}</span>
    {children}
  </label>
);
