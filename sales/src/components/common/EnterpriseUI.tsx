import React from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertCircle,
  Bell,
  ChevronRight,
  Inbox,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { Badge } from './Badge';
import { GlassCard } from './GlassCard';
import { ProfileAvatar } from './ProfileAvatar';

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export interface PageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  eyebrow,
  actions,
  icon: Icon,
  className,
}) => (
  <header className={cx('flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
    <div className="min-w-0">
      {eyebrow && <p className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-indigo-600">{eyebrow}</p>}
      <div className="flex items-center gap-3">
        {Icon && (
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-600/20">
            <Icon aria-hidden="true" className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="text-[length:var(--tf-font-size-page-title)] font-bold text-slate-950">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
        </div>
      </div>
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
  </header>
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  loading?: boolean;
}

const ButtonContent = ({
  icon: Icon,
  loading,
  children,
}: {
  icon?: LucideIcon;
  loading?: boolean;
  children?: React.ReactNode;
}) => (
  <>
    {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : Icon ? <Icon aria-hidden="true" className="h-4 w-4" /> : null}
    <span>{children}</span>
  </>
);

export const PrimaryButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, icon, loading = false, disabled, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'glass-button-primary inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    >
      <ButtonContent icon={icon} loading={loading}>{children}</ButtonContent>
    </button>
  ),
);
PrimaryButton.displayName = 'PrimaryButton';

export const SecondaryButton = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, icon, loading = false, disabled, children, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:border-indigo-200 hover:bg-white hover:text-indigo-700 disabled:cursor-not-allowed disabled:opacity-55',
        className,
      )}
      {...props}
    >
      <ButtonContent icon={icon} loading={loading}>{children}</ButtonContent>
    </button>
  ),
);
SecondaryButton.displayName = 'SecondaryButton';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon: LucideIcon;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, icon: Icon, className, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white/80 text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-700',
        className,
      )}
      {...props}
    >
      <Icon aria-hidden="true" className="h-5 w-5" />
    </button>
  ),
);
IconButton.displayName = 'IconButton';

export interface MetricCardProps extends React.ComponentProps<typeof GlassCard> {
  label: string;
  value: React.ReactNode;
  supportingText?: React.ReactNode;
  icon?: LucideIcon;
  trend?: React.ReactNode;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  supportingText,
  icon: Icon,
  trend,
  className,
  ...props
}) => (
  <GlassCard className={cx('p-5', className)} {...props}>
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <p className="mt-2 text-[length:var(--tf-font-size-kpi)] font-extrabold tracking-tight text-slate-950">{value}</p>
      </div>
      {Icon && <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-indigo-50 text-indigo-600"><Icon aria-hidden="true" className="h-5 w-5" /></span>}
    </div>
    {(supportingText || trend) && (
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200/70 pt-3 text-xs text-slate-500">
        <span>{supportingText}</span>
        {trend && <span className="font-bold text-indigo-600">{trend}</span>}
      </div>
    )}
  </GlassCard>
);

export interface ChartCardProps extends React.ComponentProps<typeof GlassCard> {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}

export const ChartCard: React.FC<ChartCardProps> = ({ title, description, actions, children, className, ...props }) => (
  <GlassCard className={cx('p-5 sm:p-6', className)} {...props}>
    <div className="mb-5 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[length:var(--tf-font-size-section-title)] font-bold text-slate-950">{title}</h2>
        {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
    {children}
  </GlassCard>
);

export const StatusBadge = Badge;

interface StateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const StatePanel = ({
  icon: Icon,
  tone,
  title,
  description,
  actionLabel,
  onAction,
  className,
}: StateProps & { icon: LucideIcon; tone: string }) => (
  <div className={cx('grid min-h-40 place-items-center rounded-2xl border border-dashed border-slate-200 bg-white/55 px-6 py-8 text-center', className)}>
    <div>
      <span className={cx('mx-auto grid h-11 w-11 place-items-center rounded-2xl', tone)}>
        <Icon aria-hidden="true" className="h-5 w-5" />
      </span>
      <h3 className="mt-3 text-sm font-bold text-slate-900">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">{description}</p>}
      {actionLabel && onAction && <SecondaryButton className="mt-4" icon={RefreshCw} onClick={onAction}>{actionLabel}</SecondaryButton>}
    </div>
  </div>
);

export const EmptyState: React.FC<StateProps> = (props) => <StatePanel icon={Inbox} tone="bg-indigo-50 text-indigo-600" {...props} />;
export const ErrorState: React.FC<StateProps> = (props) => <StatePanel icon={AlertCircle} tone="bg-rose-50 text-rose-600" {...props} />;

export const LoadingSkeleton: React.FC<{ rows?: number; className?: string; label?: string }> = ({
  rows = 3,
  className,
  label = 'Loading content',
}) => (
  <div className={cx('space-y-3', className)} role="status" aria-label={label}>
    {Array.from({ length: rows }, (_, index) => (
      <div key={index} className="h-12 animate-pulse rounded-xl bg-slate-200/80" />
    ))}
    <span className="sr-only">{label}</span>
  </div>
);

export interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  containerClassName?: string;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  ({ label = 'Search', className, containerClassName, ...props }, ref) => (
    <label className={cx('relative block', containerClassName)}>
      <span className="sr-only">{label}</span>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input ref={ref} type="search" className={cx('glass-input min-h-11 w-full rounded-xl py-2.5 pl-10 pr-4 text-sm', className)} {...props} />
    </label>
  ),
);
SearchInput.displayName = 'SearchInput';

export const FilterBar: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, children, ...props }) => (
  <div className={cx('flex flex-col gap-3 rounded-2xl border border-white/70 bg-white/60 p-3 shadow-sm sm:flex-row sm:items-center', className)} {...props}>
    {children}
  </div>
);

