import React, { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  LocateFixed,
  Map,
  Pencil,
  Plus,
  Search,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { ConfirmationDialog } from "../components/common/OverlayComponents";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError, apiRequest } from "../services/apiClient";
import { capturePreciseGpsPoint } from "../services/deviceGps";
import { loadAgents } from "../services/domainApi";
import { ShopsMap, type ShopMapData } from "../components/map/ShopsMap";
type View = "all" | "add" | "pending";
type Row = Record<string, any>;
type Form = {
  name: string;
  ownerName: string;
  phone: string;
  alternateMobile: string;
  nicNumber: string;
  brNumber: string;
  email: string;
  address: string;
  city: string;
  latitude: string;
  longitude: string;
  assignedSalespersonId: string;
  creditLimitLkr: string;
  paymentTerms: string;
  active: "true" | "false";
  notes: string;
};
const blank: Form = {
  name: "",
  ownerName: "",
  phone: "",
  alternateMobile: "",
  nicNumber: "",
  brNumber: "",
  email: "",
  address: "",
  city: "",
  latitude: "",
  longitude: "",
  assignedSalespersonId: "",
  creditLimitLkr: "",
  paymentTerms: "",
  active: "true",
  notes: "",
};
const tones: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-700",
  SUBMITTED: "bg-blue-100 text-blue-700",
  UNDER_REVIEW: "bg-violet-100 text-violet-700",
  REJECTED: "bg-rose-100 text-rose-700",
  SUSPENDED: "bg-amber-100 text-amber-700",
  INACTIVE: "bg-slate-200 text-slate-600",
  DRAFT: "bg-slate-100 text-slate-600",
};
const phone = /^\+?[0-9][0-9\s()-]{6,19}$/,
  email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  optional = (v: string) => v.trim() || undefined;

