import { useCallback, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, Facebook, Gift, Globe, Heart, Instagram, LayoutGrid, List, Lock, MapPin, Phone, Ticket } from "lucide-react";
import type { OyunsPlusBrand, OyunsPlusCoupon } from "../api";
import oyunsPlusPoints from "../assets/oyuns-plus-points.svg";

type Translate = (key: string, params?: Record<string, string | number>) => string;
export type CouponViewMode = "grid" | "list";
export type BrandTab = "about" | "coupons";
type CouponState = "available" | "locked" | "sold-out";

const FAVORITES_KEY = "oyuns-plus-favorite-brands";
const VIEW_MODE_KEY = "oyuns-plus-coupon-view";

// Storage can be unavailable in private webviews; favorites and view mode are conveniences only.
function readStorage(key: string) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function useFavoriteBrands() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { const parsed = JSON.parse(readStorage(FAVORITES_KEY) || "[]"); return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : []; } catch { return []; }
  });
  const toggle = useCallback((brandId: string) => {
    setFavorites((current) => {
      const next = current.includes(brandId) ? current.filter((id) => id !== brandId) : [...current, brandId];
      writeStorage(FAVORITES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  return { favorites, toggle };
}

export function useCouponViewMode() {
  const [mode, setMode] = useState<CouponViewMode>(() => readStorage(VIEW_MODE_KEY) === "list" ? "list" : "grid");
  const update = useCallback((next: CouponViewMode) => { setMode(next); writeStorage(VIEW_MODE_KEY, next); }, []);
  return [mode, update] as const;
}

export function formatPoints(value: number) {
  return value.toLocaleString("mn-MN");
}

export function formatCouponValue(coupon: OyunsPlusCoupon) {
  const value = Number(coupon.discount_value || 0);
  if (coupon.value_type === "percentage") return `${value.toLocaleString()}%`;
  const currency = coupon.currency_code || (coupon.country_code === "mn" ? "MNT" : "RUB");
  return `${value.toLocaleString()} ${currency === "MNT" ? "₮" : "₽"}`;
}

export function PointsMark({ className = "" }: { className?: string }) {
  return <img src={oyunsPlusPoints} alt="" aria-hidden="true" className={`oyuns-plus-points-mark ${className}`} />;
}

export function BrandLogo({ brand, size = "md" }: { brand: Pick<OyunsPlusBrand, "logo_url" | "name">; size?: "sm" | "md" | "lg" }) {
  const sizeClass = size === "md" ? "" : ` oyuns-plus-brand-logo--${size === "sm" ? "small" : "large"}`;
  if (brand.logo_url) return <img src={brand.logo_url} alt="" className={`oyuns-plus-brand-logo${sizeClass}`} />;
  const initials = brand.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "VA";
  return <span className={`oyuns-plus-brand-logo oyuns-plus-brand-logo--fallback${sizeClass}`} aria-hidden="true">{initials}</span>;
}

function brandTags(brand: OyunsPlusBrand) {
  return (brand.category || "").split(",").map((tag) => tag.trim()).filter(Boolean);
}

function couponState(coupon: OyunsPlusCoupon, balance: number): CouponState {
  if (coupon.is_sold_out) return "sold-out";
  return balance >= coupon.points_price ? "available" : "locked";
}

/* ─── Brand list ─── */

export function BrandTile({ brand, balance, favorite, onOpen, t }: { brand: OyunsPlusBrand; balance: number; favorite: boolean; onOpen: () => void; t: Translate }) {
  const hasStats = brand.available_count !== undefined;
  const available = brand.available_count ?? brand.offer_count;
  const min = brand.min_points_price ?? null;
  const max = brand.max_points_price ?? null;
  const purchasable = hasStats ? available > 0 && min !== null && balance >= min : true;
  const range = min === null ? null : max !== null && max !== min ? `${formatPoints(min)}–${formatPoints(max)}` : formatPoints(min);
  return <button type="button" onClick={onOpen} className={`oyuns-plus-brand-tile${purchasable ? "" : " oyuns-plus-brand-tile--muted"}`}>
    <span className="oyuns-plus-brand-tile-media">
      {brand.cover_url ? <img src={brand.cover_url} alt="" loading="lazy" /> : <span className="oyuns-plus-brand-tile-fallback" aria-hidden="true" />}
      {favorite && <Heart className="oyuns-plus-brand-tile-favorite" aria-hidden="true" />}
      <span className="oyuns-plus-brand-tile-badge"><BrandLogo brand={brand} /></span>
    </span>
    <span className="oyuns-plus-brand-tile-body">
      <strong>{brand.name}</strong>
      <span className="oyuns-plus-brand-tile-pills">
        <span className="oyuns-plus-pill oyuns-plus-pill--count"><Ticket aria-hidden="true" />{t("oyuns_plus.offer_count", { count: brand.offer_count })}</span>
        {hasStats && (range ? <span className="oyuns-plus-pill oyuns-plus-pill--price">{!purchasable && <Lock aria-hidden="true" />}{range}<PointsMark /></span> : <span className="oyuns-plus-pill oyuns-plus-pill--price">{t("oyuns_plus.sold_out")}</span>)}
      </span>
    </span>
  </button>;
}

/* ─── Coupons ─── */

function CouponCta({ coupon, state }: { coupon: OyunsPlusCoupon; state: CouponState }) {
  return <span className="oyuns-plus-coupon-cta">{state !== "available" && <Lock aria-hidden="true" />}<span>{formatPoints(coupon.points_price)}</span><PointsMark /><ChevronRight aria-hidden="true" /></span>;
}

function CouponStatus({ coupon, state, t }: { coupon: OyunsPlusCoupon; state: CouponState; t: Translate }) {
  if (state === "sold-out") return <span className="oyuns-plus-coupon-status oyuns-plus-coupon-status--sold-out">{t("oyuns_plus.sold_out")}</span>;
  if (coupon.remaining_purchase_count != null) return <span className="oyuns-plus-coupon-status">{t("oyuns_plus.remaining", { count: coupon.remaining_purchase_count })}</span>;
  return null;
}

export function CouponCard({ coupon, balance, view, onOpen, t, expiry }: { coupon: OyunsPlusCoupon; balance: number; view: CouponViewMode; onOpen: () => void; t: Translate; expiry?: string }) {
  const state = couponState(coupon, balance);
  const value = formatCouponValue(coupon);
  const caption = t(coupon.value_type === "percentage" ? "oyuns_plus.discount_caption" : "oyuns_plus.coupon_caption");
  const label = t("oyuns_plus.coupon_aria", { name: coupon.name, value, points: formatPoints(coupon.points_price) });
  if (view === "list") {
    return <button type="button" onClick={onOpen} aria-label={label} className={`oyuns-plus-coupon-item oyuns-plus-coupon--${state}`}>
      <span className="oyuns-plus-coupon-item-value"><strong>{value}</strong><small>{caption}</small></span>
      <span className="oyuns-plus-coupon-item-copy">
        <strong>{coupon.name}</strong>
        <span className="oyuns-plus-coupon-item-meta">{coupon.badge_label && <span className="oyuns-plus-coupon-badge">{coupon.badge_label}</span>}<CouponStatus coupon={coupon} state={state} t={t} /></span>
        {expiry && <small>{expiry}</small>}
      </span>
      <CouponCta coupon={coupon} state={state} />
    </button>;
  }
  return <button type="button" onClick={onOpen} aria-label={label} title={coupon.name} className={`oyuns-plus-coupon-card oyuns-plus-coupon--${state}`}>
    <span className="oyuns-plus-coupon-card-top">{coupon.badge_label ? <span className="oyuns-plus-coupon-badge">{coupon.badge_label}</span> : <span />}<CouponStatus coupon={coupon} state={state} t={t} /></span>
    <span className="oyuns-plus-coupon-card-hero"><strong>{value}</strong><small>{caption}</small></span>
    <CouponCta coupon={coupon} state={state} />
  </button>;
}

/* ─── Brand profile page ─── */

function displayLink(url: string) {
  return url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
}

function socialHandle(url: string) {
  const path = displayLink(url).split("/").slice(1).filter(Boolean)[0];
  return path ? `@${path.replace(/^@/, "")}` : displayLink(url);
}

function ContactRow({ icon, href, children }: { icon: ReactNode; href?: string | null; children: ReactNode }) {
  const body = <><span className="oyuns-plus-contact-icon" aria-hidden="true">{icon}</span><span className="oyuns-plus-contact-text">{children}</span>{href && <ChevronRight className="oyuns-plus-row-chevron" aria-hidden="true" />}</>;
  if (!href) return <li className="oyuns-plus-contact-row">{body}</li>;
  const external = /^https?:/i.test(href);
  return <li><a className="oyuns-plus-contact-row" href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{body}</a></li>;
}

export function BrandAbout({ brand, t }: { brand: OyunsPlusBrand; t: Translate }) {
  const address = (brand.address || "").trim();
  const rows = [
    (address || brand.map_url) && <ContactRow key="address" icon={<MapPin />} href={brand.map_url}>{address || displayLink(brand.map_url!)}</ContactRow>,
    brand.website_url && <ContactRow key="website" icon={<Globe />} href={brand.website_url}>{displayLink(brand.website_url)}</ContactRow>,
    brand.instagram_url && <ContactRow key="instagram" icon={<Instagram />} href={brand.instagram_url}>{socialHandle(brand.instagram_url)}</ContactRow>,
    brand.facebook_url && <ContactRow key="facebook" icon={<Facebook />} href={brand.facebook_url}>{socialHandle(brand.facebook_url)}</ContactRow>,
    brand.phone && <ContactRow key="phone" icon={<Phone />} href={`tel:${brand.phone.replace(/[^\d+]/g, "")}`}>{brand.phone}</ContactRow>,
  ].filter(Boolean);
  return <div className="oyuns-plus-brand-about" role="tabpanel">
    <h3>{t("oyuns_plus.about_title")}</h3>
    <p>{brand.description || t("oyuns_plus.no_description")}</p>
    {rows.length > 0 && <ul className="oyuns-plus-contact-list" aria-label={t("oyuns_plus.contacts_title")}>{rows}</ul>}
  </div>;
}

export function CouponViewSwitch({ mode, onChange, t }: { mode: CouponViewMode; onChange: (mode: CouponViewMode) => void; t: Translate }) {
  const options: { value: CouponViewMode; icon: ReactNode; label: string }[] = [
    { value: "grid", icon: <LayoutGrid aria-hidden="true" />, label: t("oyuns_plus.view_grid") },
    { value: "list", icon: <List aria-hidden="true" />, label: t("oyuns_plus.view_list") },
  ];
  return <div className="oyuns-plus-view-switch" role="radiogroup" aria-label={t("oyuns_plus.view_mode")}>
    {options.map((option) => <button key={option.value} type="button" role="radio" aria-checked={mode === option.value} aria-label={option.label} title={option.label} onClick={() => onChange(option.value)}>{option.icon}</button>)}
  </div>;
}

export function BrandPage({ brand, tab, onTabChange, favorite, onToggleFavorite, onBack, couponCount, t, children }: {
  brand: OyunsPlusBrand;
  tab: BrandTab;
  onTabChange: (tab: BrandTab) => void;
  favorite: boolean;
  onToggleFavorite: () => void;
  onBack: () => void;
  couponCount: number;
  t: Translate;
  children: ReactNode;
}) {
  const tags = brandTags(brand);
  const tabs: { value: BrandTab; label: string; count?: number }[] = [
    { value: "about", label: t("oyuns_plus.tab_about") },
    { value: "coupons", label: t("oyuns_plus.tab_coupons"), count: couponCount },
  ];
  return <section className="oyuns-plus-brand-page" aria-live="polite">
    <div className="oyuns-plus-brand-hero">
      {brand.cover_url ? <img src={brand.cover_url} alt="" /> : <span className="oyuns-plus-brand-hero-fallback" aria-hidden="true" />}
      <button type="button" onClick={onBack} className="oyuns-plus-hero-button oyuns-plus-hero-button--start" aria-label={t("oyuns_plus.all_brands")}><ArrowLeft aria-hidden="true" /></button>
      <button type="button" onClick={onToggleFavorite} className="oyuns-plus-hero-button oyuns-plus-hero-button--end" aria-pressed={favorite} aria-label={t(favorite ? "oyuns_plus.favorite_remove" : "oyuns_plus.favorite_add")}><Heart aria-hidden="true" /></button>
    </div>
    <div className="oyuns-plus-brand-sheet">
      <div className="oyuns-plus-brand-identity">
        <BrandLogo brand={brand} size="lg" />
        <div className="min-w-0">
          <h2>{brand.name}</h2>
          {tags.length > 0 && <div className="oyuns-plus-brand-tags">{tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        </div>
      </div>
      <div className="oyuns-plus-brand-tabs" role="tablist">
        {tabs.map((item) => <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} onClick={() => onTabChange(item.value)}>{item.label}{item.count !== undefined && item.count > 0 && <span className="oyuns-plus-tab-count">{item.count}</span>}</button>)}
      </div>
      {children}
    </div>
  </section>;
}

export function CouponsEmpty({ t }: { t: Translate }) {
  return <div className="oyuns-plus-empty-card"><Gift className="mx-auto mb-2 h-8 w-8 text-maroon-500" /><p>{t("oyuns_plus.coupons_empty")}</p></div>;
}
