import { useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ChevronRight, Pencil, Plus, RotateCcw, Upload } from "lucide-react";
import {
  archiveAdminOyunsPlusBrand,
  archiveAdminOyunsPlusCoupon,
  createAdminOyunsPlusBrand,
  createAdminOyunsPlusCoupon,
  fetchAdminOyunsPlusBrandCoupons,
  fetchAdminOyunsPlusBrands,
  OyunsPlusBrand,
  OyunsPlusCoupon,
  presignAdminOyunsPlusUpload,
  restoreAdminOyunsPlusBrand,
  restoreAdminOyunsPlusCoupon,
  updateAdminOyunsPlusBrand,
  updateAdminOyunsPlusCoupon,
} from "../../api";
import { queryKeys } from "../../queryKeys";
import { prepareImageForUpload } from "../../utils/imageUpload";
import { AdminEmptyState, AdminRefreshButton, AdminSectionHeader } from "./AdminPanelPrimitives";

const emptyBrand = { name: "", description: "", logo_url: "", logo_path: null as string | null, is_active: true, sort_order: 0 };
const emptyCoupon = { name: "", description: "", value_type: "amount" as "amount" | "percentage", discount_value: "", points_price: 0, country_code: "mn" as "mn" | "ru", total_purchase_limit: "", expires_at: "", is_active: true };
const validLogo = (file: File) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 2 * 1024 * 1024;

function toLocalDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatCouponValue(coupon: OyunsPlusCoupon) {
  const value = Number(coupon.discount_value || 0).toLocaleString();
  return coupon.value_type === "percentage" ? `${value}%` : `${value} ${coupon.currency_code || (coupon.country_code === "mn" ? "MNT" : "RUB")}`;
}

