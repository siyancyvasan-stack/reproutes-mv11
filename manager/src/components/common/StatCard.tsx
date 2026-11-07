import React, { useEffect, useState } from 'react';
import { GlassCard } from './GlassCard';
import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle: string;
  icon: LucideIcon;
  trend?: string;
  trendUp?: boolean;
  color: 'cyan' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'blue';
  sparklineData?: number[];
}

export const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  trendUp = true,
  color,
  sparklineData = [12, 19, 15, 25, 22, 30, 28],
}) => {
  const [displayValue, setDisplayValue] = useState<string | number>(value);

  useEffect(() => {
    const rawValue = String(value);
    const match = rawValue.match(/^(.*?)([\d,.]+)(.*)$/);
    if (!match) {
      setDisplayValue(value);
      return;
    }

    const [, prefix, numericPart, suffix] = match;
    const target = Number(numericPart.replace(/,/g, ''));
    if (!Number.isFinite(target)) {
      setDisplayValue(value);
      return;
    }

    const startedAt = performance.now();
    let frame = 0;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / 200);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(target * eased);
      setDisplayValue(`${prefix}${current.toLocaleString()}${suffix}`);
      if (progress < 1) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  const colorMap = {
    cyan: {
      bg: 'from-cyan-500/20 to-cyan-600/10 text-cyan-400 border-cyan-500/30',
      chart: '#06B6D4',
    },
    indigo: {
      bg: 'from-indigo-500/20 to-indigo-600/10 text-indigo-400 border-indigo-500/30',
      chart: '#4F46E5',
    },
    emerald: {
      bg: 'from-emerald-500/20 to-emerald-600/10 text-emerald-400 border-emerald-500/30',
      chart: '#10B981',
    },
    amber: {
      bg: 'from-amber-500/20 to-amber-600/10 text-amber-400 border-amber-500/30',
      chart: '#F59E0B',
    },
    rose: {
      bg: 'from-rose-500/20 to-rose-600/10 text-rose-400 border-rose-500/30',
      chart: '#EF4444',
    },
    blue: {
      bg: 'from-blue-500/20 to-blue-600/10 text-blue-400 border-blue-500/30',
      chart: '#2563EB',
    },
  };

  const selectedColor = colorMap[color];
  const chartData = sparklineData.map((val, idx) => ({ idx, val }));

  return (
    <GlassCard interactive className="p-5 flex flex-col justify-between relative overflow-hidden group">
      {/* Background soft radial glow */}
      <div className="absolute -right-6 -bottom-6 w-28 h-28 bg-current opacity-5 rounded-full blur-2xl pointer-events-none" />

      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</span>
          <div className={`p-2.5 rounded-xl bg-gradient-to-br border ${selectedColor.bg} transition-transform group-hover:scale-110`}>
            <Icon className="w-5 h-5" />
          </div>
        </div>

        <div className="flex items-baseline justify-between gap-2">
          <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{displayValue}</span>
          {trend && (
            <span
              className={`inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full ${
                trendUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
              }`}
            >
              {trendUp ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
              {trend}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2 border-t border-slate-800/80 pt-3">
        <span className="text-xs text-slate-400 font-medium truncate max-w-[170px]">{subtitle}</span>

        {/* Mini Sparkline */}
        <div className="w-16 h-8 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={selectedColor.chart} stopOpacity={0.6} />
                  <stop offset="100%" stopColor={selectedColor.chart} stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="val"
                stroke={selectedColor.chart}
                strokeWidth={2}
                fill={`url(#grad-${color})`}
                isAnimationActive={true}
                animationDuration={200}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </GlassCard>
  );
};
