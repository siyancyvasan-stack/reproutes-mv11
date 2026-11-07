import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  CreditCard,
  FileText,
  LocateFixed,
  MapPin,
  Phone,
  Store,
  User,
} from "lucide-react";
import { AgentLayout } from "../components/layout/AgentLayout";
import { GlassCard } from "../components/common/GlassCard";
import { ImageUploadField } from "../components/common/ImageUploadField";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ApiError, apiRequest } from "../services/apiClient";
import { capturePreciseGpsPoint } from "../services/deviceGps";

type ShopForm = {
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
  retailerType: string;
  creditLimitLkr: string;
  paymentTerms: string;
  active: "true" | "false";
  notes: string;
};

const blankForm: ShopForm = {
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
  retailerType: "Grocery",
  creditLimitLkr: "0",
  paymentTerms: "Cash",
  active: "true",
  notes: "",
};

const phoneRegex = /^\+?[0-9][0-9\s()-]{6,19}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const optional = (v: string) => v.trim() || undefined;

export const ShopCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [form, setForm] = useState<ShopForm>(blankForm);
  const [errors, setErrors] = useState<
    Partial<Record<keyof ShopForm | "form", string>>
  >({});
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [shopPhoto, setShopPhoto] = useState<File | undefined>();
  const [generatedShopId, setGeneratedShopId] = useState("");

  const setField =
    (k: keyof ShopForm) =>
    (
      e: React.ChangeEvent<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >,
    ) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setErrors((prev) => ({ ...prev, [k]: undefined, form: undefined }));
    };

  const validate = () => {
    const errs: typeof errors = {};
    (["name", "ownerName", "phone", "address", "city"] as const).forEach(
      (k) => {
        if (!form[k].trim()) errs[k] = "This field is required.";
      },
    );

    if (form.phone && !phoneRegex.test(form.phone)) {
      errs.phone = "Enter a valid mobile number.";
    }
    if (form.alternateMobile && !phoneRegex.test(form.alternateMobile)) {
      errs.alternateMobile = "Enter a valid alternate mobile number.";
    }
    if (form.email && !emailRegex.test(form.email)) {
      errs.email = "Enter a valid email address.";
    }
    if (!!form.latitude !== !!form.longitude) {
      errs.latitude = "Enter both latitude and longitude.";
    }
    if (
      form.latitude &&
      (Number(form.latitude) < -90 || Number(form.latitude) > 90)
    ) {
      errs.latitude = "Latitude must be between -90 and 90.";
    }
    if (
      form.longitude &&
      (Number(form.longitude) < -180 || Number(form.longitude) > 180)
    ) {
      errs.longitude = "Longitude must be between -180 and 180.";
    }
    if (form.creditLimitLkr && Number(form.creditLimitLkr) < 0) {
      errs.creditLimitLkr = "Credit limit cannot be negative.";
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const locate = async () => {
    if (!user?.id) return;
    setLocating(true);
    setErrors((prev) => ({
      ...prev,
      latitude: undefined,
      longitude: undefined,
      form: undefined,
    }));
    try {
      const p = await capturePreciseGpsPoint(user.id);
      setForm((f) => ({
        ...f,
        latitude: String(p.latitude),
        longitude: String(p.longitude),
      }));
      showToast("Location Captured", "GPS coordinates updated.", "info");
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        form:
          e instanceof Error
            ? e.message
            : "Could not capture current GPS location.",
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
      const createdShop = await apiRequest<{ id: string; retailerCode?: string }>("/api/v1/shops", {
        method: "POST",
        body: JSON.stringify({
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
          creditLimitLkr: Number(form.creditLimitLkr || 0),
          paymentTerms: optional(form.paymentTerms),
          retailerType: form.retailerType || undefined,
          active: form.active === "true",
          notes: optional(form.notes),
          outstandingBalanceLkr: 0,
          preferredProducts: [],
          requiredProducts: [],
          productCategories: [],
          preferredVisitDays: [],
          paymentMethod: "CASH",
        }),
      });
      setGeneratedShopId(createdShop.retailerCode ?? "");

      if (shopPhoto && createdShop?.id) {
        try {
          const photoData = new FormData();
          photoData.append("image", shopPhoto);
          photoData.append("type", "STOREFRONT");
          photoData.append("isPrimary", "true");
          await apiRequest(`/api/v1/shops/${createdShop.id}/images`, {
            method: "POST",
            body: photoData,
          });
        } catch (imgError) {
          console.warn("Could not upload storefront photo:", imgError);
        }
      }

      showToast(
        "Shop Registered",
        `${form.name} was successfully registered${createdShop.retailerCode ? ` · Shop ID: ${createdShop.retailerCode}` : ""}.`,
        "success",
      );
      navigate("/sales/shops");
    } catch (e) {
      setErrors({
        form:
          e instanceof ApiError && e.code === "DUPLICATE_RETAILER"
            ? "A retailer with this shop name, mobile, NIC or BR number already exists."
            : e instanceof Error
              ? e.message
              : "Could not save the shop registration.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AgentLayout>
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        {/* Page Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate("/sales/shops")}
              className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              aria-label="Back to shops"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <Store className="w-5 h-5 text-indigo-400" />
                <h1 className="text-2xl font-black text-white">
                  Register New Shop
                </h1>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Add a new retailer to your territory and customer network
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate("/sales/shops")}
            className="hidden sm:inline-flex rounded-xl border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>

        {/* Global Error Banner */}
        {errors.form && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm font-semibold text-rose-300 backdrop-blur-md"
          >
            {errors.form}
          </div>
        )}

        {/* Form Container (In Page) */}
        <form onSubmit={submit} className="space-y-6">
          {/* Section 1: Basic Information */}
          <GlassCard className="p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
              <Building2 className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Shop Information
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Shop ID (10 digits)">
                <input
                  type="text"
                  value={generatedShopId || "Generated after registration"}
                  readOnly
                  aria-label="Shop ID"
                  className="input w-full bg-slate-800/60 text-cyan-300 font-mono tracking-widest"
                />
                <span className="mt-1 block text-[11px] text-slate-400">Generated automatically when the shop is registered.</span>
              </Field>
              <Field label="Shop / Retailer Name" required error={errors.name}>
                <input
                  type="text"
                  required
                  placeholder="e.g. Perera Grocery"
                  value={form.name}
                  onChange={setField("name")}
                  className={`input w-full ${errors.name ? "border-rose-400" : ""}`}
                />
              </Field>

              <Field label="Owner Name" required error={errors.ownerName}>
                <input
                  type="text"
                  required
                  placeholder="e.g. Sunil Perera"
                  value={form.ownerName}
                  onChange={setField("ownerName")}
                  className={`input w-full ${errors.ownerName ? "border-rose-400" : ""}`}
                />
              </Field>

              <Field label="Retailer Type">
                <select
                  value={form.retailerType}
                  onChange={setField("retailerType")}
                  className="input w-full text-slate-900"
                >
                  <option value="Grocery">Grocery</option>
                  <option value="Supermarket">Supermarket</option>
                  <option value="Mini Mart">Mini Mart</option>
                  <option value="Restaurant">Restaurant</option>
                  <option value="Hotel">Hotel</option>
                  <option value="Pharmacy">Pharmacy</option>
                  <option value="Wholesale">Wholesale</option>
                  <option value="Other">Other</option>
                </select>
              </Field>

              <Field label="Status">
                <select
                  value={form.active}
                  onChange={setField("active")}
                  className="input w-full text-slate-900"
                >
                  <option value="true">Active</option>
                  <option value="false">Inactive</option>
                </select>
              </Field>
            </div>
          </GlassCard>

          {/* Section 2: Contact Details */}
          <GlassCard className="p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
              <Phone className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Contact & Legal Information
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Mobile Number" required error={errors.phone}>
                <input
                  type="tel"
                  required
                  placeholder="07XXXXXXXX"
                  value={form.phone}
                  onChange={setField("phone")}
                  className={`input w-full ${errors.phone ? "border-rose-400" : ""}`}
                />
              </Field>

              <Field
                label="Alternate Mobile"
                error={errors.alternateMobile}
              >
                <input
                  type="tel"
                  placeholder="Optional secondary phone"
                  value={form.alternateMobile}
                  onChange={setField("alternateMobile")}
                  className={`input w-full ${errors.alternateMobile ? "border-rose-400" : ""}`}
                />
              </Field>

              <Field label="Email Address" error={errors.email}>
                <input
                  type="email"
                  placeholder="shop@example.com"
                  value={form.email}
                  onChange={setField("email")}
                  className={`input w-full ${errors.email ? "border-rose-400" : ""}`}
                />
              </Field>

              <Field label="NIC / Passport Number">
                <input
                  type="text"
                  placeholder="National Identity Card"
                  value={form.nicNumber}
                  onChange={setField("nicNumber")}
                  className="input w-full"
                />
              </Field>

              <Field label="Business Registration (BR) Number">
                <input
                  type="text"
                  placeholder="e.g. PV/12345"
                  value={form.brNumber}
                  onChange={setField("brNumber")}
                  className="input w-full"
                />
              </Field>
            </div>
          </GlassCard>

          {/* Section 3: Location & Coordinates */}
          <GlassCard className="p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
              <MapPin className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Location & Address
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Area / City" required error={errors.city}>
                <input
                  type="text"
                  required
                  placeholder="e.g. Colombo 03, Kandy, Galle"
                  value={form.city}
                  onChange={setField("city")}
                  className={`input w-full ${errors.city ? "border-rose-400" : ""}`}
                />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Full Address" required error={errors.address}>
                  <textarea
                    required
                    rows={3}
                    placeholder="Street name, building number, nearby landmarks..."
                    value={form.address}
                    onChange={setField("address")}
                    className={`input w-full resize-y ${errors.address ? "border-rose-400" : ""}`}
                  />
                </Field>
              </div>

              {/* GPS Subcard */}
              <div className="sm:col-span-2 rounded-xl border border-slate-700/50 bg-slate-900/60 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-bold text-white">
                      GPS Coordinates
                    </p>
                    <p className="text-xs text-slate-400">
                      Capture precise location at the store or enter manual coordinates
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void locate()}
                    disabled={locating}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600/20 border border-indigo-500/40 px-3.5 py-2 text-xs font-bold text-indigo-300 hover:bg-indigo-600/30 transition-colors disabled:opacity-50"
                  >
                    <LocateFixed className="w-4 h-4" />
                    {locating ? "Acquiring GPS…" : "Capture Location"}
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Latitude" error={errors.latitude}>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 6.9271"
                      value={form.latitude}
                      onChange={setField("latitude")}
                      className={`input w-full ${errors.latitude ? "border-rose-400" : ""}`}
                    />
                  </Field>
                  <Field label="Longitude" error={errors.longitude}>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 79.8612"
                      value={form.longitude}
                      onChange={setField("longitude")}
                      className={`input w-full ${errors.longitude ? "border-rose-400" : ""}`}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </GlassCard>

          {/* Section 4: Store Photo */}
          <GlassCard className="p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
              <Store className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Storefront Photo
              </h2>
            </div>
            <p className="text-xs text-slate-400">
              Upload a clear photo of the shop front for verification and visit guidance.
            </p>
            <ImageUploadField
              label="Storefront Photo (Optional)"
              file={shopPhoto}
              onChange={setShopPhoto}
              disabled={saving}
              tone="dark"
            />
          </GlassCard>

          {/* Section 5: Commercial Terms & Notes */}
          <GlassCard className="p-6 space-y-5">
            <div className="flex items-center gap-2 border-b border-slate-700/60 pb-3">
              <CreditCard className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Commercial Terms & Notes
              </h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Credit Limit (LKR)"
                error={errors.creditLimitLkr}
              >
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={form.creditLimitLkr}
                  onChange={setField("creditLimitLkr")}
                  className={`input w-full ${errors.creditLimitLkr ? "border-rose-400" : ""}`}
                />
              </Field>

              <Field label="Payment Terms">
                <input
                  type="text"
                  placeholder="e.g. Cash, Net 14, Net 30"
                  value={form.paymentTerms}
                  onChange={setField("paymentTerms")}
                  className="input w-full"
                />
              </Field>

              <div className="sm:col-span-2">
                <Field label="Special Notes / Instructions">
                  <textarea
                    rows={3}
                    placeholder="Preferred delivery times, key decision makers, special instructions..."
                    value={form.notes}
                    onChange={setField("notes")}
                    className="input w-full resize-y"
                  />
                </Field>
              </div>
            </div>
          </GlassCard>

          {/* Submit Action Bar */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => navigate("/sales/shops")}
              className="w-full sm:w-auto rounded-xl border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="w-full sm:w-auto min-w-44 rounded-xl bg-indigo-600 px-7 py-3 text-sm font-bold text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-60"
            >
              {saving ? "Registering Shop…" : "Register Shop"}
            </button>
          </div>
        </form>
      </div>
    </AgentLayout>
  );
};

const Field = ({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) => (
  <label className="block">
    <span className="mb-1.5 block text-xs font-bold text-slate-300">
      {label}
      {required && <span className="text-rose-400"> *</span>}
    </span>
    {children}
    {error && (
      <span className="mt-1 block text-xs font-semibold text-rose-400">
        {error}
      </span>
    )}
  </label>
);

export default ShopCreatePage;

