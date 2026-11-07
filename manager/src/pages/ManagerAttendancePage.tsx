import React, { useEffect, useState } from "react";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { Badge } from "../components/common/Badge";
import { deleteAttendance, loadAttendance } from "../services/domainApi";
import {
  Clock,
  MapPin,
  Calendar,
  Eye,
  Gauge,
  Navigation,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { AttendanceRecord } from "../types";
import { ExportButton } from "../components/common/ExportButton";
import { ConfirmationDialog } from "../components/common/OverlayComponents";
import { useToast } from "../context/ToastContext";

export const ManagerAttendancePage: React.FC = () => {
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [selected, setSelected] = useState<AttendanceRecord>();
  const [pendingDelete, setPendingDelete] = useState<AttendanceRecord>();
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const rowsPerPage = 10;
  const { showToast } = useToast();

  useEffect(() => {
    loadAttendance([])
      .then(setAttendance)
      .catch(() => undefined);
  }, []);

  const totalPages = Math.max(1, Math.ceil(attendance.length / rowsPerPage));
  const currentPage = Math.min(page, totalPages);
  const paginatedAttendance = attendance.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage,
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteAttendance(pendingDelete.id);
      setAttendance((records) =>
        records.filter((record) => record.id !== pendingDelete.id),
      );
      if (selected?.id === pendingDelete.id) setSelected(undefined);
      showToast(
        "Attendance deleted",
        pendingDelete.agentName +
          " attendance record was deleted successfully.",
        "success",
      );
      setPendingDelete(undefined);
    } catch (error) {
      showToast(
        "Delete failed",
        error instanceof Error
          ? error.message
          : "Unable to delete this attendance record.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <ManagerLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Clock className="w-6 h-6 text-cyan-400" />
            <span>Field Attendance & Mileage Records</span>
          </h2>
          <p className="text-xs text-slate-400">
            Daily check-in timestamps, GPS location verification, odometer
            readings, and working hours
          </p>
        </div>
        <ExportButton
          dataset="attendance"
          pdf
          formats={["xlsx", "csv", "pdf"]}
          disabled={attendance.length === 0}
        />
      </div>

      <GlassCard className="p-3 sm:p-5">
        <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-300/80 !bg-slate-100/45 backdrop-blur-xl shadow-lg shadow-slate-300/30 font-sans">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs sm:text-sm">
              <thead className="!bg-slate-200/70 backdrop-blur-xl">
                <tr className="text-slate-900 text-[11px] font-extrabold uppercase tracking-wider">
                  <th scope="col" className="py-2.5 px-3">
                    Agent
                  </th>
                  <th scope="col" className="py-2.5 px-3">
                    Date
                  </th>
                  <th scope="col" className="py-2.5 px-3">
                    Check-in
                  </th>
                  <th scope="col" className="py-2.5 px-3">
                    Verified Start Location
                  </th>
                  <th scope="col" className="py-2.5 px-3">
                    Odometer
                  </th>
                  <th scope="col" className="py-2.5 px-3">
                    Distance
                  </th>
                  <th scope="col" className="py-2.5 px-3">
                    Working Time
                  </th>
                  <th scope="col" className="py-2.5 px-3">
                    Status
                  </th>
                  <th scope="col" className="py-2.5 px-3 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300/70">
                {paginatedAttendance.map((att, index) => (
                  <tr
                    key={att.id}
                    className={`${index % 2 === 0 ? "!bg-white/35" : "!bg-slate-200/45"} hover:!bg-slate-100/80 backdrop-blur-md transition-colors duration-200`}
                  >
                    <td className="py-2.5 px-3 font-extrabold text-slate-950">
                      {att.agentName}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-slate-700">
                      {att.date}
                    </td>
                    <td className="py-2.5 px-3 font-extrabold text-cyan-800">
                      {att.checkInTime}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="flex items-center gap-1.5 font-medium text-slate-800">
                        <MapPin className="w-3.5 h-3.5 text-cyan-600 shrink-0" />
                        {att.checkInLocation}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-800">
                      {att.checkInOdometerKm > 0
                        ? `${att.checkInOdometerKm} KM`
                        : "N/A"}
                    </td>
                    <td className="py-2.5 px-3 font-extrabold text-emerald-700">
                      {att.totalDistanceKm} KM
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-slate-800">
                      {att.workingHours}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge status={att.status} />
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setSelected(att)}
                          title="View details"
                          aria-label="View details"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-200 bg-white text-indigo-700 transition hover:bg-indigo-50 hover:text-indigo-900 focus-visible:ring-2 focus-visible:ring-indigo-500 shadow-sm"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(att)}
                          title="Delete record"
                          aria-label="Delete record"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 hover:text-rose-900 focus-visible:ring-2 focus-visible:ring-rose-500 shadow-sm"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:hidden">
          {paginatedAttendance.map((att) => (
            <article
              key={att.id}
              className="rounded-2xl p-4 sm:p-5 space-y-4 !bg-slate-100/55 backdrop-blur-xl border border-slate-300/80 shadow-lg shadow-slate-300/25 font-sans"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-950">
                    {att.agentName}
                  </h3>
                  <p className="text-sm font-medium text-slate-600 flex items-center gap-1 mt-1">
                    <Calendar className="w-3 h-3 text-cyan-600" />
                    {att.date}
                  </p>
                </div>
                <Badge status={att.status} />
              </div>

              <div className="rounded-xl bg-white/45 backdrop-blur-md border border-slate-300/80 p-3">
                <p className="text-xs uppercase font-extrabold text-slate-600 mb-1">
                  Verified Start Location
                </p>
                <p className="text-sm font-medium text-slate-950 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-cyan-700 shrink-0" />
                  {att.checkInLocation}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl bg-white/45 border border-slate-300/80 p-3">
                  <span className="block text-xs uppercase font-bold text-slate-600">
                    Check-in
                  </span>
                  <span className="text-sm font-extrabold text-slate-950">
                    {att.checkInTime}
                  </span>
                </div>
                <div className="rounded-xl bg-white/45 border border-slate-300/80 p-3">
                  <span className="block text-xs uppercase font-bold text-slate-600">
                    Odometer
                  </span>
                  <span className="text-sm font-mono font-semibold text-slate-950">
                    {att.checkInOdometerKm > 0
                      ? `${att.checkInOdometerKm} KM`
                      : "N/A"}
                  </span>
                </div>
                <div className="rounded-xl bg-white/45 border border-slate-300/80 p-3">
                  <span className="block text-xs uppercase font-bold text-slate-600">
                    Distance
                  </span>
                  <span className="text-sm font-extrabold text-emerald-700">
                    {att.totalDistanceKm} KM
                  </span>
                </div>
                <div className="rounded-xl bg-white/45 border border-slate-300/80 p-3">
                  <span className="block text-xs uppercase font-bold text-slate-600">
                    Working
                  </span>
                  <span className="text-sm font-semibold text-slate-950">
                    {att.workingHours}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelected(att)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-extrabold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700"
                >
                  <Eye className="h-4 w-4" /> View details
                </button>
                <button
                  onClick={() => setPendingDelete(att)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white text-sm font-extrabold text-rose-700 transition hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className="mt-5 flex flex-col items-center justify-between gap-3 border-t border-slate-300/80 pt-4 text-sm sm:flex-row">
          <p className="font-semibold text-slate-700">
            Showing{" "}
            {attendance.length === 0 ? 0 : (currentPage - 1) * rowsPerPage + 1}–
            {Math.min(currentPage * rowsPerPage, attendance.length)} of{" "}
            {attendance.length} records
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-extrabold text-slate-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <span className="min-w-24 text-center font-extrabold text-slate-800">
              Page {currentPage} of {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() =>
                setPage((value) => Math.min(totalPages, value + 1))
              }
              className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-indigo-500 bg-indigo-600 px-3 text-sm font-extrabold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </GlassCard>

      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onMouseDown={() => setSelected(undefined)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="attendance-details-title"
            className="w-full max-w-2xl overflow-hidden rounded-3xl bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between border-b border-slate-200 bg-gradient-to-r from-indigo-600 to-blue-600 p-6 text-white">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-indigo-100">
                  Attendance record
                </p>
                <h2
                  id="attendance-details-title"
                  className="mt-1 text-2xl font-black"
                >
                  {selected.agentName}
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-indigo-100">
                  <Calendar className="h-4 w-4" /> {selected.date}
                </p>
              </div>
              <button
                onClick={() => setSelected(undefined)}
                aria-label="Close attendance details"
                className="rounded-xl bg-white/15 p-2 transition hover:bg-white/25"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="space-y-5 p-6">
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Current status
                  </p>
                  <p className="mt-1 text-sm font-semibold text-slate-700">
                    Employee ID: {selected.agentId}
                  </p>
                </div>
                <Badge status={selected.status} />
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Detail
                  icon={Clock}
                  label="Check-in"
                  value={selected.checkInTime}
                />
                <Detail
                  icon={Clock}
                  label="Check-out"
                  value={selected.checkOutTime ?? "In progress"}
                />
                <Detail
                  icon={Navigation}
                  label="Distance"
                  value={`${selected.totalDistanceKm} km`}
                />
                <Detail
                  icon={Clock}
                  label="Working time"
                  value={selected.workingHours}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <LocationCard
                  title="Verified start location"
                  location={selected.checkInLocation}
                />
                <LocationCard
                  title="Verified end location"
                  location={selected.checkOutLocation ?? "Not checked out yet"}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Detail
                  icon={Gauge}
                  label="Opening odometer"
                  value={
                    selected.checkInOdometerKm > 0
                      ? `${selected.checkInOdometerKm.toLocaleString()} km`
                      : "Not recorded"
                  }
                />
                <Detail
                  icon={Gauge}
                  label="Closing odometer"
                  value={
                    selected.checkOutOdometerKm != null
                      ? `${selected.checkOutOdometerKm.toLocaleString()} km`
                      : "Not recorded"
                  }
                />
              </div>
            </div>

            <footer className="border-t border-slate-200 bg-slate-50 px-6 py-4 text-right">
              <button
                onClick={() => setSelected(undefined)}
                className="h-10 rounded-xl bg-slate-900 px-5 text-sm font-extrabold text-white hover:bg-slate-800"
              >
                Close
              </button>
            </footer>
          </section>
        </div>
      )}

      <ConfirmationDialog
        isOpen={Boolean(pendingDelete)}
        onClose={() => !deleting && setPendingDelete(undefined)}
        onConfirm={confirmDelete}
        title="Delete attendance record?"
        description={`This will permanently delete ${pendingDelete?.agentName ?? "this agent"}'s attendance record for ${pendingDelete?.date ?? "the selected date"}. This action cannot be undone.`}
        confirmLabel="Delete record"
        cancelLabel="Cancel"
        busy={deleting}
        destructive
      />
    </ManagerLayout>
  );
};

const Detail = ({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <Icon className="h-5 w-5 text-indigo-600" />
    <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">
      {label}
    </p>
    <p className="mt-1 text-sm font-extrabold text-slate-950">{value}</p>
  </div>
);

const LocationCard = ({
  title,
  location,
}: {
  title: string;
  location: string;
}) => (
  <div className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4">
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-cyan-100 text-cyan-700">
        <MapPin className="h-5 w-5" />
      </span>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-cyan-800">
          {title}
        </p>
        <p className="mt-1 break-words text-sm font-semibold text-slate-800">
          {location}
        </p>
      </div>
    </div>
  </div>
);