export const ManagerRetailersPage = ({
  view = "all",
  portal = "manager",
}: {
  view?: View;
  portal?: "manager" | "agent";
}) => {
  const { user } = useAuth(),
    { showToast } = useToast();
  const [items, setItems] = useState<Row[]>([]),
    [agents, setAgents] = useState<Row[]>([]),
    [page, setPage] = useState(1),
    [pagination, setPagination] = useState({
      page: 1,
      limit: 10,
      total: 0,
      pages: 1,
    }),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(view === "pending" ? "SUBMITTED" : ""),
    [adding, setAdding] = useState(view === "add"),
    [editingRetailer, setEditingRetailer] = useState<Row>(),
    [selected, setSelected] = useState<Row>(),
    [pendingDelete, setPendingDelete] = useState<Row>(),
    [deleting, setDeleting] = useState(false),
    [showMap, setShowMap] = useState(false);
  const Layout = ManagerLayout;
  const load = useCallback(
    async (next = 1) => {
      const q = new URLSearchParams({ page: String(next), limit: "10" });
      if (search.trim()) q.set("search", search.trim());
      if (status) q.set("status", status);
      const r = await apiRequest<any>(`/api/v1/shops?${q}`);
      setItems(r.items);
      setPagination({
        ...r.pagination,
        pages: Math.max(1, r.pagination.pages),
      });
      setPage(next);
    },
    [search, status],
  );
  useEffect(() => {
    if (view !== "add") void load(1);
  }, [load, view]);
  useEffect(() => {
    const refresh = () => { if (view !== "add") void load(page); };
    window.addEventListener("reproutes:notifications-changed", refresh);
    return () => window.removeEventListener("reproutes:notifications-changed", refresh);
  }, [load, page, view]);
  useEffect(() => {
    if (portal === "manager")
      void loadAgents([])
        .then(setAgents)
        .catch(() => setAgents([]));
  }, [portal]);
  const remove = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await apiRequest(`/api/v1/shops/${pendingDelete.id}`, {
        method: "DELETE",
      });
      showToast(
        "Retailer deleted",
        `${pendingDelete.name} was deleted successfully.`,
        "success",
      );
      setPendingDelete(undefined);
      await load(items.length === 1 && page > 1 ? page - 1 : page);
    } catch (e) {
      showToast(
        "Delete failed",
        e instanceof Error ? e.message : "Unable to delete retailer.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  };
  const closeAdd = () => {
    setAdding(false);
    if (view === "add") history.back();
  };
  return (
    <Layout>
      <section className="space-y-5">
        <header className="flex flex-col justify-between gap-4 py-2 sm:py-3 border-b border-slate-700/40 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-black uppercase tracking-[.2em] text-cyan-500">
              Customer network
            </p>
            <h1 className="text-3xl font-black text-white">
              {view === "pending" ? "Pending Approvals" : "Retailers"}
            </h1>
            <p className="text-sm text-slate-400">
              Registration, verification, assignment and commercial history.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowMap(!showMap)}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-cyan-500 bg-cyan-500/10 px-4 py-2.5 text-sm font-bold text-cyan-400 hover:bg-cyan-500/20"
            >
              <Map className="h-4 w-4" />
              {showMap ? "Hide Map" : "View Map"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingRetailer(undefined);
                setAdding(true);
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-500 shadow-md"
            >
              <Plus className="h-4 w-4" />
              Add Retailer
            </button>
          </div>
        </header>
        {view !== "add" && (
          <>
            {showMap && (
              <div className="glass-panel rounded-2xl p-4">
                <div className="mb-4">
                  <h3 className="text-lg font-bold text-white">Registered Shops Map</h3>
                  <p className="text-sm text-slate-400">
                    Showing {items.filter(s => s.latitude && s.longitude).length} shops with GPS coordinates
                  </p>
                </div>
                <ShopsMap
                  shops={items.map((item): ShopMapData => ({
                    id: item.id,
                    name: item.name,
                    ownerName: item.ownerName,
                    phone: item.phone,
                    city: item.city,
                    latitude: item.latitude,
                    longitude: item.longitude,
                    status: item.status,
                  }))}
                  onSelectShop={(id) => {
                    const shop = items.find(s => s.id === id);
                    if (shop) {
                      void apiRequest(`/api/v1/shops/${shop.id}`)
                        .then(setSelected)
                        .catch((e) =>
                          showToast("Could not load retailer", e.message, "error")
                        );
                    }
                  }}
                />
              </div>
            )}
            <div className="glass-panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-3 h-4 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void load(1)}
                  placeholder="Retailer ID, shop, owner, NIC, BR or mobile"
                  className="input w-full pl-9"
                />
              </div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="input"
              >
                <option value="">All statuses</option>
                {[
                  "DRAFT",
                  "SUBMITTED",
                  "UNDER_REVIEW",
                  "APPROVED",
                  "REJECTED",
                  "SUSPENDED",
                  "INACTIVE",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
              <button
                onClick={() => void load(1)}
                className="rounded-xl bg-indigo-600 px-4 font-bold text-white"
              >
                Search
              </button>
            </div>
            <div className="glass-panel overflow-x-auto rounded-2xl">
              <table className="w-full min-w-[1100px] text-xs text-slate-300">
                <thead className="bg-slate-900/40 text-left text-[10px] uppercase">
                  <tr>
                    {[
                      "Retailer ID",
                      "Shop",
                      "Owner",
                      "Mobile",
                      "Area",
                      "Salesperson",
                      "Last Visit",
                      "Orders",
                      "Outstanding",
                      "Status",
                      "Actions",
                    ].map((x) => (
                      <th key={x} className="px-3 py-2.5">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.length ? (
                    items.map((r) => (
                      <tr key={r.id} className="border-t border-slate-700/50 hover:bg-slate-800/30 transition-colors">
                        <td className="px-3 py-2 font-bold text-white">
                          {r.retailerCode || "Pending"}
                        </td>
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="px-3 py-2">{r.ownerName}</td>
                        <td className="px-3 py-2">{r.phone}</td>
                        <td className="px-3 py-2">{r.city}</td>
                        <td className="px-3 py-2">
                          {r.assignedSalesperson?.name || "Unassigned"}
                        </td>
                        <td className="px-3 py-2">
                          {r.lastVisitAt
                            ? new Date(r.lastVisitAt).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-3 py-2">{r._count?.orders ?? 0}</td>
                        <td className="px-3 py-2 font-mono">
                          LKR{" "}
                          {Number(
                            r.outstandingBalanceLkr || 0,
                          ).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black ${tones[r.status] || tones.DRAFT}`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                void apiRequest(`/api/v1/shops/${r.id}`)
                                  .then(setSelected)
                                  .catch((e) =>
                                    showToast(
                                      "Could not load retailer",
                                      e.message,
                                      "error",
                                    ),
                                  )
                              }
                              title="View retailer"
                              aria-label="View retailer"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-indigo-400/30 bg-indigo-500/10 text-indigo-300 transition hover:bg-indigo-500/20 hover:text-white"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingRetailer(r)}
                              title="Edit retailer"
                              aria-label="Edit retailer"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-300 transition hover:bg-cyan-500/20 hover:text-white"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            {portal === "manager" && (
                              <button
                                type="button"
                                onClick={() => setPendingDelete(r)}
                                title="Delete retailer"
                                aria-label="Delete retailer"
                                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-400/30 bg-rose-500/10 text-rose-300 transition hover:bg-rose-500/20 hover:text-white"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={11} className="px-6 py-12 text-center">
                        <Store className="mx-auto mb-2 h-8 text-slate-500" />
                        No retailers found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="glass-panel flex flex-col items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm text-slate-300 sm:flex-row">
              <span>
                Showing{" "}
                {pagination.total === 0 ? 0 : (page - 1) * pagination.limit + 1}
                -{Math.min(page * pagination.limit, pagination.total)} of{" "}
                {pagination.total} retailers
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => void load(page - 1)}
                  className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-600 px-3 font-bold disabled:opacity-40"
                >
                  <ChevronLeft className="h-4" />
                  Previous
                </button>
                <span className="px-2 font-bold">
                  Page {page} of {pagination.pages}
                </span>
                <button
                  disabled={page >= pagination.pages}
                  onClick={() => void load(page + 1)}
                  className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-600 px-3 font-bold disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-4" />
                </button>
              </div>
            </div>
          </>
        )}
        <AddDrawer
          open={adding || Boolean(editingRetailer)}
          retailer={editingRetailer}
          agents={agents}
          portal={portal}
          userId={user?.id}
          close={() => {
            closeAdd();
            setEditingRetailer(undefined);
          }}
          saved={async () => {
            setAdding(false);
            setEditingRetailer(undefined);
            if (view === "add") history.back();
            else await load(page);
          }}
        />
        <ConfirmationDialog
          isOpen={!!pendingDelete}
          onClose={() => !deleting && setPendingDelete(undefined)}
          onConfirm={remove}
          title="Delete retailer?"
          description={`This will permanently delete ${pendingDelete?.name ?? "this retailer"}.`}
          confirmLabel="Delete retailer"
          cancelLabel="Cancel"
          busy={deleting}
          destructive
        />
        <Summary retailer={selected} close={() => setSelected(undefined)} />
      </section>
    </Layout>
  );
};

const AddDrawer = ({
  open,
  retailer,
  agents,
  portal,
  userId,
  close,
  saved,
}: {
  open: boolean;
  retailer?: Row;
  agents: Row[];
  portal: "manager" | "agent";
  userId?: string;
  close: () => void;
  saved: () => Promise<void>;
}) => {
  const { showToast } = useToast();
  const [form, setForm] = useState<Form>(blank),
    [errors, setErrors] = useState<
      Partial<Record<keyof Form | "form", string>>
    >({}),
    [saving, setSaving] = useState(false),
    [locating, setLocating] = useState(false);
  useEffect(() => {
    if (open) {
      setErrors({});
      if (retailer) {
        setForm({
          name: retailer.name || "",
          ownerName: retailer.ownerName || "",
          phone: retailer.phone || "",
          alternateMobile: retailer.alternateMobile || "",
          nicNumber: retailer.nicNumber || "",
          brNumber: retailer.brNumber || "",
          email: retailer.email || "",
          address: retailer.address || "",
          city: retailer.city || "",
          latitude: retailer.latitude ? String(retailer.latitude) : "",
          longitude: retailer.longitude ? String(retailer.longitude) : "",
          assignedSalespersonId:
            retailer.assignedSalespersonId ||
            retailer.assignedSalesperson?.id ||
            "",
          creditLimitLkr: retailer.creditLimitLkr != null
            ? String(retailer.creditLimitLkr)
            : "",
          paymentTerms: retailer.paymentTerms || "",
          active: String(retailer.active ?? true),
          notes: retailer.notes || "",
        });
      } else {
        setForm(blank);
      }
    }
  }, [open, retailer]);
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === "Escape" && !saving && close();
    document.addEventListener("keydown", fn);
    return () => document.removeEventListener("keydown", fn);
  }, [open, saving, close]);
  if (!open) return null;
  const set =
    (k: keyof Form) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setErrors((x) => ({ ...x, [k]: undefined, form: undefined }));
    };
  const validate = () => {
    const x: typeof errors = {};
    (["name", "ownerName", "phone", "address", "city"] as const).forEach(
      (k) => {
        if (!form[k].trim()) x[k] = "This field is required.";
      },
    );
    if (portal === "manager" && !form.assignedSalespersonId)
      x.assignedSalespersonId = "Select a salesperson.";
    if (form.phone && !phone.test(form.phone))
      x.phone = "Enter a valid mobile number.";
    if (form.alternateMobile && !phone.test(form.alternateMobile))
      x.alternateMobile = "Enter a valid alternate mobile number.";
    if (form.email && !email.test(form.email))
      x.email = "Enter a valid email address.";
    if (!!form.latitude !== !!form.longitude)
      x.latitude = "Enter both latitude and longitude.";
    if (
      form.latitude &&
      (Number(form.latitude) < -90 || Number(form.latitude) > 90)
    )
      x.latitude = "Latitude must be between -90 and 90.";
    if (
      form.longitude &&
      (Number(form.longitude) < -180 || Number(form.longitude) > 180)
    )
      x.longitude = "Longitude must be between -180 and 180.";
    if (form.creditLimitLkr && Number(form.creditLimitLkr) < 0)
      x.creditLimitLkr = "Credit limit cannot be negative.";
    setErrors(x);
    return !Object.keys(x).length;
  };
  const locate = async () => {
    if (!userId) return;
    setLocating(true);
    try {
      const p = await capturePreciseGpsPoint(userId);
      setForm((f) => ({
        ...f,
        latitude: String(p.latitude),
        longitude: String(p.longitude),
      }));
    } catch (e) {
      setErrors((x) => ({
        ...x,
        form:
          e instanceof Error ? e.message : "Could not capture GPS location.",
      }));
    } finally {
      setLocating(false);
    }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        name: form.name.trim(),
        ownerName: form.ownerName.trim(),
        phone: form.phone.trim(),
        alternateMobile: optional(form.alternateMobile),
        nicNumber: optional(form.nicNumber),
        brNumber: optional(form.brNumber),
        email: optional(form.email),
        address: form.address.trim(),
        city: form.city.trim(),
        latitude: form.latitude ? Number(form.latitude) : undefined,
        longitude: form.longitude ? Number(form.longitude) : undefined,
        assignedSalespersonId:
          portal === "manager" ? form.assignedSalespersonId : undefined,
        creditLimitLkr: Number(form.creditLimitLkr || 0),
        paymentTerms: optional(form.paymentTerms),
        active: form.active === "true",
        notes: optional(form.notes),
      };

      if (retailer?.id) {
        await apiRequest(`/api/v1/shops/${retailer.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        showToast("Retailer updated successfully", undefined, "success");
      } else {
        await apiRequest("/api/v1/shops", {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            outstandingBalanceLkr: 0,
            preferredProducts: [],
            requiredProducts: [],
            productCategories: [],
            preferredVisitDays: [],
            paymentMethod: "CASH",
          }),
        });
        showToast("Retailer added successfully", undefined, "success");
      }
      setForm(blank);
      await saved();
    } catch (e) {
      setErrors({
        form:
          e instanceof ApiError && e.code === "DUPLICATE_RETAILER"
            ? "A retailer with this shop name, mobile, NIC or business registration number already exists."
            : e instanceof Error
              ? e.message
              : "Could not save the retailer.",
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && close()}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-title"
        className="my-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-h-[calc(100dvh-3rem)]"
      >
        <header className="sticky top-0 z-10 flex justify-between border-b bg-white/95 px-6 py-5 backdrop-blur">
          <div>
            <p className="text-xs font-black uppercase tracking-[.18em] text-indigo-600">
              Customer network
            </p>
            <h2 id="add-title" className="text-2xl font-black text-slate-900">
              {retailer ? "Edit Retailer" : "Add Retailer"}
            </h2>
            <p className="text-sm text-slate-500">
              {retailer
                ? "Update retailer credentials, contact information and assignment."
                : "Create a retailer in your organization’s permanent directory."}
            </p>
          </div>
          <button
            disabled={saving}
            onClick={close}
            aria-label="Close"
            className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"
          >
            <X className="h-5" />
          </button>
        </header>
        <form onSubmit={submit} className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 sm:p-6 md:grid-cols-2">
          {errors.form && (
            <div
              role="alert"
              className="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"
            >
              {errors.form}
            </div>
          )}
          <Input
            label="Shop / Retailer Name"
            required
            value={form.name}
            onChange={set("name")}
            error={errors.name}
          />
          <Input
            label="Owner Name"
            required
            value={form.ownerName}
            onChange={set("ownerName")}
            error={errors.ownerName}
          />
          <Input
            label="Mobile Number"
            required
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            error={errors.phone}
          />
          <Input
            label="Alternate Mobile"
            type="tel"
            value={form.alternateMobile}
            onChange={set("alternateMobile")}
            error={errors.alternateMobile}
          />
          <Input
            label="NIC / Passport"
            value={form.nicNumber}
            onChange={set("nicNumber")}
          />
          <Input
            label="Business Registration Number"
            value={form.brNumber}
            onChange={set("brNumber")}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={set("email")}
            error={errors.email}
          />
          <Input
            label="Area / City"
            required
            value={form.city}
            onChange={set("city")}
            error={errors.city}
          />
          <label className="md:col-span-2">
            <Label text="Address" required />
            <textarea
              value={form.address}
              onChange={set("address")}
              rows={3}
              className="input w-full resize-y text-slate-900"
            />
            {errors.address && <Err>{errors.address}</Err>}
          </label>
          <div className="md:col-span-2 rounded-2xl border bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-800">GPS Location</p>
                <p className="text-xs text-slate-500">
                  Enter coordinates or capture the current position.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void locate()}
                disabled={locating}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-50"
              >
                <LocateFixed className="h-4" />
                {locating ? "Locating…" : "Use current location"}
              </button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Latitude"
                type="number"
                step="any"
                value={form.latitude}
                onChange={set("latitude")}
                error={errors.latitude}
              />
              <Input
                label="Longitude"
                type="number"
                step="any"
                value={form.longitude}
                onChange={set("longitude")}
                error={errors.longitude}
              />
            </div>
          </div>
          {portal === "manager" && (
            <label>
              <Label text="Assigned Salesperson" required />
              <select
                value={form.assignedSalespersonId}
                onChange={set("assignedSalespersonId")}
                className="input w-full text-slate-900"
              >
                <option value="">Select salesperson</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              {errors.assignedSalespersonId && (
                <Err>{errors.assignedSalespersonId}</Err>
              )}
            </label>
          )}
          <Input
            label="Credit Limit"
            type="number"
            min="0"
            step="0.01"
            value={form.creditLimitLkr}
            onChange={set("creditLimitLkr")}
            error={errors.creditLimitLkr}
          />
          <Input
            label="Payment Terms"
            value={form.paymentTerms}
            onChange={set("paymentTerms")}
            placeholder="e.g. Net 30 days"
          />
          <label>
            <Label text="Status" />
            <select
              value={form.active}
              onChange={set("active")}
              className="input w-full text-slate-900"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </label>
          <label className="md:col-span-2">
            <Label text="Notes" />
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={4}
              className="input w-full resize-y text-slate-900"
            />
          </label>
          <footer className="sticky bottom-0 md:col-span-2 -mx-5 -mb-5 mt-2 flex justify-end gap-3 border-t bg-white px-5 py-4 sm:-mx-6 sm:-mb-6 sm:px-6">
            <button
              type="button"
              disabled={saving}
              onClick={close}
              className="rounded-xl border px-5 py-2.5 text-sm font-bold text-slate-700"
            >
              Cancel
            </button>
            <button
              disabled={saving}
              className="min-w-36 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : retailer ? "Update Retailer" : "Save Retailer"}
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
};
const Label = ({ text, required }: { text: string; required?: boolean }) => (
  <span className="mb-1.5 block text-xs font-bold text-slate-700">
    {text}
    {required && <span className="text-rose-500"> *</span>}
  </span>
);
const Err = ({ children }: { children: React.ReactNode }) => (
  <span className="mt-1 block text-xs font-semibold text-rose-600">
    {children}
  </span>
);
const Input = ({
  label,
  required,
  error,
  ...p
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  required?: boolean;
  error?: string;
}) => (
  <label>
    <Label text={label} required={required} />
    <input
      {...p}
      aria-invalid={!!error}
      className={`input w-full text-slate-900 ${error ? "border-rose-400" : ""}`}
    />
    {error && <Err>{error}</Err>}
  </label>
);
const Summary = ({ retailer, close }: { retailer?: Row; close: () => void }) =>
  !retailer ? null : (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <aside className="my-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:p-6">
        <div className="flex justify-between">
          <div>
            <p className="text-xs font-bold text-indigo-600">
              {retailer.retailerCode || "PENDING"}
            </p>
            <h2 className="text-2xl font-black text-slate-900">
              {retailer.name}
            </h2>
          </div>
          <button onClick={close}>
            <X />
          </button>
        </div>
        {retailer.images?.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">Shop photos</h3>
            <div className="grid grid-cols-2 gap-3">
              {retailer.images.map((image: Row) => (
                <a key={image.id} href={image.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                  <img src={image.url} alt={`${retailer.name} shop`} className="h-32 w-full object-cover" />
                  <p className="px-3 py-2 text-xs font-semibold text-slate-600">{image.type?.replaceAll("_", " ") || "Shop photo"}</p>
                </a>
              ))}
            </div>
          </section>
        )}
        <dl className="mt-8 grid gap-5 sm:grid-cols-2">
          {[
            ["Owner", retailer.ownerName],
            ["Mobile", retailer.phone],
            ["Alternate mobile", retailer.alternateMobile || "—"],
            ["Email", retailer.email || "—"],
            ["NIC / Passport", retailer.nicNumber || "—"],
            ["Business registration", retailer.brNumber || "—"],
            ["Area / City", retailer.city],
            ["Address", retailer.address],
            ["Latitude", retailer.latitude ? Number(retailer.latitude).toFixed(6) : "—"],
            ["Longitude", retailer.longitude ? Number(retailer.longitude).toFixed(6) : "—"],
            [
              "Assigned salesperson",
              retailer.assignedSalesperson?.name || "Unassigned",
            ],
            [
              "Credit limit",
              `LKR ${Number(retailer.creditLimitLkr || 0).toLocaleString()}`,
            ],
            ["Payment terms", retailer.paymentTerms || "—"],
            ["Status", retailer.active ? "Active" : "Inactive"],
          ].map(([l, v]) => (
            <div key={l}>
              <dt className="text-xs font-bold uppercase text-slate-400">
                {l}
              </dt>
              <dd className="mt-1 font-semibold text-slate-800">{v}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  );
