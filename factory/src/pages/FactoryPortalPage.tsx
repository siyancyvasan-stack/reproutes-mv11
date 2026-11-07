import React, {
  FormEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Factory,
  CalendarDays,
  Eye,
  FileText,
  Gauge,
  Loader2,
  MapPin,
  Package,
  Pencil,
  Plus,
  Search,
  Settings,
  Store,
  Trash2,
  Truck,
  UserRound,
  Users,
  Warehouse,
  X,
} from "lucide-react";
import { FactoryLayout } from "../components/layout/FactoryLayout";
import {
  factoryApi,
  FactoryDashboard,
  FactoryPage,
} from "../services/factoryApi";
import { deleteOrder, loadAgents } from "../services/domainApi";
import { useLiveAgentTracking } from "../hooks/useLiveAgentTracking";
import { Agent } from "../types";
import { ProfileAvatar } from "../components/common/ProfileAvatar";
import { useToast } from "../context/ToastContext";
import { EnterpriseFactoryDashboard } from "./EnterpriseFactoryDashboard";
import { InvoiceManagementContent } from "./InvoiceManagementPage";
import { apiBlob } from "../services/apiClient";
import { ImageUploadField } from "../components/common/ImageUploadField";
import { ContactsContent } from "./ContactsPage";
import { ExportButton } from "../components/common/ExportButton";
import { Badge } from "../components/common/Badge";
import { downloadProductionReport } from "../services/productionExport";
import { downloadFactoryOrdersReport } from "../services/factoryOrdersExport";
import { Modal } from "../components/common/Modal";

const InteractiveCityMap = lazy(() =>
  import("../components/map/InteractiveCityMap").then((module) => ({
    default: module.InteractiveCityMap,
  })),
);
type Section =
  | "dashboard"
  | "orders"
  | "production"
  | "products"
  | "inventory"
  | "members"
  | "dispatch"
  | "sales-tracking"
  | "retailers"
  | "contacts"
  | "invoices"
  | "reports"
  | "notifications"
  | "settings";
type AnyRow = Record<string, any>;

const titleCase = (value?: string) =>
  (value ?? "—")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
const date = (value?: string) =>
  value ? new Date(value).toLocaleDateString() : "—";
const finiteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const safeNode = (value: React.ReactNode) =>
  typeof value === "number" && !Number.isFinite(value) ? "—" : value;
