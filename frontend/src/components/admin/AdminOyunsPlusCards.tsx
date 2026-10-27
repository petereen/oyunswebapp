import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ChevronRight, Facebook, Globe, ImagePlus, Instagram, MapPin, Pencil, Phone, Plus, RotateCcw, X } from "lucide-react";
import {
  archiveAdminOyunsPlusBrand,
  archiveAdminOyunsPlusCoupon,
  createAdminOyunsPlusBrand,
  createAdminOyunsPlusCoupon,
  fetchAdminOyunsPlusBrandCoupons,
  fetchAdminOyunsPlusBrands,
  fetchAdminOyunsPlusPartnerConfig,
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
import { parseServerDate, ubDateParts, ubLocalInputToIso } from "../../utils/time";

const emptyBrand = { name: "", description: "", logo_url: "", logo_path: null as string | null, cover_url: "", cover_path: null as string | null, category: "", address: "", map_url: "", website_url: "", instagram_url: "", facebook_url: "", phone: "", is_active: true, sort_order: 0 };
type BrandForm = typeof emptyBrand;
// Optional profile rows: anything left blank is hidden on the user-facing brand page.
const contactFields: { key: "address" | "map_url" | "website_url" | "instagram_url" | "facebook_url" | "phone"; label: string; placeholder: string; icon: typeof Globe; inputMode?: "url" | "tel" }[] = [
  { key: "address", label: "Хаяг", placeholder: "СБД, 1-р хороо, ...", icon: MapPin },
  { key: "map_url", label: "Газрын зургийн холбоос", placeholder: "https://maps.app.goo.gl/...", icon: MapPin, inputMode: "url" },
  { key: "website_url", label: "Вэбсайт", placeholder: "example.mn", icon: Globe, inputMode: "url" },
  { key: "instagram_url", label: "Instagram", placeholder: "https://instagram.com/brand", icon: Instagram, inputMode: "url" },
  { key: "facebook_url", label: "Facebook", placeholder: "https://facebook.com/brand", icon: Facebook, inputMode: "url" },
  { key: "phone", label: "Утас", placeholder: "+976 9911 2233", icon: Phone, inputMode: "tel" },
];
const emptyCoupon = { issuance_mode: "manual" as "manual" | "automatic", sku_tier: "", validity_days: 30, name: "", description: "", badge_label: "", value_type: "amount" as "amount" | "percentage", discount_value: "", points_price: 0, country_code: "mn" as "mn" | "ru", total_purchase_limit: "", expires_at: "", is_active: true };
const validLogo = (file: File) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 2 * 1024 * 1024;

// datetime-local inputs are edited in Ulaanbaatar time.
function toLocalDateTime(value?: string | null) {
  const date = parseServerDate(value);
  if (!date) return "";
  const p = ubDateParts(date);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function formatCouponValue(coupon: OyunsPlusCoupon) {
  const value = Number(coupon.discount_value || 0).toLocaleString();
  return coupon.value_type === "percentage" ? `${value}%` : `${value} ${coupon.currency_code || (coupon.country_code === "mn" ? "MNT" : "RUB")}`;
}

function BrandImageField({ label, hint, file, currentUrl, onFile, onClear, previewClassName }: { label: string; hint: string; file: File | null; currentUrl: string; onFile: (file: File) => void; onClear?: () => void; previewClassName: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setPreview(null); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const shown = preview || currentUrl;
  return <div className="grid gap-2 text-sm">
    <span className="font-semibold">{label}</span>
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3"><ImagePlus className="h-4 w-4" />{file ? file.name : currentUrl ? `${label} солих` : `${label} оруулах`}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { const next = event.target.files?.[0]; if (next) onFile(next); event.currentTarget.value = ""; }} /></label>
    <span className="text-xs text-slate-500">{hint}</span>
    {shown && <div className="flex items-center gap-2"><img src={shown} alt="" className={previewClassName} />{onClear && <button type="button" onClick={onClear} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"><X className="h-3.5 w-3.5" />Устгах</button>}</div>}
  </div>;
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
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [error, setError] = useState("");

  const partnerConfig = useQuery({ queryKey: ["admin", "oyuns-plus", "partner-config"], queryFn: fetchAdminOyunsPlusPartnerConfig });
  const brandsQuery = useQuery({ queryKey: queryKeys.admin.oyunsPlusBrands, queryFn: () => fetchAdminOyunsPlusBrands(true) });
  const couponsQuery = useQuery({ queryKey: selectedBrandId ? queryKeys.admin.oyunsPlusBrandCoupons(selectedBrandId) : ["admin", "oyuns-plus", "brands", "none", "coupons"], queryFn: () => fetchAdminOyunsPlusBrandCoupons(selectedBrandId!, true), enabled: Boolean(selectedBrandId) });
  const brands = brandsQuery.data?.brands ?? [];
  const visibleBrands = brands.filter((brand) => Boolean(brand.archived_at) === showArchive);
  const selectedBrand = brands.find((brand) => brand.id === selectedBrandId) || null;
  const coupons = couponsQuery.data?.coupons ?? [];

  const uploadBrandImage = async (brandId: string, file: File, assetType: "brand_logo" | "brand_cover") => {
    if (!validLogo(file)) throw new Error("JPG, PNG эсвэл WebP зураг 2MB-аас бага байх ёстой.");
    const prepared = await prepareImageForUpload(file);
    const signed = await presignAdminOyunsPlusUpload({ asset_type: assetType, brand_id: brandId, extension: prepared.extension as "jpg" | "jpeg" | "png" | "webp", mime_type: prepared.mimeType as "image/jpeg" | "image/png" | "image/webp" });
    const response = await fetch(signed.upload_url, { method: "PUT", body: prepared.file, headers: { "Content-Type": prepared.mimeType } });
    if (!response.ok) throw new Error(assetType === "brand_logo" ? "Logo upload failed" : "Cover upload failed");
    return { url: signed.public_url || "", path: signed.path };
  };
  const uploadPendingImages = async (brandId: string) => {
    const updates: Partial<BrandForm> = {};
    if (logoFile) { const logo = await uploadBrandImage(brandId, logoFile, "brand_logo"); updates.logo_url = logo.url; updates.logo_path = logo.path; }
    if (coverFile) { const cover = await uploadBrandImage(brandId, coverFile, "brand_cover"); updates.cover_url = cover.url; updates.cover_path = cover.path; }
    return updates;
  };

  const saveBrand = useMutation({
    mutationFn: async () => {
      setError("");
      if (!brandForm.name.trim()) throw new Error("Брэндийн нэр шаардлагатай.");
      if (!editingBrand && brandForm.is_active && !logoFile) throw new Error("Идэвхтэй брэндэд лого оруулна уу.");
      if (editingBrand) return updateAdminOyunsPlusBrand(editingBrand, { ...brandForm, ...(await uploadPendingImages(editingBrand)) });
      const created = await createAdminOyunsPlusBrand({ ...brandForm, logo_url: null, logo_path: null, cover_url: null, cover_path: null, is_active: false });
      const uploaded = await uploadPendingImages(created.id);
      if (Object.keys(uploaded).length > 0 || brandForm.is_active) return updateAdminOyunsPlusBrand(created.id, { ...uploaded, is_active: brandForm.is_active });
      return created;
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrands }); resetBrandForm(); },
    onError: (mutationError: unknown) => setError(mutationError instanceof Error ? mutationError.message : "Брэнд хадгалахад алдаа гарлаа."),
  });

  const saveCoupon = useMutation({
    mutationFn: () => {
      const targetBrandId = couponBrandId || selectedBrandId;
      if (!targetBrandId || !couponForm.name.trim()) throw new Error("Брэнд болон купоны нэр шаардлагатай.");
      const discount = Number(couponForm.discount_value);
      if (!Number.isFinite(discount) || discount <= 0 || (couponForm.value_type === "percentage" && discount > 100)) throw new Error("Хөнгөлөлтийн утгыг зөв оруулна уу.");
      if (couponForm.issuance_mode === "automatic" && (!partnerConfig.data?.enabled || targetBrandId !== partnerConfig.data.brand_id)) throw new Error("Automatic зөвхөн тохируулсан түнш брэндэд боломжтой.");
      const payload = { issuance_mode: couponForm.issuance_mode, sku_tier: couponForm.issuance_mode === "automatic" ? couponForm.sku_tier.trim() : null, validity_days: couponForm.issuance_mode === "automatic" ? couponForm.validity_days : null, brand_id: targetBrandId, name: couponForm.name.trim(), description: couponForm.description.trim(), badge_label: couponForm.badge_label.trim() || null, value_type: couponForm.value_type, discount_value: discount, points_price: Number(couponForm.points_price), country_code: couponForm.country_code, total_purchase_limit: couponForm.total_purchase_limit ? Number(couponForm.total_purchase_limit) : null, expires_at: ubLocalInputToIso(couponForm.expires_at) ?? null, is_active: couponForm.is_active };
      return editingCoupon ? updateAdminOyunsPlusCoupon(editingCoupon, payload) : createAdminOyunsPlusCoupon(payload);
    },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrandCoupons(selectedBrandId || "") }); if (couponBrandId) void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrandCoupons(couponBrandId) }); void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrands }); setCouponForm(emptyCoupon); setCouponBrandId(selectedBrandId); setEditingCoupon(null); },
    onError: (mutationError: unknown) => setError(mutationError instanceof Error ? mutationError.message : "Купон хадгалахад алдаа гарлаа."),
  });

  const archiveBrand = useMutation({ mutationFn: (brand: OyunsPlusBrand) => brand.archived_at ? restoreAdminOyunsPlusBrand(brand.id) : archiveAdminOyunsPlusBrand(brand.id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrands }); void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrandCoupons(selectedBrandId || "") }); } });
  const archiveCoupon = useMutation({ mutationFn: (coupon: OyunsPlusCoupon) => coupon.archived_at ? restoreAdminOyunsPlusCoupon(coupon.id) : archiveAdminOyunsPlusCoupon(coupon.id), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrandCoupons(selectedBrandId || "") }); void queryClient.invalidateQueries({ queryKey: queryKeys.admin.oyunsPlusBrands }); } });

  const resetBrandForm = () => { setBrandForm(emptyBrand); setEditingBrand(null); setLogoFile(null); setCoverFile(null); setError(""); };
  const startBrandEdit = (brand: OyunsPlusBrand) => { setEditingBrand(brand.id); setBrandForm({ name: brand.name, description: brand.description, logo_url: brand.logo_url || "", logo_path: brand.logo_path || null, cover_url: brand.cover_url || "", cover_path: brand.cover_path || null, category: brand.category || "", address: brand.address || "", map_url: brand.map_url || "", website_url: brand.website_url || "", instagram_url: brand.instagram_url || "", facebook_url: brand.facebook_url || "", phone: brand.phone || "", is_active: brand.is_active, sort_order: brand.sort_order }); setLogoFile(null); setCoverFile(null); setError(""); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const startCouponEdit = (coupon: OyunsPlusCoupon) => { setEditingCoupon(coupon.id); setCouponBrandId(coupon.brand_id); setCouponForm({ issuance_mode: coupon.issuance_mode || "manual", sku_tier: coupon.sku_tier || "", validity_days: coupon.validity_days || 30, name: coupon.name, description: coupon.description, badge_label: coupon.badge_label || "", value_type: coupon.value_type || "amount", discount_value: coupon.discount_value == null ? "" : String(coupon.discount_value), points_price: coupon.points_price, country_code: coupon.country_code, total_purchase_limit: coupon.total_purchase_limit == null ? "" : String(coupon.total_purchase_limit), expires_at: toLocalDateTime(coupon.expires_at), is_active: coupon.is_active }); setError(""); };

  if (selectedBrand) {
    return <div className="space-y-4">
      <button type="button" onClick={() => { setSelectedBrandId(null); setEditingCoupon(null); setCouponForm(emptyCoupon); setCouponBrandId(null); }} className="inline-flex items-center gap-1 text-sm font-semibold text-maroon-700"><ArrowLeft className="h-4 w-4" /> Брэндүүд</button>
      <AdminSectionHeader icon={Archive} title={selectedBrand.name} count={coupons.length} action={<AdminRefreshButton onClick={() => void couponsQuery.refetch()} loading={couponsQuery.isFetching} label="Купон шинэчлэх" />} />
      <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-dark-600 dark:bg-dark-800" onSubmit={(event) => { event.preventDefault(); saveCoupon.mutate(); }}>
        <div className="flex items-center justify-between"><h3 className="font-semibold">{editingCoupon ? "Купон засах" : "Шинэ купон"}</h3>{editingCoupon && <button type="button" className="text-xs text-slate-500" onClick={() => { setEditingCoupon(null); setCouponForm(emptyCoupon); setCouponBrandId(selectedBrandId); }}>Цуцлах</button>}</div>
        <label className="grid gap-1 text-sm font-semibold">Код олгох төрөл<select value={couponForm.issuance_mode} onChange={(event) => setCouponForm({ ...couponForm, issuance_mode: event.target.value as "manual" | "automatic" })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700"><option value="manual">Manual</option><option value="automatic" disabled={!partnerConfig.data?.enabled || (couponBrandId || selectedBrandId) !== partnerConfig.data.brand_id}>Automatic</option></select></label>
        {partnerConfig.isPending && <p role="status" className="text-xs text-slate-500">Түншийн тохиргоог шалгаж байна…</p>}
        {!partnerConfig.isPending && !partnerConfig.isError && !partnerConfig.data?.enabled && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Automatic тохиргоо идэвхгүй байна. Серверт PARTNER_BRAND_ID болон PARTNER_API_KEY тохируулсны дараа ашиглах боломжтой.</p>}
        {partnerConfig.data?.enabled && (couponBrandId || selectedBrandId) !== partnerConfig.data.brand_id && <p role="status" className="text-xs text-amber-700 dark:text-amber-300">Automatic зөвхөн түншийн тохируулсан брэндэд боломжтой. Одоогийн брэнд: {selectedBrand.name}.</p>}
        {partnerConfig.isError && <p role="status" className="text-xs text-red-600">Түншийн тохиргоог шалгаж чадсангүй. Админ API холболтоо шалгаад хуудсыг дахин ачаална уу.</p>}
        {couponForm.issuance_mode === "automatic" && <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">SKU tier<input required maxLength={80} pattern="[a-z][a-z0-9_]{0,79}" placeholder="vpn_premium_3m" value={couponForm.sku_tier} onChange={(event) => setCouponForm({ ...couponForm, sku_tier: event.target.value })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label><label className="grid gap-1 text-sm font-semibold">Код хүчинтэй хоног<input required type="number" min="1" max="3650" value={couponForm.validity_days} onChange={(event) => setCouponForm({ ...couponForm, validity_days: Number(event.target.value) })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label></div>}
        <label className="grid gap-1 text-sm font-semibold">Брэнд<select value={couponBrandId || selectedBrandId || ""} onChange={(event) => setCouponBrandId(event.target.value)} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700">{brands.filter((brand) => !brand.archived_at).map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></label>
        <input required value={couponForm.name} onChange={(event) => setCouponForm({ ...couponForm, name: event.target.value })} placeholder="Купоны нэр" className="w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
        <textarea value={couponForm.description} onChange={(event) => setCouponForm({ ...couponForm, description: event.target.value })} placeholder="Тайлбар" className="min-h-20 w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
        <label className="grid gap-1 text-sm font-semibold">Тэмдэглэгээ (заавал биш)<input maxLength={40} value={couponForm.badge_label} onChange={(event) => setCouponForm({ ...couponForm, badge_label: event.target.value })} placeholder="Жишээ: Хэмнэлт 10%" className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /><span className="text-xs font-normal text-slate-500">Купоны картын зүүн дээд буланд харагдана. Хоосон бол харуулахгүй.</span></label>
        <label className="grid gap-1 text-sm font-semibold">Хөнгөлөлтийн төрөл<select value={couponForm.value_type} onChange={(event) => setCouponForm({ ...couponForm, value_type: event.target.value as "amount" | "percentage" })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700"><option value="amount">Дүн — {couponForm.country_code === "mn" ? "MNT" : "RUB"}</option><option value="percentage">Хувь — %</option></select></label>
        <input required min="0.01" max={couponForm.value_type === "percentage" ? "100" : undefined} step="0.01" type="number" value={couponForm.discount_value} onChange={(event) => setCouponForm({ ...couponForm, discount_value: event.target.value })} placeholder={couponForm.value_type === "percentage" ? "Хувь" : "Хөнгөлөлтийн дүн"} className="w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">OYUNS+ үнэ<input required min="1" type="number" value={couponForm.points_price || ""} onChange={(event) => setCouponForm({ ...couponForm, points_price: Number(event.target.value) })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label><label className="grid gap-1 text-sm font-semibold">Улс<select value={couponForm.country_code} onChange={(event) => setCouponForm({ ...couponForm, country_code: event.target.value as "mn" | "ru" })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700"><option value="mn">MN — Монгол</option><option value="ru">RU — Орос</option></select></label></div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Нийт лимит<input min="1" type="number" value={couponForm.total_purchase_limit} onChange={(event) => setCouponForm({ ...couponForm, total_purchase_limit: event.target.value })} placeholder="Хязгааргүй" className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label><label className="grid gap-1 text-sm font-semibold">Дуусах хугацаа<input type="datetime-local" value={couponForm.expires_at} onChange={(event) => setCouponForm({ ...couponForm, expires_at: event.target.value })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={couponForm.is_active} onChange={(event) => setCouponForm({ ...couponForm, is_active: event.target.checked })} />Идэвхтэй</label>
        {error && <p className="text-sm text-red-600">{error}</p>}<button disabled={saveCoupon.isPending} className="inline-flex items-center gap-2 rounded-xl bg-maroon-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{editingCoupon ? "Хадгалах" : "Үүсгэх"}</button>
      </form>
      {couponsQuery.isError ? <p className="text-sm text-red-600">Купон ачаалж чадсангүй.</p> : coupons.length === 0 ? <AdminEmptyState>Купон бүртгэгдээгүй байна</AdminEmptyState> : <div className="space-y-2">{coupons.map((coupon) => <div key={coupon.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-dark-600 dark:bg-dark-800"><div className="min-w-0 flex-1"><p className="truncate font-semibold">{coupon.name}</p><p className="text-xs text-slate-500">{formatCouponValue(coupon)}{coupon.badge_label ? ` · ${coupon.badge_label}` : ""} · {coupon.points_price.toLocaleString()} оноо · {coupon.needs_review ? "Шалгах шаардлагатай" : coupon.is_active ? "идэвхтэй" : "идэвхгүй"}</p></div>{coupon.needs_review && <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">Review</span>}<button type="button" title="Засах" onClick={() => startCouponEdit(coupon)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button><button type="button" onClick={() => archiveCoupon.mutate(coupon)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title={coupon.archived_at ? "Сэргээх" : "Архивлах"}>{coupon.archived_at ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</button></div>)}</div>}
    </div>;
  }

  return <div className="space-y-4">
    <form className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-dark-600 dark:bg-dark-800" onSubmit={(event) => { event.preventDefault(); saveBrand.mutate(); }}>
      <div className="flex items-center justify-between"><h3 className="font-semibold">{editingBrand ? "Брэнд засах" : "Шинэ брэнд"}</h3>{editingBrand && <button type="button" className="text-xs text-slate-500" onClick={resetBrandForm}>Цуцлах</button>}</div>
      <input required value={brandForm.name} onChange={(event) => setBrandForm({ ...brandForm, name: event.target.value })} placeholder="Брэндийн нэр" className="w-full rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />
      <label className="grid gap-1 text-sm font-semibold">Ангилал<input maxLength={160} value={brandForm.category} onChange={(event) => setBrandForm({ ...brandForm, category: event.target.value })} placeholder="Фитнес клуб, Спорт" className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /><span className="text-xs font-normal text-slate-500">Таслалаар тусгаарлавал тус бүр тусдаа шошго болно.</span></label>
      <label className="grid gap-1 text-sm font-semibold">Байгууллагын тухай<textarea value={brandForm.description} onChange={(event) => setBrandForm({ ...brandForm, description: event.target.value })} placeholder="Тайлбар" className="min-h-24 w-full rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <BrandImageField label="Лого" hint="Дөрвөлжин, тунгалаг эсвэл цагаан дэвсгэртэй" file={logoFile} currentUrl={brandForm.logo_url} onFile={setLogoFile} previewClassName="h-20 w-20 rounded-2xl object-contain bg-slate-50" />
        <BrandImageField label="Нүүр зураг" hint="Хэвтээ зураг, 16:10 орчим" file={coverFile} currentUrl={brandForm.cover_url} onFile={setCoverFile} onClear={() => { setCoverFile(null); setBrandForm({ ...brandForm, cover_url: "", cover_path: null }); }} previewClassName="h-20 w-32 rounded-2xl object-cover" />
      </div>
      <fieldset className="space-y-2 rounded-xl border border-dashed border-slate-200 p-3 dark:border-dark-600">
        <legend className="px-1 text-sm font-semibold">Холбоо барих (заавал биш)</legend>
        <p className="text-xs text-slate-500">Хоосон үлдээсэн мөр хэрэглэгчид харагдахгүй.</p>
        {contactFields.map(({ key, label, placeholder, icon: Icon, inputMode }) => <label key={key} className="flex items-center gap-2 text-sm"><Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /><span className="sr-only">{label}</span><input value={brandForm[key]} inputMode={inputMode} onChange={(event) => setBrandForm({ ...brandForm, [key]: event.target.value })} placeholder={`${label} — ${placeholder}`} className="min-w-0 flex-1 rounded-xl border px-3 py-2 dark:border-dark-600 dark:bg-dark-700" />{brandForm[key] && <button type="button" onClick={() => setBrandForm({ ...brandForm, [key]: "" })} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label={`${label} арилгах`}><X className="h-4 w-4" /></button>}</label>)}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Эрэмбэ<input min="0" type="number" value={brandForm.sort_order} onChange={(event) => setBrandForm({ ...brandForm, sort_order: Number(event.target.value) })} className="rounded-xl border px-3 py-2 font-normal dark:border-dark-600 dark:bg-dark-700" /></label><label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={brandForm.is_active} onChange={(event) => setBrandForm({ ...brandForm, is_active: event.target.checked })} />Идэвхтэй</label></div>
      {error && <p className="text-sm text-red-600">{error}</p>}<button disabled={saveBrand.isPending} className="inline-flex items-center gap-2 rounded-xl bg-maroon-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Plus className="h-4 w-4" />{editingBrand ? "Хадгалах" : "Үүсгэх"}</button>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-2"><AdminSectionHeader icon={Archive} title={showArchive ? "Архив брэндүүд" : "Брэндүүд"} count={visibleBrands.length} action={<div className="flex items-center gap-2"><AdminRefreshButton onClick={() => void brandsQuery.refetch()} loading={brandsQuery.isFetching} label="Брэнд шинэчлэх" /><button type="button" onClick={() => setShowArchive(!showArchive)} className="text-xs font-semibold text-maroon-700">{showArchive ? "Идэвхтэйг харах" : "Архив харах"}</button></div>} /></div>
    {visibleBrands.length === 0 ? <AdminEmptyState>Брэнд бүртгэгдээгүй байна</AdminEmptyState> : <div className="space-y-2">{visibleBrands.map((brand) => <div key={brand.id} className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left dark:border-dark-600 dark:bg-dark-800"><button type="button" onClick={() => setSelectedBrandId(brand.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left"><span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-slate-100 text-xs font-bold text-maroon-700">{brand.logo_url ? <img src={brand.logo_url} alt="" className="h-full w-full object-contain" /> : "VA"}</span><span className="min-w-0 flex-1"><span className="block truncate font-semibold">{brand.name}</span><span className="block truncate text-xs text-slate-500">{brand.offer_count} купон · {brand.is_active ? "идэвхтэй" : "идэвхгүй"}{brand.category ? ` · ${brand.category}` : ""}{brand.cover_url ? "" : " · нүүр зураггүй"}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-400" /></button><button type="button" title="Засах" onClick={() => startBrandEdit(brand)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button><button type="button" title={brand.archived_at ? "Сэргээх" : "Архивлах"} onClick={() => archiveBrand.mutate(brand)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">{brand.archived_at ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}</button></div>)}</div>}
  </div>;
}

export function AdminOyunsPlusCards() {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}><AdminOyunsPlusCatalogContent /></QueryClientProvider>;
}
