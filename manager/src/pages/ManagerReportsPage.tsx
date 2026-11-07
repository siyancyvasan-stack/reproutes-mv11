import React, { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { ensureAccessToken, getAccessToken } from "../services/apiClient";
import { AttendanceReport, loadAttendanceReport } from "../services/domainApi";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { BarChart3, TrendingUp, Users, Award, Shield } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { ExportButton } from "../components/common/ExportButton";

export const ManagerReportsPage: React.FC = () => {
  const [report, setReport] = useState<AttendanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refreshReport = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const nextReport = await loadAttendanceReport();
      setReport(nextReport);
      setError("");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load attendance records.",
      );
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshReport();
    const interval = window.setInterval(() => void refreshReport(true), 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshReport(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshReport]);

  useEffect(() => {
    const configuredUrl = import.meta.env.VITE_TRACKING_SOCKET_URL?.trim();
    if (!configuredUrl) return;
    const socketUrl =
      configuredUrl === "same-origin" ? undefined : configuredUrl;
    let disposed = false;
    let socket: ReturnType<typeof io> | undefined;

    void ensureAccessToken()
      .then(() => {
        if (disposed) return;
        socket = io(socketUrl, {
          transports: ["websocket"],
          withCredentials: true,
          auth: (callback) =>
            callback({ token: getAccessToken() ?? undefined }),
        });
        socket.on("attendance:updated", () => void refreshReport(true));
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [refreshReport]);

  const today = report?.today;
  const isEmpty = !loading && !error && report?.records.length === 0;
  const value = (number: number | undefined, suffix = "") =>
    loading ? "—" : `${number ?? 0}${suffix}`;

  return (
    <ManagerLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-cyan-400" />
            <span>Sales & Distance Analytics Reports</span>
          </h2>
          <p className="text-xs text-slate-400">
            Field agent performance comparisons, sales volume, mileage
            efficiency, and route ROI
          </p>
        </div>

        <div className="flex items-center gap-3">
          <ExportButton
            dataset="sales_summary"
            pdf
            disabled={loading || Boolean(error)}
            filters={
              report ? { from: report.range.from, to: report.range.to } : {}
            }
          />
        </div>
      </div>

      {error && (
        <GlassCard
          className="p-4 flex items-center justify-between gap-4"
          role="alert"
        >
          <p className="text-xs text-rose-400">{error}</p>
          <button
            onClick={() => void refreshReport()}
            className="text-xs font-bold text-cyan-400"
          >
            Retry
          </button>
        </GlassCard>
      )}

      <section
        aria-label="Report summary"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4"
      >
        <GlassCard interactive className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                Present Today
              </p>
              <p className="text-xl font-extrabold text-white mt-1">
                {value(today?.present)}
              </p>
              <p className="text-[10px] text-emerald-400 font-semibold mt-1">
                Live database check-ins
              </p>
            </div>
            <span className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
            </span>
          </div>
        </GlassCard>

        <GlassCard interactive className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                Absent Today
              </p>
              <p className="text-xl font-extrabold text-white mt-1">
                {value(today?.absent)}
              </p>
              <p className="text-[10px] text-cyan-400 font-semibold mt-1">
                Without attendance records
              </p>
            </div>
            <span className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
              <BarChart3 className="w-5 h-5 text-cyan-400" />
            </span>
          </div>
        </GlassCard>

        <GlassCard interactive className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                Late / On Leave
              </p>
              <p className="text-xl font-extrabold text-white mt-1">
                {value(today?.late)} / {value(today?.onLeave)}
              </p>
              <p className="text-[10px] text-indigo-400 font-semibold mt-1">
                Late arrivals and approved leave
              </p>
            </div>
            <span className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
              <Users className="w-5 h-5 text-indigo-400" />
            </span>
          </div>
        </GlassCard>

        <GlassCard interactive className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-slate-500">
                Attendance %
              </p>
              <p className="text-xl font-extrabold text-white mt-1">
                {value(today?.attendancePercentage, "%")}
              </p>
              <p className="text-[10px] text-amber-400 font-semibold mt-1">
                {loading
                  ? "Loading current coverage"
                  : `${today?.present ?? 0} of ${today?.totalAgents ?? 0} agents today`}
              </p>
            </div>
            <span className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Shield className="w-5 h-5 text-amber-400" />
            </span>
          </div>
        </GlassCard>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <GlassCard className="lg:col-span-8 p-6">
          <h3 className="text-base font-bold text-white mb-4">
            Daily Attendance Rate
          </h3>
          <div className="w-full h-80">
            {loading ? (
              <StateMessage message="Loading attendance report…" />
            ) : error ? (
              <StateMessage message="Attendance chart is unavailable." />
            ) : isEmpty ? (
              <StateMessage message="No attendance has been marked in the selected period." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={report?.daily ?? []}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(255,255,255,0.05)"
                  />
                  <XAxis dataKey="day" stroke="#94A3B8" fontSize={11} />
                  <YAxis
                    stroke="#94A3B8"
                    fontSize={11}
                    domain={[0, 100]}
                    tickFormatter={(val) => `${val}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "rgba(7, 17, 31, 0.95)",
                      borderColor: "rgba(6, 182, 212, 0.4)",
                      borderRadius: "12px",
                      color: "#FFF",
                    }}
                    formatter={(val: any) => [
                      `${Number(val).toFixed(1)}%`,
                      "Attendance",
                    ]}
                  />
                  <Bar
                    dataKey="attendancePercentage"
                    fill="#06B6D4"
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </GlassCard>

        <GlassCard className="lg:col-span-4 p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-400" />
              <span>Attendance Leaderboard</span>
            </h3>

            <div className="space-y-3">
              {loading ? (
                <StateMessage message="Loading leaderboard…" compact />
              ) : error ? (
                <StateMessage message="Leaderboard is unavailable." compact />
              ) : !report?.leaderboard.length || isEmpty ? (
                <StateMessage
                  message="No attendance records available."
                  compact
                />
              ) : (
                report.leaderboard.map((agent, index) => (
                  <div
                    key={agent.agentId}
                    className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-extrabold ${
                          index === 0
                            ? "bg-amber-400 text-slate-950"
                            : index === 1
                              ? "bg-slate-300 text-slate-950"
                              : index === 2
                                ? "bg-amber-700 text-white"
                                : "bg-slate-800 text-slate-400"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <ProfileAvatar
                        src={agent.avatarUrl}
                        name={agent.name}
                        className="w-8 h-8 rounded-full object-cover text-xs"
                      />
                      <div>
                        <p className="text-xs font-bold text-white">
                          {agent.name.split(" ")[0]}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {agent.presentDays} Present · {agent.lateDays} Late
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-extrabold text-emerald-400">
                      {agent.attendancePercentage}%
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard className="overflow-x-auto p-0">
        <div className="border-b border-slate-800 p-5">
          <h3 className="text-base font-bold text-white">Daily GPS Coverage</h3>
          <p className="mt-1 text-xs text-slate-400">
            Real device points received versus the expected 15-second interval.
          </p>
        </div>
        <table className="min-w-[1100px] w-full text-left text-xs">
          <thead className="bg-slate-900/70 text-[10px] uppercase text-slate-400">
            <tr>
              <th className="p-3">Agent</th>
              <th className="p-3">Date</th>
              <th className="p-3">Working</th>
              <th className="p-3">Break</th>
              <th className="p-3">Distance</th>
              <th className="p-3">Break distance</th>
              <th className="p-3">Avg / Max speed</th>
              <th className="p-3">Points</th>
              <th className="p-3">Coverage</th>
              <th className="p-3">Delays</th>
              <th className="p-3">Longest gap</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {report?.records.map((record) => (
              <tr key={record.id} className="text-slate-300">
                <td className="p-3 font-bold text-white">
                  {record.agent.name}
                </td>
                <td className="p-3">{record.date.slice(0, 10)}</td>
                <td className="p-3">{record.workingDurationMinutes} min</td>
                <td className="p-3">{record.breakDurationMinutes} min</td>
                <td className="p-3">{record.distanceKm.toFixed(2)} km</td>
                <td className="p-3">{record.breakDistanceKm.toFixed(2)} km</td>
                <td className="p-3">
                  {record.averageSpeedKmH} / {record.maximumSpeedKmH} km/h
                </td>
                <td className="p-3">
                  {record.receivedPoints} / {record.expectedPoints}
                </td>
                <td className="p-3 font-bold text-cyan-400">
                  {record.gpsCoverage}%
                </td>
                <td className="p-3">{record.gpsDelayCount}</td>
                <td className="p-3">{record.longestGpsGapSeconds}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </GlassCard>
    </ManagerLayout>
  );
};

const StateMessage: React.FC<{ message: string; compact?: boolean }> = ({
  message,
  compact,
}) => (
  <div
    className={`w-full flex items-center justify-center text-xs text-slate-400 ${compact ? "min-h-40" : "h-full"}`}
  >
    {message}
  </div>
);
