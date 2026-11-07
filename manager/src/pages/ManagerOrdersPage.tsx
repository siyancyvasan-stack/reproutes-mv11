import React, { FormEvent, useEffect, useState } from "react";
import { io } from "socket.io-client";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { GlassCard } from "../components/common/GlassCard";
import { Badge } from "../components/common/Badge";
import { Modal } from "../components/common/Modal";
import { Order, OrderStatus } from "../types";
import { useToast } from "../context/ToastContext";
import {
  ensureAccessToken,
  getAccessToken,
  isBackendConfigured,
} from "../services/apiClient";
import {
  createShop,
  deleteOrder,
  loadOrders,
  loadShops,
  updateOrderStatus,
  uploadShopImage,
} from "../services/domainApi";
import {
  ShoppingBag,
  Search,
  Eye,
  Download,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Store,
} from "lucide-react";
import { ExportButton } from "../components/common/ExportButton";
import { ImageUploadField } from "../components/common/ImageUploadField";
import { downloadOrderInvoice, downloadOrders } from "../services/ordersExport";

const displayOrderNumber = (id: string) => `#${id.slice(-8).toUpperCase()}`;
const fieldClass = "w-full px-4 py-2.5 text-xs rounded-xl glass-input";
const emptyShop = {
  name: "",
  ownerName: "",
  phone: "",
  address: "",
  city: "",
  routeGroup: "",
  outstandingBalanceLkr: "",
};