export interface DataTableColumn<Row> {
  key: string;
  header: React.ReactNode;
  render: (row: Row) => React.ReactNode;
  className?: string;
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: Array<DataTableColumn<Row>>;
  getRowKey: (row: Row) => React.Key;
  caption: string;
  emptyState?: React.ReactNode;
  className?: string;
}

export function DataTable<Row>({ rows, columns, getRowKey, caption, emptyState, className }: DataTableProps<Row>) {
  if (!rows.length && emptyState) return <>{emptyState}</>;
  return (
    <div className={cx('overflow-x-auto rounded-2xl border border-slate-200 bg-white/75', className)}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs uppercase tracking-wider text-slate-500">
          <tr>{columns.map((column) => <th key={column.key} scope="col" className={cx('px-4 py-3 font-bold', column.className)}>{column.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-200/80">
          {rows.map((row) => (
            <tr key={getRowKey(row)}>{columns.map((column) => <td key={column.key} className={cx('px-4 py-3 text-slate-700', column.className)}>{column.render(row)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export interface AgentCardProps {
  name: string;
  status: string;
  avatar?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
}

export const AgentCard: React.FC<AgentCardProps> = ({ name, status, avatar, meta, actions, onClick }) => (
  <GlassCard interactive={Boolean(onClick)} className="p-4" onClick={onClick}>
    <div className="flex items-center gap-3">
      <ProfileAvatar src={avatar} name={name} className="h-11 w-11 rounded-2xl" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-bold text-slate-900">{name}</h3>
        <div className="mt-1 flex items-center gap-2"><Badge status={status} />{meta}</div>
      </div>
      {actions ?? (onClick && <ChevronRight aria-hidden="true" className="h-4 w-4 text-slate-400" />)}
    </div>
  </GlassCard>
);

export interface NotificationItem {
  id: string;
  title: string;
  description?: string;
  time?: string;
  unread?: boolean;
}

export const NotificationPanel: React.FC<{ items: NotificationItem[]; emptyMessage?: string }> = ({
  items,
  emptyMessage = 'No notifications available.',
}) => (
  <section aria-label="Notifications" className="space-y-2">
    {!items.length ? <EmptyState title={emptyMessage} className="min-h-32" /> : items.map((item) => (
      <article key={item.id} className="flex gap-3 rounded-xl border border-slate-200 bg-white/70 p-3">
        <span className={cx('mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl', item.unread ? 'bg-indigo-50 text-indigo-600' : 'bg-slate-100 text-slate-500')}>
          <Bell aria-hidden="true" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">{item.title}</h3>
          {item.description && <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>}
          {item.time && <time className="mt-1 block text-[11px] text-slate-400">{item.time}</time>}
        </div>
      </article>
    ))}
  </section>
);
