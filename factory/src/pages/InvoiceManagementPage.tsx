import React, { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Filter,
  Printer,
  ReceiptText,
  Search,
  WalletCards,
  X,
} from "lucide-react";
import { FactoryLayout } from "../components/layout/FactoryLayout";
import { invoiceApi } from "../services/invoiceApi";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { ExportButton } from "../components/common/ExportButton";

type Invoice = {
  id: string;
  invoiceNumber: string;
  issuedAt: string;
  dueAt: string;
  totalLkr: number | string;
  paidLkr: number | string;
  status: string;
  order: { shopName: string };
  salesperson: { name: string };
  payments: Array<{
    id: string;
    paidAt: string;
    method: string;
    amountLkr: number | string;
  }>;
};

type InvoiceList = {
  items: Invoice[];
  pagination: { page: number; pages: number };
};

const money = (value: number | string) =>
  `LKR ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const statusTone: Record<string, string> = {
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  PARTIAL: "border-blue-200 bg-blue-50 text-blue-700",
  OVERDUE: "border-rose-200 bg-rose-50 text-rose-700",
};

export const InvoiceManagementContent = () => {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [data, setData] = useState<InvoiceList>({
    items: [],
    pagination: { page: 1, pages: 1 },
  });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Invoice>();
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const result = await invoiceApi.list(
        new URLSearchParams({
          page: String(page),
          limit: "20",
          search,
          ...(status ? { status } : {}),
        }).toString(),
      );
      setData(result as InvoiceList);
    } catch (error) {
      showToast(
        "Invoices unavailable",
        error instanceof Error ? error.message : "Please try again.",
        "error",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, status]);

  const pdf = async (invoice: Invoice, print = false) => {
    try {
      const blob = await invoiceApi.pdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const win = window.open(url, "_blank", "noopener,noreferrer");
      if (print) win?.addEventListener("load", () => win.print());
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      showToast(
        "Invoice unavailable",
        error instanceof Error ? error.message : "Could not open the invoice.",
        "error",
      );
    }
  };

  const pay = async () => {
    if (!selected) return;
    const amount = Number(window.prompt("Payment amount (LKR)"));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const method =
      window.prompt("Method: CASH, CARD, BANK_TRANSFER or CREDIT") || "CASH";
    try {
      await invoiceApi.payment(selected.id, { amountLkr: amount, method });
      showToast("Payment recorded", "Invoice balance updated.", "success");
      setSelected(undefined);
      await load();
    } catch (error) {
      showToast(
        "Payment failed",
        error instanceof Error ? error.message : "Please try again.",
        "error",
      );
    }
  };

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-cyan-700">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-cyan-100">
              <ReceiptText className="h-5 w-5" />
            </span>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em]">
              Accounts receivable
            </p>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-slate-950 sm:text-4xl">
            Invoice Management
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Search invoices, review balances, record payments, and export
            documents.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {user?.role !== "factory_manager" && (
            <ExportButton
              dataset="invoices"
              variant="violet"
              filters={{ search, paymentStatus: status }}
            />
          )}
          <div className="rounded-2xl border border-slate-200 bg-white/75 px-4 py-3 shadow-sm backdrop-blur-xl">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
              Invoices found
            </p>
            <p className="mt-1 text-2xl font-black text-slate-950">
              {data.items.length}
            </p>
          </div>
        </div>
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          void load();
        }}
        className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-lg shadow-slate-300/20 backdrop-blur-xl"
      >
        <div className="flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1">
            <span className="sr-only">Search invoices</span>
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search invoice number, shop, or salesperson"
              className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-medium text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            />
          </label>
          <label className="relative min-w-52">
            <span className="sr-only">Filter by status</span>
            <Filter className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className="h-12 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-11 pr-9 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
            >
              <option value="">All statuses</option>
              {["PAID", "PENDING", "PARTIAL", "OVERDUE"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <button
            disabled={loading}
            className="h-12 rounded-xl bg-indigo-600 px-6 text-sm font-extrabold text-white shadow-lg shadow-indigo-200 transition hover:bg-indigo-700 disabled:cursor-wait disabled:opacity-60"
          >
            {loading ? "Loading…" : "Apply filters"}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-xl shadow-slate-300/20 backdrop-blur-xl">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-100/80">
              <tr>
                {[
                  "Invoice",
                  "Shop / salesperson",
                  "Issued",
                  "Due",
                  "Total",
                  "Paid",
                  "Balance",
                  "Status",
                  "Actions",
                ].map((heading) => (
                  <th
                    key={heading}
                    className={`px-5 py-4 text-xs font-extrabold uppercase tracking-wider text-slate-600 ${heading === "Actions" ? "text-right" : ""}`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {data.items.map((invoice) => {
                const balance =
                  Number(invoice.totalLkr) - Number(invoice.paidLkr);
                return (
                  <tr
                    key={invoice.id}
                    className="transition hover:bg-cyan-50/50"
                  >
                    <td className="px-5 py-4">
                      <span className="whitespace-nowrap rounded-lg bg-indigo-50 px-2.5 py-1.5 font-mono text-xs font-black text-indigo-700">
                        {invoice.invoiceNumber}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-extrabold text-slate-950">
                        {invoice.order.shopName}
                      </p>
                      <p className="mt-1 text-xs font-medium text-slate-500">
                        {invoice.salesperson.name}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-700">
                      {new Date(invoice.issuedAt).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-700">
                      {new Date(invoice.dueAt).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 font-extrabold text-slate-950">
                      {money(invoice.totalLkr)}
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 font-bold text-emerald-700">
                      {money(invoice.paidLkr)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-5 py-4 font-extrabold ${balance > 0 ? "text-rose-700" : "text-slate-600"}`}
                    >
                      {money(balance)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-extrabold ${statusTone[invoice.status] ?? "border-slate-200 bg-slate-50 text-slate-700"}`}
                      >
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <IconButton
                          label="Download PDF"
                          onClick={() => void pdf(invoice)}
                        >
                          <Download />
                        </IconButton>
                        <IconButton
                          label="Print invoice"
                          onClick={() => void pdf(invoice, true)}
                        >
                          <Printer />
                        </IconButton>
                        <IconButton
                          label="View payments"
                          onClick={() => setSelected(invoice)}
                        >
                          <WalletCards />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 p-4 md:hidden">
          {data.items.map((invoice) => (
            <article
              key={invoice.id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-black text-indigo-700">
                    {invoice.invoiceNumber}
                  </p>
                  <h2 className="mt-1 font-extrabold text-slate-950">
                    {invoice.order.shopName}
                  </h2>
                  <p className="text-sm text-slate-500">
                    {invoice.salesperson.name}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-extrabold ${statusTone[invoice.status] ?? ""}`}
                >
                  {invoice.status}
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Metric label="Total" value={money(invoice.totalLkr)} />
                <Metric
                  label="Balance"
                  value={money(
                    Number(invoice.totalLkr) - Number(invoice.paidLkr),
                  )}
                />
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <IconButton
                  label="Download PDF"
                  onClick={() => void pdf(invoice)}
                >
                  <Download />
                </IconButton>
                <IconButton
                  label="Print invoice"
                  onClick={() => void pdf(invoice, true)}
                >
                  <Printer />
                </IconButton>
                <IconButton
                  label="View payments"
                  onClick={() => setSelected(invoice)}
                >
                  <WalletCards />
                </IconButton>
              </div>
            </article>
          ))}
        </div>

        {!loading && data.items.length === 0 && (
          <div className="grid min-h-72 place-items-center p-8 text-center">
            <div>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <FileText className="h-7 w-7" />
              </span>
              <h2 className="mt-4 text-lg font-extrabold text-slate-900">
                No invoices found
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Try another search or status filter.
              </p>
            </div>
          </div>
        )}

        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50/70 px-4 py-3 sm:px-5">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage((value) => value - 1)}
            className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Previous
          </button>
          <span className="text-sm font-semibold text-slate-600">
            Page <b className="text-slate-950">{page}</b> of{" "}
            <b className="text-slate-950">
              {Math.max(1, data.pagination.pages)}
            </b>
          </span>
          <button
            disabled={page >= data.pagination.pages || loading}
            onClick={() => setPage((value) => value + 1)}
            className="inline-flex h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-40"
          >
            Next <ChevronRight className="h-4 w-4" />
          </button>
        </footer>
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4 backdrop-blur-sm"
          onMouseDown={() => setSelected(undefined)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-history-title"
            className="w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between border-b border-slate-200 p-6">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-wider text-cyan-700">
                  Accounts receivable
                </p>
                <h2
                  id="payment-history-title"
                  className="mt-1 text-2xl font-black text-slate-950"
                >
                  Payment history
                </h2>
                <p className="mt-1 font-mono text-sm font-bold text-indigo-700">
                  {selected.invoiceNumber}
                </p>
              </div>
              <button
                onClick={() => setSelected(undefined)}
                aria-label="Close payment history"
                className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="max-h-80 space-y-2 overflow-y-auto p-6">
              {selected.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4"
                >
                  <div>
                    <p className="text-sm font-extrabold text-slate-900">
                      {payment.method.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(payment.paidAt).toLocaleString()}
                    </p>
                  </div>
                  <b className="whitespace-nowrap text-sm text-emerald-700">
                    {money(payment.amountLkr)}
                  </b>
                </div>
              ))}
              {selected.payments.length === 0 && (
                <p className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No payments recorded yet.
                </p>
              )}
            </div>
            <footer className="border-t border-slate-200 p-6">
              <button
                onClick={() => void pay()}
                className="h-12 w-full rounded-xl bg-emerald-600 font-extrabold text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700"
              >
                Record payment
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
};

const IconButton = ({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactElement<{ className?: string }>;
}) => (
  <button
    title={label}
    aria-label={label}
    onClick={onClick}
    className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500"
  >
    {React.cloneElement(children, { className: "h-4 w-4" })}
  </button>
);
const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-50 p-3">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
      {label}
    </p>
    <p className="mt-1 text-sm font-extrabold text-slate-950">{value}</p>
  </div>
);

export const InvoiceManagementPage = () => (
  <FactoryLayout>
    <InvoiceManagementContent />
  </FactoryLayout>
);