export const ManagerOrdersPage: React.FC = () => {
  const { showToast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderToDelete, setOrderToDelete] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [shopForm, setShopForm] = useState(emptyShop);
  const [shopImage, setShopImage] = useState<File>();
  const [savingShop, setSavingShop] = useState(false);

  useEffect(() => {
    const refresh = () =>
      loadOrders([])
        .then(setOrders)
        .catch(() => undefined);
    void refresh();
    if (!isBackendConfigured) return;
    let socket: ReturnType<typeof io> | undefined;
    void ensureAccessToken()
      .then(() => {
        socket = io(undefined, {
          transports: ["websocket"],
          withCredentials: true,
          auth: (callback) =>
            callback({ token: getAccessToken() ?? undefined }),
        });
        socket.on("factory:new-order", () => void refresh());
      })
      .catch(() => undefined);
    return () => socket?.disconnect();
  }, []);

  const filteredOrders = orders.filter((ord) => {
    const matchesSearch =
      ord.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ord.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ord.shopName.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === "All" || ord.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const totalPages = Math.max(
    1,
    Math.ceil(filteredOrders.length / rowsPerPage),
  );
  const currentPage = Math.min(page, totalPages);
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage,
  );

  useEffect(() => {
    setPage(1);
  }, [searchQuery, statusFilter, rowsPerPage]);

  const handleDelete = async () => {
    if (!orderToDelete) return;
    setDeleting(true);
    try {
      if (isBackendConfigured) await deleteOrder(orderToDelete.id);
      setOrders((current) =>
        current.filter((order) => order.id !== orderToDelete.id),
      );
      if (selectedOrder?.id === orderToDelete.id) setSelectedOrder(null);
      showToast(
        "Order deleted",
        `${displayOrderNumber(orderToDelete.id)} was deleted successfully.`,
        "success",
      );
      setOrderToDelete(null);
    } catch (error) {
      showToast(
        "Delete failed",
        error instanceof Error
          ? error.message
          : "The order could not be deleted.",
        "error",
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleUpdateStatus = async (
    orderId: string,
    newStatus: OrderStatus,
  ) => {
    if (isBackendConfigured) {
      try {
        await updateOrderStatus(orderId, newStatus);
      } catch {
        showToast(
          "Update Failed",
          "The order status could not be saved. Please try again.",
          "error",
        );
        return;
      }
    }

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
    );
    if (selectedOrder && selectedOrder.id === orderId) {
      setSelectedOrder({ ...selectedOrder, status: newStatus });
    }
    showToast(
      "Order Status Updated",
      `Order ${displayOrderNumber(orderId)} changed to ${newStatus}.`,
      "success",
    );
  };

  const closeShopModal = () => {
    if (savingShop) return;
    setShopModalOpen(false);
    setShopImage(undefined);
  };

  const handleCreateShop = async (event: FormEvent) => {
    event.preventDefault();
    if (!shopImage) {
      showToast(
        "Shop Image Required",
        "Please add a shop image before saving.",
        "error",
      );
      return;
    }
    setSavingShop(true);
    try {
      const created = await createShop({
        name: shopForm.name.trim(),
        ownerName: shopForm.ownerName.trim(),
        phone: shopForm.phone.trim(),
        address: shopForm.address.trim(),
        city: shopForm.city.trim(),
        routeGroup: shopForm.routeGroup.trim(),
        outstandingBalanceLkr: Number(shopForm.outstandingBalanceLkr || 0),
      });
      await uploadShopImage(created.id, shopImage, "FRONT", true);
      const [, refreshedOrders] = await Promise.allSettled([
        loadShops([]),
        loadOrders([]),
      ]);
      if (refreshedOrders.status === "fulfilled")
        setOrders(refreshedOrders.value);
      setShopForm(emptyShop);
      setShopImage(undefined);
      setShopModalOpen(false);
      showToast(
        "Shop Added",
        `${created.name} has been added to the territory.`,
        "success",
      );
    } catch (error) {
      showToast(
        "Shop Not Added",
        error instanceof Error ? error.message : "Please check the details.",
        "error",
      );
    } finally {
      setSavingShop(false);
    }
  };

  return (
    <ManagerLayout>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2.5">
            <ShoppingBag className="w-7 h-7 text-cyan-400" />
            <span>Daily Orders Directory</span>
          </h2>
          <p className="mt-1 text-sm font-semibold text-slate-300">
            Review, approve, and track order fulfillment across field sales
            territories
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton
            dataset="orders"
            pdf
            formats={["csv", "pdf"]}
            disabled={filteredOrders.length === 0}
            onExport={(format) =>
              downloadOrders(filteredOrders, format as "csv" | "pdf")
            }
          />
          <button
            type="button"
            onClick={() => setShopModalOpen(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400 bg-cyan-50 px-4 py-2.5 text-sm font-black text-cyan-500 shadow-lg shadow-cyan-500/10 transition hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2"
          >
            <Store className="h-4 w-4" />
            Add Shop
          </button>
        </div>
      </div>

      <GlassCard className="p-4 sm:p-5 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="relative w-full lg:w-96">
          <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search Order ID, Agent or Shop..."
            className="w-full min-h-11 pl-11 pr-4 py-2.5 text-sm font-semibold rounded-xl glass-input"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 lg:pb-0">
          {["All", "Approved", "Pending", "In Production", "Delivered"].map(
            (st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`min-h-10 whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                  statusFilter === st
                    ? "bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/20"
                    : "text-slate-400 hover:text-white bg-slate-900/60"
                }`}
              >
                {st}
              </button>
            ),
          )}
        </div>
      </GlassCard>

      <GlassCard className="p-4 sm:p-6">
        <div className="hidden md:block overflow-hidden rounded-2xl border border-slate-300/80 !bg-slate-100/45 backdrop-blur-xl shadow-lg shadow-slate-300/30 font-sans">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1020px] text-left text-base">
              <thead className="bg-slate-200/70 backdrop-blur-xl">
                <tr className="text-slate-950 text-sm font-black uppercase tracking-wide">
                  <th scope="col" className="py-3.5 px-4">
                    Order
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Agent & Shop
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Payment
                  </th>
                  <th scope="col" className="py-3.5 px-4 text-center">
                    Cases
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Total
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Time
                  </th>
                  <th scope="col" className="py-3.5 px-4">
                    Status
                  </th>
                  <th scope="col" className="py-3.5 px-4 text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-300/70">
                {paginatedOrders.map((ord, index) => (
                  <tr
                    key={ord.id}
                    className={`group ${index % 2 === 0 ? "bg-white/35" : "bg-slate-200/35"} hover:bg-white/75 backdrop-blur-md transition-colors duration-200`}
                  >
                    <td className="py-4 px-4">
                      <span
                        className="inline-flex whitespace-nowrap rounded-lg bg-cyan-100/80 border border-cyan-300 px-2.5 py-1 font-mono text-sm font-extrabold tracking-wide text-cyan-950"
                        title={`Full order ID: ${ord.id}`}
                      >
                        {displayOrderNumber(ord.id)}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <p className="font-extrabold text-slate-950">
                        {ord.shopName}
                      </p>
                      <p className="text-sm font-semibold text-slate-600 mt-0.5">
                        {ord.agentName}
                      </p>
                    </td>
                    <td className="py-4 px-4 text-amber-700 font-bold">
                      {ord.paymentTerm}
                    </td>
                    <td className="py-4 px-4 text-center font-bold text-slate-950">
                      {ord.casesCount}
                    </td>
                    <td className="py-4 px-4 font-extrabold text-emerald-700">
                      LKR {ord.totalAmountLkr.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 font-medium text-slate-700">
                      {ord.time}
                    </td>
                    <td className="py-4 px-4">
                      <Badge status={ord.status} />
                    </td>
                    <td className="py-4 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(ord)}
                          className="inline-flex min-h-10 items-center gap-2 px-3 py-2 rounded-lg bg-white/80 border border-cyan-400 hover:bg-cyan-100 text-cyan-900 text-sm font-extrabold transition-all focus-visible:ring-2 focus-visible:ring-cyan-500"
                          aria-label={`View order ${ord.id}`}
                        >
                          <Eye className="w-4 h-4" />
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => setOrderToDelete(ord)}
                          className="inline-flex min-h-10 items-center gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-300 hover:bg-rose-100 text-rose-700 text-sm font-extrabold transition-all focus-visible:ring-2 focus-visible:ring-rose-500"
                          aria-label={`Delete order ${ord.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
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
          {paginatedOrders.map((ord) => (
            <article
              key={ord.id}
              className="rounded-2xl p-4 sm:p-5 flex flex-col gap-4 !bg-slate-100/50 backdrop-blur-xl border border-slate-300/80 shadow-lg shadow-slate-300/25 font-sans"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className="font-mono font-extrabold tracking-wide text-cyan-900 text-base"
                    title={`Full order ID: ${ord.id}`}
                  >
                    {displayOrderNumber(ord.id)}
                  </p>
                  <h3 className="font-extrabold text-slate-950 text-base mt-1">
                    {ord.shopName}
                  </h3>
                  <p className="text-sm text-slate-600 mt-0.5">
                    Booked by {ord.agentName}
                  </p>
                </div>
                <Badge status={ord.status} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="rounded-xl bg-white/45 border border-slate-300/80 p-3 backdrop-blur-md">
                  <span className="block text-xs uppercase font-bold text-slate-600">
                    Cases
                  </span>
                  <span className="text-sm font-bold text-slate-950">
                    {ord.casesCount} cases
                  </span>
                </div>
                <div className="rounded-xl bg-white/45 border border-slate-300/80 p-3 backdrop-blur-md">
                  <span className="block text-xs uppercase font-bold text-slate-600">
                    Payment
                  </span>
                  <span className="text-sm font-semibold text-amber-700">
                    {ord.paymentTerm}
                  </span>
                </div>
                <div className="rounded-xl bg-white/45 border border-slate-300/80 p-3 backdrop-blur-md">
                  <span className="block text-xs uppercase font-bold text-slate-600">
                    Time
                  </span>
                  <span className="text-sm font-semibold text-slate-950">
                    {ord.time}
                  </span>
                </div>
                <div className="rounded-xl bg-white/45 border border-slate-300/80 p-3 backdrop-blur-md">
                  <span className="block text-xs uppercase font-bold text-slate-600">
                    Total
                  </span>
                  <span className="text-sm font-extrabold text-emerald-700">
                    LKR {ord.totalAmountLkr.toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setSelectedOrder(ord)}
                  className="min-h-11 px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-white text-sm font-extrabold transition-all flex items-center justify-center gap-2"
                >
                  <Eye className="w-4 h-4" />
                  View Details
                </button>
                <button
                  onClick={() => setOrderToDelete(ord)}
                  className="min-h-11 px-3 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-300 text-rose-700 text-sm font-extrabold transition-all flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>

        {filteredOrders.length === 0 && (
          <div className="py-14 text-center">
            <ShoppingBag className="w-9 h-9 text-slate-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-300">No orders found</p>
            <p className="text-xs text-slate-500 mt-1">
              Try changing your search or status filter.
            </p>
          </div>
        )}

        {filteredOrders.length > 0 && (
          <div className="mt-6 flex flex-col gap-4 border-t border-slate-300/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-300">
              <label htmlFor="orders-page-size">Rows per page</label>
              <select
                id="orders-page-size"
                value={rowsPerPage}
                onChange={(event) => setRowsPerPage(Number(event.target.value))}
                className="min-h-10 rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm font-bold text-white"
              >
                {[5, 10, 20, 50].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span className="ml-2 text-slate-400">
                {(currentPage - 1) * rowsPerPage + 1}–
                {Math.min(currentPage * rowsPerPage, filteredOrders.length)} of{" "}
                {filteredOrders.length}
              </span>
            </div>
            <nav
              aria-label="Orders pagination"
              className="flex items-center gap-1.5 overflow-x-auto"
            >
              <button
                type="button"
                disabled={currentPage === 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map(
                (number) => (
                  <button
                    type="button"
                    key={number}
                    aria-current={number === currentPage ? "page" : undefined}
                    onClick={() => setPage(number)}
                    className={`min-h-10 min-w-10 rounded-lg border px-3 text-sm font-black ${number === currentPage ? "border-cyan-400 bg-cyan-500 text-slate-950" : "border-slate-600 bg-slate-900 text-white hover:bg-slate-800"}`}
                  >
                    {number}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={currentPage === totalPages}
                onClick={() =>
                  setPage((value) => Math.min(totalPages, value + 1))
                }
                className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-600 bg-slate-900 px-3 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </nav>
          </div>
        )}
      </GlassCard>

      <Modal
        isOpen={Boolean(orderToDelete)}
        onClose={() => !deleting && setOrderToDelete(null)}
        title="Delete order?"
        maxWidth="sm"
      >
        <div className="space-y-5">
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
            <p className="text-base font-bold text-white">
              This action cannot be undone.
            </p>
            <p className="mt-2 text-sm font-medium leading-6 text-slate-300">
              Delete{" "}
              {orderToDelete
                ? displayOrderNumber(orderToDelete.id)
                : "this order"}{" "}
              for{" "}
              <strong className="text-white">{orderToDelete?.shopName}</strong>?
              Orders linked to production, dispatch, or payments are protected
              and cannot be deleted.
            </p>
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={deleting}
              onClick={() => setOrderToDelete(null)}
              className="min-h-11 rounded-xl border border-slate-600 px-5 text-sm font-extrabold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={() => void handleDelete()}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-600 px-5 text-sm font-extrabold text-white hover:bg-rose-500 disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? "Deleting..." : "Delete order"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={shopModalOpen}
        onClose={closeShopModal}
        title="Add New Customer Shop"
        maxWidth="xl"
        stickyActions
        scrollControls
      >
        <form
          onSubmit={handleCreateShop}
          className="agent-form-contrast space-y-4"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Shop Name">
              <input
                required
                minLength={2}
                value={shopForm.name}
                onChange={(event) =>
                  setShopForm({ ...shopForm, name: event.target.value })
                }
                placeholder="e.g. City Mart"
                className={fieldClass}
              />
            </Field>
            <Field label="Owner Name *">
              <input
                required
                minLength={2}
                value={shopForm.ownerName}
                onChange={(event) =>
                  setShopForm({ ...shopForm, ownerName: event.target.value })
                }
                className={fieldClass}
              />
            </Field>
          </div>
          <ImageUploadField
            label="Shop Image *"
            file={shopImage}
            disabled={savingShop}
            onChange={setShopImage}
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Contact Number *">
              <input
                required
                type="tel"
                minLength={7}
                value={shopForm.phone}
                onChange={(event) =>
                  setShopForm({ ...shopForm, phone: event.target.value })
                }
                placeholder="+94 77 123 4567"
                className={fieldClass}
              />
            </Field>
            <Field label="City">
              <input
                required
                minLength={2}
                value={shopForm.city}
                onChange={(event) =>
                  setShopForm({ ...shopForm, city: event.target.value })
                }
                placeholder="e.g. Colombo"
                className={fieldClass}
              />
            </Field>
          </div>
          <Field label="Full Address">
            <textarea
              required
              minLength={5}
              rows={3}
              value={shopForm.address}
              onChange={(event) =>
                setShopForm({ ...shopForm, address: event.target.value })
              }
              className={fieldClass}
            />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Route / Territory (Optional)">
              <input
                value={shopForm.routeGroup}
                onChange={(event) =>
                  setShopForm({ ...shopForm, routeGroup: event.target.value })
                }
                placeholder="e.g. Route A"
                className={fieldClass}
              />
            </Field>
            <Field label="Opening Balance (LKR)">
              <input
                type="number"
                min="0"
                step="0.01"
                value={shopForm.outstandingBalanceLkr}
                onChange={(event) =>
                  setShopForm({
                    ...shopForm,
                    outstandingBalanceLkr: event.target.value,
                  })
                }
                className={fieldClass}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={savingShop}
              onClick={closeShopModal}
              className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={savingShop}
              className="glass-button-primary rounded-xl px-5 py-2.5 text-xs font-bold text-white disabled:opacity-60"
            >
              {savingShop ? "Saving…" : "Add Shop"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={!!selectedOrder}
        onClose={() => setSelectedOrder(null)}
        title={`Invoice & Order Review - ${selectedOrder ? displayOrderNumber(selectedOrder.id) : ""}`}
      >
        {selectedOrder && (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-1">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-white text-base">
                  {selectedOrder.shopName}
                </h4>
                <Badge status={selectedOrder.status} />
              </div>
              <p className="text-xs text-slate-400">
                {selectedOrder.shopAddress}
              </p>
              <p className="text-xs text-cyan-400 pt-1 font-semibold">
                Booked by {selectedOrder.agentName} at {selectedOrder.time}
              </p>
            </div>

            <div className="border border-slate-800 rounded-xl overflow-hidden">
              <div className="bg-slate-900/80 p-3 text-xs font-bold text-slate-300 uppercase">
                Order Line Items
              </div>
              <div className="divide-y divide-slate-800 text-xs">
                {selectedOrder.items.map((it) => (
                  <div
                    key={it.id}
                    className="p-3 flex items-center justify-between"
                  >
                    <div>
                      <p className="font-bold text-white">{it.productName}</p>
                      <p className="text-[10px] text-slate-400">
                        {it.casesQuantity} Cases @ LKR{" "}
                        {it.pricePerCaseLkr.toLocaleString()} / case
                      </p>
                    </div>
                    <span className="font-bold text-cyan-400">
                      LKR {it.totalLkr.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-400 font-bold uppercase">
                Payment Terms:
              </span>
              <span className="text-xs font-bold text-amber-400">
                {selectedOrder.paymentTerm}
              </span>
            </div>

            <div className="pt-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    handleUpdateStatus(selectedOrder.id, "Approved")
                  }
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                >
                  Approve Order
                </button>
                <button
                  onClick={() =>
                    handleUpdateStatus(selectedOrder.id, "In Production")
                  }
                  className="px-3 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold"
                >
                  Set In Production
                </button>
              </div>

              <button
                onClick={() => {
                  downloadOrderInvoice(selectedOrder);
                  showToast(
                    "Download started",
                    `PDF invoice for ${displayOrderNumber(selectedOrder.id)} is downloading.`,
                    "success",
                  );
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF Invoice</span>
              </button>
            </div>
          </div>
        )}
      </Modal>
    </ManagerLayout>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="block">
    <span className="mb-1 block text-xs font-bold uppercase text-slate-300">
      {label}
    </span>
    {children}
  </label>
);
