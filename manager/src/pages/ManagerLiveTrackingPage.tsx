import React, { useEffect, useState } from "react";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { Badge } from "../components/common/Badge";
import { InteractiveCityMap } from "../components/map/InteractiveCityMap";
import { Agent } from "../types";
import {
  Navigation,
  MapPin,
  Search,
  ShieldCheck,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { useLiveAgentTracking } from "../hooks/useLiveAgentTracking";
import { deleteAgent, loadAgents } from "../services/domainApi";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { ConfirmationDialog } from "../components/common/OverlayComponents";
import { useToast } from "../context/ToastContext";

const formatAge = (value?: string) => {
  if (!value) return "No GPS update";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return `Updated ${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  return `Last updated ${minutes} minute${minutes === 1 ? "" : "s"} ${seconds % 60} seconds ago`;
};

const formatMetric = (value: unknown, digits: number, fallback = "—") => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : fallback;
};

export const ManagerLiveTrackingPage: React.FC = () => {
  const [directoryAgents, setDirectoryAgents] = useState<Agent[]>([]);
  const { agents, connectionState } = useLiveAgentTracking(directoryAgents);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Agent | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();
  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? null;

  useEffect(() => {
    const refreshAgents = () => {
      void loadAgents([])
        .then(setDirectoryAgents)
        .catch(() => undefined);
    };
    refreshAgents();
    const refreshTimer = window.setInterval(refreshAgents, 10_000);
    window.addEventListener("reproutes:agent-created", refreshAgents);
    return () => {
      window.clearInterval(refreshTimer);
      window.removeEventListener("reproutes:agent-created", refreshAgents);
    };
  }, []);

  const handleAgentSelect = (agent: Agent) => {
    setSelectedAgentId(agent.id);
  };

  const handleDeleteAgent = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteAgent(pendingDelete.id);
      setDirectoryAgents((current) =>
        current.filter((agent) => agent.id !== pendingDelete.id),
      );
      if (selectedAgentId === pendingDelete.id) setSelectedAgentId(null);
      showToast("Agent removed", `${pendingDelete.name} was removed from the live directory.`, "success");
      setPendingDelete(null);
    } catch (error) {
      showToast(
        "Unable to remove agent",
        error instanceof Error ? error.message : "Please try again.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  };

  const filteredAgents = agents.filter(
    (a) =>
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.employeeCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.currentLocation.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <ManagerLayout>
      <div className="flex flex-col lg:flex-row items-center justify-between gap-4 mb-2">
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Navigation className="w-6 h-6 text-cyan-400" />
            <span>Live Field Agent Tracking</span>
          </h2>
          <p className="text-xs text-slate-400">
            Real-time GPS telemetry, active routes, speed indicators, and
            battery status
          </p>
        </div>

        <div className="flex items-center gap-3 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-64">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agent or location..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl glass-input"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Agent Selector List (4 Cols) */}
        <div className="lg:col-span-4 space-y-3">
          <GlassCard className="p-4 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Agent Directory ({filteredAgents.length})
            </h3>

            <div className="max-h-[min(42vh,360px)] space-y-2 overflow-y-auto pr-1 lg:max-h-[600px]">
              {filteredAgents.map((agent) => (
                <div
                  key={agent.id}
                  onClick={() => handleAgentSelect(agent)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    selectedAgent?.id === agent.id
                      ? "bg-indigo-600/20 border-cyan-400 shadow-lg glow-cyan"
                      : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <ProfileAvatar
                      src={agent.avatar}
                      name={agent.name}
                      className="w-10 h-10 rounded-full object-cover border border-cyan-500/40 text-[10px]"
                    />
                    <div>
                      <p className="text-xs font-bold text-white">
                        {agent.name}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {agent.routeAssigned}
                      </p>
                      <p className="text-[10px] text-cyan-400 font-semibold mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {agent.currentLocation}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2">
                    <div className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {(agent.trackingStatus === "location_off" ||
                          agent.trackingStatus === "idle_1h") && (
                          <Badge status={agent.trackingStatus} />
                        )}
                        <Badge status={agent.presenceStatus ?? "OFFLINE"} />
                        <Badge status={agent.shiftStatus ?? "OFF_SHIFT"} />
                        <Badge status={agent.gpsStatus ?? "UNAVAILABLE"} />
                      </div>
                      <p className="mt-1 text-[10px] text-slate-400">
                        {formatAge(agent.lastUpdatedAt)}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {agent.gpsAccuracyMeters == null
                          ? "Accuracy —"
                          : `Accuracy ±${Math.round(agent.gpsAccuracyMeters)} m`}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {formatMetric(agent.speedKmH, 1)} km/h · Battery{" "}
                        {Number.isFinite(Number(agent.batteryLevel))
                          ? agent.batteryLevel
                          : "—"}
                        %
                      </p>
                      <p className="text-xs font-extrabold text-cyan-400 mt-1">
                        {formatMetric(agent.distanceKm, 2)} KM
                      </p>
                      <p className="max-w-40 truncate text-[10px] text-slate-500">
                        {agent.destination?.label ?? "No destination"} · ETA{" "}
                        {agent.etaMinutes ?? "—"} min
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingDelete(agent);
                      }}
                      aria-label={`Remove ${agent.name}`}
                      title="Remove agent"
                      className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* Live Vector Map Stage (8 Cols) */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <InteractiveCityMap
            agents={agents}
            selectedAgentId={selectedAgent?.id}
            onSelectAgent={handleAgentSelect}
            heightClass="h-[520px]"
            connectionState={connectionState}
          />

          {/* Selected Agent Route Breakdown */}
          {selectedAgent && (
            <GlassCard className="p-6">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span>Assigned Shop Route Visits - {selectedAgent.name}</span>
              </h3>

              {selectedAgent.idleAlert && (
                <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  <b>Idle for 1+ Hour</b> · Current location{" "}
                  {selectedAgent.idleAlert.latitude.toFixed(6)},{" "}
                  {selectedAgent.idleAlert.longitude.toFixed(6)} · Stopped{" "}
                  {Math.max(
                    60,
                    Math.floor(
                      (Date.now() -
                        new Date(
                          selectedAgent.idleAlert.idleStartedAt,
                        ).getTime()) /
                        60_000,
                    ),
                  )}{" "}
                  minutes · Last movement{" "}
                  {new Date(
                    selectedAgent.idleAlert.lastMovementAt,
                  ).toLocaleString()}{" "}
                  · Battery {selectedAgent.idleAlert.battery ?? "—"}% · Last GPS{" "}
                  {new Date(selectedAgent.idleAlert.lastGpsAt).toLocaleString()}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {selectedAgent.routeCoordinates.map((waypoint, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-xl border flex items-center gap-3 ${
                      waypoint.visited
                        ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-200"
                        : "bg-slate-900/60 border-slate-800 text-slate-400"
                    }`}
                  >
                    <div
                      className={`p-2 rounded-lg ${
                        waypoint.visited
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-slate-800 text-slate-500"
                      }`}
                    >
                      {waypoint.visited ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <MapPin className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">
                        {waypoint.label || `Shop Stop #${idx + 1}`}
                      </p>
                      <p className="text-[10px] uppercase font-semibold mt-0.5">
                        {waypoint.visited
                          ? "Completed & Order Logged"
                          : "Pending Visit"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </div>
      </div>
      <ConfirmationDialog
        isOpen={Boolean(pendingDelete)}
        onClose={() => !deleting && setPendingDelete(null)}
        onConfirm={handleDeleteAgent}
        title="Remove agent from directory?"
        description={`${pendingDelete?.name ?? "This agent"} will no longer be able to sign in or appear in live tracking. Their existing sales and attendance records will be retained.`}
        confirmLabel="Remove agent"
        busy={deleting}
        destructive
      />
    </ManagerLayout>
  );
};
