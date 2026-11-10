import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { MapPin, Package, Phone, Plus, Search, Store } from "lucide-react";
import { GlassCard } from "../components/common/GlassCard";
import { Modal } from "../components/common/Modal";
import { ManagerLayout } from "../components/layout/ManagerLayout";
import { useToast } from "../context/ToastContext";
import {
  createProduct,
  createShop,
  loadProducts,
  loadShops,
} from "../services/domainApi";
import { Product, Shop } from "../types";
import { ImageUploadField } from "../components/common/ImageUploadField";
import { uploadProductImage, uploadShopImage } from "../services/domainApi";
import { ExportButton } from "../components/common/ExportButton";

type CatalogTab = "products" | "shops";

const fieldClass = "w-full px-4 py-2.5 text-xs rounded-xl glass-input";
const emptyProduct = {
  name: "",
  sku: "",
  category: "",
  pricePerCaseLkr: "",
  unitsPerCase: "",
  stockCases: "",
};
const emptyShop = {
  name: "",
  ownerName: "",
  phone: "",
  address: "",
  city: "",
  routeGroup: "",
  outstandingBalanceLkr: "",
};

export const ManagerProductsPage: React.FC = () => {
  const { showToast } = useToast();
  const [products, setProducts] = useState<Product[]>([]);
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeTab, setActiveTab] = useState<CatalogTab>("products");
  const [searchQuery, setSearchQuery] = useState("");
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [shopModalOpen, setShopModalOpen] = useState(false);
  const [productForm, setProductForm] = useState(emptyProduct);
  const [shopForm, setShopForm] = useState(emptyShop);
  const [saving, setSaving] = useState(false);
  const [productImage, setProductImage] = useState<File>();
  const [shopImage, setShopImage] = useState<File>();

  useEffect(() => {
    Promise.all([loadProducts([]), loadShops([])])
      .then(([nextProducts, nextShops]) => {
        setProducts(nextProducts);
        setShops(nextShops);
      })
      .catch(() =>
        showToast(
          "Catalog Unavailable",
          "Could not load the latest catalog data.",
          "error",
        ),
      );
  }, [showToast]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return products.filter((product) =>
      [product.name, product.sku, product.category].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [products, searchQuery]);

  const filteredShops = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return shops.filter((shop) =>
      [shop.name, shop.ownerName, shop.city, shop.routeGroup].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [shops, searchQuery]);

  const handleCreateProduct = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      let created = await createProduct({
        name: productForm.name.trim(),
        sku: productForm.sku.trim().toUpperCase(),
        category: productForm.category.trim(),
        pricePerCaseLkr: Number(productForm.pricePerCaseLkr),
        unitsPerCase: Number(productForm.unitsPerCase),
        stockCases: Number(productForm.stockCases),
      });
      if (productImage)
        created = await uploadProductImage(created.id, productImage);
      setProducts((current) => [created, ...current]);
      setProductForm(emptyProduct);
      setProductImage(undefined);
      setProductModalOpen(false);
      showToast(
        "Product Added",
        `${created.name} is now available in the catalog.`,
        "success",
      );
    } catch (error) {
      showToast(
        "Product Not Added",
        error instanceof Error ? error.message : "Please check the details.",
        "error",
      );
    } finally {
      setSaving(false);
    }
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
    setSaving(true);
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
      const uploaded = await uploadShopImage(
        created.id,
        shopImage,
        "FRONT",
        true,
      );
      created.images = [uploaded];
      created.primaryImageUrl = uploaded.url;
      setShops((current) => [created, ...current]);
      setShopForm(emptyShop);
      setShopImage(undefined);
      setShopModalOpen(false);
      setActiveTab("shops");
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
      setSaving(false);
    }
  };

  const closeShopModal = () => {
    if (saving) return;
    setShopModalOpen(false);
    setShopImage(undefined);
  };

  return (
    <ManagerLayout>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Package className="w-6 h-6 text-cyan-400" />
            <span>Catalog & Territory</span>
          </h2>
          <p className="text-xs text-slate-400">
            Manage sellable products, inventory, and customer shops from one
            workspace
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <ExportButton
            dataset={activeTab === "products" ? "products" : "shops"}
            filters={{ search: searchQuery }}
          />
          <button
            type="button"
            onClick={() => setShopModalOpen(true)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400 bg-cyan-50 px-4 py-2.5 text-sm font-black text-cyan-500 shadow-lg shadow-cyan-500/10 transition hover:bg-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2"
          >
            <Store className="w-4 h-4" />
            Add Shop
          </button>
          <button
            type="button"
            onClick={() => setProductModalOpen(true)}
            className="px-4 py-2.5 rounded-xl text-xs font-bold text-white glass-button-primary flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Product
          </button>
        </div>
      </div>

      <GlassCard className="p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="inline-flex w-fit rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {(["products", "shops"] as CatalogTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setActiveTab(tab);
                setSearchQuery("");
              }}
              className={`inline-flex min-h-10 min-w-[120px] items-center justify-center rounded-xl px-4 py-2 text-sm font-extrabold capitalize transition-all ${
                activeTab === tab
                  ? "bg-cyan-500 text-slate-950 shadow-md shadow-cyan-500/20"
                  : "!bg-slate-100 !text-slate-800 hover:!bg-cyan-50 hover:!text-cyan-700"
              }`}
            >
              {tab === "products" ? "Products" : "Shops"}{" "}
              <span className="ml-1 text-xs font-black opacity-80">
                ({tab === "products" ? products.length : shops.length})
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={
              activeTab === "products"
                ? "Search name, SKU or category…"
                : "Search shop, owner, city or route…"
            }
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl glass-input"
          />
        </div>
      </GlassCard>

      {activeTab === "products" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProducts.map((product) => (
            <GlassCard
              key={product.id}
              interactive
              className="p-5 flex flex-col justify-between space-y-4 !bg-slate-100/50 !border-slate-300/80 backdrop-blur-xl shadow-lg shadow-slate-300/25 font-sans"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  {product.image ? (
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-16 h-16 rounded-2xl object-cover border border-cyan-500/30 shrink-0"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 grid place-items-center shrink-0">
                      <Package className="w-7 h-7" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-cyan-800 bg-cyan-100/70 px-2 py-0.5 rounded-full border border-cyan-300/70">
                      {product.category}
                    </span>
                    <h3 className="text-base font-extrabold text-slate-950 mt-1 leading-snug">
                      {product.name}
                    </h3>
                    <p className="text-sm text-slate-600 font-mono mt-0.5">
                      SKU: {product.sku}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm border-t border-slate-300/80 pt-3 text-slate-950">
                  <Metric
                    label="Price / Case"
                    value={`LKR ${product.pricePerCaseLkr.toLocaleString()}`}
                    accent
                  />
                  <Metric
                    label="Units / Case"
                    value={`${product.unitsPerCase} Units`}
                  />
                </div>
              </div>
              <div className="p-3 rounded-xl bg-white/45 backdrop-blur-md border border-slate-300/80 flex items-center justify-between text-sm">
                <span className="text-slate-700 font-semibold">
                  Warehouse Stock
                </span>
                <span className="font-extrabold text-cyan-800">
                  {product.stockCases} Cases
                </span>
              </div>
            </GlassCard>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredShops.map((shop) => (
            <GlassCard
              key={shop.id}
              interactive
              className="overflow-hidden !bg-slate-100/50 !border-slate-300/80 backdrop-blur-xl shadow-lg shadow-slate-300/25 font-sans"
            >
              <div className="relative h-40 overflow-hidden bg-cyan-500/10">
                {shop.primaryImageUrl ? (
                  <img
                    src={shop.primaryImageUrl}
                    alt={`${shop.name} shop front`}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-cyan-500">
                    <Store className="h-10 w-10" />
                  </div>
                )}
                {shop.routeGroup && (
                  <span className="absolute right-3 top-3 rounded-full border border-white/40 bg-slate-950/65 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">
                    {shop.routeGroup}
                  </span>
                )}
              </div>
              <div className="space-y-4 p-5">
                <div>
                  <h3 className="text-base font-extrabold text-slate-950">
                    {shop.name}
                  </h3>
                  <p className="mt-1 text-xs font-bold uppercase tracking-wide text-slate-500">
                    Owner
                  </p>
                  <p className="text-sm font-extrabold text-slate-800">
                    {shop.ownerName}
                  </p>
                </div>
                <div className="space-y-2 border-t border-slate-300/80 pt-3 text-sm font-medium text-slate-900">
                  <p className="flex gap-2">
                    <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    {shop.address}, {shop.city}
                  </p>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    Contact
                  </p>
                  <p className="flex gap-2 font-bold text-slate-800">
                    <Phone className="w-3.5 h-3.5 shrink-0 text-cyan-500" />
                    {shop.phone}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white/45 backdrop-blur-md border border-slate-300/80 flex items-center justify-between text-sm">
                  <span className="text-slate-700">Outstanding</span>
                  <span className="font-bold text-amber-700">
                    LKR {shop.outstandingBalanceLkr.toLocaleString()}
                  </span>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {(activeTab === "products" ? filteredProducts : filteredShops).length ===
        0 && (
        <GlassCard className="p-10 text-center">
          <p className="text-sm font-bold text-white">No {activeTab} found</p>
          <p className="text-xs text-slate-400 mt-1">
            Try another search or add your first{" "}
            {activeTab === "products" ? "product" : "shop"}.
          </p>
        </GlassCard>
      )}

      <Modal
        isOpen={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title="Add New Product"
        maxWidth="xl"
        stickyActions
        scrollControls
      >
        <form
          onSubmit={handleCreateProduct}
          className="agent-form-contrast space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Product Name">
              <input
                required
                minLength={2}
                value={productForm.name}
                onChange={(e) =>
                  setProductForm({ ...productForm, name: e.target.value })
                }
                placeholder="e.g. Premium Tea 100g"
                className={fieldClass}
              />
            </Field>
            <Field label="SKU">
              <input
                required
                minLength={2}
                value={productForm.sku}
                onChange={(e) =>
                  setProductForm({ ...productForm, sku: e.target.value })
                }
                placeholder="e.g. TEA-100"
                className={fieldClass}
              />
            </Field>
          </div>
          <Field label="Category">
            <input
              required
              minLength={2}
              value={productForm.category}
              onChange={(e) =>
                setProductForm({ ...productForm, category: e.target.value })
              }
              placeholder="e.g. Hot Beverages"
              className={fieldClass}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Price / Case (LKR)">
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={productForm.pricePerCaseLkr}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    pricePerCaseLkr: e.target.value,
                  })
                }
                className={fieldClass}
              />
            </Field>
            <Field label="Units / Case">
              <input
                required
                type="number"
                min="1"
                value={productForm.unitsPerCase}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    unitsPerCase: e.target.value,
                  })
                }
                className={fieldClass}
              />
            </Field>
            <Field label="Opening Stock">
              <input
                required
                type="number"
                min="0"
                value={productForm.stockCases}
                onChange={(e) =>
                  setProductForm({ ...productForm, stockCases: e.target.value })
                }
                className={fieldClass}
              />
            </Field>
          </div>
          <ImageUploadField
            file={productImage}
            onChange={setProductImage}
            disabled={saving}
          />
          <FormActions
            saving={saving}
            onCancel={() => setProductModalOpen(false)}
            submitLabel="Add Product"
          />
        </form>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Shop Name">
              <input
                required
                minLength={2}
                value={shopForm.name}
                onChange={(e) =>
                  setShopForm({ ...shopForm, name: e.target.value })
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
                onChange={(e) =>
                  setShopForm({ ...shopForm, ownerName: e.target.value })
                }
                className={fieldClass}
              />
            </Field>
          </div>
          <ImageUploadField
            label="Shop Image *"
            file={shopImage}
            disabled={saving}
            onChange={setShopImage}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Contact Number *">
              <input
                required
                type="tel"
                minLength={7}
                value={shopForm.phone}
                onChange={(e) =>
                  setShopForm({ ...shopForm, phone: e.target.value })
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
                onChange={(e) =>
                  setShopForm({ ...shopForm, city: e.target.value })
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
              onChange={(e) =>
                setShopForm({ ...shopForm, address: e.target.value })
              }
              className={fieldClass}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Route / Territory (Optional)">
              <input
                value={shopForm.routeGroup}
                onChange={(e) =>
                  setShopForm({ ...shopForm, routeGroup: e.target.value })
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
                onChange={(e) =>
                  setShopForm({
                    ...shopForm,
                    outstandingBalanceLkr: e.target.value,
                  })
                }
                className={fieldClass}
              />
            </Field>
          </div>
          <FormActions
            saving={saving}
            onCancel={closeShopModal}
            submitLabel="Add Shop"
          />
        </form>
      </Modal>
    </ManagerLayout>
  );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <label className="block">
    <span className="block text-xs font-bold text-slate-300 uppercase mb-1">
      {label}
    </span>
    {children}
  </label>
);

const Metric: React.FC<{ label: string; value: string; accent?: boolean }> = ({
  label,
  value,
  accent,
}) => (
  <div className="p-2.5 rounded-xl bg-white/45 backdrop-blur-md border border-slate-300/80">
    <span className="text-xs text-slate-600 font-bold block uppercase">
      {label}
    </span>
    <span
      className={`text-sm font-extrabold ${accent ? "text-emerald-700" : "text-slate-950"}`}
    >
      {value}
    </span>
  </div>
);

const FormActions: React.FC<{
  saving: boolean;
  onCancel: () => void;
  submitLabel: string;
}> = ({ saving, onCancel, submitLabel }) => (
  <div className="pt-2 flex justify-end gap-3">
    <button
      type="button"
      onClick={onCancel}
      className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white"
    >
      Cancel
    </button>
    <button
      type="submit"
      disabled={saving}
      className="px-5 py-2.5 rounded-xl text-xs font-bold text-white glass-button-primary disabled:opacity-60"
    >
      {saving ? "Saving…" : submitLabel}
    </button>
  </div>
);
