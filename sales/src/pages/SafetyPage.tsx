import React, { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BatteryLow,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Edit3,
  ExternalLink,
  Gauge,
  Loader2,
  MapPin,
  MessageCircle,
  MoreVertical,
  Phone,
  Plus,
  Search,
  ShieldAlert,
  Siren,
  Trash2,
  UserRound,
  WifiOff,
  X,
} from "lucide-react";
import { io } from "socket.io-client";
import { AgentLayout } from "../components/layout/AgentLayout";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  apiBlob,
  ensureAccessToken,
  getAccessToken,
} from "../services/apiClient";
import {
  archiveSafetyEvent,
  bulkArchiveSafetyEvents,
  bulkResolveSafetyEvents,
  createEmergencyContact,
  createIncident,
  createSafetyEvent,
  deleteEmergencyContact,
  deleteSafetyEvent,
  EmergencyContact,
  loadEmergencyContacts,
  loadSafetyEventDetails,
  loadSafetyEvents,
  resolveSafetyEvent,
  SafetyEvent,
  SafetyEventDetails,
  SafetyFilter,
  updateEmergencyContact,
} from "../services/operationsApi";

const getLocation = () =>
  new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
    }),
  );
const filters: Array<{ value: SafetyFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "CRITICAL", label: "Critical" },
  { value: "OFFLINE", label: "Offline" },
  { value: "STATIONARY", label: "Stationary" },
  { value: "SOS", label: "SOS" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "ARCHIVED", label: "Archived" },
];
const severityTone = {
  CRITICAL: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  HIGH: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  WARNING: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  INFO: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
};
const formatDate = (value?: string) =>
  value ? new Date(value).toLocaleString() : "Not available";
const duration = (start: string, end?: string) => {
  const seconds = Math.max(
    0,
    Math.floor(
      ((end ? new Date(end).getTime() : Date.now()) -
        new Date(start).getTime()) /
        1000,
    ),
  );
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [days && `${days}d`, (hours || days) && `${hours}h`, `${minutes}m`]
    .filter(Boolean)
    .join(" ");
};
const whatsappHref = (phone: string) =>
  `https://wa.me/${phone.replace(/\D/g, "")}`;

type ActionState = {
  kind:
    | "resolve"
    | "archive"
    | "delete"
    | "permanent"
    | "bulkResolve"
    | "bulkArchive";
  event?: SafetyEvent;
} | null;

