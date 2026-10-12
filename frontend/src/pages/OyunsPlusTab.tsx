import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Gift, History, Loader2, Tag, TrendingDown, TrendingUp, Users } from "lucide-react";
import {
  createOyunsPlusVoucherRequest,
  fetchOyunsPlusBrandCoupons,
  fetchOyunsPlusBrands,
  fetchOyunsPlusHistory,
  fetchOyunsPlusSummary,
  OyunsPlusBrand,
  OyunsPlusCoupon,
  OyunsPlusHistoryEntry,
} from "../api";
import { SuccessCheck } from "../components/SuccessCheck";
import { useLang } from "../i18n/useLang";
import { queryKeys } from "../queryKeys";
import { OyunsPlusSkeleton } from "../components/Skeleton";
import { OyunsPlusMembershipCard } from "../components/OyunsPlusMembershipCard";
import { BrandAbout, BrandLogo, BrandPage, BrandTab, BrandTile, CouponCard, CouponsEmpty, CouponViewSwitch, formatCouponValue, formatPoints, PointsMark, useCouponViewMode, useFavoriteBrands } from "../components/OyunsPlusCatalog";

interface Props {
  userId?: number;
  userName?: string;
  verificationLevel?: number;
  emailVerificationPending?: boolean;
  emailAddress?: string;
  isProfileLoading?: boolean;
  isProfileResolved?: boolean;
}

function getErrorMessage(error: unknown, fallback: string, t: (key: string) => string) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") {
    if (detail === "INSUFFICIENT_POINTS") return fallback;
    if (detail === "CARD_SOLD_OUT") return t("oyuns_plus.sold_out");
    if (detail === "CARD_EXPIRED") return t("oyuns_plus.expired");
    return detail;
  }
  return fallback;
}

function normalizePhone(value: string, countryCode: "mn" | "ru") {
  const digits = value.replace(/\D/g, "");
  if (countryCode === "mn" && digits.startsWith("976") && digits.length === 11 && /^[6-9]/.test(digits.slice(3))) return `+976${digits.slice(3)}`;
  if (countryCode === "ru" && digits.length === 11 && /^[78]9/.test(digits)) return `+7${digits.slice(1)}`;
  if (countryCode === "ru" && digits.length === 10 && /^9/.test(digits)) return `+7${digits}`;
  if (countryCode === "mn" && digits.length === 8 && /^[6-9]/.test(digits)) return `+976${digits}`;
  return "";
}

function validReceiverPhone(value: string, countryCode: "mn" | "ru") {
  return normalizePhone(value, countryCode) !== "";
}

