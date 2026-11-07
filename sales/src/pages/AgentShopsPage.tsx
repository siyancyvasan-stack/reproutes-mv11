import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AgentLayout } from "../components/layout/AgentLayout";
import { GlassCard } from "../components/common/GlassCard";
import { useToast } from "../context/ToastContext";
import { Store, Phone, MapPin, CheckCircle2, Navigation, Loader2 } from "lucide-react";
import { loadShops } from "../services/domainApi";
import { capturePreciseGpsPoint, captureFastGpsPoint } from "../services/deviceGps";
import { ApiError, apiRequest } from "../services/apiClient";
import { useAuth } from "../context/AuthContext";
import { ExportButton } from "../components/common/ExportButton";
import {
  exportToCsv,
  exportToPdf,
  type ExportColumn,
} from "../services/exportService";
import type { Shop } from "../types";

const ShopThumbnail: React.FC<{ src?: string | null; alt: string }> = ({ src, alt }) => {
  const [hasError, setHasError] = useState(false);

  if (!src || hasError) {
    return (
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-cyan-500/20 text-cyan-400">
        <Store className="w-6 h-6" />
      </div>
    );
  }

  return (
    <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-cyan-500/20 border border-cyan-500/30">
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover"
        onError={() => setHasError(true)}
        loading="lazy"
      />
    </div>
  );
};

