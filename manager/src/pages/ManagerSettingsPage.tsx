import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { useToast } from "../context/ToastContext";
import {
  Bell,
  Clock3,
  DollarSign,
  Link2,
  Loader2,
  LocateFixed,
  MapPin,
  Save,
  Settings,
  Shield,
} from "lucide-react";
import { PasskeySettings } from "../components/auth/PasskeySettings";
import {
  loadTenantSettings,
  saveTenantSettings,
  TenantSettings,
  WorkingDay,
} from "../services/settingsApi";

const defaults: TenantSettings = {
  gpsTrackingEnabled: true,
  gpsUpdateIntervalSeconds: 30,
  gpsAccuracyThresholdMeters: 100,
  attendanceRequireGps: true,
  attendanceLateGraceMinutes: 15,
  attendanceAllowManualEdits: false,
  workingStart: "08:00",
  workingEnd: "17:00",
  timezone: "Asia/Colombo",
  workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
  geofenceEnabled: true,
  geofenceRadiusMeters: 100,
  geofenceBlockOutside: true,
  commissionEnabled: true,
  commissionRatePercent: 2.5,
  commissionMinimumRevenueLkr: 0,
  sessionTimeoutMinutes: 480,
  requirePasskeyForManagers: false,
  notifyLateArrival: true,
  notifyGeofenceViolation: true,
  notifyDailySummary: true,
  emailNotificationsEnabled: true,
  mapProvider: "OPENSTREETMAP",
  routingProvider: "OSRM",
  webhookEnabled: false,
  webhookUrl: "",
};

const days: Array<{ value: WorkingDay; label: string }> = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
];
const inputClass = "w-full px-4 py-2.5 text-xs rounded-xl glass-input";

