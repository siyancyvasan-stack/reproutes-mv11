import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentLayout } from "../components/layout/AgentLayout";
import { GlassCard } from "../components/common/GlassCard";
import { Badge } from "../components/common/Badge";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { apiRequest } from "../services/apiClient";
import { trackingLog } from "../services/trackingLog";
import { capturePreciseGpsPoint, GpsError } from "../services/deviceGps";
import { enqueueGpsPoint, type QueuedGpsPoint } from "../services/gpsQueue";
import { uploadGpsPointImmediately } from "../hooks/useAgentLocationPublisher";
import {
  getBiometricErrorMessage,
  verifyBiometricForAction,
  verifyPasswordForAttendance,
  supportsBiometricLogin,
} from "../services/authApi";
import { uploadCheckoutGpsBestEffort } from "../services/gpsCheckout";
import { enqueueFieldOperation } from "../services/fieldOperationQueue";
import { PunchInAuthModal } from "../components/attendance/PunchInAuthModal";
import {
  Navigation,
  PlusCircle,
  Store,
  CheckCircle2,
  MapPin,
  Clock,
  TrendingUp,
  ShoppingBag,
  Coffee,
  Play,
  Zap,
  Banknote,
  Fingerprint,
  Loader2,
  LocateFixed,
} from "lucide-react";
import { ExportButton } from "../components/common/ExportButton";
import { loadShops } from "../services/domainApi";
import {
  loadMyActivity,
  type AgentActivityReport,
} from "../services/agentActivityApi";
import {
  exportToCsv,
  exportToPdf,
  type ExportColumn,
} from "../services/exportService";
import type { Shop } from "../types";
import { AndroidAppInstall } from "../components/common/AndroidAppInstall";

type BiometricState =
  | "IDLE"
  | "REGISTERING"
  | "AUTHENTICATING"
  | "AUTHENTICATED"
  | "REQUESTING_LOCATION"
  | "LOCATION_SUCCESS"
  | "LOCATION_ERROR"
  | "AUTH_ERROR"
  | "CHECKOUT_PROCESSING"
  | "SUCCESS"
  | "SHIFT_STARTED";