const statusTone = (status?: string) => {
  const value = status ?? "";
  if (/(READY|COMPLETED|DELIVERED|GOOD|WORKING|ACTIVE|LIVE)/.test(value))
    return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (/(FAILED|REJECTED|CANCELLED|CRITICAL|ABSENT)/.test(value))
    return "bg-rose-50 text-rose-700 ring-rose-600/20";
  if (/(LOW|PAUSED|BREAK|DELAY|QUALITY)/.test(value))
    return "bg-amber-50 text-amber-700 ring-amber-600/20";
  return "bg-blue-50 text-blue-700 ring-blue-600/20";
};
const Status = ({ value }: { value?: string }) => (
  <span
    className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ring-1 ring-inset ${statusTone(value)}`}
  >
    {titleCase(value)}
  </span>
);
const Card = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
  key?: React.Key;
}) => (
  <section
    className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}
  >
    {children}
  </section>
);
const Heading = ({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
    <div className="flex items-start gap-3">
      <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600">
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 className="text-xl font-extrabold text-slate-950">{title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
      </div>
    </div>
    {action}
  </div>
);
const Empty = ({ label = "No records found" }) => (
  <div className="grid min-h-40 place-items-center text-sm text-slate-400">
    {label}
  </div>
);
const SearchBox = ({
  value,
  onChange,
  placeholder = "Search records…",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) => (
  <label className="relative block w-full sm:w-72">
    <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
    />
  </label>
);
const PageNav = ({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) => (
  <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
    <span>
      Page {page} of {pages}
    </span>
    <div className="flex gap-2">
      <button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
      >
        Previous
      </button>
      <button
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
      >
        Next
      </button>
    </div>
  </div>
);

const usePage = (loader: (query: string) => Promise<FactoryPage<any>>) => {
  const [data, setData] = useState<FactoryPage<any>>({
    items: [],
    pagination: { page: 1, limit: 20, total: 0, pages: 1 },
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const refresh = React.useCallback(() => {
    setLoading(true);
    const query = new URLSearchParams({
      page: String(page),
      limit: "20",
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
    });
    return loader(query.toString())
      .then(setData)
      .finally(() => setLoading(false));
  }, [loader, page, search, status]);
  const removeItem = React.useCallback(
    (id: string) =>
      setData((current) => {
        const total = Math.max(0, current.pagination.total - 1);
        return {
          items: current.items.filter((item) => item.id !== id),
          pagination: {
            ...current.pagination,
            total,
            pages: Math.max(1, Math.ceil(total / current.pagination.limit)),
          },
        };
      }),
    [],
  );
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 250);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  return {
    data,
    search,
    setSearch,
    status,
    setStatus,
    page,
    setPage,
    loading,
    refresh,
    removeItem,
  };
};

const Table = ({
  columns,
  rows,
  loading,
}: {
  columns: Array<[string, (row: AnyRow) => React.ReactNode]>;
  rows: AnyRow[];
  loading?: boolean;
}) => (
  <div className="overflow-x-auto">
    {loading ? (
      <div className="grid min-h-48 place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
      </div>
    ) : !rows.length ? (
      <Empty />
    ) : (
      <table className="w-full min-w-[800px] text-left">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80">
            {columns.map(([label]) => (
              <th
                key={label}
                className="px-5 py-3 text-[10px] font-extrabold uppercase tracking-wider text-slate-500"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-slate-100 text-sm hover:bg-slate-50"
            >
              {columns.map(([label, render]) => (
                <td key={label} className="px-5 py-4 text-slate-600">
                  {safeNode(render(row))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const OrderDetails = ({
  order,
  onClose,
}: {
  order?: AnyRow;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!order) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [order, onClose]);
  if (!order) return null;
  const quantity =
    order.items?.reduce(
      (sum: number, item: AnyRow) => sum + finiteNumber(item.casesQuantity),
      0,
    ) ?? 0;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-details-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="my-6 w-full max-w-3xl overflow-hidden rounded-3xl border border-white bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5 text-white">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-100">
              Sales order
            </p>
            <h3 id="order-details-title" className="mt-1 text-xl font-black">
              #{order.id.slice(-8).toUpperCase()}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close order details"
            className="rounded-xl bg-white/15 p-2 transition hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [UserRound, "Customer", order.shopName],
              [UserRound, "Salesperson", order.agent?.name ?? "—"],
              [CalendarDays, "Order date", date(order.createdAt)],
              [CalendarDays, "Expected ready", date(order.expectedReadyAt)],
            ].map(([Icon, label, value]) => (
              <div key={String(label)} className="rounded-2xl bg-slate-50 p-4">
                <Icon className="mb-3 h-5 w-5 text-indigo-500" />
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  {label as string}
                </p>
                <p className="mt-1 text-sm font-bold text-slate-900">
                  {value as React.ReactNode}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 p-5">
              <h4 className="font-extrabold text-slate-900">
                Delivery details
              </h4>
              <div className="mt-4 flex gap-3 text-sm text-slate-600">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
                <span>{order.shopAddress || "No address provided"}</span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 text-sm">
                <span className="text-slate-500">Payment term</span>
                <b className="text-slate-900">{titleCase(order.paymentTerm)}</b>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 p-5">
              <h4 className="font-extrabold text-slate-900">Order summary</h4>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Total quantity</span>
                  <b>{quantity} cases</b>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Priority</span>
                  <Status value={order.priority} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Status</span>
                  <Status value={order.status} />
                </div>
                <div className="flex justify-between border-t border-slate-100 pt-3">
                  <span className="font-bold text-slate-700">Order total</span>
                  <b className="text-base text-indigo-600">
                    LKR {finiteNumber(order.totalAmountLkr).toLocaleString()}
                  </b>
                </div>
              </div>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
              <h4 className="font-extrabold text-slate-900">
                Ordered products
              </h4>
            </div>
            <div className="divide-y divide-slate-100">
              {order.items?.map((item: AnyRow) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-4 px-5 py-4"
                >
                  <div>
                    <p className="font-bold text-slate-900">
                      {item.product?.name ?? "Product"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {item.product?.sku ?? "No SKU"}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-xl bg-indigo-50 px-3 py-1.5 text-sm font-extrabold text-indigo-700">
                    {item.casesQuantity} cases
                  </span>
                </div>
              ))}
            </div>
          </div>
          {order.remarks && (
            <div className="rounded-2xl bg-amber-50 p-4">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-amber-700">
                Remarks
              </p>
              <p className="mt-1 text-sm text-amber-900">{order.remarks}</p>
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

const ProductDetails = ({
  product,
  onClose,
}: {
  product?: AnyRow;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!product) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [product, onClose]);

  if (!product) return null;
  const available = Math.max(
    0,
    finiteNumber(product.stockCases) - finiteNumber(product.reservedStock),
  );
  const details = [
    [
      "Price per case",
      `LKR ${finiteNumber(product.pricePerCaseLkr).toLocaleString()}`,
    ],
    ["Units per case", finiteNumber(product.unitsPerCase).toLocaleString()],
    [
      "Available stock",
      `${available.toLocaleString()} ${titleCase(product.unitType).toLowerCase()}`,
    ],
    ["Reserved stock", finiteNumber(product.reservedStock).toLocaleString()],
    [
      "Pending production",
      finiteNumber(product.pendingProductionQuantity).toLocaleString(),
    ],
    [
      "Production capacity",
      finiteNumber(product.productionCapacity).toLocaleString(),
    ],
    [
      "Minimum stock level",
      finiteNumber(product.minimumStockLevel).toLocaleString(),
    ],
    ["Damaged stock", finiteNumber(product.damagedStock).toLocaleString()],
  ];

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-details-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="my-6 w-full max-w-2xl overflow-hidden rounded-3xl border border-white bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5 text-white">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-white/15">
              {product.imageUrl ? (
                <img
                  src={product.imageUrl}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <Package className="h-7 w-7" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-100">
                {product.category || "Product"}
              </p>
              <h3
                id="product-details-title"
                className="mt-1 text-xl font-black"
              >
                {product.name}
              </h3>
              <p className="mt-0.5 text-sm text-indigo-100">
                SKU: {product.sku}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close product details"
            className="rounded-xl bg-white/15 p-2 transition hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 p-6">
          <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                Product status
              </p>
              <p className="mt-1 text-sm font-bold text-slate-900">
                {product.active
                  ? "Available for operations"
                  : "Not currently available"}
              </p>
            </div>
            <Status value={product.active ? "ACTIVE" : "INACTIVE"} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {details.map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-slate-200 p-4"
              >
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  {label}
                </p>
                <p className="mt-1.5 text-base font-black text-slate-900">
                  {value}
                </p>
              </div>
            ))}
          </div>
          {product.description && (
            <div className="rounded-2xl bg-indigo-50 p-4">
              <p className="text-[10px] font-extrabold uppercase tracking-wider text-indigo-500">
                Description
              </p>
              <p className="mt-1.5 text-sm leading-6 text-indigo-950">
                {product.description}
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

const MemberDetails = ({
  member,
  onClose,
}: {
  member?: AnyRow;
  onClose: () => void;
}) => {
  useEffect(() => {
    if (!member) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [member, onClose]);
  if (!member) return null;
  const latestAttendance = member.attendance?.[0];
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm"
      onMouseDown={onClose}
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-details-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="my-6 w-full max-w-2xl overflow-hidden rounded-3xl border border-white bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between bg-gradient-to-r from-indigo-600 to-violet-600 px-6 py-5 text-white">
          <div className="flex items-center gap-4">
            <ProfileAvatar
              src={member.profileImage}
              name={member.name}
              className="h-14 w-14 rounded-2xl ring-2 ring-white/30"
            />
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-indigo-100">
                Factory member
              </p>
              <h3 id="member-details-title" className="mt-1 text-xl font-black">
                {member.name}
              </h3>
              <p className="text-sm text-indigo-100">{member.employeeId}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close member details"
            className="rounded-xl bg-white/15 p-2 hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-5 p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Department", member.department],
              ["Status", titleCase(member.status)],
              ["Workload", `${finiteNumber(member.workload)} tasks`],
              ["Phone", member.phone || "Not provided"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                  {label}
                </p>
                <p className="mt-1.5 text-sm font-bold text-slate-900">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-slate-900">
                Current assignment
              </h4>
              <Status value={member.status} />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {member.currentTask || "No task is currently assigned."}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 p-5">
            <h4 className="font-extrabold text-slate-900">Latest attendance</h4>
            {latestAttendance ? (
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ["Date", date(latestAttendance.date)],
                  [
                    "Punch in",
                    latestAttendance.punchInAt
                      ? new Date(
                          latestAttendance.punchInAt,
                        ).toLocaleTimeString()
                      : "—",
                  ],
                  [
                    "Punch out",
                    latestAttendance.punchOutAt
                      ? new Date(
                          latestAttendance.punchOutAt,
                        ).toLocaleTimeString()
                      : "—",
                  ],
                  [
                    "Break",
                    `${finiteNumber(latestAttendance.breakMinutes)} min`,
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-slate-400">{label}</p>
                    <b className="text-slate-800">{value}</b>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">
                No attendance record available.
              </p>
            )}
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

const Dashboard = () => {
  const [data, setData] = useState<FactoryDashboard>();
  useEffect(() => {
    void factoryApi.dashboard().then(setData);
  }, []);
  if (!data)
    return (
      <div className="grid h-72 place-items-center">
        <Loader2 className="animate-spin text-indigo-500" />
      </div>
    );
  const cards = [
    [
      "Today’s Production",
      data.kpis.todayProduction,
      Factory,
      "text-indigo-600 bg-indigo-50",
    ],
    [
      "Pending Orders",
      data.kpis.pendingOrders,
      ClipboardList,
      "text-amber-600 bg-amber-50",
    ],
    [
      "In Production",
      data.kpis.inProduction,
      Gauge,
      "text-blue-600 bg-blue-50",
    ],
    [
      "Ready to Dispatch",
      data.kpis.readyToDispatch,
      Truck,
      "text-emerald-600 bg-emerald-50",
    ],
    [
      "Low Stock Items",
      data.kpis.lowStockItems,
      AlertTriangle,
      "text-rose-600 bg-rose-50",
    ],
    [
      "Delayed Orders",
      data.kpis.delayedOrders,
      AlertTriangle,
      "text-orange-600 bg-orange-50",
    ],
    [
      "Active Salespersons",
      data.kpis.activeSalespersons,
      Users,
      "text-cyan-600 bg-cyan-50",
    ],
    [
      "Active Factory Members",
      data.kpis.activeFactoryMembers,
      Users,
      "text-violet-600 bg-violet-50",
    ],
  ] as const;
  const completedPercent = Math.min(
    100,
    Math.round(
      (finiteNumber(data.production.completed) /
        Math.max(finiteNumber(data.production.target), 1)) *
        100,
    ),
  );
  return (
    <>
      <Heading
        icon={Factory}
        title="Factory Dashboard"
        subtitle="A live view of production, inventory and fulfilment"
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map(([label, value, Icon, tone]) => (
          <Card key={label} className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-black text-slate-950">
                  {Number(value).toLocaleString()}
                </p>
              </div>
              <span className={`rounded-xl p-2.5 ${tone}`}>
                <Icon className="h-5 w-5" />
              </span>
            </div>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-2">
          <h3 className="font-extrabold text-slate-900">Production Overview</h3>
          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Daily", data.production.daily],
                ["Weekly", data.production.weekly],
                ["Monthly", data.production.monthly],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    {label}
                  </p>
                  <p className="mt-1 text-lg font-black">
                    {Number(value).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
            <div>
              <div className="mb-2 flex justify-between text-xs font-bold">
                <span>Target completion</span>
                <span>{completedPercent}%</span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{ width: `${completedPercent}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-rose-50 p-3 text-rose-700">
                <p className="text-xs">Rejected</p>
                <b>{data.production.rejected.toLocaleString()}</b>
              </div>
              <div className="rounded-xl bg-amber-50 p-3 text-amber-700">
                <p className="text-xs">Damaged</p>
                <b>{data.production.damaged.toLocaleString()}</b>
              </div>
            </div>
          </div>
        </Card>
        <Card className="lg:col-span-3">
          <div className="border-b p-5">
            <h3 className="font-extrabold">Recent Sales Orders</h3>
          </div>
          <Table
            rows={data.recentOrders}
            columns={[
              [
                "Order",
                (r) => (
                  <b className="text-slate-900">
                    #{r.id.slice(-8).toUpperCase()}
                  </b>
                ),
              ],
              ["Customer", (r) => r.shopName],
              ["Salesperson", (r) => r.agent?.name],
              ["Product", (r) => r.items?.[0]?.product?.name ?? "—"],
              [
                "Quantity",
                (r) =>
                  r.items?.reduce(
                    (sum: number, item: AnyRow) => sum + item.casesQuantity,
                    0,
                  ),
              ],
              ["Status", (r) => <Status value={r.status} />],
            ]}
          />
        </Card>
      </div>
    </>
  );
};

