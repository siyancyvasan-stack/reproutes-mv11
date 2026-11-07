import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';

export type DashboardRange = { key: string; label: string; from: string; to: string; query: string };

const startOfDay = (date: Date) => { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; };
const endOfDay = (date: Date) => { const value = new Date(date); value.setHours(23, 59, 59, 999); return value; };
const inputDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const resolveDashboardRange = (key: string, customFrom?: string, customTo?: string, selectedDate?: string): DashboardRange | null => {
  const now = new Date(); let from = startOfDay(now); let to = now; let label = 'Today';
  if (key === 'yesterday') { from.setDate(from.getDate() - 1); to = endOfDay(from); label = 'Yesterday'; }
  if (key === 'last7') { from.setDate(from.getDate() - 6); label = 'Last 7 Days'; }
  if (key === 'last30') { from.setDate(from.getDate() - 29); label = 'Last 30 Days'; }
  if (key === 'thisMonth') { from = new Date(now.getFullYear(), now.getMonth(), 1); label = 'This Month'; }
  if (key === 'lastMonth') { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)); label = 'Last Month'; }
  if (key === 'selectedDate') {
    if (!selectedDate) return null;
    const date = new Date(`${selectedDate}T00:00:00`);
    if (Number.isNaN(date.getTime()) || date > endOfDay(now)) return null;
    from = startOfDay(date); to = endOfDay(date);
    label = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
  }
  if (key === 'custom') {
    if (!customFrom || !customTo) return null;
    from = startOfDay(new Date(`${customFrom}T00:00:00`)); to = endOfDay(new Date(`${customTo}T00:00:00`)); label = 'Custom Range';
    if (from > to) return null;
  }
  const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() }).toString();
  return { key, label, from: from.toISOString(), to: to.toISOString(), query };
};

export const DashboardDateFilter = ({ onChange }: { onChange: (range: DashboardRange) => void }) => {
  const [params, setParams] = useSearchParams();
  const initialKey = params.get('range') ?? 'today';
  const [value, setValue] = useState(initialKey);
  const [from, setFrom] = useState(params.get('fromDate') ?? '');
  const [to, setTo] = useState(params.get('toDate') ?? '');
  const [selectedDate, setSelectedDate] = useState(params.get('date') ?? inputDate(new Date()));
  const [error, setError] = useState('');

  const apply = (key: string, customFrom = from, customTo = to, date = selectedDate) => {
    setValue(key);
    const range = resolveDashboardRange(key, customFrom, customTo, date);
    if (!range) { setError('Choose a valid start and end date.'); return; }
    setError('');
    const next = new URLSearchParams(params); next.set('range', key);
    if (key === 'custom') { next.set('fromDate', customFrom); next.set('toDate', customTo); }
    else { next.delete('fromDate'); next.delete('toDate'); }
    if (key === 'selectedDate') next.set('date', date);
    else next.delete('date');
    if (key === 'today') setSelectedDate(inputDate(new Date()));
    setParams(next, { replace: true }); onChange(range);
  };

  useEffect(() => { const range = resolveDashboardRange(initialKey, from, to, selectedDate) ?? resolveDashboardRange('today')!; onChange(range); }, []);

  return <div className="flex w-full flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:w-auto" role="group" aria-label="Dashboard date range">
    <label className="sr-only" htmlFor="dashboard-range">Dashboard date range</label>
    <select id="dashboard-range" value={value} onChange={(event) => apply(event.target.value)} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      <option value="today">Today</option><option value="selectedDate">Selected Date</option><option value="yesterday">Yesterday</option><option value="last7">Last 7 Days</option><option value="last30">Last 30 Days</option><option value="thisMonth">This Month</option><option value="lastMonth">Last Month</option><option value="custom">Custom Range</option>
    </select>
    <label className="relative flex min-h-11 min-w-0 flex-1 items-center sm:flex-none" title="Choose a dashboard date">
      <span className="sr-only">Choose dashboard date</span>
      <CalendarDays aria-hidden="true" className="pointer-events-none absolute left-3 h-4 w-4 text-indigo-600" />
      <input
        aria-label="Dashboard date"
        type="date"
        value={selectedDate}
        max={inputDate(new Date())}
        onChange={(event) => {
          const date = event.target.value;
          setSelectedDate(date);
          if (date) apply('selectedDate', from, to, date);
        }}
        className="min-h-11 w-full rounded-xl border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm font-bold text-slate-700 sm:w-auto"
      />
    </label>
    {value === 'custom' && <><input aria-label="Start date" type="date" value={from} max={to || inputDate(new Date())} onChange={(e) => setFrom(e.target.value)} className="min-h-10 rounded-xl border border-slate-300 px-3 text-sm"/><input aria-label="End date" type="date" value={to} min={from} max={inputDate(new Date())} onChange={(e) => setTo(e.target.value)} className="min-h-10 rounded-xl border border-slate-300 px-3 text-sm"/><button type="button" onClick={() => apply('custom')} className="min-h-10 rounded-xl bg-indigo-600 px-4 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2">Apply</button></>}
    {error && <span role="alert" className="w-full text-sm font-semibold text-rose-700">{error}</span>}
  </div>;
};