export const AgentShopsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const [shops, setShops] = useState<Awaited<ReturnType<typeof loadShops>>>([]);
  const [shopsLoading, setShopsLoading] = useState(true);
  const [shopsError, setShopsError] = useState<string | null>(null);
  const [checkingInShopId, setCheckingInShopId] = useState<string | null>(null);
  
  const loadShopList = async () => {
    setShopsLoading(true);
    setShopsError(null);
    try {
      const loadedShops = await loadShops([]);
      setShops(loadedShops);
    } catch (error) {
      setShops([]);
      setShopsError(
        error instanceof Error
          ? error.message
          : "Unable to load your assigned shops.",
      );
    } finally {
      setShopsLoading(false);
    }
  };
  
  useEffect(() => {
    void loadShopList();
  }, []);

  const exportDate = new Date().toLocaleDateString("en-CA");
  const shopColumns: ExportColumn<Shop>[] = [
    { header: "Shop Name", value: (shop) => shop.name },
    { header: "Address", value: (shop) => shop.address },
    { header: "Territory", value: (shop) => shop.territory ?? shop.routeGroup },
    {
      header: "Visit Status",
      value: (shop) => (shop.visitedToday ? "Visited" : "Not Visited"),
    },
    {
      header: "Outstanding Balance",
      value: (shop) => shop.outstandingBalanceLkr,
    },
    {
      header: "Assigned Agent",
      value: (shop) => shop.assignedAgentName ?? user?.name,
    },
    { header: "Contact Number", value: (shop) => shop.phone },
    {
      header: "Last Visit Date",
      value: (shop) =>
        shop.lastVisitAt ? new Date(shop.lastVisitAt).toLocaleDateString() : "",
    },
  ];
  const exportShops = async (format: "csv" | "pdf") => {
    const filename = `assigned_shops_${exportDate}.${format}`;
    if (format === "csv")
      return exportToCsv(shops, { columns: shopColumns }, filename);
    const visited = shops.filter((shop) => shop.visitedToday).length;
    await exportToPdf(
      shops,
      {
        title: "Assigned Territory Stores Report",
        subtitle: "Currently displayed assigned retailer network",
        metadata: [
          ["Assigned Agent", user?.name],
          [
            "Territory",
            [
              ...new Set(
                shops
                  .map((shop) => shop.territory ?? shop.routeGroup)
                  .filter(Boolean),
              ),
            ].join(", ") || "Not assigned",
          ],
        ],
        kpis: [
          ["Total Shops", shops.length],
          ["Visited", visited],
          ["Not Visited", shops.length - visited],
          [
            "Outstanding Balance",
            `LKR ${shops.reduce((sum, shop) => sum + shop.outstandingBalanceLkr, 0).toLocaleString()}`,
          ],
        ],
        columns: shopColumns,
      },
      filename,
    );
  };

  const handleCheckIn = async (shopId: string, shopName: string) => {
    if (!user?.id || checkingInShopId) return;
    setCheckingInShopId(shopId);
    try {
      const point = await capturePreciseGpsPoint(user.id, 6000)
        .catch(() => captureFastGpsPoint(user.id));
      await apiRequest(`/api/v1/shops/${shopId}/visits`, {
        method: "POST",
        body: JSON.stringify({
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.accuracy,
        }),
      });
      setShops((prev) =>
        prev.map((s) =>
          s.id === shopId
            ? { ...s, visitedToday: true, lastVisitAt: new Date().toISOString() }
            : s,
        ),
      );
      showToast("GPS Verified", `Checked in at ${shopName}.`, "success");
    } catch (error) {
      showToast(
        "Check-in failed",
        error instanceof Error ? error.message : "GPS unavailable.",
        "error",
      );
    } finally {
      setCheckingInShopId(null);
    }
  };

  return (
    <AgentLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-extrabold text-white">
              Assigned Territory Stores
            </h2>
            <p className="text-xs text-slate-400">
              Your approved and assigned retailer network
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <ExportButton
              dataset="shop_visits"
              pdf
              formats={["pdf", "csv"]}
              onExport={(format) => exportShops(format as "csv" | "pdf")}
            />
            <button
              onClick={() => navigate("/sales/shops/new")}
              className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition-colors"
            >
              + Register Shop
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {shopsLoading && Array.from({ length: 3 }).map((_, index) => (
            <GlassCard key={index} className="h-44 animate-pulse p-5" />
          ))}

          {!shopsLoading && shopsError && (
            <GlassCard className="space-y-3 p-5 text-center">
              <p className="font-bold text-rose-600">Unable to load assigned shops</p>
              <p className="text-sm text-slate-500">{shopsError}</p>
              <button
                type="button"
                onClick={() => void loadShopList()}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500"
              >
                Try again
              </button>
            </GlassCard>
          )}

          {!shopsLoading && !shopsError && shops.length === 0 && (
            <GlassCard className="space-y-3 p-8 text-center">
              <Store className="mx-auto h-9 w-9 text-indigo-500" />
              <div>
                <p className="font-bold text-slate-900">No shops assigned yet</p>
                <p className="mt-1 text-sm text-slate-500">
                  Your manager can assign stores here, or you can register a new shop.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/sales/shops/new")}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-500"
              >
                Register new shop
              </button>
            </GlassCard>
          )}

          {!shopsLoading && !shopsError && shops.map((shop) => (
            <GlassCard key={shop.id} className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ShopThumbnail src={shop.primaryImageUrl} alt={shop.name} />
                  <div>
                    <h3 className="text-base font-bold text-white">
                      {shop.name}
                    </h3>
                    <p className="text-xs text-slate-400">{shop.ownerName}</p>
                  </div>
                </div>

                {shop.visitedToday && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Visited
                  </span>
                )}
              </div>

              <div className="space-y-1 text-xs text-slate-300 border-t border-slate-800 pt-3">
                <p className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span>{shop.address}</span>
                </p>
                <p className="flex items-center gap-2 text-slate-400">
                  <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  <span>{shop.phone}</span>
                </p>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between text-xs">
                <span className="text-slate-400 font-semibold">
                  Outstanding Balance:
                </span>
                <span className="font-extrabold text-amber-400">
                  LKR {shop.outstandingBalanceLkr.toLocaleString()}
                </span>
              </div>

              <div className="flex items-center gap-2 pt-1">
                {!shop.visitedToday && (
                  <button
                    disabled={checkingInShopId === shop.id}
                    onClick={() => void handleCheckIn(shop.id, shop.name)}
                    className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {checkingInShopId === shop.id ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Verifying GPS...</span>
                      </>
                    ) : (
                      "GPS Check-In"
                    )}
                  </button>
                )}
                <button
                  onClick={() => navigate(`/sales/new-order?shopId=${encodeURIComponent(shop.id)}`)}
                  className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold"
                >
                  Book Order
                </button>
                <a
                  href={`tel:${shop.phone}`}
                  className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-cyan-300"
                >
                  Call
                </a>
                {Number.isFinite(shop.coordinates.lat) && (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${shop.coordinates.lat},${shop.coordinates.lng}`}
                    className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-bold text-cyan-300"
                  >
                    <Navigation className="h-4" />
                  </a>
                )}
              </div>
            </GlassCard>
          ))}
        </div>

      </div>
    </AgentLayout>
  );
};