const Orders = () => {
  const page = usePage(factoryApi.orders);
  const { showToast } = useToast();
  const [selectedOrder, setSelectedOrder] = useState<AnyRow>();
  const [orderToDelete, setOrderToDelete] = useState<AnyRow>();
  const [deleting, setDeleting] = useState(false);
  const deleteInFlight = React.useRef(false);
  const displayOrderId = (id: string) => `#${id.slice(-8).toUpperCase()}`;
  const update = async (id: string, status: string) => {
    await factoryApi.updateOrder(id, status);
    showToast(
      "Order updated",
      `Order moved to ${titleCase(status)}.`,
      "success",
    );
    void page.refresh();
  };
  const confirmDelete = async () => {
    if (!orderToDelete || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleting(true);
    const deletedOrder = orderToDelete;
    try {
      await deleteOrder(deletedOrder.id);
      page.removeItem(deletedOrder.id);
      if (selectedOrder?.id === deletedOrder.id) setSelectedOrder(undefined);
      if (page.data.items.length === 1 && page.page > 1)
        page.setPage(page.page - 1);
      setOrderToDelete(undefined);
      showToast(
        "Order deleted",
        `Order ${displayOrderId(deletedOrder.id)} deleted successfully.`,
        "success",
      );
    } catch {
      showToast(
        "Delete failed",
        "Unable to delete the order. Please try again.",
        "error",
      );
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  };
  const filters = [
    ["", "All"],
    ["APPROVED", "Approved"],
    ["PENDING", "Pending"],
    ["IN_PRODUCTION", "In Production"],
    ["DELIVERED", "Delivered"],
  ] as const;
  const orderStatus = (value?: string) => {
    const normalized = titleCase(value);
    if (normalized === "In Production" || normalized === "Production Required")
      return (
        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-indigo-500/30 bg-indigo-500/15 px-2.5 py-1 text-xs font-medium text-indigo-700 backdrop-blur-md">
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-indigo-500" />
          {normalized}
        </span>
      );
    if (normalized === "Failed" || normalized === "Rejected")
      return (
        <span className="inline-flex items-center whitespace-nowrap rounded-full border border-rose-500/30 bg-rose-500/15 px-2.5 py-1 text-xs font-medium text-rose-700 backdrop-blur-md">
          <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-rose-500" />
          {normalized}
        </span>
      );
    return (
      <Badge
        status={normalized}
        className="!text-emerald-700 [&:has(.bg-amber-400)]:!text-amber-700 [&:has(.bg-rose-400)]:!text-rose-700"
      />
    );
  };
  return (
    <>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-cyan-100/80 p-2.5 text-cyan-700">
            <ClipboardList className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-xl font-extrabold text-slate-950">
              Sales Orders
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Approved orders entering the factory workflow
            </p>
          </div>
        </div>
        <ExportButton
          dataset="factory_orders"
          pdf
          formats={["csv", "pdf"]}
          disabled={page.loading || page.data.items.length === 0}
          onExport={(format) =>
            downloadFactoryOrdersReport(
              page.data.items,
              format as "csv" | "pdf",
              page.status,
              page.search,
            )
          }
          busyLabel="Preparing export..."
          successMessage="Factory orders exported successfully."
          failureMessage="Unable to export orders. Please try again."
          emptyMessage="No orders available to export."
          formatLabels={{ csv: "Export CSV", pdf: "Export PDF" }}
        />
      </div>
      <Card className="flex flex-col items-stretch justify-between gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
        <label className="relative block w-full lg:w-96">
          <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
          <input
            value={page.search}
            onChange={(event) => page.setSearch(event.target.value)}
            placeholder="Search Order ID, Customer or Product..."
            className="glass-input min-h-11 w-full rounded-xl py-2.5 pl-11 pr-4 text-sm font-semibold"
          />
        </label>
        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
          {filters.map(([value, label]) => (
            <button
              key={label}
              onClick={() => page.setStatus(value)}
              className={`min-h-10 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold transition-all ${page.status === value ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20" : "bg-slate-900/60 text-slate-400 hover:text-white"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </Card>
      <Card className="p-4 sm:p-6">
        {page.loading ? (
          <div className="grid min-h-48 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-500" />
          </div>
        ) : !page.data.items.length ? (
          <Empty />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-300/80 !bg-slate-100/45 font-sans shadow-lg shadow-slate-300/30 backdrop-blur-xl">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-left text-base">
                <thead className="bg-slate-200/70 backdrop-blur-xl">
                  <tr className="text-sm font-black uppercase tracking-wide text-slate-950">
                    {[
                      "Order ID",
                      "Customer",
                      "Product",
                      "Qty",
                      "Order Date",
                      "Priority",
                      "Status",
                      "Action",
                    ].map((label) => (
                      <th key={label} className="px-4 py-3.5">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {page.data.items.map((r, index) => (
                    <tr
                      key={r.id}
                      className={`group ${index % 2 === 0 ? "bg-white/35" : "bg-slate-200/35"} transition-colors duration-200 hover:bg-white/75`}
                    >
                      <td className="px-4 py-4">
                        <span className="inline-flex whitespace-nowrap rounded-lg border border-cyan-300 bg-cyan-100/80 px-2.5 py-1 font-mono text-sm font-extrabold tracking-wide text-cyan-950">
                          {displayOrderId(r.id)}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <b className="text-slate-950">{r.shopName}</b>
                        <p className="mt-0.5 text-sm font-semibold text-slate-600">
                          {r.agent?.name}
                        </p>
                      </td>
                      <td className="px-4 py-4 font-medium text-slate-700">
                        {r.items?.map((x: AnyRow) => x.product.name).join(", ")}
                      </td>
                      <td className="px-4 py-4 font-bold text-slate-950">
                        {r.items?.reduce(
                          (n: number, x: AnyRow) =>
                            n + Number(x.cases ?? x.casesQuantity ?? 0),
                          0,
                        )}
                      </td>
                      <td className="px-4 py-4 font-medium text-slate-700">
                        {date(r.createdAt)}
                      </td>
                      <td className="px-4 py-4">
                        <Status value={r.priority} />
                      </td>
                      <td className="px-4 py-4">{orderStatus(r.status)}</td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setSelectedOrder(r)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-cyan-400 bg-white/80 px-3 py-2 text-sm font-extrabold text-cyan-900 transition-all hover:bg-cyan-100 focus-visible:ring-2 focus-visible:ring-cyan-500"
                          >
                            <Eye className="h-4 w-4" />
                            View
                          </button>
                          <button
                            type="button"
                            onClick={() => setOrderToDelete(r)}
                            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-rose-300 bg-rose-50/80 px-3 py-2 text-sm font-extrabold text-rose-700 transition-all hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-500"
                            aria-label={`Delete order ${r.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                          <select
                            aria-label={`Update order ${r.id} status`}
                            value={r.status}
                            onChange={(e) => void update(r.id, e.target.value)}
                            className="rounded-lg border px-2 py-1.5 text-xs"
                          >
                            {[
                              "PRODUCTION_REQUIRED",
                              "IN_PRODUCTION",
                              "QUALITY_CHECK",
                              "READY",
                              "DISPATCHED",
                              "DELIVERED",
                              "CANCELLED",
                            ].map((x) => (
                              <option key={x} value={x}>
                                {titleCase(x)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <PageNav
          page={page.page}
          pages={page.data.pagination.pages}
          onPage={page.setPage}
        />
      </Card>
      <Modal
        isOpen={Boolean(orderToDelete)}
        onClose={() => {
          if (!deleteInFlight.current) setOrderToDelete(undefined);
        }}
        title="Delete Order?"
        maxWidth="sm"
      >
        <div className="space-y-5">
          <div className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 text-sm font-medium leading-6 text-slate-700">
            Are you sure you want to delete Order{" "}
            {orderToDelete ? displayOrderId(orderToDelete.id) : ""}? This action
            cannot be undone.
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setOrderToDelete(undefined)}
              className="min-h-11 rounded-xl border border-slate-300 bg-white/80 px-5 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-extrabold text-white shadow-sm hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting..." : "Delete Order"}
            </button>
          </div>
        </div>
      </Modal>
      <OrderDetails
        order={selectedOrder}
        onClose={() => setSelectedOrder(undefined)}
      />
    </>
  );
};

const Products = () => {
  const page = usePage(factoryApi.products);
  const { showToast } = useToast();
  const [selectedProduct, setSelectedProduct] = useState<AnyRow>();
  const [editing, setEditing] = useState<AnyRow | null>();
  const [productToDelete, setProductToDelete] = useState<AnyRow>();
  const [deleting, setDeleting] = useState(false);
  const deleteInFlight = React.useRef(false);
  const confirmDelete = async () => {
    if (!productToDelete || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleting(true);
    const product = productToDelete;
    try {
      await factoryApi.deleteProduct(product.id);
      page.removeItem(product.id);
      if (selectedProduct?.id === product.id) setSelectedProduct(undefined);
      if (page.data.items.length === 1 && page.page > 1)
        page.setPage(page.page - 1);
      setProductToDelete(undefined);
      showToast(
        "Product deleted",
        product.name + " was deleted successfully.",
        "success",
      );
    } catch {
      showToast(
        "Delete failed",
        "Unable to delete product. Please try again.",
        "error",
      );
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  };
  const actionButton =
    "inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-white/80 px-2.5 py-1.5 text-xs font-extrabold transition-all focus-visible:outline-none focus-visible:ring-2";
  return (
    <>
      <Heading
        icon={Package}
        title="Products"
        subtitle="Finished goods, capacity and stock controls"
        action={
          <div className="flex gap-2">
            <SearchBox value={page.search} onChange={page.setSearch} />
            <button
              onClick={() => setEditing({})}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white"
            >
              <Plus className="h-4 w-4" />
              Create product
            </button>
          </div>
        }
      />
      <Card>
        <Table
          loading={page.loading}
          rows={page.data.items}
          columns={[
            [
              "Product",
              (r) => (
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center overflow-hidden rounded-xl bg-indigo-50">
                    {r.imageUrl ? (
                      <img
                        src={r.imageUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Package className="h-5 w-5 text-indigo-500" />
                    )}
                  </div>
                  <div>
                    <b className="text-slate-900">{r.name}</b>
                    <p className="text-xs">{r.sku}</p>
                  </div>
                </div>
              ),
            ],
            ["Category", (r) => r.category],
            [
              "Price",
              (r) => `LKR ${Number(r.pricePerCaseLkr).toLocaleString()}`,
            ],
            [
              "Available",
              (r) => <b>{Math.max(0, r.stockCases - r.reservedStock)}</b>,
            ],
            ["Reserved", (r) => r.reservedStock],
            ["Pending Production", (r) => r.pendingProductionQuantity],
            ["Capacity", (r) => r.productionCapacity],
            [
              "Status",
              (r) => <Status value={r.active ? "ACTIVE" : "INACTIVE"} />,
            ],
            [
              "Action",
              (r) => (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedProduct(r)}
                    className={`${actionButton} border-cyan-300 text-cyan-800 hover:border-cyan-400 hover:bg-cyan-50 focus-visible:ring-cyan-500`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    onClick={() => setEditing(r)}
                    className={`${actionButton} border-cyan-300 text-cyan-800 hover:border-cyan-400 hover:bg-cyan-50 focus-visible:ring-cyan-500`}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    onClick={() => setProductToDelete(r)}
                    className={`${actionButton} border-rose-300 text-rose-700 hover:border-rose-400 hover:bg-rose-50 focus-visible:ring-rose-500`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              ),
            ],
          ]}
        />
        <PageNav
          page={page.page}
          pages={page.data.pagination.pages}
          onPage={page.setPage}
        />
      </Card>
      <Modal
        isOpen={Boolean(productToDelete)}
        onClose={() => {
          if (!deleteInFlight.current) setProductToDelete(undefined);
        }}
        title="Delete Product?"
        maxWidth="sm"
      >
        <div className="space-y-5">
          <p className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 text-sm font-medium leading-6 text-slate-700">
            Are you sure you want to delete{" "}
            <strong>{productToDelete?.name}</strong>? This action cannot be
            undone.
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setProductToDelete(undefined)}
              className="min-h-11 rounded-xl border border-slate-300 bg-white/80 px-5 text-sm font-extrabold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-extrabold text-white shadow-sm hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting..." : "Delete Product"}
            </button>
          </div>
        </div>
      </Modal>
      <ProductDetails
        product={selectedProduct}
        onClose={() => setSelectedProduct(undefined)}
      />
      {editing && (
        <FactoryProductEditor
          product={editing.id ? editing : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void page.refresh();
          }}
          showToast={showToast}
        />
      )}
    </>
  );
};

const FactoryProductEditor = ({
  product,
  onClose,
  onSaved,
  showToast,
}: {
  product?: AnyRow;
  onClose: () => void;
  onSaved: () => void;
  showToast: (
    title: string,
    message: string,
    type: "success" | "error",
  ) => void;
}) => {
  const [form, setForm] = useState({
    name: product?.name ?? "",
    sku: product?.sku ?? "",
    category: product?.category ?? "",
    pricePerCaseLkr: String(product?.pricePerCaseLkr ?? ""),
    unitsPerCase: String(product?.unitsPerCase ?? ""),
    stockCases: String(product?.stockCases ?? ""),
    minimumStockLevel: String(product?.minimumStockLevel ?? 20),
    productionCapacity: String(product?.productionCapacity ?? 0),
  });
  const [image, setImage] = useState<File>();
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const field = (key: string) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const payload = {
        ...form,
        pricePerCaseLkr: Number(form.pricePerCaseLkr),
        unitsPerCase: Number(form.unitsPerCase),
        stockCases: Number(form.stockCases),
        minimumStockLevel: Number(form.minimumStockLevel),
        productionCapacity: Number(form.productionCapacity),
        unitType: "CASE",
        active: true,
      };
      const row: any = product
        ? await factoryApi.updateProduct(product.id, payload)
        : await factoryApi.createProduct(payload);
      if (image) await factoryApi.uploadProductImage(row.id, image);
      else if (product?.imageUrl && removeImage)
        await factoryApi.deleteProductImage(row.id);
      showToast("Product saved", `${form.name} is now available.`, "success");
      onSaved();
    } catch (error) {
      showToast(
        "Product not saved",
        error instanceof Error ? error.message : "Please check the details.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4"
      onMouseDown={onClose}
    >
      <form
        onSubmit={save}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-xl space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <div className="flex justify-between">
          <div>
            <p className="text-xs font-bold uppercase text-indigo-500">
              Product catalog
            </p>
            <h3 className="text-xl font-black">
              {product ? "Edit Product" : "Add Product"}
            </h3>
          </div>
          <button type="button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["name", "Product Name"],
              ["sku", "SKU"],
              ["category", "Category"],
              ["pricePerCaseLkr", "Price / Case"],
              ["unitsPerCase", "Units / Case"],
              ["stockCases", "Opening Stock"],
              ["minimumStockLevel", "Minimum Stock"],
              ["productionCapacity", "Production Capacity"],
            ] as const
          ).map(([key, label]) => (
            <label
              key={key}
              className={key === "category" ? "sm:col-span-2" : ""}
            >
              <span className="text-xs font-bold text-slate-600">{label}</span>
              <input
                required
                value={form[key]}
                onChange={field(key)}
                type={
                  [
                    "pricePerCaseLkr",
                    "unitsPerCase",
                    "stockCases",
                    "minimumStockLevel",
                    "productionCapacity",
                  ].includes(key)
                    ? "number"
                    : "text"
                }
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              />
            </label>
          ))}
        </div>
        <div className="[&_span]:!text-slate-600">
          <ImageUploadField
            file={image}
            currentUrl={removeImage ? undefined : product?.imageUrl}
            disabled={busy}
            onChange={(file) => {
              setImage(file);
              setRemoveImage(!file);
            }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            disabled={busy}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-bold text-white"
          >
            {busy ? "Saving…" : "Save Product"}
          </button>
        </div>
      </form>
    </div>
  );
};

const Production = () => {
  const page = usePage(factoryApi.production);
  const { showToast } = useToast();
  const update = async (r: AnyRow, status: string) => {
    await factoryApi.updateProduction(r.id, {
      status,
      producedQuantity: r.producedQuantity,
    });
    showToast(
      "Production updated",
      `Status changed to ${titleCase(status)}.`,
      "success",
    );
    void page.refresh();
  };
  const exportRecords = (format: "csv" | "pdf") =>
    downloadProductionReport(page.data.items, format, page.status);
  return (
    <>
      <Heading
        icon={Factory}
        title="Production"
        subtitle="Plan work, assign teams and record completed output"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={page.status}
              onChange={(e) => page.setStatus(e.target.value)}
              className="min-h-11 rounded-xl border px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              {[
                "WAITING",
                "IN_PROGRESS",
                "PAUSED",
                "QUALITY_CHECK",
                "COMPLETED",
                "REJECTED",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <ExportButton
              dataset="factory_production"
              pdf
              formats={["csv", "pdf"]}
              disabled={page.loading || page.data.items.length === 0}
              onExport={(format) => exportRecords(format as "csv" | "pdf")}
              busyLabel="Preparing export..."
              successMessage="Production report exported successfully."
              failureMessage="Unable to export report. Please try again."
              emptyMessage="No production records available to export."
              formatLabels={{ csv: "Export CSV", pdf: "Export PDF" }}
            />
          </div>
        }
      />
      <Card>
        <Table
          loading={page.loading}
          rows={page.data.items}
          columns={[
            ["Production ID", (r) => <b>PR-{r.id.slice(-7).toUpperCase()}</b>],
            [
              "Product",
              (r) => (
                <div>
                  <b className="text-slate-900">{r.product?.name}</b>
                  <p className="text-xs">
                    Order {r.salesOrder?.id?.slice(-6) ?? "Internal"}
                  </p>
                </div>
              ),
            ],
            ["Required", (r) => r.requiredQuantity],
            ["Produced", (r) => r.producedQuantity],
            [
              "Remaining",
              (r) => Math.max(0, r.requiredQuantity - r.producedQuantity),
            ],
            [
              "Progress",
              (r) => (
                <div className="w-28">
                  <p className="mb-1 text-xs font-bold">
                    {Math.round(
                      (r.producedQuantity / Math.max(r.requiredQuantity, 1)) *
                        100,
                    )}
                    %
                  </p>
                  <div className="h-1.5 rounded bg-slate-100">
                    <div
                      className="h-full rounded bg-indigo-500"
                      style={{
                        width: `${Math.min(100, (r.producedQuantity / Math.max(r.requiredQuantity, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ),
            ],
            [
              "Members",
              (r) =>
                r.tasks?.map((x: AnyRow) => x.factoryMember.name).join(", ") ||
                "Unassigned",
            ],
            ["Due", (r) => date(r.expectedFinishAt)],
            [
              "Status",
              (r) => (
                <select
                  value={r.status}
                  onChange={(e) => void update(r, e.target.value)}
                  className="rounded-lg border px-2 py-1.5 text-xs"
                >
                  {[
                    "WAITING",
                    "IN_PROGRESS",
                    "PAUSED",
                    "QUALITY_CHECK",
                    "COMPLETED",
                    "REJECTED",
                  ].map((x) => (
                    <option key={x}>{titleCase(x)}</option>
                  ))}
                </select>
              ),
            ],
          ]}
        />
        <PageNav
          page={page.page}
          pages={page.data.pagination.pages}
          onPage={page.setPage}
        />
      </Card>
    </>
  );
};

const Inventory = () => {
  const [data, setData] = useState<AnyRow>();
  const { showToast } = useToast();
  const refresh = () => factoryApi.inventory().then(setData);
  useEffect(() => {
    void refresh();
  }, []);
  const adjust = async (r: AnyRow, type: string) => {
    const quantity = Number(prompt(`Quantity to ${titleCase(type)}`));
    if (!quantity) return;
    await factoryApi.adjustInventory({ productId: r.id, type, quantity });
    showToast("Inventory updated", `${r.name} stock was updated.`, "success");
    void refresh();
  };
  return (
    <>
      <Heading
        icon={Warehouse}
        title="Inventory"
        subtitle="Finished goods, raw material levels and low-stock alerts"
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <div className="border-b p-5">
            <h3 className="font-extrabold">Finished Goods</h3>
          </div>
          <Table
            rows={data?.finishedGoods ?? []}
            columns={[
              [
                "Product",
                (r) => (
                  <div>
                    <b>{r.name}</b>
                    <p className="text-xs">{r.sku}</p>
                  </div>
                ),
              ],
              ["In stock", (r) => r.stockCases],
              ["Reserved", (r) => r.reservedStock],
              ["Available", (r) => r.availableQuantity],
              ["Damaged", (r) => r.damagedStock],
              ["Level", (r) => <Status value={r.stockStatus} />],
              [
                "Adjust",
                (r) => (
                  <div className="flex gap-1">
                    <button
                      onClick={() => void adjust(r, "STOCK_IN")}
                      className="rounded border px-2 py-1 text-xs"
                    >
                      In
                    </button>
                    <button
                      onClick={() => void adjust(r, "STOCK_OUT")}
                      className="rounded border px-2 py-1 text-xs"
                    >
                      Out
                    </button>
                  </div>
                ),
              ],
            ]}
          />
        </Card>
        <Card>
          <div className="border-b p-5">
            <h3 className="font-extrabold">Raw Materials</h3>
          </div>
          <Table
            rows={data?.rawMaterials ?? []}
            columns={[
              [
                "Material",
                (r) => (
                  <div>
                    <b>{r.name}</b>
                    <p className="text-xs">{r.sku}</p>
                  </div>
                ),
              ],
              ["Current", (r) => `${r.currentQuantity} ${r.unitType}`],
              ["Minimum", (r) => r.minimumStock],
              ["Supplier", (r) => r.supplier || "—"],
              ["Updated", (r) => date(r.updatedAt)],
              ["Reorder", (r) => <Status value={r.reorderStatus} />],
            ]}
          />
        </Card>
      </div>
    </>
  );
};

const Members = () => {
  const page = usePage(factoryApi.members);
  const { showToast } = useToast();
  const [selectedMember, setSelectedMember] = useState<AnyRow>();
  const [memberToDelete, setMemberToDelete] = useState<AnyRow>();
  const [showCreateMember, setShowCreateMember] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [memberForm, setMemberForm] = useState({
    name: "",
    employeeId: "",
    department: "Production",
    phone: "",
    profileImage: "",
    currentTask: "",
    status: "OFF_SHIFT",
  });
  const [deleting, setDeleting] = useState(false);
  const deleteInFlight = React.useRef(false);
  const attendance = async (id: string, action: string) => {
    await factoryApi.attendance(id, action);
    showToast("Attendance recorded", titleCase(action), "success");
    void page.refresh();
  };
  const confirmDelete = async () => {
    if (!memberToDelete || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleting(true);
    const member = memberToDelete;
    try {
      await factoryApi.deleteMember(member.id);
      page.removeItem(member.id);
      if (selectedMember?.id === member.id) setSelectedMember(undefined);
      if (page.data.items.length === 1 && page.page > 1)
        page.setPage(page.page - 1);
      setMemberToDelete(undefined);
      showToast(
        "Member deleted",
        member.name + " was deleted successfully.",
        "success",
      );
    } catch {
      showToast(
        "Delete failed",
        "Unable to delete factory member. Please try again.",
        "error",
      );
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  };
  const closeCreate = () => {
    if (creating) return;
    setShowCreateMember(false);
    setCreateError("");
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    const name = memberForm.name.trim();
    const employeeId = memberForm.employeeId.trim();
    const department = memberForm.department.trim();
    if (name.length < 2 || employeeId.length < 2 || department.length < 2) {
      setCreateError(
        "Name, employee ID and department must contain at least 2 characters.",
      );
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      await factoryApi.createMember({
        ...memberForm,
        name,
        employeeId,
        department,
        phone: memberForm.phone.trim() || undefined,
        profileImage: memberForm.profileImage.trim() || undefined,
        currentTask: memberForm.currentTask.trim() || undefined,
      });
      setShowCreateMember(false);
      setMemberForm({
        name: "",
        employeeId: "",
        department: "Production",
        phone: "",
        profileImage: "",
        currentTask: "",
        status: "OFF_SHIFT",
      });
      showToast(
        "Member added",
        "Factory member was added successfully.",
        "success",
      );
      await page.refresh();
    } catch (error) {
      setCreateError(
        error instanceof Error
          ? error.message
          : "Unable to add factory member. Please try again.",
      );
    } finally {
      setCreating(false);
    }
  };
  const inputClass =
    "min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
  const field = (label: string, control: React.ReactNode, required = false) => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-extrabold uppercase tracking-wide text-slate-800">
        {label}
        {required && <span className="text-rose-600"> *</span>}
      </span>
      {control}
    </label>
  );
  return (
    <>
      <Heading
        icon={Users}
        title="Factory Members"
        subtitle="People, attendance, assignments and current workload"
        action={
          <div className="flex gap-2">
            <SearchBox value={page.search} onChange={page.setSearch} />
            <button
              onClick={() => setShowCreateMember(true)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white"
            >
              Add member
            </button>
          </div>
        }
      />
      <Card>
        <Table
          loading={page.loading}
          rows={page.data.items}
          columns={[
            [
              "Member",
              (r) => (
                <div className="flex items-center gap-3">
                  <ProfileAvatar
                    src={r.profileImage}
                    name={r.name}
                    className="h-9 w-9 rounded-full"
                  />
                  <div>
                    <b>{r.name}</b>
                    <p className="text-xs">{r.employeeId}</p>
                  </div>
                </div>
              ),
            ],
            ["Department", (r) => r.department],
            ["Current task", (r) => r.currentTask || "Unassigned"],
            ["Workload", (r) => r.workload],
            ["Status", (r) => <Status value={r.status} />],
            [
              "Attendance",
              (r) => (
                <div className="flex flex-wrap gap-1">
                  {[
                    ["PUNCH_IN", "In"],
                    ["BREAK_START", "Break"],
                    ["BREAK_END", "Resume"],
                    ["PUNCH_OUT", "Out"],
                  ].map(([a, l]) => (
                    <button
                      key={a}
                      onClick={() => void attendance(r.id, a)}
                      className="rounded border px-2 py-1 text-[10px] font-bold"
                    >
                      {l}
                    </button>
                  ))}
                </div>
              ),
            ],
            [
              "Action",
              (r) => (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedMember(r)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-bold text-cyan-800 hover:bg-cyan-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemberToDelete(r)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              ),
            ],
          ]}
        />
        <PageNav
          page={page.page}
          pages={page.data.pagination.pages}
          onPage={page.setPage}
        />
      </Card>
      <Modal
        isOpen={showCreateMember}
        onClose={closeCreate}
        title="Add Factory Member"
        maxWidth="lg"
      >
        <form onSubmit={create} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              "Member name",
              <input
                autoFocus
                required
                minLength={2}
                value={memberForm.name}
                onChange={(event) =>
                  setMemberForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder="e.g. Kasun Perera"
                className={inputClass}
              />,
              true,
            )}
            {field(
              "Employee ID",
              <input
                required
                minLength={2}
                value={memberForm.employeeId}
                onChange={(event) =>
                  setMemberForm((current) => ({
                    ...current,
                    employeeId: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="e.g. FM-001"
                className={inputClass}
              />,
              true,
            )}
            {field(
              "Department",
              <input
                required
                minLength={2}
                value={memberForm.department}
                onChange={(event) =>
                  setMemberForm((current) => ({
                    ...current,
                    department: event.target.value,
                  }))
                }
                placeholder="e.g. Production"
                className={inputClass}
              />,
              true,
            )}
            {field(
              "Phone number",
              <input
                type="tel"
                value={memberForm.phone}
                onChange={(event) =>
                  setMemberForm((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
                placeholder="e.g. +94 77 123 4567"
                className={inputClass}
              />,
            )}
            {field(
              "Status",
              <select
                value={memberForm.status}
                onChange={(event) =>
                  setMemberForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
                className={inputClass}
              >
                <option value="OFF_SHIFT">Off shift</option>
                <option value="WORKING">Working</option>
                <option value="ON_BREAK">On break</option>
              </select>,
            )}
            {field(
              "Profile image URL",
              <input
                type="url"
                value={memberForm.profileImage}
                onChange={(event) =>
                  setMemberForm((current) => ({
                    ...current,
                    profileImage: event.target.value,
                  }))
                }
                placeholder="https://…"
                className={inputClass}
              />,
            )}
            <div className="sm:col-span-2">
              {field(
                "Current task",
                <textarea
                  value={memberForm.currentTask}
                  onChange={(event) =>
                    setMemberForm((current) => ({
                      ...current,
                      currentTask: event.target.value,
                    }))
                  }
                  maxLength={300}
                  placeholder="Optional current assignment"
                  className={`${inputClass} min-h-24 resize-y py-3`}
                />,
              )}
            </div>
          </div>
          {createError && (
            <p
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700"
            >
              {createError}
            </p>
          )}
          <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={creating}
              onClick={closeCreate}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-extrabold text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 text-sm font-extrabold text-white shadow-lg disabled:opacity-60"
            >
              {creating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Save Member
                </>
              )}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        isOpen={Boolean(memberToDelete)}
        onClose={() => {
          if (!deleteInFlight.current) setMemberToDelete(undefined);
        }}
        title="Delete Factory Member?"
        maxWidth="sm"
      >
        <div className="space-y-5">
          <p className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 text-sm font-medium leading-6 text-slate-700">
            Are you sure you want to delete{" "}
            <strong>{memberToDelete?.name}</strong>? This action cannot be
            undone.
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setMemberToDelete(undefined)}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-extrabold text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-extrabold text-white hover:bg-rose-500 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting..." : "Delete Member"}
            </button>
          </div>
        </div>
      </Modal>
      <MemberDetails
        member={selectedMember}
        onClose={() => setSelectedMember(undefined)}
      />
    </>
  );
};

const Dispatch = () => {
  const page = usePage(factoryApi.dispatches);
  const { showToast } = useToast();
  const update = async (id: string, status: string) => {
    await factoryApi.updateDispatch(id, status);
    showToast("Dispatch updated", titleCase(status), "success");
    void page.refresh();
  };
  return (
    <>
      <Heading
        icon={Truck}
        title="Dispatch & Handover"
        subtitle="Track product handovers from factory to final delivery"
        action={
          <select
            value={page.status}
            onChange={(e) => page.setStatus(e.target.value)}
            className="rounded-xl border px-3 py-2 text-sm"
          >
            <option value="">All statuses</option>
            {[
              "WAITING",
              "DISPATCHED",
              "IN_TRANSIT",
              "ARRIVED",
              "DELIVERED",
              "FAILED",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        }
      />
      <Card>
        <Table
          loading={page.loading}
          rows={page.data.items}
          columns={[
            ["Dispatch ID", (r) => <b>DS-{r.id.slice(-7).toUpperCase()}</b>],
            [
              "Salesperson",
              (r) => (
                <div className="flex items-center gap-2">
                  <ProfileAvatar
                    src={r.salesperson?.avatarUrl}
                    name={r.salesperson?.name}
                    className="h-8 w-8 rounded-full"
                  />
                  <b>{r.salesperson?.name}</b>
                </div>
              ),
            ],
            ["Order", (r) => `#${r.orderId.slice(-7).toUpperCase()}`],
            ["Product", (r) => r.product?.name],
            ["Quantity", (r) => r.quantity],
            ["Dispatch time", (r) => date(r.dispatchedAt)],
            ["Destination", (r) => r.destination],
            [
              "Status",
              (r) => (
                <select
                  value={r.status}
                  onChange={(e) => void update(r.id, e.target.value)}
                  className="rounded-lg border px-2 py-1.5 text-xs"
                >
                  {[
                    "WAITING",
                    "DISPATCHED",
                    "IN_TRANSIT",
                    "ARRIVED",
                    "DELIVERED",
                    "FAILED",
                  ].map((x) => (
                    <option key={x}>{titleCase(x)}</option>
                  ))}
                </select>
              ),
            ],
          ]}
        />
        <PageNav
          page={page.page}
          pages={page.data.pagination.pages}
          onPage={page.setPage}
        />
      </Card>
    </>
  );
};

const SalesTracking = () => {
  const [directory, setDirectory] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string>();
  const [search, setSearch] = useState("");
  useEffect(() => {
    void loadAgents([]).then(setDirectory);
  }, []);
  const { agents, connectionState } = useLiveAgentTracking(directory);
  const shown = agents.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <Heading
        icon={Gauge}
        title="Sales Tracking"
        subtitle="Live salesperson GPS for active factory deliveries"
        action={
          <div className="flex items-center gap-3">
            <Status value={connectionState.toUpperCase()} />
            <SearchBox value={search} onChange={setSearch} />
          </div>
        }
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="max-h-[650px] overflow-y-auto p-3">
          {shown.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelected(agent.id)}
              className={`mb-2 flex w-full items-center justify-between rounded-xl border p-3 text-left ${selected === agent.id ? "border-indigo-500 bg-indigo-50" : "border-slate-100"}`}
            >
              <div className="flex items-center gap-3">
                <ProfileAvatar
                  src={agent.avatar}
                  name={agent.name}
                  className="h-10 w-10 rounded-full"
                />
                <div>
                  <b className="text-sm">{agent.name}</b>
                  <p className="text-xs text-slate-500">
                    {agent.currentLocation}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <Status value={agent.gpsStatus} />
                <p className="mt-1 text-[10px] text-slate-500">
                  {Number.isFinite(Number(agent.speedKmH))
                    ? Number(agent.speedKmH).toFixed(1)
                    : "—"}{" "}
                  km/h
                </p>
              </div>
            </button>
          ))}
        </Card>
        <Card className="overflow-hidden lg:col-span-2">
          <Suspense
            fallback={
              <div className="grid h-[620px] place-items-center">
                <Loader2 className="animate-spin" />
              </div>
            }
          >
            <InteractiveCityMap
              agents={agents}
              selectedAgentId={selected}
              onSelectAgent={(a) => setSelected(a.id)}
              heightClass="h-[620px]"
              connectionState={connectionState}
            />
          </Suspense>
        </Card>
      </div>
    </>
  );
};

const RetailerDetails = ({
  retailer,
  onClose,
}: {
  retailer?: AnyRow;
  onClose: () => void;
}) => {
  if (!retailer) return null;
  const openDocument = async (type: string) => {
    const blob = await apiBlob(
      `/api/v1/shops/${retailer.id}/documents/${type}`,
    );
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/55 p-4"
      onMouseDown={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        className="my-6 w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <header className="flex justify-between bg-gradient-to-r from-indigo-600 to-violet-600 p-6 text-white">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider">
              Sales customer
            </p>
            <h3 className="mt-1 text-xl font-black">{retailer.name}</h3>
            <p className="text-sm text-indigo-100">
              {retailer.retailerCode || "Pending retailer ID"} ·{" "}
              {retailer.assignedSalesperson?.name || "Unassigned"}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close retailer details">
            <X />
          </button>
        </header>
        <div className="space-y-5 p-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Status", titleCase(retailer.status)],
              ["Owner", retailer.ownerName],
              ["Phone", retailer.phone],
              ["Location", `${retailer.address}, ${retailer.city}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-4">
                <p className="text-[10px] font-bold uppercase text-slate-400">
                  {label}
                </p>
                <b className="mt-1 block text-sm">{value}</b>
              </div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <h4 className="border-b p-4 font-extrabold">Orders</h4>
              <Table
                rows={retailer.orders ?? []}
                columns={[
                  ["Date", (r) => date(r.createdAt)],
                  [
                    "Amount",
                    (r) =>
                      `LKR ${finiteNumber(r.totalAmountLkr).toLocaleString()}`,
                  ],
                  ["Status", (r) => <Status value={r.status} />],
                ]}
              />
            </Card>
            <Card>
              <h4 className="border-b p-4 font-extrabold">Visits</h4>
              <Table
                rows={retailer.visits ?? []}
                columns={[
                  ["Salesperson", (r) => r.agent?.name],
                  ["Visited", (r) => date(r.visitedAt)],
                  [
                    "Duration",
                    (r) =>
                      r.durationMinutes ? `${r.durationMinutes} min` : "Active",
                  ],
                ]}
              />
            </Card>
          </div>
          <Card>
            <h4 className="border-b p-4 font-extrabold">
              Supporting documents
            </h4>
            <div className="flex flex-wrap gap-3 p-4">
              {!retailer.documents?.length ? (
                <span className="text-sm text-slate-400">
                  No documents uploaded.
                </span>
              ) : (
                retailer.documents.map((document: AnyRow) => (
                  <button
                    key={document.id}
                    onClick={() => void openDocument(document.type)}
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-700"
                  >
                    <FileText className="h-4 w-4" />
                    {titleCase(document.type)}
                  </button>
                ))
              )}
            </div>
          </Card>
          {(retailer.salesNotes || retailer.notes) && (
            <Card className="p-4">
              <h4 className="font-extrabold">Sales notes</h4>
              <p className="mt-2 text-sm text-slate-600">
                {retailer.salesNotes || retailer.notes}
              </p>
            </Card>
          )}
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white"
            >
              Close
            </button>
          </div>
        </div>
      </section>
    </div>
  );
};

const Retailers = () => {
  const page = usePage(factoryApi.retailers);
  const { showToast } = useToast();
  const [selected, setSelected] = useState<AnyRow>();
  const [retailerToDelete, setRetailerToDelete] = useState<AnyRow>();
  const [deleting, setDeleting] = useState(false);
  const deleteInFlight = React.useRef(false);
  useEffect(() => {
    const refresh = () => void page.refresh();
    window.addEventListener("reproutes:sales-data-updated", refresh);
    return () =>
      window.removeEventListener("reproutes:sales-data-updated", refresh);
  }, [page.refresh]);
  const open = async (id: string) => setSelected(await factoryApi.retailer(id));
  const confirmDelete = async () => {
    if (!retailerToDelete || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleting(true);
    const retailer = retailerToDelete;
    try {
      await factoryApi.deleteRetailer(retailer.id);
      page.removeItem(retailer.id);
      if (selected?.id === retailer.id) setSelected(undefined);
      if (page.data.items.length === 1 && page.page > 1)
        page.setPage(page.page - 1);
      setRetailerToDelete(undefined);
      showToast(
        "Retailer deleted",
        retailer.name + " was deleted successfully.",
        "success",
      );
    } catch {
      showToast(
        "Delete failed",
        "Unable to delete retailer. Please try again.",
        "error",
      );
    } finally {
      deleteInFlight.current = false;
      setDeleting(false);
    }
  };
  return (
    <>
      <Heading
        icon={Store}
        title="Sales Data / Retailers"
        subtitle="Permanent read-only customer, order, visit and document history"
        action={
          <div className="flex gap-2">
            <SearchBox
              value={page.search}
              onChange={page.setSearch}
              placeholder="Search customer, owner or phone…"
            />
            <select
              value={page.status}
              onChange={(event) => page.setStatus(event.target.value)}
              className="rounded-xl border border-slate-200 px-3 text-sm"
            >
              <option value="">All statuses</option>
              {[
                "DRAFT",
                "SUBMITTED",
                "UNDER_REVIEW",
                "APPROVED",
                "REJECTED",
                "SUSPENDED",
                "INACTIVE",
              ].map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </div>
        }
      />
      <Card>
        <Table
          loading={page.loading}
          rows={page.data.items}
          columns={[
            [
              "Retailer",
              (r) => (
                <div>
                  <b className="text-slate-900">{r.name}</b>
                  <p className="text-xs">{r.retailerCode || "Pending ID"}</p>
                </div>
              ),
            ],
            ["Owner", (r) => r.ownerName],
            ["Area", (r) => r.city],
            ["Salesperson", (r) => r.assignedSalesperson?.name || "Unassigned"],
            ["Orders", (r) => r._count?.orders ?? 0],
            ["Visits", (r) => r._count?.visits ?? 0],
            ["Status", (r) => <Status value={r.status} />],
            [
              "Action",
              (r) => (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void open(r.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300 bg-white px-2.5 py-1.5 text-xs font-bold text-cyan-800 hover:bg-cyan-50"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetailerToDelete(r)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              ),
            ],
          ]}
        />
        <PageNav
          page={page.page}
          pages={page.data.pagination.pages}
          onPage={page.setPage}
        />
      </Card>
      <Modal
        isOpen={Boolean(retailerToDelete)}
        onClose={() => {
          if (!deleteInFlight.current) setRetailerToDelete(undefined);
        }}
        title="Delete Retailer?"
        maxWidth="sm"
      >
        <div className="space-y-5">
          <p className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 text-sm font-medium leading-6 text-slate-700">
            Are you sure you want to delete{" "}
            <strong>{retailerToDelete?.name}</strong>? This action cannot be
            undone.
          </p>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setRetailerToDelete(undefined)}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-5 text-sm font-extrabold text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void confirmDelete()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-extrabold text-white hover:bg-rose-500 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting..." : "Delete Retailer"}
            </button>
          </div>
        </div>
      </Modal>
      <RetailerDetails
        retailer={selected}
        onClose={() => setSelected(undefined)}
      />
    </>
  );
};

const Reports = () => {
  const [data, setData] = useState<AnyRow>();
  useEffect(() => {
    void factoryApi.reports().then(setData);
  }, []);
  if (!data) return <Loader2 className="animate-spin" />;
  const metrics = [
    ["Produced", data.production.totalProduced],
    ["Target", data.production.totalTarget],
    ["Rejected", data.production.rejected],
    ["Completion", `${data.production.completionPercentage}%`],
    ["Available stock", data.inventory.availableStock],
    ["Damaged stock", data.inventory.damagedStock],
    ["Low stock", data.inventory.lowStock],
    ["Dispatched", data.dispatch.total],
    ["Delivered", data.dispatch.delivered],
    ["Failed", data.dispatch.failed],
  ];
  return (
    <>
      <Heading
        icon={BarChart3}
        title="Factory Reports"
        subtitle="Production, inventory and dispatch performance"
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {metrics.map(([label, value]) => (
          <Card key={label} className="p-5">
            <p className="text-xs font-bold text-slate-500">{label}</p>
            <p className="mt-2 text-2xl font-black">{value}</p>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <div className="border-b p-5 font-extrabold">Production Report</div>
          <Table
            rows={data.production.rows}
            columns={[
              ["Product", (r) => r.product?.name],
              ["Target", (r) => r.targetQuantity],
              ["Produced", (r) => r.producedQuantity],
              ["Rejected", (r) => r.rejectedQuantity],
              ["Status", (r) => <Status value={r.status} />],
            ]}
          />
        </Card>
        <Card>
          <div className="border-b p-5 font-extrabold">Dispatch Report</div>
          <Table
            rows={data.dispatch.rows}
            columns={[
              ["Salesperson", (r) => r.salesperson?.name],
              ["Product", (r) => r.product?.name],
              ["Quantity", (r) => r.quantity],
              ["Status", (r) => <Status value={r.status} />],
            ]}
          />
        </Card>
      </div>
    </>
  );
};

const Notifications = () => {
  const [items, setItems] = useState<AnyRow[]>([]);
  const refresh = () => factoryApi.notifications().then(setItems);
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <>
      <Heading
        icon={Bell}
        title="Notifications"
        subtitle="Factory workflow alerts and operational exceptions"
      />
      <Card className="divide-y divide-slate-100">
        {!items.length ? (
          <Empty />
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => void factoryApi.markRead(item.id).then(refresh)}
              className={`flex w-full items-start gap-4 p-5 text-left ${item.readAt ? "bg-white" : "bg-indigo-50/50"}`}
            >
              <span className={`rounded-xl p-2 ${statusTone(item.type)}`}>
                <Bell className="h-4 w-4" />
              </span>
              <div className="flex-1">
                <div className="flex justify-between gap-3">
                  <b className="text-sm text-slate-900">{item.title}</b>
                  <span className="text-xs text-slate-400">
                    {date(item.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">{item.message}</p>
                <p className="mt-2 text-[10px] font-bold uppercase text-indigo-500">
                  {titleCase(item.type)}
                </p>
              </div>
            </button>
          ))
        )}
      </Card>
    </>
  );
};
const SettingsPage = () => (
  <>
    <Heading
      icon={Settings}
      title="Factory Settings"
      subtitle="Portal preferences and operational defaults"
    />
    <Card className="max-w-2xl p-6">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-6 w-6 text-emerald-500" />
        <div>
          <b>Factory integration is active</b>
          <p className="text-sm text-slate-500">
            Authentication, sales orders, GPS tracking, notifications and
            inventory share the RepRoutes platform.
          </p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-bold">
          Default production unit
          <input
            defaultValue="Cases"
            className="mt-2 w-full rounded-xl border p-3 font-normal"
          />
        </label>
        <label className="text-sm font-bold">
          Low-stock alert threshold
          <input
            type="number"
            defaultValue="20"
            className="mt-2 w-full rounded-xl border p-3 font-normal"
          />
        </label>
      </div>
      <button className="mt-6 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white">
        Save preferences
      </button>
    </Card>
  </>
);

export const FactoryPortalPage = ({ section }: { section: string }) => {
  const pages: Record<Section, React.ReactNode> = {
    dashboard: <EnterpriseFactoryDashboard />,
    orders: <Orders />,
    production: <Production />,
    products: <Products />,
    inventory: <Inventory />,
    members: <Members />,
    dispatch: <Dispatch />,
    "sales-tracking": <SalesTracking />,
    retailers: <Retailers />,
    contacts: <ContactsContent />,
    invoices: <InvoiceManagementContent />,
    reports: <Reports />,
    notifications: <Notifications />,
    settings: <SettingsPage />,
  };
  const exports: Partial<Record<Section, { dataset: string; pdf?: boolean }>> =
    {
      orders: { dataset: "factory_orders" },
      products: { dataset: "products" },
      inventory: { dataset: "stock_report", pdf: true },
      reports: { dataset: "factory_performance", pdf: true },
    };
  const exportConfig = exports[section as Section];
  return (
    <FactoryLayout>
      {exportConfig && section !== "orders" && (
        <div className="mb-4 flex justify-end">
          <ExportButton dataset={exportConfig.dataset} pdf={exportConfig.pdf} />
        </div>
      )}
      {pages[section as Section] ?? <Dashboard />}
    </FactoryLayout>
  );
};