export const SafetyPage: React.FC = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const manager = user?.role !== "agent";
  const admin = user?.role === "admin";
  const [events, setEvents] = useState<SafetyEvent[]>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [filter, setFilter] = useState<SafetyFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [incident, setIncident] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [menuId, setMenuId] = useState<string>();
  const [action, setAction] = useState<ActionState>(null);
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState<SafetyEventDetails>();
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [editingContact, setEditingContact] = useState<string>();
  const [contactForm, setContactForm] = useState({
    name: "",
    phone: "",
    relationship: "",
    priority: 1,
  });
  const [, tick] = useState(0);

  const refresh = async () => {
    const [eventResult, nextContacts] = await Promise.all([
      loadSafetyEvents(filter, search),
      loadEmergencyContacts(),
    ]);
    setEvents(eventResult.items);
    setContacts(nextContacts);
    setSelected(
      (current) =>
        new Set(
          [...current].filter((id) =>
            eventResult.items.some((event) => event.id === id),
          ),
        ),
    );
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      void refresh()
        .catch((error) =>
          showToast(
            "Unable to load Safety",
            error instanceof Error ? error.message : "Try again.",
            "error",
          ),
        )
        .finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filter, search]);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    let socket: ReturnType<typeof io> | undefined;
    void ensureAccessToken()
      .then(() => {
        const configured = import.meta.env.VITE_TRACKING_SOCKET_URL?.trim();
        socket = io(configured === "same-origin" ? undefined : configured, {
          transports: ["websocket"],
          withCredentials: true,
          auth: (callback) => callback({ token: getAccessToken() }),
        });
        socket.on("safety:alert", () => void refresh());
        socket.on("safety:resolved", () => void refresh());
      })
      .catch(() => undefined);
    return () => socket?.disconnect();
  }, [filter, search]);

  const locationPayload = async () => {
    const position = await getLocation();
    const battery = await (
      navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }
    )
      .getBattery?.()
      .catch(() => undefined);
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      battery: battery ? Math.round(battery.level * 100) : undefined,
    };
  };
  const safetyAction = async (type: "sos" | "check-in") => {
    setBusy(true);
    try {
      await createSafetyEvent(type, await locationPayload());
      await refresh();
      showToast(
        type === "sos" ? "SOS Sent" : "Safety Check-In Complete",
        type === "sos"
          ? "Managers received your live GPS location."
          : "Your safety status was recorded.",
        type === "sos" ? "error" : "success",
      );
    } catch (error) {
      showToast(
        "Safety Action Failed",
        error instanceof Error
          ? error.message
          : "Location permission is required.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const reportIncident = async () => {
    if (!incident.trim()) return;
    setBusy(true);
    try {
      const location = await locationPayload();
      const form = new FormData();
      Object.entries(location).forEach(([key, value]) => {
        if (value !== undefined) form.append(key, String(value));
      });
      form.append("description", incident);
      photos.forEach((photo) => form.append("photos", photo));
      await createIncident(form);
      setIncident("");
      setPhotos([]);
      await refresh();
      showToast(
        "Incident Reported",
        "Managers received the report and GPS location.",
        "success",
      );
    } catch (error) {
      showToast(
        "Incident Failed",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const openPhoto = async (eventId: string, index: number) => {
    const blob = await apiBlob(
      `/api/v1/safety/events/${eventId}/photos/${index}`,
    );
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  const viewDetails = async (event: SafetyEvent) => {
    setMenuId(undefined);
    setDetailsLoading(true);
    setDetails({ event, history: [], audit: [] });
    try {
      setDetails(await loadSafetyEventDetails(event.id));
    } catch (error) {
      setDetails(undefined);
      showToast(
        "Unable to load incident",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setDetailsLoading(false);
    }
  };
  const submitAction = async () => {
    if (!action || reason.trim().length < 3) return;
    setBusy(true);
    try {
      if (action.kind === "resolve" && action.event)
        await resolveSafetyEvent(action.event.id, reason);
      if (action.kind === "archive" && action.event)
        await archiveSafetyEvent(action.event.id, reason);
      if (action.kind === "delete" && action.event)
        await deleteSafetyEvent(action.event.id, reason);
      if (action.kind === "permanent" && action.event)
        await deleteSafetyEvent(action.event.id, reason, true);
      if (action.kind === "bulkResolve")
        await bulkResolveSafetyEvents([...selected], reason);
      if (action.kind === "bulkArchive")
        await bulkArchiveSafetyEvents([...selected], reason);
      showToast(
        "Safety alert updated",
        "The action and reason were saved to the audit log.",
        "success",
      );
      setAction(null);
      setReason("");
      setSelected(new Set());
      await refresh();
    } catch (error) {
      showToast(
        "Action failed",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const saveContact = async () => {
    if (!contactForm.name.trim() || !contactForm.phone.trim()) return;
    setBusy(true);
    try {
      if (editingContact)
        await updateEmergencyContact(editingContact, contactForm);
      else await createEmergencyContact(contactForm);
      setEditingContact(undefined);
      setContactForm({ name: "", phone: "", relationship: "", priority: 1 });
      await refresh();
      showToast(
        "Emergency contact saved",
        "Contact details are now available to the team.",
        "success",
      );
    } catch (error) {
      showToast(
        "Contact update failed",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const removeContact = async (contact: EmergencyContact) => {
    setBusy(true);
    try {
      await deleteEmergencyContact(contact.id);
      await refresh();
      showToast(
        "Contact removed",
        `${contact.name} was safely deactivated.`,
        "success",
      );
    } catch (error) {
      showToast(
        "Delete failed",
        error instanceof Error ? error.message : "Try again.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  const allSelected =
    events.length > 0 && events.every(({ id }) => selected.has(id));
  const currentActionLabel = useMemo(
    () =>
      action?.kind.includes("Resolve") || action?.kind === "resolve"
        ? "Resolution note"
        : "Reason for this action",
    [action],
  );

  const agentControls = !manager && (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          disabled={busy}
          onClick={() => void safetyAction("sos")}
          className="flex flex-col items-center gap-3 rounded-2xl border-2 border-rose-500/50 bg-rose-500/20 p-8 font-extrabold text-rose-300 shadow-xl"
        >
          <Siren className="h-12 w-12" />
          ONE-TAP SOS
          <span className="text-xs font-normal">
            Sends live GPS and an instant manager alert
          </span>
        </button>
        <button
          disabled={busy}
          onClick={() => void safetyAction("check-in")}
          className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/15 p-8 font-extrabold text-emerald-300"
        >
          <CheckCircle2 className="h-12 w-12" />
          I'M SAFE
          <span className="text-xs font-normal">
            Record a safety check-in with location
          </span>
        </button>
      </div>
      <GlassCard className="space-y-4 p-5">
        <h3 className="text-sm font-bold uppercase text-cyan-400">
          Report an Incident
        </h3>
        <textarea
          value={incident}
          onChange={(event) => setIncident(event.target.value)}
          rows={3}
          placeholder="Describe what happened…"
          className="glass-input w-full rounded-xl px-4 py-3 text-sm"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-bold text-cyan-400">
            <Camera className="h-4 w-4" />
            Add Photos
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              onChange={(event) =>
                setPhotos(Array.from(event.target.files ?? []).slice(0, 3))
              }
            />
          </label>
          <span className="text-xs text-slate-400">
            {photos.length} of 3 photos
          </span>
          <button
            onClick={() => void reportIncident()}
            disabled={busy || !incident.trim()}
            className="glass-button-primary ml-auto rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            Submit Incident
          </button>
        </div>
      </GlassCard>
    </>
  );

  const content = (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-white">
          <ShieldAlert className="h-7 w-7 text-rose-400" />
          Enterprise Emergency & Safety
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Real-time emergency response, incident evidence and agent safety
          monitoring
        </p>
      </div>
      {agentControls}
      {manager && (
        <GlassCard className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {filters.map((item) => (
                <button
                  key={item.value}
                  onClick={() => setFilter(item.value)}
                  className={`whitespace-nowrap rounded-xl border px-3.5 py-2 text-xs font-bold transition ${filter === item.value ? "border-cyan-400/40 bg-cyan-500/20 text-cyan-300" : "border-slate-700 bg-slate-900/50 text-slate-400 hover:text-white"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label className="relative block w-full xl:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search agent, phone or code"
                className="glass-input h-11 w-full rounded-xl pl-10 pr-4 text-sm"
              />
            </label>
          </div>
          {selected.size > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-700/60 pt-4">
              <span className="mr-auto text-sm font-semibold text-slate-300">
                {selected.size} selected
              </span>
              <button
                onClick={() => {
                  setReason("");
                  setAction({ kind: "bulkResolve" });
                }}
                className="rounded-xl bg-emerald-500/15 px-4 py-2 text-xs font-bold text-emerald-300"
              >
                Bulk Resolve
              </button>
              <button
                onClick={() => {
                  setReason("");
                  setAction({ kind: "bulkArchive" });
                }}
                className="rounded-xl bg-amber-500/15 px-4 py-2 text-xs font-bold text-amber-300"
              >
                Bulk Archive
              </button>
            </div>
          )}
        </GlassCard>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <GlassCard className="p-4 sm:p-5 lg:col-span-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-bold text-white">
              Safety Event Feed
            </h3>
            {manager && events.length > 0 && (
              <label className="flex items-center gap-2 text-xs font-semibold text-slate-400">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelected(
                      allSelected
                        ? new Set()
                        : new Set(events.map(({ id }) => id)),
                    )
                  }
                  className="h-4 w-4 accent-cyan-500"
                />
                Select all
              </label>
            )}
          </div>
          {loading ? (
            <div className="grid min-h-48 place-items-center">
              <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
            </div>
          ) : !events.length ? (
            <p className="py-12 text-center text-sm text-slate-400">
              No matching safety alerts.
            </p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <article
                  key={event.id}
                  className={`relative rounded-xl border p-4 ${event.severity === "CRITICAL" && event.status === "OPEN" ? "border-rose-500/40 bg-rose-500/10" : "border-slate-800 bg-slate-900/60"}`}
                >
                  <div className="flex items-start gap-3">
                    {manager && (
                      <input
                        aria-label={`Select ${event.type} alert`}
                        type="checkbox"
                        checked={selected.has(event.id)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            next.has(event.id)
                              ? next.delete(event.id)
                              : next.add(event.id);
                            return next;
                          })
                        }
                        className="mt-1 h-4 w-4 shrink-0 accent-cyan-500"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${severityTone[event.severity]}`}
                        >
                          {event.severity}
                        </span>
                        <p className="text-sm font-bold text-white">
                          {event.type.replaceAll("_", " ")} ·{" "}
                          {event.agent?.name ?? "Sales Agent"}
                        </p>
                        <span
                          className={`rounded-full px-2 py-1 text-[10px] font-bold ${event.status === "OPEN" ? "bg-rose-500/15 text-rose-300" : "bg-emerald-500/15 text-emerald-300"}`}
                        >
                          {event.status}
                        </span>
                      </div>
                      {event.description && (
                        <p className="mt-2 text-xs leading-relaxed text-slate-400">
                          {event.description}
                        </p>
                      )}
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-3">
                        <span className="text-slate-500">
                          Alert Time
                          <strong className="block text-slate-300">
                            {formatDate(event.createdAt)}
                          </strong>
                        </span>
                        <span className="text-slate-500">
                          {event.type === "OFFLINE"
                            ? "Offline Since"
                            : "Started"}
                          <strong className="block text-slate-300">
                            {formatDate(event.alertStartedAt)}
                          </strong>
                        </span>
                        <span className="text-slate-500">
                          Duration
                          <strong className="block text-slate-300">
                            {duration(
                              event.alertStartedAt,
                              event.resolvedAt ?? event.archivedAt,
                            )}
                          </strong>
                        </span>
                        <span className="text-slate-500">
                          Last GPS Update
                          <strong className="block text-slate-300">
                            {formatDate(event.lastGpsAt)}
                          </strong>
                        </span>
                        <span className="text-slate-500">
                          Agent Status
                          <strong className="block text-slate-300">
                            {event.agent?.status?.replaceAll("_", " ") ??
                              "Unknown"}
                          </strong>
                        </span>
                        {event.battery !== undefined && (
                          <span className="text-slate-500">
                            Battery
                            <strong className="block text-slate-300">
                              {event.battery}%
                            </strong>
                          </span>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3">
                        {event.latitude !== undefined && (
                          <a
                            className="inline-flex items-center gap-1 text-xs text-cyan-400"
                            target="_blank"
                            rel="noreferrer"
                            href={`https://www.google.com/maps?q=${event.latitude},${event.longitude}`}
                          >
                            <MapPin className="h-3.5 w-3.5" />
                            Open location
                          </a>
                        )}
                        {event.photoKeys.length > 0 && (
                          <button
                            onClick={() => void openPhoto(event.id, 0)}
                            className="inline-flex items-center gap-1 text-xs text-cyan-400"
                          >
                            <Camera className="h-3.5 w-3.5" />
                            Evidence ({event.photoKeys.length})
                          </button>
                        )}
                      </div>
                    </div>
                    {manager && (
                      <div className="relative">
                        <button
                          aria-label="Alert actions"
                          onClick={() =>
                            setMenuId(
                              menuId === event.id ? undefined : event.id,
                            )
                          }
                          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                        >
                          <MoreVertical className="h-5 w-5" />
                        </button>
                        {menuId === event.id && (
                          <div className="absolute right-0 top-10 z-20 w-44 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 py-1 shadow-2xl">
                            <button
                              onClick={() => void viewDetails(event)}
                              className="block w-full px-4 py-2.5 text-left text-xs text-slate-200 hover:bg-slate-800"
                            >
                              View Details
                            </button>
                            {event.status === "OPEN" && (
                              <button
                                onClick={() => {
                                  setMenuId(undefined);
                                  setReason("");
                                  setAction({ kind: "resolve", event });
                                }}
                                className="block w-full px-4 py-2.5 text-left text-xs text-emerald-300 hover:bg-slate-800"
                              >
                                Resolve
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setMenuId(undefined);
                                setReason("");
                                setAction({ kind: "archive", event });
                              }}
                              className="block w-full px-4 py-2.5 text-left text-xs text-amber-300 hover:bg-slate-800"
                            >
                              Archive
                            </button>
                            <button
                              onClick={() => {
                                setMenuId(undefined);
                                setReason("");
                                setAction({ kind: "delete", event });
                              }}
                              className="block w-full px-4 py-2.5 text-left text-xs text-rose-300 hover:bg-slate-800"
                            >
                              Delete
                            </button>
                            {admin && (
                              <button
                                onClick={() => {
                                  setMenuId(undefined);
                                  setReason("");
                                  setAction({ kind: "permanent", event });
                                }}
                                className="block w-full px-4 py-2.5 text-left text-xs font-bold text-rose-400 hover:bg-rose-500/10"
                              >
                                Permanent Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </GlassCard>
        <GlassCard className="p-4 sm:p-5 lg:col-span-4">
          <h3 className="mb-4 text-base font-bold text-white">
            Emergency Contacts
          </h3>
          <div className="space-y-2">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="rounded-xl border border-slate-800 bg-slate-900/60 p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-white">
                      {contact.name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {contact.relationship || contact.phone}
                    </span>
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <a
                      aria-label={`Call ${contact.name}`}
                      href={`tel:${contact.phone}`}
                      className="rounded-lg p-2 text-emerald-400 hover:bg-slate-800"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                    <a
                      aria-label={`WhatsApp ${contact.name}`}
                      href={whatsappHref(contact.phone)}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg p-2 text-emerald-400 hover:bg-slate-800"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                    {manager && (
                      <>
                        <button
                          aria-label={`Edit ${contact.name}`}
                          onClick={() => {
                            setEditingContact(contact.id);
                            setContactForm({
                              name: contact.name,
                              phone: contact.phone,
                              relationship: contact.relationship ?? "",
                              priority: contact.priority,
                            });
                          }}
                          className="rounded-lg p-2 text-cyan-400 hover:bg-slate-800"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          aria-label={`Delete ${contact.name}`}
                          onClick={() => void removeContact(contact)}
                          className="rounded-lg p-2 text-rose-400 hover:bg-slate-800"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {manager && (
            <div className="mt-4 space-y-2 border-t border-slate-800 pt-4">
              <input
                placeholder="Contact name"
                value={contactForm.name}
                onChange={(event) =>
                  setContactForm({ ...contactForm, name: event.target.value })
                }
                className="glass-input w-full rounded-xl px-3 py-2.5 text-sm"
              />
              <input
                placeholder="Phone number"
                value={contactForm.phone}
                onChange={(event) =>
                  setContactForm({ ...contactForm, phone: event.target.value })
                }
                className="glass-input w-full rounded-xl px-3 py-2.5 text-sm"
              />
              <input
                placeholder="Relationship / service"
                value={contactForm.relationship}
                onChange={(event) =>
                  setContactForm({
                    ...contactForm,
                    relationship: event.target.value,
                  })
                }
                className="glass-input w-full rounded-xl px-3 py-2.5 text-sm"
              />
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => void saveContact()}
                  className="glass-button-primary flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-white"
                >
                  <Plus className="h-4 w-4" />
                  {editingContact ? "Update" : "Add"} Contact
                </button>
                {editingContact && (
                  <button
                    onClick={() => {
                      setEditingContact(undefined);
                      setContactForm({
                        name: "",
                        phone: "",
                        relationship: "",
                        priority: 1,
                      });
                    }}
                    className="rounded-xl border border-slate-700 px-3 text-slate-300"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}
        </GlassCard>
      </div>
      {action && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-extrabold text-white">
                  {action.kind
                    .replace(/([A-Z])/g, " $1")
                    .replace(/^./, (value) => value.toUpperCase())}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  This action will be recorded in the Safety Audit Log.
                </p>
              </div>
              <button
                onClick={() => setAction(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-5 block text-xs font-bold text-slate-300">
              {currentActionLabel}
              <textarea
                autoFocus
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Enter at least 3 characters…"
                className="glass-input mt-2 w-full rounded-xl p-3 text-sm font-normal"
              />
            </label>
            {action.kind === "permanent" && (
              <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                Permanent deletion cannot be undone.
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setAction(null)}
                className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-300"
              >
                Cancel
              </button>
              <button
                disabled={busy || reason.trim().length < 3}
                onClick={() => void submitAction()}
                className="glass-button-primary rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
      {details && (
        <div
          className="fixed inset-0 z-[65] bg-slate-950/60 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetails(undefined);
          }}
        >
          <aside className="ml-auto h-full w-full overflow-y-auto border-l border-slate-700 bg-slate-950 p-4 shadow-2xl sm:max-w-xl sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <p
                  className={`inline-block rounded-lg border px-2 py-1 text-[10px] font-black ${severityTone[details.event.severity]}`}
                >
                  {details.event.severity}
                </p>
                <h3 className="mt-2 text-xl font-extrabold text-white">
                  Incident Details
                </h3>
                <p className="text-sm text-slate-400">
                  {details.event.type.replaceAll("_", " ")}
                </p>
              </div>
              <button
                onClick={() => setDetails(undefined)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {detailsLoading ? (
              <div className="grid min-h-80 place-items-center">
                <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <section className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                  <Info
                    icon={UserRound}
                    label="Agent"
                    value={
                      details.agent?.name ??
                      details.event.agent?.name ??
                      "Unknown"
                    }
                  />
                  <Info
                    icon={Phone}
                    label="Phone"
                    value={details.agent?.phone ?? "Not available"}
                  />
                  <Info
                    icon={ShieldAlert}
                    label="Status"
                    value={details.agent?.profile?.status ?? "Unknown"}
                  />
                  <Info
                    icon={BatteryLow}
                    label="Battery"
                    value={
                      details.agent?.profile?.batteryLevel == null
                        ? "Unknown"
                        : `${details.agent.profile.batteryLevel}%`
                    }
                  />
                  <Info
                    icon={Gauge}
                    label="Speed"
                    value={
                      details.agent?.profile?.lastSpeedKmH == null
                        ? "Unknown"
                        : `${details.agent.profile.lastSpeedKmH.toFixed(1)} km/h`
                    }
                  />
                  <Info
                    icon={Clock3}
                    label="Attendance"
                    value={
                      details.attendance
                        ? `${details.attendance.status} · ${details.attendance.checkOutAt ? "Checked out" : "On shift"}`
                        : "No record"
                    }
                  />
                  <Info
                    icon={MapPin}
                    label="GPS"
                    value={`${details.agent?.profile?.trackingState ?? "Unknown"} · ${details.agent?.profile?.locationPermission ?? "Unknown"}`}
                  />
                  <Info
                    icon={ExternalLink}
                    label="Last shop"
                    value={details.lastVisit?.shop.name ?? "No visit"}
                  />
                </section>
                {(details.event.latitude ??
                  details.agent?.profile?.latitude) !== undefined && (
                  <section className="overflow-hidden rounded-2xl border border-slate-800">
                    <iframe
                      title="Incident location"
                      className="h-64 w-full"
                      loading="lazy"
                      src={`https://www.openstreetmap.org/export/embed.html?bbox=${(details.event.longitude ?? details.agent?.profile?.longitude ?? 0) - 0.01}%2C${(details.event.latitude ?? details.agent?.profile?.latitude ?? 0) - 0.01}%2C${(details.event.longitude ?? details.agent?.profile?.longitude ?? 0) + 0.01}%2C${(details.event.latitude ?? details.agent?.profile?.latitude ?? 0) + 0.01}&layer=mapnik&marker=${details.event.latitude ?? details.agent?.profile?.latitude}%2C${details.event.longitude ?? details.agent?.profile?.longitude}`}
                    />
                  </section>
                )}
                <section>
                  <h4 className="mb-3 text-sm font-bold text-white">
                    Alert History
                  </h4>
                  <div className="space-y-2">
                    {details.history.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-xl border border-slate-800 bg-slate-900/50 p-3"
                      >
                        <div className="flex justify-between gap-3">
                          <span className="text-xs font-bold text-white">
                            {item.type.replaceAll("_", " ")}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            {formatDate(item.createdAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {item.status}
                          {item.resolutionNote
                            ? ` · ${item.resolutionNote}`
                            : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
                {details.audit.length > 0 && (
                  <section>
                    <h4 className="mb-3 text-sm font-bold text-white">
                      Action History
                    </h4>
                    <div className="space-y-2">
                      {details.audit.map((item) => (
                        <p
                          key={item.id}
                          className="rounded-xl bg-slate-900/50 p-3 text-xs text-slate-400"
                        >
                          <strong className="text-slate-200">
                            {item.action.replaceAll("_", " ")}
                          </strong>{" "}
                          · {item.actor?.name ?? "System"} ·{" "}
                          {formatDate(item.createdAt)}
                          <span className="mt-1 block">
                            {item.metadata?.reason}
                          </span>
                        </p>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
      {busy && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/40">
          <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
        </div>
      )}
    </div>
  );
  return manager ? (
    <ManagerLayout>{content}</ManagerLayout>
  ) : (
    <AgentLayout>{content}</AgentLayout>
  );
};

const Info: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => (
  <div className="min-w-0">
    <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
    <strong className="mt-1 block break-words text-xs text-slate-200">
      {value}
    </strong>
  </div>
);
