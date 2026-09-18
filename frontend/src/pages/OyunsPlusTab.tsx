import { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ChevronRight, Copy, Gift, History, Loader2, Settings, TrendingDown, TrendingUp, Users } from "lucide-react";
import {
  createOyunsPlusVoucherRequest,
  fetchOyunsPlusCards,
  fetchOyunsPlusHistory,
  fetchOyunsPlusSummary,
  OyunsPlusCard,
  OyunsPlusHistoryEntry,
} from "../api";
import { SuccessCheck } from "../components/SuccessCheck";
import { useLang } from "../i18n/useLang";
import { queryKeys } from "../queryKeys";
import { OyunsPlusSkeleton } from "../components/Skeleton";
import oyunsPlusPoints from "../assets/oyuns-plus-points.svg";

interface Props {
  userId?: number;
  verificationLevel?: number;
  emailVerificationPending?: boolean;
  emailAddress?: string;
  isProfileLoading?: boolean;
  isProfileResolved?: boolean;
}

function getErrorMessage(error: unknown, fallback: string) {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") {
    if (detail === "INSUFFICIENT_POINTS") return fallback;
    return detail;
  }
  return fallback;
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("976") && digits.length === 11 && /^[6-9]/.test(digits.slice(3))) {
    return `+976${digits.slice(3)}`;
  }
  if (digits.length === 11 && /^[78]9/.test(digits)) {
    return `+7${digits.slice(1)}`;
  }
  if (digits.length === 10 && /^9/.test(digits)) {
    return `+7${digits}`;
  }
  if (digits.length === 8 && /^[6-9]/.test(digits)) {
    return `+976${digits}`;
  }
  return "";
}

function validReceiverPhone(value: string) {
  return normalizePhone(value) !== "";
}

function formatPoints(value: number) {
  return value.toLocaleString("mn-MN");
}

function formatDate(value: string | null | undefined, lang: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(lang === "mn" ? "mn-MN" : "ru-RU", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function historyLabel(entry: OyunsPlusHistoryEntry, t: (key: string, params?: Record<string, string | number>) => string) {
  if (entry.transaction_type === "redeemed") return t("oyuns_plus.history_redeemed", { name: entry.voucher_name || t("oyuns_plus.voucher") });
  if (entry.transaction_type === "refunded") return t("oyuns_plus.history_refunded", { name: entry.voucher_name || t("oyuns_plus.voucher") });
  if (entry.source_type === "referral_kyc_approved") return t("oyuns_plus.history_source_referral");
  if (entry.source_type === "gift_completed") return t("oyuns_plus.history_source_gift");
  if (entry.source_type === "fuel_order_completed") return t("oyuns_plus.history_source_fuel");
  return t("oyuns_plus.history_source_exchange");
}

function PointsMark({ className = "" }: { className?: string }) {
  return <img src={oyunsPlusPoints} alt="" aria-hidden="true" className={`oyuns-plus-points-mark ${className}`} />;
}

function TiltSurface({ children, className = "", onOpen }: { children: ReactNode; className?: string; onOpen?: (rect: DOMRect) => void }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef({ active: false, dragged: false, startX: 0, startY: 0 });

  const resetTilt = () => {
    const shell = shellRef.current;
    if (!shell) return;
    shell.dataset.tilting = "false";
    shell.style.setProperty("--oyuns-tilt-x", "0deg");
    shell.style.setProperty("--oyuns-tilt-y", "0deg");
    shell.style.setProperty("--oyuns-glare-x", "50%");
    shell.style.setProperty("--oyuns-glare-y", "50%");
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointerRef.current = { active: true, dragged: false, startX: event.clientX, startY: event.clientY };
    if (event.pointerType === "touch") event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const shell = shellRef.current;
    const pointer = pointerRef.current;
    if (!shell || !pointer.active) return;
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (Math.abs(dx) + Math.abs(dy) > 10) pointer.dragged = true;
    const rect = shell.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    shell.dataset.tilting = "true";
    shell.style.setProperty("--oyuns-tilt-x", `${(0.5 - y) * 8}deg`);
    shell.style.setProperty("--oyuns-tilt-y", `${(x - 0.5) * 8}deg`);
    shell.style.setProperty("--oyuns-glare-x", `${x * 100}%`);
    shell.style.setProperty("--oyuns-glare-y", `${y * 100}%`);
  };

  const handlePointerUp = () => {
    const pointer = pointerRef.current;
    pointer.active = false;
    resetTilt();
    if (!pointer.dragged) onOpen?.(shellRef.current?.getBoundingClientRect() ?? new DOMRect());
  };

  return (
    <div ref={shellRef} className={`oyuns-plus-tilt-shell ${className}`} data-tilting="false" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={() => { pointerRef.current.active = false; resetTilt(); }} onPointerLeave={() => { if (!pointerRef.current.active) resetTilt(); }}>
      {children}
    </div>
  );
}

function TiltShell({ card, onOpen }: { card: OyunsPlusCard; onOpen: (card: OyunsPlusCard, rect: DOMRect) => void }) {
  return <TiltSurface onOpen={(rect) => onOpen(card, rect)}>
    <button type="button" className="oyuns-plus-card group" aria-label={card.name} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen(card, event.currentTarget.getBoundingClientRect());
      }
    }}>
      <span className="oyuns-plus-card-image-wrap">
        <img src={card.image_url} alt="" className="oyuns-plus-card-image" loading="lazy" />
        <span className="oyuns-plus-card-glare" aria-hidden="true" />
        <span className="oyuns-plus-card-price"><span>{formatPoints(card.points_price)}</span><PointsMark /></span>
      </span>
      <span className="oyuns-plus-card-name">{card.name}</span>
    </button>
  </TiltSurface>;
}