export const AgentDashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [isCheckedIn, setIsCheckedIn] = useState(false);
  const [agentStatus, setAgentStatus] = useState<"Active" | "On Break">(
    "Active",
  );
  const [distanceKm, setDistanceKm] = useState(0);
  const [attendanceBusy, setAttendanceBusy] = useState(false);
  const attendanceRequestRef = useRef(false);
  const [attendanceError, setAttendanceError] = useState<string>();
  const [biometricState, setBiometricState] = useState<BiometricState>("IDLE");
  const [punchInTime, setPunchInTime] = useState<string>();
  const [activity, setActivity] = useState<AgentActivityReport>();
  const [shops, setShops] = useState<Shop[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const stateCopy: Record<BiometricState, { title: string; detail: string }> = {
    IDLE: {
      title: "Punch In to Start Shift",
      detail: "Tap fingerprint to verify",
    },
    REGISTERING: {
      title: "Registering Passkey...",
      detail: "Complete fingerprint, face, or device PIN setup",
    },
    AUTHENTICATING: {
      title: "Verifying Identity...",
      detail: "Complete fingerprint or device PIN verification",
    },
    AUTHENTICATED: {
      title: "Identity Verified",
      detail: "Backend verified your WebAuthn response",
    },
    REQUESTING_LOCATION: {
      title: "Getting Your Location...",
      detail: "Waiting up to 20 seconds for GPS",
    },
    LOCATION_SUCCESS: {
      title: "Location Confirmed",
      detail: "GPS accuracy requirement passed",
    },
    LOCATION_ERROR: {
      title: "Location Failed",
      detail: "Review the error message and retry",
    },
    AUTH_ERROR: {
      title: "Fingerprint Failed",
      detail: "Authentication was not completed",
    },
    CHECKOUT_PROCESSING: {
      title: isCheckedIn ? "Completing Checkout..." : "Starting Shift...",
      detail: "Saving verified attendance securely",
    },
    SUCCESS: {
      title: "Checkout Complete",
      detail: "Attendance and GPS were saved",
    },
    SHIFT_STARTED: {
      title: "Shift Active",
      detail: `Punch In • ${punchInTime ?? "Active"} • GPS Live`,
    },
  };
  const busyState = [
    "REGISTERING",
    "AUTHENTICATING",
    "REQUESTING_LOCATION",
    "CHECKOUT_PROCESSING",
  ].includes(biometricState);
  const verifiedState = [
    "AUTHENTICATED",
    "LOCATION_SUCCESS",
    "SUCCESS",
    "SHIFT_STARTED",
  ].includes(biometricState);

  const reportDate = new Date().toLocaleDateString("en-CA");
  const ordersCount = activity?.kpis.orders ?? 0;
  const revenueLkr = activity?.kpis.totalSalesLkr ?? 0;
  const visitedCount = shops.filter((shop) => shop.visitedToday).length;
  const remainingCount = Math.max(0, shops.length - visitedCount);
  const completionPercentage = shops.length
    ? Math.round((visitedCount / shops.length) * 100)
    : 0;

  useEffect(() => {
    // Check biometric availability
    void supportsBiometricLogin()
      .then(setBiometricAvailable)
      .catch(() => setBiometricAvailable(false));

    // Restore shift state
    void apiRequest<{
      checkedIn: boolean;
      shiftStatus: string;
      attendance?: { distanceKm?: number; checkInAt?: string };
    }>("/api/v1/attendance/status")
      .then(({ checkedIn, shiftStatus, attendance }) => {
        setIsCheckedIn(checkedIn);
        setBiometricState(checkedIn ? "SHIFT_STARTED" : "IDLE");
        if (checkedIn && attendance?.checkInAt) {
          setPunchInTime(
            new Date(attendance.checkInAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          );
        }
        setAgentStatus(shiftStatus === "ON_BREAK" ? "On Break" : "Active");
        setDistanceKm(attendance?.distanceKm ?? 0);
        localStorage.setItem("tf_agent_checked_in", String(checkedIn));
        window.dispatchEvent(new Event("reproutes:agent-check-in-changed"));
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void Promise.all([loadMyActivity(reportDate, reportDate), loadShops([])])
      .then(([report, assignedShops]) => {
        setActivity(report);
        setDistanceKm(report.kpis.distanceKm);
        const visitedIds = new Set(report.visits.map((visit) => visit.shopId));
        setShops(
          assignedShops.map((shop) => ({
            ...shop,
            visitedToday: visitedIds.has(shop.id),
          })),
        );
      })
      .catch(() => undefined);
  }, [reportDate]);

  const exportDashboard = async (format: "csv" | "pdf") => {
    if (!activity || !shops.length) throw new Error("NO_EXPORT_DATA");
    const summary = [
      {
        agentName: activity.agent.name,
        date: reportDate,
        distance: activity.kpis.distanceKm,
        orders: activity.kpis.orders,
        revenue: activity.kpis.totalSalesLkr,
        assigned: shops.length,
        visited: visitedCount,
        remaining: remainingCount,
        completion: completionPercentage,
      },
    ];
    const summaryColumns: ExportColumn<(typeof summary)[number]>[] = [
      { header: "Agent Name", value: (row) => row.agentName },
      { header: "Date", value: (row) => row.date },
      { header: "Distance Travelled", value: (row) => `${row.distance} km` },
      { header: "Orders Booked", value: (row) => row.orders },
      { header: "Revenue", value: (row) => row.revenue },
      { header: "Assigned Shops", value: (row) => row.assigned },
      { header: "Shops Visited", value: (row) => row.visited },
      { header: "Remaining Shops", value: (row) => row.remaining },
      {
        header: "Route Completion Percentage",
        value: (row) => `${row.completion}%`,
      },
    ];
    if (format === "csv")
      return exportToCsv(
        summary,
        { columns: summaryColumns },
        `agent_daily_report_${reportDate}.csv`,
      );
    const shopColumns: ExportColumn<Shop>[] = [
      { header: "Shop Name", value: (shop) => shop.name },
      { header: "Address", value: (shop) => shop.address },
      {
        header: "Visit Status",
        value: (shop) => (shop.visitedToday ? "Visited" : "Remaining"),
      },
      {
        header: "Outstanding Balance",
        value: (shop) => `LKR ${shop.outstandingBalanceLkr.toLocaleString()}`,
      },
      { header: "Contact Number", value: (shop) => shop.phone },
    ];
    await exportToPdf(
      shops,
      {
        title: "Agent Daily Field Report",
        subtitle: `Daily field activity for ${reportDate}`,
        metadata: [
          ["Agent Name", activity.agent.name],
          [
            "Route/Territory",
            user?.region ??
              shops[0]?.territory ??
              shops[0]?.routeGroup ??
              "Not assigned",
          ],
          ["Shift Status", activity.kpis.currentStatus],
        ],
        kpis: [
          ["Distance Travelled", `${activity.kpis.distanceKm} km`],
          ["Orders Booked", activity.kpis.orders],
          ["Revenue", `LKR ${activity.kpis.totalSalesLkr.toLocaleString()}`],
          ["Shops Visited", `${visitedCount} / ${shops.length}`],
          ["Route Completion", `${completionPercentage}%`],
        ],
        columns: shopColumns,
      },
      `agent_daily_report_${reportDate}.pdf`,
    );
  };

  const handleToggleCheckIn = async () => {
    if (!user?.id || attendanceRequestRef.current) return;
    
    // Open authentication modal instead of immediately authenticating
    setShowAuthModal(true);
  };

  const handleBiometricAuth = async () => {
    if (!user?.id) throw new Error('User not found');
    
    setBiometricState("AUTHENTICATING");
    await verifyBiometricForAction(user.id, (progress) =>
      setBiometricState(
        progress === "registering" ? "REGISTERING" : "AUTHENTICATING",
      ),
    );
    setBiometricState("AUTHENTICATED");
  };

  const handlePasswordAuth = async (password: string) => {
    const verified = await verifyPasswordForAttendance(password);
    if (!verified) {
      throw new Error('Password verification failed');
    }
  };

  const completePunchInOut = async () => {
    if (!user?.id || attendanceRequestRef.current) return;
    attendanceRequestRef.current = true;
    setAttendanceError(undefined);
    setAttendanceBusy(true);
    
    try {
      setBiometricState("REQUESTING_LOCATION");
      showToast(
        "Acquiring GPS",
        "Waiting for a more accurate GPS signal...",
        "info",
      );
      let point: QueuedGpsPoint | undefined;
      let permission: "granted" | "denied" | "unavailable" = "granted";
      try {
        point = await capturePreciseGpsPoint(user.id);
        setBiometricState("LOCATION_SUCCESS");
      } catch (locErr) {
        permission =
          locErr instanceof GpsError && locErr.code === "PERMISSION_DENIED"
            ? "denied"
            : "unavailable";
        if (!isCheckedIn) {
          const message = locErr instanceof GpsError
            ? locErr.message
            : "Allow location permission and turn on GPS before punching in.";
          setAttendanceError(`Punch in blocked: ${message}`);
          showToast("GPS required", "Allow location permission and enable GPS before starting your shift.", "error");
          setBiometricState("LOCATION_ERROR");
          return;
        }
        showToast("Location unavailable", "Punch out will be saved, but the final GPS point could not be captured.", "info");
      }

      const gps = point
        ? { ...point, locationPermission: "granted" as const }
        : {
            clientPointId: crypto.randomUUID(),
            agentId: user.id,
            latitude: undefined,
            longitude: undefined,
            accuracy: undefined,
            capturedAt: new Date().toISOString(),
            deviceTimestamp: new Date().toISOString(),
            locationPermission: permission,
          };
      setBiometricState("CHECKOUT_PROCESSING");
      
      if (isCheckedIn) {
        if (point) {
          await uploadCheckoutGpsBestEffort(point, uploadGpsPointImmediately);
        }
        await apiRequest("/api/v1/attendance/check-out", {
          method: "POST",
          body: JSON.stringify(gps),
        });
        setIsCheckedIn(false);
        setBiometricState("SUCCESS");
        setPunchInTime(undefined);
        localStorage.setItem("tf_agent_checked_in", "false");
        window.dispatchEvent(new Event("reproutes:agent-check-in-changed"));
        trackingLog("check-out", {
          agentId: user.id,
          accuracyMeters: point ? Math.round(point.accuracy) : undefined,
          locationPermission: permission,
        });
        trackingLog("tracking-stop", {
          agentId: user?.id,
          reason: "check-out",
        });
        showToast(
          "Checked Out",
          `Work shift ended. GPS mileage saved at ${distanceKm} KM.`,
          "info",
        );
        // Close modal and reset state after a brief success display
        setTimeout(() => {
          setShowAuthModal(false);
          setBiometricState("IDLE");
        }, 1500);
      } else {
        try {
          await apiRequest("/api/v1/attendance/check-in", {
            method: "POST",
            body: JSON.stringify(gps),
          });
        } catch (error) {
          if (navigator.onLine) throw error;
          await enqueueFieldOperation({
            agentId: user.id,
            kind: "ATTENDANCE",
            url: "/api/v1/attendance/check-in",
            method: "POST",
            body: gps,
          });
          showToast("Offline punch-in saved", "Route tracking will sync when the connection returns.", "info");
        }
        if (point) {
          // Publish the first fix immediately so the manager map can start the
          // agent's travelled route from the exact punch-in location.
          try {
            await uploadGpsPointImmediately(point);
          } catch {
            // Keep the point for retry if the live socket is still connecting.
            await enqueueGpsPoint(point);
          }
        }
        setIsCheckedIn(true);
        setBiometricState("SHIFT_STARTED");
        setPunchInTime(
          new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        );
        localStorage.setItem("tf_agent_checked_in", "true");
        window.dispatchEvent(new Event("reproutes:agent-check-in-changed"));
        trackingLog("check-in", {
          agentId: user.id,
          accuracyMeters: point ? Math.round(point.accuracy) : undefined,
          locationPermission: permission,
        });
        showToast(
          "Checked In",
          point
            ? "Precise GPS confirmed. Live tracking started."
            : "Shift started without location permission.",
          "success",
        );
        // Close modal
        setShowAuthModal(false);
      }
    } catch (error) {
      const message =
        error instanceof GpsError
          ? error.message
          : error instanceof Error
            ? error.message
            : "An error occurred during punch in/out";
      setBiometricState(
        error instanceof GpsError ? "LOCATION_ERROR" : "AUTH_ERROR",
      );
      setAttendanceError(message);
      showToast("Attendance Update Failed", message, "error");
      if (error instanceof GpsError) {
        trackingLog(
          "gps-error",
          {
            agentId: user?.id,
            operation: isCheckedIn ? "check-out" : "check-in",
            code: error.code,
            message: error.message,
            accuracyMeters: error.accuracy,
          },
          "error",
        );
      }
      throw error; // Re-throw to let modal handle the error
    } finally {
      attendanceRequestRef.current = false;
      setAttendanceBusy(false);
    }
  };

  const handleToggleBreak = async () => {
    if (!isCheckedIn)
      return showToast(
        "Shift Not Started",
        "Punch in before starting a break.",
        "error",
      );
    const startingBreak = agentStatus === "Active";
    try {
      await apiRequest(
        `/api/v1/attendance/break/${startingBreak ? "start" : "end"}`,
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      );
      setAgentStatus(startingBreak ? "On Break" : "Active");
      showToast(
        startingBreak ? "Break Started" : "Work Resumed",
        "GPS and route recording continue normally.",
        startingBreak ? "info" : "success",
      );
    } catch (error) {
      showToast(
        "Break Update Failed",
        error instanceof Error ? error.message : "Please try again.",
        "error",
      );
    }
  };

  const handleShopCheckIn = (shopId: string, shopName: string) => {
    setShops((prev) =>
      prev.map((s) => (s.id === shopId ? { ...s, visitedToday: true } : s)),
    );
    showToast("Shop Check-In", `Checked in at ${shopName} via GPS.`, "success");
  };

  return (
    <AgentLayout agentStatus={agentStatus} onToggleBreak={handleToggleBreak}>
      <div className="space-y-6">
        <AndroidAppInstall className="sm:hidden" />
        <div className="flex justify-end">
          <ExportButton
            dataset="orders"
            pdf
            formats={["pdf", "csv"]}
            onExport={(format) => exportDashboard(format as "csv" | "pdf")}
          />
        </div>

        {/* Agent Greeting & Check-In Hero Panel */}
        <GlassCard glow="cyan" className="border-cyan-500/30 p-4 sm:p-6">
          <div className="flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-3">
              <ProfileAvatar
                src={user?.avatar}
                name={user?.name}
                className="w-14 h-14 rounded-2xl object-cover border-2 border-cyan-400/50 shadow-xl text-sm"
              />
              <div>
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider block">
                  Field Agent Portal
                </span>
                <h2 className="text-xl font-extrabold text-white">
                  {user?.name}
                </h2>
                <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                  <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                  <span>
                    {user?.region ??
                      shops[0]?.territory ??
                      shops[0]?.routeGroup ??
                      "Route not assigned"}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center lg:w-auto">
              <div className="flex min-w-0 flex-1 items-center justify-center gap-3 rounded-2xl border border-indigo-400/20 bg-indigo-500/[0.06] px-3 py-2 sm:min-w-[270px] lg:flex-none">
                <button
                  type="button"
                  onClick={handleToggleCheckIn}
                  disabled={attendanceBusy}
                  aria-label={
                    isCheckedIn
                      ? "Verify fingerprint and punch out"
                      : "Verify fingerprint and punch in"
                  }
                  className="group relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-wait"
                >
                  <span
                    className={`absolute inset-1 rounded-full border ${busyState ? "animate-spin border-indigo-400 border-r-transparent" : verifiedState ? "border-emerald-400/70" : "animate-pulse border-indigo-400/40 shadow-[0_0_18px_rgba(99,102,241,0.18)]"}`}
                  />
                  <span
                    className={`absolute inset-2.5 rounded-full border ${verifiedState ? "border-emerald-500/30 bg-emerald-500/10" : biometricState === "LOCATION_ERROR" || biometricState === "AUTH_ERROR" ? "border-rose-500/40 bg-rose-500/10" : "border-indigo-400/20 bg-slate-950/60"}`}
                  />
                  {biometricState === "REQUESTING_LOCATION" ||
                  biometricState === "LOCATION_SUCCESS" ? (
                    <LocateFixed
                      className={`relative h-8 w-8 ${biometricState === "REQUESTING_LOCATION" ? "animate-pulse text-indigo-300" : "text-emerald-400"}`}
                    />
                  ) : verifiedState ? (
                    <span className="relative">
                      <Fingerprint className="h-8 w-8 text-emerald-400" />
                      <CheckCircle2 className="absolute -bottom-1 -right-1 h-4 w-4 fill-slate-950 text-emerald-300" />
                    </span>
                  ) : busyState ? (
                    <span className="relative">
                      <Fingerprint className="h-8 w-8 text-indigo-300" />
                      <Loader2 className="absolute -bottom-1 -right-1 h-4 w-4 animate-spin text-cyan-300" />
                    </span>
                  ) : (
                    <Fingerprint
                      className={`relative h-8 w-8 transition group-hover:scale-105 ${biometricState === "LOCATION_ERROR" || biometricState === "AUTH_ERROR" ? "text-rose-400" : "text-indigo-300 group-hover:text-indigo-200"}`}
                    />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-xs font-extrabold ${verifiedState ? "text-emerald-300" : biometricState === "LOCATION_ERROR" || biometricState === "AUTH_ERROR" ? "text-rose-300" : "text-white"}`}
                  >
                    {agentStatus === "On Break" && isCheckedIn
                      ? "On Break"
                      : stateCopy[biometricState].title}
                  </p>
                  <p className="mt-1 max-w-44 text-[10px] leading-4 text-slate-400">
                    {agentStatus === "On Break" && isCheckedIn
                      ? `GPS Live • Punched in ${punchInTime ?? ""}`
                      : (attendanceError ?? stateCopy[biometricState].detail)}
                  </p>
                </div>
              </div>

              <button
                onClick={() => navigate("/sales/new-order")}
                className="glass-button-primary flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-xs font-bold text-white sm:w-auto sm:flex-none"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Book Order</span>
              </button>
            </div>
          </div>
        </GlassCard>

        {/* Agent Today Stats (4 Grid Cards) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <GlassCard className="p-4 text-center">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
              Distance
            </span>
            <span className="text-lg sm:text-xl font-extrabold text-cyan-400 mt-1 block">
              {distanceKm} KM
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              Odometer GPS
            </span>
          </GlassCard>

          <GlassCard className="p-4 text-center">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
              Orders Booked
            </span>
            <span className="text-lg sm:text-xl font-extrabold text-white mt-1 block">
              {ordersCount}
            </span>
            <span className="text-[10px] text-emerald-400 block mt-0.5">
              +4 vs Target
            </span>
          </GlassCard>

          <GlassCard className="p-4 text-center">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
              Today Revenue
            </span>
            <span className="text-lg sm:text-xl font-extrabold text-emerald-400 mt-1 block">
              LKR {(revenueLkr / 1000).toFixed(0)}k
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              LKR {revenueLkr.toLocaleString()}
            </span>
          </GlassCard>

          <GlassCard className="p-4 text-center">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
              Shops Visited
            </span>
            <span className="text-lg sm:text-xl font-extrabold text-amber-400 mt-1 block">
              {visitedCount} / {shops.length}
            </span>
            <span className="text-[10px] text-slate-500 block mt-0.5">
              {completionPercentage}% Complete
            </span>
          </GlassCard>
        </div>

        {/* Assigned Route & Shop Checklist */}
        <GlassCard className="p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">
                Today's Assigned Route Shops
              </h3>
              <p className="text-xs text-slate-400">
                Check in at each store to log visit & book orders
              </p>
            </div>
            <button
              onClick={() => navigate("/agent/shops")}
              className="text-xs font-semibold text-cyan-400 hover:underline"
            >
              All Shops →
            </button>
          </div>

          <div className="space-y-3">
            {shops.map((shop) => (
              <div
                key={shop.id}
                className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  shop.visitedToday
                    ? "bg-slate-900/40 border-emerald-500/30"
                    : "bg-slate-900/80 border-slate-800"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`p-2 rounded-xl mt-0.5 ${
                      shop.visitedToday
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    <Store className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">
                      {shop.name}
                    </h4>
                    <p className="text-xs text-slate-400">{shop.address}</p>
                    <p className="text-[10px] text-amber-400 mt-1">
                      Outstanding Balance: LKR{" "}
                      {shop.outstandingBalanceLkr.toLocaleString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-center">
                  {shop.visitedToday ? (
                    <span className="px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Visited</span>
                    </span>
                  ) : (
                    <button
                      onClick={() => handleShopCheckIn(shop.id, shop.name)}
                      className="px-3 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold cursor-pointer"
                    >
                      Check-In at Store
                    </button>
                  )}

                  <button
                    onClick={() => navigate(`/sales/new-order?shopId=${encodeURIComponent(shop.id)}`)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-bold"
                  >
                    + Book Order
                  </button>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <PunchInAuthModal
          isOpen={showAuthModal}
          isPunchOut={isCheckedIn}
          biometricAvailable={biometricAvailable}
          onClose={() => {
            setShowAuthModal(false);
            setBiometricState(isCheckedIn ? "SHIFT_STARTED" : "IDLE");
          }}
          onBiometricAuth={async () => {
            await handleBiometricAuth();
            await completePunchInOut();
          }}
          onPasswordAuth={async (password) => {
            await handlePasswordAuth(password);
            await completePunchInOut();
          }}
        />
      </div>
    </AgentLayout>
  );
};