function AdminOyunsPlusCatalogContent() {
  const queryClient = useQueryClient();
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [brandForm, setBrandForm] = useState(emptyBrand);
  const [couponForm, setCouponForm] = useState(emptyCoupon);
  const [couponBrandId, setCouponBrandId] = useState<string | null>(null);
  const [editingBrand, setEditingBrand] = useState<string | null>(null);
  const [editingCoupon, setEditingCoupon] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const brandsQuery = useQuery({ queryKey: queryKeys.admin.oyunsPlusBrands, queryFn: () => fetchAdminOyunsPlusBrands(true) });
  const couponsQuery = useQuery({ queryKey: selectedBrandId ? queryKeys.admin.oyunsPlusBrandCoupons(selectedBrandId) : ["admin", "oyuns-plus", "brands", "none", "coupons"], queryFn: () => fetchAdminOyunsPlusBrandCoupons(selectedBrandId!, true), enabled: Boolean(selectedBrandId) });
  const brands = brandsQuery.data?.brands ?? [];
  const visibleBrands = brands.filter((brand) => Boolean(brand.archived_at) === showArchive);
  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId) || null;
  const coupons = couponsQuery.data?.coupons ?? [];

  const uploadLogo = async (brandId: string, file: File) => {
    if (!validLogo(file)) throw new Error("JPG, PNG эсвэл WebP зураг 2MB-аас бага байх ёстой.");
    const prepared = await prepareImageForUpload(file);
    const signed = await presignAdminOyunsPlusUpload({ asset_type: "brand_logo", brand_id: brandId, extension: prepared.extension as "jpg" | "jpeg" | "png" | "webp", mime_type: prepared.mimeType as "image/jpeg" | "image/png" | "image/webp" });
    const response = await fetch(signed.upload_url, { method: "PUT", body: prepared.file, headers: { "Content-Type": prepared.mimeType } });
    if (!response.ok) throw new Error("Logo upload failed");
    return { logo_url: signed.public_url || "", logo_path: signed.path };
  };

  const saveBrand = useMutation({
    mutationFn: async () => {
      setError("");
      if (!brandForm.name.trim()) throw new Error("Брэндийн нэр шаардлагатай.");
      if (!editingBrand && brandForm.is_active && !logoFile) throw new Error("Идэвхтэй брэндэд лого оруулна уу.");
      if (editingBrand) {
        let updates = { ...brandForm };
        if (logoFile) updates = { ...updates, ...(await uploadLogo(editingBrand, logoFile)) };
        return updateAdminOyunsPlusBrand(editingBrand, updates);
      }
      const created = await createAdminOyunsPlusBrand({ ...brandForm, logo_url: null, logo_path: null, is_active: false });
      if (logoFile) {
        const uploaded = await uploadLogo(created.id, logoFile);
        return updateAdminOyunsPlusBrand(created.id, { ...uploaded, is_active: brandForm.is_active });
      }
      if (brandForm.is_active) throw new Error("Идэвхтэй брэндэд лого оруулна уу.");
      return created;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrands }); setBrandForm(emptyBrand); setEditingBrand(null); setLogoFile(null); },
    onError: (mutationError: unknown) => setError(mutationError instanceof Error ? mutationError.message : "Брэнд хадгалахад алдаа гарлаа."),
  });

  const saveCoupon = useMutation({
    mutationFn: () => {
      const targetBrandId = couponBrandId || selectedBrandId;
      if (!targetBrandId || !couponForm.name.trim()) throw new Error("Брэнд болон купоны нэр шаардлагатай.");
      const discount = Number(couponForm.discount_value);
      if (!Number.isFinite(discount) || discount <= 0 || (couponForm.value_type === "percentage" && discount > 100)) throw new Error("Хөнгөлөлтийн утгыг зөв оруулна уу.");
      const payload = { brand_id: targetBrandId, name: couponForm.name.trim(), description: couponForm.description.trim(), value_type: couponForm.value_type, discount_value: discount, points_price: Number(couponForm.points_price), country_code: couponForm.country_code, total_purchase_limit: couponForm.total_purchase_limit ? Number(couponForm.total_purchase_limit) : null, expires_at: couponForm.expires_at ? new Date(couponForm.expires_at).toISOString() : null, is_active: couponForm.is_active };
      return editingCoupon ? updateAdminOyunsPlusCoupon(editingCoupon, payload) : createAdminOyunsPlusCoupon(payload);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrandCoupons(selectedBrandId || "") }); if (couponBrandId) void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrandCoupons(couponBrandId) }); void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrands }); setCouponForm(emptyCoupon); setCouponBrandId(selectedBrandId); setEditingCoupon(null); },
    onError: (mutationError: unknown) => setError(mutationError instanceof Error ? mutationError.message : "Купон хадгалахад алдаа гарлаа."),
  });

  const archiveBrand = useMutation({ mutationFn: (brand: OyunsPlusBrand) => brand.archived_at ? restoreAdminOyunsPlusBrand(brand.id) : archiveAdminOyunsPlusBrand(brand.id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrands }); void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrandCoupons(selectedBrandId || "") }); } });
  const archiveCoupon = useMutation({ mutationFn: (coupon: OyunsPlusCoupon) => coupon.archived_at ? restoreAdminOyunsPlusCoupon(coupon.id) : archiveAdminOyunsPlusCoupon(coupon.id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrandCoupons(selectedBrandId || "") }); void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrands }); } });

  const startBrandEdit = (brand: OyunsPlusBrand) => { setEditingBrand(brand.id); setBrandForm({ name: brand.name, description: brand.description, logo_url: brand.logo_url || "", logo_path: brand.logo_path || null, is_active: brand.is_active, sort_order: brand.sort_order }); setLogoFile(null); setError(""); };
  const startCouponEdit = (coupon: OyunsPlusCoupon) => { setEditingCoupon(coupon.id); setCouponBrandId(coupon.brand_id); setCouponForm({ name: coupon.name, description: coupon.description, value_type: coupon.value_type || "amount", discount_value: coupon.discount_value == null ? "" : String(coupon.discount_value), points_price: coupon.points_price, country_code: coupon.country_code, total_purchase_limit: coupon.total_purchase_limit == null ? "" : String(coupon.total_purchase_limit), expires_at: toLocalDateTime(coupon.expires_at), is_active: coupon.is_active }); setError(""); };

  if (selectedBrand) {
    return <div className="space-y-4">
      <button type="button" onClick={() => { setSelectedBrandId(null); setEditingCoupon(null); setCouponForm(emptyCoupon); setCouponBrandId(null); }} className="inline-flex items-center gap-1 text-sm font-semibold text-maroon-700"><ArrowLeft className="h-4 w-4" /> Брэндүүд</button>
      <AdminSectionHeader icon={Archive} title={selectedBrand.name} count={coupons.length} action={<AdminRefreshButton onClick={() => void couponsQuery.refetch()} loading={couponsQuery.isFetching} label="Купон шинэчлэх" />} />
      <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-dark-600 dark:bg-dark-800" onSubmit={(event) => { event.preventDefault(); saveCoupon.mutate(); }}>
        <div className="flex items-center justify-between"><h3 className="font-semibold">{editingCoupon ? "Купон засах" : "Шинэ купон"}</h3>{editingCoupon && <button type="button" className="text-xs text-slate-500" onClick={() => { setEditingCoupon(null); setCouponForm(emptyCoupon); setCouponBrandId(selectedBrandId); }}>Цуцлах</button>}</div>
        <label className="grid gap-1 text-sm font-semibold">Брэнд<select value={couponBrandId || selectedBrandId || ""} onChange={(event) => setCouponBrandId(event.target.value)} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700">{brands.filter((brand) => !brand.archived_at).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        <input required value={couponForm.name} onChange={(event) => setCouponForm({ ...couponForm, name: event.target.value })} placeholder="Купоны нэр" className="w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
        <textarea value={couponForm.description} onChange={(event) => setCouponForm({ ...couponForm, description: event.target.value })} placeholder="Тайлбар" className="min-h-20 w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
        <label className="grid gap-1 text-sm font-semibold">Хөнгөлөлтийн төрөл<select value={couponForm.value_type} onChange={(event) => setCouponForm({ ...couponForm, value_type: event.target.value as "amount" | "percentage" })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700"><option value="amount">Дүн — {couponForm.country_code === "mn" ? "MNT" : "RUB"}</option><option value="percentage">Хувь — %</option></select></label>
        <input required min="0.01" max={couponForm.value_type === "percentage" ? "100" : undefined} step="0.01" type="number" value={couponForm.discount_value} onChange={(event) => setCouponForm({ ...couponForm, discount_value: event.target.value })} placeholder={couponForm.value_type === "percentage" ? "Хувь" : "Хөнгөлөлтийн дүн"} className="w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">OYUNS+ үнэ<input required min="1" type="number" value={couponForm.points_price || ""} onChange={(event) => setCouponForm({ ...couponForm, points_price: Number(event.target.value) })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label><label className="grid gap-1 text-sm font-semibold">Улс<select value={couponForm.country_code} onChange={(event) => setCouponForm({ ...couponForm, country_code: event.target.value as "mn" | "ru" })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700"><option value="mn">MN — Монгол</option><option value="ru">RU — Орос</option></select></label></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Нийт лимит<input min="1" type="number" value={couponForm.total_purchase_limit} onChange={(event) => setCouponForm({ ...couponForm, total_purchase_limit: event.target.value })} placeholder="Хязгааргүй" className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label><label className="grid gap-1 text-sm font-semibold">Дуусах хугацаа<input type="datetime-local" value={couponForm.expires_at} onChange={(event) => setCouponForm({ ...couponForm, expires_at: event.target.value })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={couponForm.is_active} onChange={(event) => setCouponForm({ ...couponForm, is_active: event.target.checked })} />Идэвхтэй</label>
        {error && <p className="text-sm text-red-600">{error}</p>}<button disabled={saveCoupon.isPending} className="inline-flex items-center gap-2 rounded-xl bg-maroon-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{editingCoupon ? "Хадгалах" : "Үүсгэх"}</button>
      </form>
      {couponsQuery.isError ? <p className="text-sm text-red-600">Купон ачаалж чадсангүй.</p> : coupons.length === 0 ? <AdminEmptyState>Купон бүртгэгдээгүй байна</AdminEmptyState> : <div className="space-y-2">{coupons.map((coupon) => <div key={coupon.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-dark-600 dark:bg-dark-800"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{coupon.name}</p><p className="text-xs text-slate-500">{formatCouponValue(coupon)} · {coupon.points_price.toLocaleString()} оноо · {coupon.needs_review ? "Шалгах шаардлагатай" : coupon.is_active ? "идэвхтэй" : "идэвхгүй"}</p></div>{coupon.needs_review && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">Review</span>}<button type="button" title="Засах" onClick={() => startCouponEdit(coupon)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => archiveCoupon.mutate(coupon)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title={coupon.archived_at ? "Сэргээх" : "Архивлах"}>{coupon.archived_at ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</button></div>)}</div>}
    </div>;
  }

  return <div className="space-y-4">
    <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-dark-600 dark:bg-dark-800" onSubmit={(event) => { event.preventDefault(); saveBrand.mutate(); }}>
      <div className="flex items-center justify-between"><h3 className="font-semibold">{editingBrand ? "Брэнд засах" : "Шинэ брэнд"}</h3>{editingBrand && <button type="button" className="text-xs text-slate-500" onClick={() => { setEditingBrand(null); setBrandForm(emptyBrand); setLogoFile(null); }}>Цуцлах</button>}</div>
      <input required value={brandForm.name} onChange={(event) => setBrandForm({ ...brandForm, name: event.target.value })} placeholder="Брэндийн нэр" className="w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
      <textarea value={brandForm.description} onChange={(event) => setBrandForm({ ...brandForm, description: event.target.value })} placeholder="Тайлбар" className="min-h-20 w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Эрэмбэ<input min="0" type="number" value={brandForm.sort_order} onChange={(event) => setBrandForm({ ...brandForm, sort_order: Number(event.target.value) })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label><label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm"><Upload className="h-4 w-4" />{logoFile ? logoFile.name : brandForm.logo_url ? "Лого солих" : "Лого оруулах"}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) setLogoFile(file); event.currentTarget.value = ""; }} /></label></div>
      {brandForm.logo_url && <img src={brandForm.logo_url} alt="" className="h-20 w-20 rounded-2xl object-contain" />}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={brandForm.is_active} onChange={(event) => setBrandForm({ ...brandForm, is_active: event.target.checked })} />Идэвхтэй</label>
      {error && <p className="text-sm text-red-600">{error}</p>}<button disabled={saveBrand.isPending} className="inline-flex items-center gap-2 rounded-xl bg-maroon-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{editingBrand ? "Хадгалах" : "Үүсгэх"}</button>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-2"><AdminSectionHeader icon={Archive} title={showArchive ? "Архив брэндүүд" : "Брэндүүд"} count={visibleBrands.length} action={<div className="flex items-center gap-2"><AdminRefreshButton onClick={() => void brandsQuery.refetch()} loading={brandsQuery.isFetching} label="Брэнд шинэчлэх" /><button type="button" onClick={() => setShowArchive(!showArchive)} className="text-xs font-semibold text-maroon-700">{showArchive ? "Идэвхтэйг харах" : "Архив харах"}</button></div>} /></div>
    {visibleBrands.length === 0 ? <AdminEmptyState>Брэнд бүртгэгдээгүй байна</AdminEmptyState> : <div className="space-y-2">{visibleBrands.map((brand) => <div key={brand.id} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left dark:border-dark-600 dark:bg-dark-800"><button type="button" onClick={() => setSelectedBrandId(brand.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-xs font-bold text-maroon-700">{brand.logo_url ? <img src={brand.logo_url} alt="" className="h-full w-full object-contain" /> : "VA"}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{brand.name}</span><span className="block text-xs text-slate-500">{brand.offer_count} купон · {brand.is_active ? "идэвхтэй" : "идэвхгүй"}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /></button><button type="button" title="Засах" onClick={() => startBrandEdit(brand)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button><button type="button" title={brand.archived_at ? "Сэргээх" : "Архивлах"} onClick={() => archiveBrand.mutate(brand)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">{brand.archived_at ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</button></div>)}</div>}
  </div>;
}

export function AdminOyunsPlusCards() {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}><AdminOyunsPlusCatalogContent /></QueryClientProvider>;
}