export function OyunsPlusTab({ userId, isProfileLoading = false }: Props) {
  const { t, lang } = useLang();
  const queryClient = useQueryClient();
  const [selectedCard, setSelectedCard] = useState<OyunsPlusCard | null>(null);
  const [detailOrigin, setDetailOrigin] = useState<{ x: number; y: number } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [formError, setFormError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState<{ name: string; balance: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [balancePulse, setBalancePulse] = useState(false);

  const summaryQuery = useQuery({
    queryKey: userId ? queryKeys.oyunsPlus.summary(userId) : ["oyuns-plus", "summary", "anonymous"],
    queryFn: fetchOyunsPlusSummary,
    enabled: Boolean(userId),
    staleTime: 0,
  });
  const cardsQuery = useQuery({
    queryKey: ["oyuns-plus", "cards"],
    queryFn: fetchOyunsPlusCards,
    enabled: Boolean(userId),
    staleTime: 60_000,
  });
  const historyQuery = useQuery({
    queryKey: userId ? queryKeys.oyunsPlus.history(userId) : ["oyuns-plus", "history", "anonymous"],
    queryFn: fetchOyunsPlusHistory,
    enabled: Boolean(userId) && showSettings,
    staleTime: 0,
  });

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && userId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.summary(userId) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.history(userId) });
      }
    };
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [queryClient, userId]);

  const requestMutation = useMutation({
    mutationFn: createOyunsPlusVoucherRequest,
    onSuccess: async (result) => {
      setRequestSuccess({ name: result.card_name, balance: result.balance_after });
      setShowForm(false);
      setReceiverName("");
      setReceiverPhone("");
      setFormError("");
      setBalancePulse(true);
      window.setTimeout(() => setBalancePulse(false), 450);
      if (userId) {
        queryClient.setQueryData(queryKeys.oyunsPlus.summary(userId), (current: typeof summaryQuery.data) => current ? { ...current, points_balance: result.balance_after } : current);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.summary(userId) }),
          queryClient.invalidateQueries({ queryKey: queryKeys.oyunsPlus.history(userId) }),
        ]);
      }
    },
    onError: (error) => setFormError(getErrorMessage(error, t("oyuns_plus.purchase_error"))),
  });

  if (isProfileLoading) return <div aria-busy="true"><OyunsPlusSkeleton /></div>;

  const balance = summaryQuery.data?.points_balance ?? 0;
  const cards = cardsQuery.data?.cards || [];

  const openCard = (card: OyunsPlusCard, rect: DOMRect) => {
    setDetailOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    setSelectedCard(card);
    setShowForm(false);
    setRequestSuccess(null);
    setFormError("");
  };

  const submitRequest = () => {
    if (!selectedCard) return;
    if (!receiverName.trim()) {
      setFormError(t("oyuns_plus.receiver_name_required"));
      return;
    }
    if (!validReceiverPhone(receiverPhone)) {
      setFormError(t("oyuns_plus.receiver_phone_invalid"));
      return;
    }
    setFormError("");
    requestMutation.mutate({
      card_id: selectedCard.id,
      receiver_name: receiverName.trim(),
      receiver_phone: normalizePhone(receiverPhone),
    });
  };

  const copyReferral = () => {
    if (!summaryQuery.data?.referral_code) return;
    void navigator.clipboard.writeText(summaryQuery.data.referral_code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  const balanceStyle = balancePulse ? "oyuns-plus-balance oyuns-plus-balance-pulse" : "oyuns-plus-balance";

  return (
    <div className="oyuns-plus-page space-y-4">
      <div className="oyuns-plus-balance-sticky">
        <div className="oyuns-plus-balance-card">
          <div>
            <div className="oyuns-plus-eyebrow">{t("oyuns_plus.balance_label")}</div>
            <div className={balanceStyle} aria-live="polite">{summaryQuery.isLoading ? "—" : formatPoints(balance)} <PointsMark /></div>
          </div>
          <button type="button" onClick={() => setShowSettings(true)} className="oyuns-plus-settings-button" aria-label={t("oyuns_plus.settings_btn")}>
            <Settings className="h-4 w-4" />
            <span>{t("oyuns_plus.history_button")}</span>
          </button>
        </div>
      </div>

      {showSettings ? (
        <section className="oyuns-plus-settings-view" aria-label={t("oyuns_plus.settings_title")}>
          <button type="button" onClick={() => setShowSettings(false)} className="oyuns-plus-back-button"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
          <div className="oyuns-plus-settings-card">
            <div className="flex items-center gap-2"><PointsMark className="oyuns-plus-settings-points-mark" /><h2>{t("oyuns_plus.settings_title")}</h2></div>
            <div className="oyuns-plus-settings-stats">
              <div><span>{t("profile.oyuns_points")}</span><strong>{formatPoints(balance)} <PointsMark /></strong></div>
              <div><span><Users className="inline h-3 w-3" /> {t("oyuns_plus.settings_invited")}</span><strong>{summaryQuery.data?.invited_verified ?? 0}/{summaryQuery.data?.invited_total ?? 0}</strong></div>
            </div>
          </div>
          {summaryQuery.data?.referral_code && (
            <div className="oyuns-plus-panel">
              <div className="oyuns-plus-panel-title">{t("oyuns_plus.settings_referral_code")}</div>
              <div className="flex gap-2"><code className="flex-1 rounded-xl bg-surface-100 px-3 py-2 font-bold tracking-widest dark:bg-dark-700">{summaryQuery.data.referral_code}</code><button type="button" onClick={copyReferral} className="oyuns-plus-secondary-button">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}</button></div>
            </div>
          )}
          <div className="oyuns-plus-panel">
            <div className="oyuns-plus-panel-title flex items-center gap-2"><History className="h-4 w-4" /> {t("oyuns_plus.history_title")}</div>
            {historyQuery.isLoading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-maroon-600" /></div> : historyQuery.isError ? <div className="oyuns-plus-error">{t("oyuns_plus.history_error")}</div> : !historyQuery.data?.entries.length ? <div className="oyuns-plus-empty">{t("oyuns_plus.history_empty")}</div> : <div className="space-y-2">{historyQuery.data.entries.map((entry, index) => <HistoryRow key={entry.id || index} entry={entry} lang={lang} t={t} />)}</div>}
          </div>
        </section>
      ) : selectedCard ? (
        <section className="oyuns-plus-detail-view" style={{ "--oyuns-detail-x": `${detailOrigin?.x ?? 50}px`, "--oyuns-detail-y": `${detailOrigin?.y ?? 50}px` } as CSSProperties}>
          <button type="button" onClick={() => { setSelectedCard(null); setRequestSuccess(null); }} className="oyuns-plus-back-button"><ArrowLeft className="h-4 w-4" /> {t("common.back")}</button>
          <TiltSurface className="oyuns-plus-detail-tilt">
            <div className="oyuns-plus-detail-card">
              <img src={selectedCard.image_url} alt={selectedCard.name} className="oyuns-plus-detail-image" />
              <div className="oyuns-plus-detail-content">
              <div className="oyuns-plus-detail-price"><span>{formatPoints(selectedCard.points_price)}</span><PointsMark /></div>
              <h2>{selectedCard.name}</h2>
              <p>{selectedCard.description || t("oyuns_plus.no_description")}</p>
              {requestSuccess ? (
                <div className="oyuns-plus-success" role="status">
                  <SuccessCheck />
                  <strong>{t("oyuns_plus.request_success")}</strong>
                  <span>{t("oyuns_plus.request_success_balance", { balance: formatPoints(requestSuccess.balance) })}</span>
                </div>
              ) : (
                <>
                  <button type="button" disabled={balance < selectedCard.points_price || requestMutation.isPending} onClick={() => setShowForm((value) => !value)} className="oyuns-plus-primary-button disabled:cursor-not-allowed disabled:opacity-50">
                    {balance < selectedCard.points_price ? t("oyuns_plus.points_shortfall", { points: formatPoints(selectedCard.points_price - balance) }) : requestMutation.isPending ? t("oyuns_plus.submitting") : t("oyuns_plus.purchase")}
                  </button>
                  {showForm && <div className="oyuns-plus-receiver-form">
                    <label>{t("oyuns_plus.receiver_name")}<input value={receiverName} onChange={(event) => setReceiverName(event.target.value)} autoComplete="name" /></label>
                    <label>{t("oyuns_plus.receiver_phone")}<input value={receiverPhone} onChange={(event) => setReceiverPhone(event.target.value)} inputMode="tel" placeholder="+976 99112233 / +7 999 123 45 67" /></label>
                    {formError && <div className="oyuns-plus-error" role="alert">{formError}</div>}
                    <button type="button" onClick={submitRequest} disabled={requestMutation.isPending} className="oyuns-plus-primary-button">{requestMutation.isPending ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : t("oyuns_plus.submit_request")}</button>
                  </div>}
                </>
              )}
              </div>
            </div>
          </TiltSurface>
        </section>
      ) : (
        <>
          <h1 className="oyuns-plus-heading">{t("oyuns_plus.vouchers_title")}</h1>
          {cardsQuery.isError ? <div className="oyuns-plus-error">{t("oyuns_plus.cards_error")}</div> : cardsQuery.isLoading ? <OyunsPlusSkeleton /> : cards.length === 0 ? <div className="oyuns-plus-empty-card"><Gift className="mx-auto mb-2 h-8 w-8 text-maroon-500" /><p>{t("oyuns_plus.cards_empty")}</p></div> : <div className="oyuns-plus-grid">{cards.map((card) => <TiltShell key={card.id} card={card} onOpen={openCard} />)}</div>}
          <div className="oyuns-plus-note">{t("oyuns_plus.vouchers_note")}</div>
        </>
      )}
    </div>
  );
}

function HistoryRow({ entry, lang, t }: { entry: OyunsPlusHistoryEntry; lang: string; t: (key: string, params?: Record<string, string | number>) => string }) {
  const positive = entry.points >= 0;
  return <div className="oyuns-plus-history-row"><div className="flex min-w-0 items-start gap-2">{positive ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-[#00C885]" /> : <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-[#FF3B57]" />}<div className="min-w-0"><div className="truncate text-xs font-semibold">{historyLabel(entry, t)}</div><div className="text-[10px] text-slate-500">{formatDate(entry.created_at, lang)}</div></div></div><div className="text-right"><div className={`text-xs font-bold ${positive ? "text-[#00C885]" : "text-[#FF3B57]"}`}>{positive ? "+" : ""}{formatPoints(entry.points)}</div><div className="text-[10px] text-slate-500">{t("oyuns_plus.balance_after", { balance: formatPoints(entry.balance_after) })}</div></div></div>;
}