function formatDate(value: string | null | undefined, lang: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(lang === "mn" ? "mn-MN" : "ru-RU", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function historyLabel(entry: OyunsPlusHistoryEntry, t: (key: string, params?: Record<string, string | number>) => string) {
  if (entry.transaction_type === "redeemed") return t("oyuns_plus.history_redeemed", { name: entry.voucher_name || t("oyuns_plus.voucher") });
  if (entry.transaction_type === "refunded") return t("oyuns_plus.history_refunded", { name: entry.voucher_name || t("oyuns_plus.voucher") });
  if (entry.source_type === "referral_kyc_approved") return t("oyuns_plus.history_source_referral");
  if (entry.source_type === "gift_completed") return t("oyuns_plus.history_source_gift");
  if (entry.source_type === "fuel_order_completed") return t("oyuns_plus.history_source_fuel");
  return t("oyuns_plus.history_source_exchange");
}

export function OyunsPlusTab({ userId, userName = "", isProfileLoading = false }: Props) {
  const { t, lang } = useLang();
  const queryClient = useQueryClient();
  const [selectedBrand, setSelectedBrand] = useState<OyunsPlusBrand | null>(null);
  const [selectedCoupon, setSelectedCoupon] = useState<OyunsPlusCoupon | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [formError, setFormError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState<{ name: string; balance: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [brandTab, setBrandTab] = useState<BrandTab>("coupons");
  const [couponView, setCouponView] = useCouponViewMode();
  const { favorites, toggle: toggleFavorite } = useFavoriteBrands();

  const summaryQuery = useQuery({ queryKey: userId ? queryKeys.oyunsPlus.summary(userId) : ["oyuns-plus", "summary", "anonymous"], queryFn: fetchOyunsPlusSummary, enabled: Boolean(userId), staleTime: 0 });
  const brandsQuery = useQuery({ queryKey: queryKeys.oyunsPlus.brands, queryFn: fetchOyunsPlusBrands, enabled: Boolean(userId) && !selectedBrand, staleTime: 0, refetchOnMount: "always" });
  const couponsQuery = useQuery({ queryKey: selectedBrand ? queryKeys.oyunsPlus.brandCoupons(selectedBrand.id) : ["oyuns-plus", "brands", "none", "coupons"], queryFn: () => fetchOyunsPlusBrandCoupons(selectedBrand!.id), enabled: Boolean(userId && selectedBrand), staleTime: 0, refetchOnMount: "always" });
  const historyQuery = useQuery({ queryKey: userId ? queryKeys.oyunsPlus.history(userId) : ["oyuns-plus", "history", "anonymous"], queryFn: fetchOyunsPlusHistory, enabled: Boolean(userId) && showSettings, staleTime: 0 });

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && userId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.summary(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.history(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.brands });
        if (selectedBrand) void queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.brandCoupons(selectedBrand.id) });
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [queryClient, selectedBrand, userId]);

  const requestMutation = useMutation({
    mutationFn: createOyunsPlusVoucherRequest,
    onSuccess: async (result) => {
      setRequestSuccess({ name: result.card_name, balance: result.balance_after });
      setShowForm(false); setReceiverName(""); setReceiverPhone(""); setFormError("");
      if (userId) {
        queryClient.setQueryData(queryKeys.oyunsPlus.summary(userId), (current: typeof summaryQuery.data) => current ? { ...current, points_balance: result.balance_after } : current);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.summary(userId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.history(userId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.brands }),
          ...(selectedBrand ? [queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.brandCoupons(selectedBrand.id) })] : []),
        ]);
      }
    },
    onError: (error) => {
      setFormError(getErrorMessage(error, t("oyuns_plus.purchase_error"), t));
      if (selectedBrand) void queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.brandCoupons(selectedBrand.id) });
    },
  });

  if (isProfileLoading) return <div aria-busy="true"><OyunsPlusSkeleton /></div>;

  const balance = summaryQuery.data?.points_balance ?? 0;
  // Favorites float to the top; the stable sort keeps the admin-defined order within each group.
  const brands = [...(brandsQuery.data?.brands || [])].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  const coupons = couponsQuery.data?.coupons || [];
  const selectedBrandData = couponsQuery.data?.brand || selectedBrand;

  const openBrand = (brand: OyunsPlusBrand) => { setSelectedBrand(brand); setBrandTab("coupons"); setSelectedCoupon(null); setRequestSuccess(null); setFormError(""); window.scrollTo({ top: 0 }); };
  const openCoupon = (coupon: OyunsPlusCoupon) => { setSelectedCoupon(coupon); setShowForm(false); setRequestSuccess(null); setFormError(""); };
  const backFromCoupon = () => { setSelectedCoupon(null); setRequestSuccess(null); setFormError(""); };
  const backFromBrand = () => { setSelectedCoupon(null); setSelectedBrand(null); };

  const submitRequest = () => {
    if (!selectedCoupon) return;
    if (!receiverName.trim()) { setFormError(t("oyuns_plus.receiver_name_required")); return; }
    if (!validReceiverPhone(receiverPhone, selectedCoupon.country_code)) { setFormError(t("oyuns_plus.receiver_phone_invalid")); return; }
    setFormError("");
    requestMutation.mutate({ card_id: selectedCoupon.id, receiver_name: receiverName.trim(), receiver_phone: normalizePhone(receiverPhone, selectedCoupon.country_code) });
  };

  const copyReferral = () => {
    if (!summaryQuery.data?.referral_code) return;
    void navigator.clipboard.writeText(summaryQuery.data.referral_code).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); });
  };

  return <div className="oyuns-plus-page space-y-4">
    {!selectedBrand && !selectedCoupon && <div className="oyuns-plus-balance-sticky oyuns-plus-membership-hero">
      <OyunsPlusMembershipCard
        cardHolder={userName}
        points={summaryQuery.isLoading ? "—" : balance}
        earnedPoints={summaryQuery.isLoading ? "—" : summaryQuery.data?.points_earned_total ?? balance}
        spentPoints={summaryQuery.data?.points_spent_total ?? 0}
        referralCode={summaryQuery.data?.referral_code || ""}
        invitedCount={summaryQuery.data?.invited_total ?? 0}
        onDetailsOpen={() => setShowSettings(true)}
      />
    </div>}

    {showSettings ? <section className="oyuns-plus-settings-view" aria-label={t("oyuns_plus.settings_title")}>
      <button type="button" onClick={() => setShowSettings(false)} className="oyuns-plus-back-button"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
      <div className="oyuns-plus-settings-card"><div className="flex items-center gap-2"><PointsMark className="oyuns-plus-settings-points-mark" /><h2>{t("oyuns_plus.settings_title")}</h2></div><div className="oyuns-plus-settings-stats"><div><span>{t("profile.oyuns_points")}</span><strong>{formatPoints(balance)} <PointsMark /></strong></div><div><span><Users className="inline h-3 w-3" /> {t("oyuns_plus.settings_invited")}</span><strong>{summaryQuery.data?.invited_verified ?? 0}/{summaryQuery.data?.invited_total ?? 0}</strong></div></div></div>
      {summaryQuery.data?.referral_code && <div className="oyuns-plus-panel"><div className="oyuns-plus-panel-title">{t("oyuns_plus.settings_referral_code")}</div><div className="flex gap-2"><code className="flex-1 rounded-xl bg-surface-100 px-3 py-2 font-bold tracking-widest dark:bg-dark-700">{summaryQuery.data.referral_code}</code><button type="button" onClick={copyReferral} className="oyuns-plus-secondary-button">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button></div></div>}
      <div className="oyuns-plus-panel"><div className="oyuns-plus-panel-title flex items-center gap-2"><History className="h-4 w-4" /> {t("oyuns_plus.history_title")}</div>{historyQuery.isLoading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-maroon-600" /></div> : historyQuery.isError ? <div className="oyuns-plus-error">{t("oyuns_plus.history_error")}</div> : !historyQuery.data?.entries.length ? <div className="oyuns-plus-empty">{t("oyuns_plus.history_empty")}</div> : <div className="space-y-2">{historyQuery.data.entries.map((entry, index) => <HistoryRow key={entry.id || index} entry={entry} lang={lang} t={t} />)}</div>}</div>
    </section> : selectedCoupon && selectedBrandData ? <section className="oyuns-plus-detail-view">
      <button type="button" onClick={backFromCoupon} className="oyuns-plus-back-button"><ArrowLeft className="h-4 w-4" /> {selectedBrandData.name}</button>
      <div className="oyuns-plus-detail-card oyuns-plus-coupon-detail-card"><div className="oyuns-plus-coupon-detail-brand"><BrandLogo brand={selectedBrandData} size="sm" /><span>{selectedBrandData.name}</span></div><div className="oyuns-plus-detail-content"><div className="oyuns-plus-detail-price"><span>{formatPoints(selectedCoupon.points_price)}</span><PointsMark /></div><div className="oyuns-plus-discount-badge"><Tag className="h-3.5 w-3.5" /> {formatCouponValue(selectedCoupon)}</div>{selectedCoupon.badge_label && <div className="oyuns-plus-coupon-badge oyuns-plus-coupon-badge--detail">{selectedCoupon.badge_label}</div>}<h2>{selectedCoupon.name}</h2><p>{selectedCoupon.description || t("oyuns_plus.no_description")}</p>{selectedCoupon.expires_at && <div className="oyuns-plus-expiry">{t("oyuns_plus.expires", { date: formatDate(selectedCoupon.expires_at, lang) })}</div>}
        {requestSuccess ? <div className="oyuns-plus-success" role="status"><SuccessCheck /><strong>{t("oyuns_plus.request_success")}</strong><span>{t("oyuns_plus.request_success_balance", { balance: formatPoints(requestSuccess.balance) })}</span></div> : <><button type="button" disabled={selectedCoupon.is_sold_out || balance < selectedCoupon.points_price || requestMutation.isPending} onClick={() => setShowForm((value) => !value)} className="oyuns-plus-primary-button disabled:cursor-not-allowed disabled:opacity-50">{selectedCoupon.is_sold_out ? t("oyuns_plus.sold_out") : balance < selectedCoupon.points_price ? t("oyuns_plus.points_shortfall", { points: formatPoints(selectedCoupon.points_price - balance) }) : requestMutation.isPending ? t("oyuns_plus.submitting") : <><span>{formatPoints(selectedCoupon.points_price)}</span><PointsMark /></>}</button>{showForm && <div className="oyuns-plus-receiver-form"><label>{t("oyuns_plus.receiver_name")}<input value={receiverName} onChange={(event) => setReceiverName(event.target.value)} autoComplete="name" /></label><label>{t("oyuns_plus.receiver_phone")}<input value={receiverPhone} onChange={(event) => setReceiverPhone(event.target.value)} inputMode="tel" placeholder="Утасны дугаар" /></label>{formError && <div className="oyuns-plus-error" role="alert">{formError}</div>}<button type="button" onClick={submitRequest} disabled={requestMutation.isPending} className="oyuns-plus-primary-button">{requestMutation.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("oyuns_plus.submit_request")}</button></div>}</>}
      </div></div>
    </section> : selectedBrand && selectedBrandData ? <BrandPage brand={selectedBrandData} tab={brandTab} onTabChange={setBrandTab} favorite={favorites.includes(selectedBrandData.id)} onToggleFavorite={() => toggleFavorite(selectedBrandData.id)} onBack={backFromBrand} couponCount={couponsQuery.data ? coupons.length : selectedBrandData.offer_count} t={t}>
      {brandTab === "about" ? <BrandAbout brand={selectedBrandData} t={t} /> : <div role="tabpanel">
        <div className="oyuns-plus-coupon-toolbar"><span>{t("oyuns_plus.offer_count", { count: coupons.length })}</span><CouponViewSwitch mode={couponView} onChange={setCouponView} t={t} /></div>
        {couponsQuery.isError ? <div className="oyuns-plus-error">{t("oyuns_plus.coupons_error")}</div> : couponsQuery.isLoading ? <OyunsPlusSkeleton /> : coupons.length === 0 ? <CouponsEmpty t={t} /> : <div className={couponView === "grid" ? "oyuns-plus-coupon-grid" : "oyuns-plus-coupon-list"}>{coupons.map((coupon) => <CouponCard key={coupon.id} coupon={coupon} balance={balance} view={couponView} onOpen={() => openCoupon(coupon)} t={t} expiry={coupon.expires_at ? t("oyuns_plus.expires", { date: formatDate(coupon.expires_at, lang) }) : undefined} />)}</div>}
      </div>}
    </BrandPage> : <>{brandsQuery.isError ? <div className="oyuns-plus-error">{t("oyuns_plus.brands_error")}</div> : brandsQuery.isLoading ? <OyunsPlusSkeleton /> : brands.length === 0 ? <div className="oyuns-plus-empty-card"><Gift className="mx-auto mb-2 h-8 w-8 text-maroon-500" /><p>{t("oyuns_plus.brands_empty")}</p></div> : <div className="oyuns-plus-brand-grid">{brands.map((brand) => <BrandTile key={brand.id} brand={brand} balance={balance} favorite={favorites.includes(brand.id)} onOpen={() => openBrand(brand)} t={t} />)}</div>}<div className="oyuns-plus-note">{t("oyuns_plus.vouchers_note")}</div></>}
  </div>;
}

function HistoryRow({ entry, lang, t }: { entry: OyunsPlusHistoryEntry; lang: string; t: (key: string, params?: Record<string, string | number>) => string }) {
  const positive = entry.points >= 0;
  return <div className="oyuns-plus-history-row"><div className="flex min-w-0 items-start gap-2">{positive ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-[#00C885]" /> : <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-[#FF3B57]" />}<div className="min-w-0"><div className="truncate text-xs font-semibold">{historyLabel(entry, t)}</div><div className="text-[10px] text-slate-500">{formatDate(entry.created_at, lang)}</div></div></div><div className="text-right"><div className={`text-xs font-bold ${positive ? "text-[#00C885]" : "text-[#FF3B57]"}`}>{positive ? "+" : ""}{formatPoints(entry.points)}</div><div className="text-[10px] text-slate-500">{t("oyuns_plus.balance_after", { balance: formatPoints(entry.balance_after) })}</div></div></div>;
}