export const ManagerSettingsPage: React.FC = () => {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<TenantSettings>(defaults);
  const [savedSettings, setSavedSettings] = useState<TenantSettings>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(savedSettings),
    [settings, savedSettings],
  );

  useEffect(() => {
    void loadTenantSettings()
      .then((loaded) => {
        setSettings(loaded);
        setSavedSettings(loaded);
        setError("");
      })
      .catch((requestError) => {
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Unable to load system settings.",
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const update = <K extends keyof TenantSettings>(
    key: K,
    value: TenantSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (settings.workingStart === settings.workingEnd) {
      setError("Shift start and end times must be different.");
      return;
    }
    if (
      settings.webhookEnabled &&
      !settings.webhookUrl.startsWith("https://")
    ) {
      setError("An HTTPS webhook URL is required when webhooks are enabled.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await saveTenantSettings(settings);
      setSettings(saved);
      setSavedSettings(saved);
      showToast(
        "Settings Saved",
        "Enterprise operating policies were updated successfully.",
        "success",
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to save system settings.";
      setError(message);
      showToast("Settings Not Saved", message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ManagerLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6 text-cyan-400" />
            <span>System & Fleet Settings</span>
          </h2>
          <p className="text-xs text-slate-400">
            Configure geo-fencing radius, agent commissions, working hours, and
            alert thresholds
          </p>
        </div>
      </div>

      <GlassCard className="p-8 max-w-3xl">
        {loading ? (
          <div className="min-h-48 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
            Loading system settings…
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-6">
            <Section
              title="GPS Tracking"
              icon={<LocateFixed className="w-4 h-4" />}
            >
              <Toggle
                label="Enable live GPS tracking"
                hint="Allows authenticated field agents to publish location telemetry"
                checked={settings.gpsTrackingEnabled}
                onChange={(value) => update("gpsTrackingEnabled", value)}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <NumberField
                  label="Update Interval (Seconds)"
                  hint="5–300 seconds"
                  value={settings.gpsUpdateIntervalSeconds}
                  min={5}
                  max={300}
                  onChange={(value) =>
                    update("gpsUpdateIntervalSeconds", value)
                  }
                  disabled={!settings.gpsTrackingEnabled}
                />
                <NumberField
                  label="Required Accuracy (Meters)"
                  hint="Reject GPS fixes less accurate than this threshold"
                  value={settings.gpsAccuracyThresholdMeters}
                  min={5}
                  max={500}
                  onChange={(value) =>
                    update("gpsAccuracyThresholdMeters", value)
                  }
                  disabled={!settings.gpsTrackingEnabled}
                />
              </div>
            </Section>

            <Section title="Attendance" icon={<Clock3 className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Toggle
                  label="Require GPS for attendance"
                  hint="Check-in and checkout must include a valid location"
                  checked={settings.attendanceRequireGps}
                  onChange={(value) => update("attendanceRequireGps", value)}
                />
                <Toggle
                  label="Allow manager corrections"
                  hint="Permits audited manual attendance corrections"
                  checked={settings.attendanceAllowManualEdits}
                  onChange={(value) =>
                    update("attendanceAllowManualEdits", value)
                  }
                />
              </div>
              <NumberField
                label="Late Arrival Grace Period (Minutes)"
                hint="0–120 minutes after shift start"
                value={settings.attendanceLateGraceMinutes}
                min={0}
                max={120}
                onChange={(value) =>
                  update("attendanceLateGraceMinutes", value)
                }
              />
            </Section>

            <Section
              title="Working Hours"
              icon={<Clock3 className="w-4 h-4" />}
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field label="Shift Start">
                  <input
                    type="time"
                    required
                    value={settings.workingStart}
                    onChange={(event) =>
                      update("workingStart", event.target.value)
                    }
                    className={`${inputClass} bg-slate-900`}
                  />
                </Field>
                <Field label="Shift End">
                  <input
                    type="time"
                    required
                    value={settings.workingEnd}
                    onChange={(event) =>
                      update("workingEnd", event.target.value)
                    }
                    className={`${inputClass} bg-slate-900`}
                  />
                </Field>
                <Field label="Timezone">
                  <select
                    value={settings.timezone}
                    onChange={(event) =>
                      update(
                        "timezone",
                        event.target.value as TenantSettings["timezone"],
                      )
                    }
                    className={`${inputClass} bg-slate-900`}
                  >
                    <option value="Asia/Colombo">Asia/Colombo</option>
                    <option value="UTC">UTC</option>
                  </select>
                </Field>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase mb-2">
                  Working Days
                </label>
                <div className="flex flex-wrap gap-2">
                  {days.map((day) => {
                    const selected = settings.workingDays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => {
                          const next = selected
                            ? settings.workingDays.filter(
                                (value) => value !== day.value,
                              )
                            : [...settings.workingDays, day.value];
                          if (next.length) update("workingDays", next);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${selected ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20" : "text-slate-400 hover:text-white bg-slate-900/60"}`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </Section>

            <Section title="Geo-Fencing" icon={<MapPin className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Toggle
                  label="Enable shop geo-fences"
                  hint="Verify shop visits against configured coordinates"
                  checked={settings.geofenceEnabled}
                  onChange={(value) => update("geofenceEnabled", value)}
                />
                <Toggle
                  label="Block outside-radius check-ins"
                  hint="Prevent check-ins beyond the permitted radius"
                  checked={settings.geofenceBlockOutside}
                  onChange={(value) => update("geofenceBlockOutside", value)}
                  disabled={!settings.geofenceEnabled}
                />
              </div>
              <NumberField
                label="Shop Check-In Radius (Meters)"
                hint="25–5,000 meters"
                value={settings.geofenceRadiusMeters}
                min={25}
                max={5000}
                onChange={(value) => update("geofenceRadiusMeters", value)}
                disabled={!settings.geofenceEnabled}
              />
            </Section>

            <Section
              title="Commission"
              icon={<DollarSign className="w-4 h-4" />}
            >
              <Toggle
                label="Enable sales commission"
                hint="Apply the configured rate to eligible booked revenue"
                checked={settings.commissionEnabled}
                onChange={(value) => update("commissionEnabled", value)}
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <NumberField
                  label="Commission Rate (%)"
                  hint="0–100%"
                  value={settings.commissionRatePercent}
                  min={0}
                  max={100}
                  step={0.1}
                  onChange={(value) => update("commissionRatePercent", value)}
                  disabled={!settings.commissionEnabled}
                />
                <NumberField
                  label="Minimum Revenue (LKR)"
                  hint="Revenue required before commission applies"
                  value={settings.commissionMinimumRevenueLkr}
                  min={0}
                  max={1_000_000_000}
                  onChange={(value) =>
                    update("commissionMinimumRevenueLkr", value)
                  }
                  disabled={!settings.commissionEnabled}
                />
              </div>
            </Section>

            <Section title="Security" icon={<Shield className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <NumberField
                  label="Session Timeout (Minutes)"
                  hint="15 minutes–7 days"
                  value={settings.sessionTimeoutMinutes}
                  min={15}
                  max={10080}
                  onChange={(value) => update("sessionTimeoutMinutes", value)}
                />
                <Toggle
                  label="Require passkeys for managers"
                  hint="Enforce phishing-resistant authentication policy"
                  checked={settings.requirePasskeyForManagers}
                  onChange={(value) =>
                    update("requirePasskeyForManagers", value)
                  }
                />
              </div>
            </Section>

            <Section title="Notifications" icon={<Bell className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Toggle
                  label="Email notifications"
                  hint="Enable operational emails for this workspace"
                  checked={settings.emailNotificationsEnabled}
                  onChange={(value) =>
                    update("emailNotificationsEnabled", value)
                  }
                />
                <Toggle
                  label="Late arrival alerts"
                  hint="Notify managers when grace time is exceeded"
                  checked={settings.notifyLateArrival}
                  onChange={(value) => update("notifyLateArrival", value)}
                />
                <Toggle
                  label="Geo-fence violation alerts"
                  hint="Notify managers of blocked or invalid visits"
                  checked={settings.notifyGeofenceViolation}
                  onChange={(value) => update("notifyGeofenceViolation", value)}
                />
                <Toggle
                  label="Daily operations summary"
                  hint="Send attendance and field activity summary"
                  checked={settings.notifyDailySummary}
                  onChange={(value) => update("notifyDailySummary", value)}
                />
              </div>
            </Section>

            <Section title="Integrations" icon={<Link2 className="w-4 h-4" />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Map Provider">
                  <select
                    value={settings.mapProvider}
                    onChange={(event) =>
                      update(
                        "mapProvider",
                        event.target.value as TenantSettings["mapProvider"],
                      )
                    }
                    className={`${inputClass} bg-slate-900`}
                  >
                    <option value="OPENSTREETMAP">OpenStreetMap</option>
                    <option value="GOOGLE_MAPS">Google Maps</option>
                  </select>
                </Field>
                <Field label="Routing Provider">
                  <select
                    value={settings.routingProvider}
                    onChange={(event) =>
                      update(
                        "routingProvider",
                        event.target.value as TenantSettings["routingProvider"],
                      )
                    }
                    className={`${inputClass} bg-slate-900`}
                  >
                    <option value="OSRM">OSRM</option>
                    <option value="GOOGLE_DIRECTIONS">Google Directions</option>
                  </select>
                </Field>
              </div>
              <Toggle
                label="Outbound event webhook"
                hint="Send operational events to an approved HTTPS endpoint"
                checked={settings.webhookEnabled}
                onChange={(value) => update("webhookEnabled", value)}
              />
              {settings.webhookEnabled && (
                <Field label="Webhook URL">
                  <input
                    type="url"
                    required
                    placeholder="https://example.com/reproutes/events"
                    value={settings.webhookUrl}
                    onChange={(event) =>
                      update("webhookUrl", event.target.value)
                    }
                    className={inputClass}
                  />
                </Field>
              )}
            </Section>

            {error && (
              <p role="alert" className="text-xs font-semibold text-rose-400">
                {error}
              </p>
            )}
            <div className="pt-4 border-t border-slate-800 flex justify-end">
              <button
                type="submit"
                disabled={!dirty || saving}
                className="px-6 py-3 rounded-xl text-xs font-bold text-white glass-button-primary flex items-center gap-2 cursor-pointer disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>
                  {saving
                    ? "Saving Settings…"
                    : dirty
                      ? "Save System Settings"
                      : "Settings Up to Date"}
                </span>
              </button>
            </div>
          </form>
        )}
      </GlassCard>

      <GlassCard className="p-8 max-w-3xl">
        <PasskeySettings />
      </GlassCard>
    </ManagerLayout>
  );
};

const Section: React.FC<{
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, icon, children }) => (
  <section className="space-y-4">
    <h3 className="text-sm font-bold text-cyan-400 uppercase tracking-wider border-b border-slate-800 pb-2 flex items-center gap-2">
      {icon}
      {title}
    </h3>
    {children}
  </section>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="block">
    <span className="block text-xs font-bold text-slate-300 uppercase mb-1">
      {label}
    </span>
    {children}
  </label>
);

const NumberField: React.FC<{
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ label, hint, value, min, max, step = 1, disabled, onChange }) => (
  <Field label={label}>
    <input
      type="number"
      required
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className={`${inputClass} disabled:opacity-50`}
    />
    <span className="text-[10px] text-slate-500 mt-1 block">{hint}</span>
  </Field>
);

const Toggle: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, hint, checked, disabled, onChange }) => (
  <label
    className={`flex items-start justify-between gap-4 p-3 rounded-xl bg-slate-900/60 border border-slate-800 ${disabled ? "opacity-50" : "cursor-pointer"}`}
  >
    <span>
      <span className="text-xs font-bold text-white block">{label}</span>
      <span className="text-[10px] text-slate-500 block mt-0.5">{hint}</span>
    </span>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className="mt-1 h-4 w-4 accent-cyan-500 shrink-0"
    />
  </label>
);
