import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AgentLayout } from "../components/layout/AgentLayout";
import { GlassCard } from "../components/common/GlassCard";
import { Product, Shop } from "../types";
import { createOrder, loadProducts, loadShops } from "../services/domainApi";
import { useToast } from "../context/ToastContext";
import {
  ShoppingBag,
  Plus,
  Minus,
  Check,
  ArrowLeft,
  Store,
  CreditCard,
  FileText,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

export const AgentNewOrderPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const linkedVisitId = params.get("visitId") ?? undefined;
  const linkedShopId = params.get("shopId");
  const { showToast } = useToast();
  const { user } = useAuth();

  const [selectedShopId, setSelectedShopId] = useState("");
  const [shops, setShops] = useState<Shop[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoadingShops, setIsLoadingShops] = useState(true);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentTerm, setPaymentTerm] = useState<
    "Cash" | "Credit 14 Days" | "Credit 30 Days" | "Cheque"
  >("Credit 14 Days");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [remarks, setRemarks] = useState("");

  useEffect(() => {
    void loadShops([])
      .then((items) => {
        setShops(items);
        if (linkedShopId && items.some((item) => item.id === linkedShopId))
          setSelectedShopId(linkedShopId);
        else if (items[0]) setSelectedShopId(items[0].id);
      })
      .catch((error: unknown) => {
        showToast("Shops Unavailable", error instanceof Error ? error.message : "Unable to load assigned shops.", "error");
      })
      .finally(() => setIsLoadingShops(false));
    void loadProducts([])
      .then((items) => setProducts(items.filter((product) => product.active)))
      .catch((error: unknown) => {
        showToast(
          "Products Unavailable",
          error instanceof Error ? error.message : "Unable to load products.",
          "error",
        );
      })
      .finally(() => setIsLoadingProducts(false));
  }, [showToast]);

  const handleQuantityChange = (productId: string, delta: number) => {
    setQuantities((prev) => {
      const current = prev[productId] || 0;
      const product = products.find((item) => item.id === productId);
      // A zero/omitted stock value is used by older product records to mean
      // "not configured", not "the salesperson cannot add an order". Keep
      // the cart usable and let the backend/factory workflow handle stock.
      const configuredStock = Number(product?.stockCases);
      const maxCases = Number.isFinite(configuredStock) && configuredStock > 0
        ? configuredStock
        : 9999;
      const updated = Math.min(maxCases, Math.max(0, current + delta));
      return { ...prev, [productId]: updated };
    });
  };

  // Calculate order totals
  const orderItems = products
    .map((prod) => {
      const qty = quantities[prod.id] || 0;
      return {
        product: prod,
        cases: qty,
        totalLkr: qty * prod.pricePerCaseLkr,
      };
    })
    .filter((item) => item.cases > 0);

  const totalCases = orderItems.reduce((acc, item) => acc + item.cases, 0);
  const totalAmountLkr = orderItems.reduce(
    (acc, item) => acc + item.totalLkr,
    0,
  );

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (orderItems.length === 0) {
      showToast(
        "Cart Empty",
        "Please select at least 1 product case to book.",
        "error",
      );
      return;
    }

    const shop = shops.find((s) => s.id === selectedShopId);
    if (!shop) {
      showToast("Shop Required", "Select a valid customer shop.", "error");
      return;
    }
    setIsSubmitting(true);
    try {
      const createdOrder = await createOrder(
        {
          shopId: shop.id,
          shopVisitId: linkedVisitId,
          shopName: shop.name,
          shopAddress: shop.address,
          paymentTerm,
          remarks: remarks.trim() || undefined,
          items: orderItems.map((item) => ({
            productId: item.product.id,
            cases: item.cases,
          })),
        },
        user?.id,
      );
      showToast(
        createdOrder?.id ? "Order Booked!" : "Order Queued",
        createdOrder?.id
          ? `Order ${createdOrder.id} for LKR ${totalAmountLkr.toLocaleString()} was saved for ${shop.name}.`
          : "The order is queued and will sync when the connection returns.",
        "success",
      );
      navigate(linkedVisitId ? "/sales/visits/new" : "/sales/dashboard");
    } catch (error) {
      showToast(
        "Order Failed",
        error instanceof Error
          ? error.message
          : "The order could not be saved.",
        "error",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AgentLayout>
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/sales/dashboard")}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-xl font-extrabold text-white">
              Book New Store Order
            </h2>
            <p className="text-xs text-slate-400">
              Select customer shop & FMCG product quantities
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmitOrder} className="space-y-6">
          {/* Shop Selector */}
          <GlassCard className="p-5 space-y-3">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Store className="w-4 h-4 text-cyan-400" />
              <span>Select Customer Store</span>
            </label>
            <select
              value={selectedShopId}
              onChange={(e) => setSelectedShopId(e.target.value)}
              disabled={isLoadingShops || shops.length === 0}
              className="w-full px-4 py-3 text-xs rounded-xl glass-input bg-slate-900 font-bold text-white"
            >
              <option value="" disabled>
                {isLoadingShops ? "Loading assigned shops…" : "No assigned shops available"}
              </option>
              {shops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} - {s.city} (Bal: LKR{" "}
                  {s.outstandingBalanceLkr.toLocaleString()})
                </option>
              ))}
            </select>
            {!isLoadingShops && shops.length === 0 && (
              <p className="text-[10px] text-amber-500">
                No shop is assigned to your account. Ask your manager to assign a shop before booking an order.
              </p>
            )}
          </GlassCard>

          {/* Product Items Stepper List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-1">
              Select FMCG Product Cases
            </h3>

            {isLoadingProducts && (
              <GlassCard className="p-5 text-center text-xs text-slate-400">
                Loading products…
              </GlassCard>
            )}
            {!isLoadingProducts && products.length === 0 && (
              <GlassCard className="p-5 text-center">
                <p className="text-xs font-bold text-slate-300">
                  No active products available
                </p>
                <p className="mt-1 text-[10px] text-slate-500">
                  Ask a manager to add products before booking an order.
                </p>
              </GlassCard>
            )}
            {products.map((prod) => {
              const qty = quantities[prod.id] || 0;
              return (
                <GlassCard
                  key={prod.id}
                  className="p-4 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={prod.image}
                      alt={prod.name}
                      className="w-12 h-12 rounded-xl object-cover border border-cyan-500/30 shrink-0"
                    />
                    <div className="min-w-0">
                      <h4 className="text-xs font-bold text-white truncate">
                        {prod.name}
                      </h4>
                      <p className="text-[10px] text-cyan-400 font-semibold">
                        LKR {prod.pricePerCaseLkr.toLocaleString()} / case (
                        {prod.unitsPerCase} units)
                      </p>
                      <p className="text-[10px] text-slate-500">Available: {prod.stockCases} cases</p>
                    </div>
                  </div>

                  {/* Quantity Stepper */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(prod.id, -1)}
                      className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-white flex items-center justify-center font-bold"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>

                    <span className="w-8 text-center text-sm font-extrabold text-white">
                      {qty}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleQuantityChange(prod.id, 1)}
                      className="w-8 h-8 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center font-bold"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </GlassCard>
              );
            })}
          </div>

          {/* Payment Terms Selector */}
          <GlassCard className="p-5 space-y-3">
            <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-cyan-400" />
              <span>Payment & Credit Term</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                ["Cash", "Credit 14 Days", "Credit 30 Days", "Cheque"] as const
              ).map((term) => (
                <button
                  type="button"
                  key={term}
                  onClick={() => setPaymentTerm(term)}
                  className={`p-2.5 rounded-xl text-xs font-bold border text-center transition-all ${
                    paymentTerm === term
                      ? "bg-cyan-500 text-slate-950 border-cyan-400 font-extrabold shadow-md"
                      : "bg-slate-900/60 border-slate-800 text-slate-400 hover:text-white"
                  }`}
                >
                  {term}
                </button>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-5 space-y-3">
            <label
              htmlFor="order-remarks"
              className="block text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2"
            >
              <FileText className="w-4 h-4 text-cyan-400" />
              <span>Order Note / Remarks</span>
            </label>
            <textarea
              id="order-remarks"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value.slice(0, 1000))}
              maxLength={1000}
              rows={3}
              placeholder="Add any customer request, delivery instruction, or order note (optional)"
              className="w-full resize-y rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-white placeholder:text-slate-500 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
            />
            <p className="text-right text-[10px] text-slate-500">
              {remarks.length}/1000
            </p>
          </GlassCard>

          {/* Order Summary Footer */}
          <GlassCard glow="cyan" className="p-5 space-y-3 border-cyan-500/40">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-semibold">Total Cases:</span>
              <span className="text-white font-extrabold">
                {totalCases} Cases
              </span>
            </div>

            <div className="flex items-center justify-between text-sm font-extrabold border-t border-slate-800 pt-2">
              <span className="text-white">Total Order Amount:</span>
              <span className="text-emerald-400 text-lg">
                LKR {totalAmountLkr.toLocaleString()}
              </span>
            </div>

            <button
              type="submit"
              disabled={
                isSubmitting || isLoadingProducts || products.length === 0
              }
              className="w-full py-3.5 rounded-xl text-sm font-bold text-white glass-button-primary flex items-center justify-center gap-2 cursor-pointer shadow-xl mt-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="w-5 h-5" />
              <span>
                {isSubmitting ? "Saving Order…" : "Submit & Confirm Order"}
              </span>
            </button>
          </GlassCard>
        </form>
      </div>
    </AgentLayout>
  );
};
