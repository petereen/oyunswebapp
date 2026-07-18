import { useState, useMemo, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Upload,
  MapPin,
  Fuel,
  AlertTriangle,
  Loader2,
  Navigation,
  Camera,
  X,
  Clock,
  History,
  Plus,
  ChevronRight,
} from "lucide-react";
import {
  FUEL_STATIONS_FALLBACK,
  fetchFuelStations,
  calculateFuel,
  createFuelOrder,
  fetchFuelAdminBanks,
  requestPresign,
  uploadFuelPumpPhoto,
  fetchActiveFuelOrders,
  fetchFuelOrders,
  fetchFuelShiftStatus,
  FuelAdminBankAccount,
  FuelCalculation,
  FuelOrder,
  FuelStation,
} from "../api";
import { FuelChat } from "./FuelChat";
import { useLang } from "../i18n/useLang";

interface Props {
  sellRate: number;
  onBack: () => void;
  onSuccess: () => void;
  initialOrderId?: string;
}

type FuelView = "menu" | "history" | "new" | "tracking";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  pending_payment: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  paid: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  in_progress: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  fueling_complete: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  cancelled: "bg-slate-100 text-slate-600 dark:bg-slate-900/30 dark:text-slate-400",
};

function isActiveStatus(status: string) {
  return ["pending", "pending_payment", "approved", "paid", "in_progress", "fueling_complete"].includes(status);
}

export function FuelFlow({ sellRate, onBack, onSuccess, initialOrderId }: Props) {
  const { t, lang } = useLang();

  const getStatusLabel = (status: string): string => {
    const map: Record<string, string> = {
      pending: t("fuel.status_pending"),
      pending_payment: t("fuel.status_pending"),
      approved: t("fuel.status_approved"),
      paid: t("fuel.status_approved"),
      in_progress: t("fuel.status_approved"),
      fueling_complete: t("fuel.status_approved"),
      completed: t("fuel.status_completed"),
      rejected: t("fuel.status_rejected"),
      cancelled: t("fuel.status_cancelled"),
    };
    return map[status] || status;
  };

  const [view, setView] = useState<FuelView>("menu");
  const [step, setStep] = useState(0);

  // Dynamic stations
  const [stations, setStations] = useState<FuelStation[]>([]);
  const [stationsLoading, setStationsLoading] = useState(true);

  // Station selection
  const [stationName, setStationName] = useState("");
  const [discountPercent, setDiscountPercent] = useState(13);
  const [requiresDispenser, setRequiresDispenser] = useState(false);
  const [dispenserNumber, setDispenserNumber] = useState("");

  // Location
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [locationText, setLocationText] = useState("");
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError] = useState("");

  // Fuel details
  const [liters, setLiters] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");

  // Payment
  const [paymentCurrency, setPaymentCurrency] = useState<"RUB" | "MNT" | null>(null);

  // Admin bank
  const [adminBanks, setAdminBanks] = useState<FuelAdminBankAccount[]>([]);
  const [selectedBank, setSelectedBank] = useState<FuelAdminBankAccount | null>(null);
  const [invoiceId, setInvoiceId] = useState("");

  // Receipt
  const [receiptUrl, setReceiptUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  // Active order tracking
  const [activeOrder, setActiveOrder] = useState<FuelOrder | null>(null);
  const [orderPolling, setOrderPolling] = useState(false);

  // Pump photo (completion)
  const [pumpPhotoUrl, setPumpPhotoUrl] = useState("");
  const [pumpUploading, setPumpUploading] = useState(false);

  // History
  const [historyOrders, setHistoryOrders] = useState<FuelOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // General
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  // Shift status
  const [shiftActive, setShiftActive] = useState(true);
  const [shiftLoading, setShiftLoading] = useState(true);

  // Load stations, banks, shift on mount
  useEffect(() => {
    fetchFuelAdminBanks()
      .then((res) => setAdminBanks(res.accounts || []))
      .catch(() => setAdminBanks([]));
    fetchFuelStations()
      .then((data) => setStations(data.length > 0 ? data : FUEL_STATIONS_FALLBACK))
      .catch(() => setStations(FUEL_STATIONS_FALLBACK))
      .finally(() => setStationsLoading(false));
    fetchFuelShiftStatus()
      .then((res) => setShiftActive(res.is_active))
      .catch(() => setShiftActive(true))
      .finally(() => setShiftLoading(false));
  }, []);

  // Auto-open specific order from navigation
  useEffect(() => {
    if (initialOrderId) {
      const loadOrder = async () => {
        try {
          // Try active orders first, then all orders
          let found: FuelOrder | undefined;
          const active = await fetchActiveFuelOrders();
          found = (active.orders || []).find((o) => o.id === initialOrderId);
          if (!found) {
            const all = await fetchFuelOrders();
            found = (all.orders || []).find((o) => o.id === initialOrderId);
          }
          if (found) {
            setActiveOrder(found);
            setPumpPhotoUrl("");
            setView("tracking");
            if (isActiveStatus(found.status)) setOrderPolling(true);
          }
        } catch { /* ignore */ }
      };
      loadOrder();
    }
  }, [initialOrderId]);

  // Generate invoice ID
  const generateInvoiceId = useCallback(() => {
    const now = new Date();
    const moscowOffset = 3 * 60;
    const localOffset = now.getTimezoneOffset();
    const moscowTime = new Date(now.getTime() + (moscowOffset + localOffset) * 60 * 1000);
    const y = moscowTime.getFullYear();
    const mo = String(moscowTime.getMonth() + 1).padStart(2, "0");
    const d = String(moscowTime.getDate()).padStart(2, "0");
    const h = String(moscowTime.getHours()).padStart(2, "0");
    const mi = String(moscowTime.getMinutes()).padStart(2, "0");
    const s = String(moscowTime.getSeconds()).padStart(2, "0");
    const r = String(Math.floor(Math.random() * 100)).padStart(2, "0");
    return `F${y}${mo}${d}-${h}${mi}${s}-${r}`;
  }, []);

  // Calculation
  const calculation = useMemo((): FuelCalculation | null => {
    const l = parseFloat(liters);
    const p = parseFloat(pricePerLiter);
    if (!l || !p || l <= 0 || p <= 0 || !paymentCurrency) return null;

    const gross = l * p;
    const discount = gross * discountPercent / 100;
    const net = gross - discount;
    const rounded = Math.round(net / 100) * 100;

    let exchangeRate: number | undefined;
    let final_amount = rounded;

    if (paymentCurrency === "MNT" && sellRate > 0) {
      exchangeRate = sellRate;
      final_amount = Math.round(rounded * sellRate);
    }

    return {
      station_name: stationName,
      liters: l,
      station_price_per_liter: p,
      discount_percent: discountPercent,
      gross_amount: Math.round(gross * 100) / 100,
      discount_amount: Math.round(discount * 100) / 100,
      net_amount: Math.round(net * 100) / 100,
      rounded_amount: rounded,
      payment_currency: paymentCurrency,
      exchange_rate: exchangeRate,
      final_amount: final_amount,
    };
  }, [liters, pricePerLiter, discountPercent, paymentCurrency, sellRate, stationName]);

  // Filtered banks by currency – randomly pick ONE to cycle across accounts
  const filteredBanks = useMemo(() => {
    const currencyBanks = !paymentCurrency
      ? adminBanks
      : adminBanks.filter((b) => b.currency === paymentCurrency);
    if (currencyBanks.length <= 1) return currencyBanks;
    const randomIndex = Math.floor(Math.random() * currencyBanks.length);
    return [currencyBanks[randomIndex]];
  }, [adminBanks, paymentCurrency]);

  // Auto-select the randomly chosen bank
  useEffect(() => {
    if (filteredBanks.length === 1) {
      setSelectedBank(filteredBanks[0]);
    } else {
      setSelectedBank(null);
    }
  }, [filteredBanks]);

  // Geolocation
  const requestGeolocation = () => {
    if (!("geolocation" in navigator)) {
      setGeoError(t("fuel.geo_not_supported"));
      return;
    }
    setGeoLoading(true);
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude);
        setLongitude(pos.coords.longitude);
        setGeoLoading(false);
      },
      (err) => {
        setGeoError(
          err.code === 1
            ? t("fuel.geo_denied")
            : t("fuel.geo_error")
        );
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  // Copy helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  // File upload helper
  const handleFileUpload = async (
    file: File,
    setUrl: (url: string) => void,
    setUpl: (v: boolean) => void,
    prefix: string
  ) => {
    if (!file) return;
    setUpl(true);
    setError("");
    try {
      const prepared = await prepareImageForUpload(file);
      const path = `fuel/${prefix}/${invoiceId || "unknown"}_${Date.now()}.${prepared.extension}`;
      const presigned = await requestPresign({ bucket: "bills", path });
      const uploadRes = await fetch(presigned.upload_url, {
        method: "PUT",
        body: prepared.file,
        headers: { "Content-Type": prepared.mimeType },
      });
      if (!uploadRes.ok) {
        const detail = await uploadRes.text().catch(() => "");
        await logUploadIssue({
          issue_type: "fuel_photo_upload_failure",
          bucket: "bills",
          path,
          user_id: undefined,
          message: `Fuel photo upload failed with status ${uploadRes.status}`,
          details: {
            status: uploadRes.status,
            detail,
            originalName: prepared.originalName,
            originalSizeBytes: prepared.originalSizeBytes,
            finalSizeBytes: prepared.finalSizeBytes,
            mimeType: prepared.mimeType,
            wasCompressed: prepared.wasCompressed,
          },
        });
        throw new Error(`Upload failed with status ${uploadRes.status}`);
      }
      setUrl(presigned.public_url);
    } catch {
      setError(t("fuel.photo_error"));
    } finally {
      setUpl(false);
    }
  };

  // Submit fuel order
  const handleSubmit = async () => {
    if (!calculation || !receiptUrl) return;
    setLoading(true);
    setError("");

    try {
      const res = await createFuelOrder({
        invoice: invoiceId,
        station_name: stationName,
        dispenser_number: dispenserNumber.trim() || undefined,
        station_latitude: latitude || undefined,
        station_longitude: longitude || undefined,
        location_text: locationText || undefined,
        liters: calculation.liters,
        station_price_per_liter: calculation.station_price_per_liter,
        payment_currency: calculation.payment_currency,
        exchange_rate: calculation.exchange_rate,
        payment_receipt_url: receiptUrl,
        admin_bank_id: selectedBank?.id,
      });
      setActiveOrder({
        id: res.id,
        invoice: res.invoice,
        status: "pending",
        user_id: 0,
        station_name: stationName,
        dispenser_number: dispenserNumber.trim() || undefined,
        liters: calculation.liters,
        station_price_per_liter: calculation.station_price_per_liter,
        discount_percent: calculation.discount_percent,
        gross_amount: calculation.gross_amount,
        discount_amount: calculation.discount_amount,
        net_amount: calculation.net_amount,
        rounded_amount: calculation.rounded_amount,
        payment_currency: calculation.payment_currency,
        final_amount: calculation.final_amount,
        created_at: res.created_at,
      } as FuelOrder);
      setView("tracking");
      setOrderPolling(true);
    } catch (err: any) {
      setError(err.response?.data?.detail || t("fuel.order_error"));
    } finally {
      setLoading(false);
    }
  };

  // Poll active order status
  useEffect(() => {
    if (!orderPolling || !activeOrder) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetchActiveFuelOrders();
        const found = res.orders.find((o) => o.id === activeOrder.id);
        if (found) {
          setActiveOrder(found);
          if (["completed", "rejected", "cancelled"].includes(found.status)) {
            setOrderPolling(false);
          }
        }
      } catch { /* ignore */ }
    }, 10000);
    return () => clearInterval(interval);
  }, [orderPolling, activeOrder]);

  // Handle pump photo upload & complete order
  const handlePumpPhotoSubmit = async () => {
    if (!pumpPhotoUrl || !activeOrder) return;
    setLoading(true);
    setError("");
    try {
      await uploadFuelPumpPhoto(activeOrder.id, pumpPhotoUrl);
      setActiveOrder({ ...activeOrder, status: "completed", pump_photo_url: pumpPhotoUrl });
      setOrderPolling(false);
    } catch {
      setError(t("fuel.send_photo_error"));
    } finally {
      setLoading(false);
    }
  };

  // Load user history
  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await fetchFuelOrders();
      setHistoryOrders(res.orders || []);
    } catch { /* ignore */ }
    setHistoryLoading(false);
  };

  // Open order in tracking view
  const openOrderTracking = (order: FuelOrder) => {
    setActiveOrder(order);
    setPumpPhotoUrl("");
    setView("tracking");
    if (isActiveStatus(order.status)) {
      setOrderPolling(true);
    }
  };

  // ---- Render helpers ----
  const renderBack = (label: string, onBackFn?: () => void) => (
    <div className="flex items-center gap-2 mb-5">
      <button
        onClick={onBackFn || (() => setStep(step - 1))}
        className="p-2 hover:bg-surface-100 dark:hover:bg-dark-700 rounded-xl transition"
      >
        <ArrowLeft className="w-5 h-5 text-dark-600 dark:text-ivory-300" />
      </button>
      <div className="flex items-center gap-2 text-dark-800 dark:text-ivory-200">
        <Fuel className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-bold">{label}</span>
      </div>
    </div>
  );

  // ============== VIEW: MENU ==============
  if (view === "menu") {
    return (
      <div className="animate-slideUp">
        {renderBack(t("fuel.title"), onBack)}
        {(stationsLoading || shiftLoading) ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
          </div>
        ) : !shiftActive ? (
          <div className="bg-white dark:bg-dark-800 p-8 rounded-2xl border border-silver/60 dark:border-dark-600 text-center space-y-4">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-amber-500" />
            </div>
            <h3 className="font-bold text-dark-800 dark:text-ivory-200">{t("fuel.not_working")}</h3>
            <p className="text-sm text-dark-500 dark:text-ivory-400">
              {t("fuel.not_working_desc")}
            </p>
            <button
              onClick={onBack}
              className="px-6 py-3 bg-dark-800 dark:bg-ivory-200 text-white dark:text-dark-800 rounded-xl font-semibold transition"
            >
              {t("fuel.back")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <button
              onClick={() => { setView("new"); setStep(0); }}
              className="w-full flex items-center gap-4 p-5 bg-white dark:bg-dark-800 rounded-2xl border border-silver/60 dark:border-dark-600 hover:border-amber-400 dark:hover:border-amber-500 active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 bg-amber-100 dark:bg-amber-900/30 rounded-xl flex items-center justify-center">
                <Plus className="w-6 h-6 text-amber-600" />
              </div>
              <div className="flex-1 text-left">
                <div className="font-bold text-dark-800 dark:text-ivory-200">{t("fuel.new_order")}</div>
                <div className="text-xs text-dark-500 dark:text-ivory-400 mt-0.5">{t("fuel.new_order_desc")}</div>
              </div>
              <ChevronRight className="w-5 h-5 text-dark-400" />
            </button>

            <button
              onClick={() => { setView("history"); loadHistory(); }}
              className="w-full flex items-center gap-4 p-5 bg-white dark:bg-dark-800 rounded-2xl border border-silver/60 dark:border-dark-600 hover:border-amber-400 dark:hover:border-amber-500 active:scale-[0.98] transition-all"
            >
              <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center">
                <History className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1 text-left">
                <div className="font-bold text-dark-800 dark:text-ivory-200">{t("fuel.order_history")}</div>
                <div className="text-xs text-dark-500 dark:text-ivory-400 mt-0.5">{t("fuel.order_history_desc")}</div>
              </div>
              <ChevronRight className="w-5 h-5 text-dark-400" />
            </button>
          </div>
        )}
      </div>
    );
  }

  // ============== VIEW: HISTORY ==============
  if (view === "history") {
    const activeOrders = historyOrders.filter((o) => isActiveStatus(o.status));
    const pastOrders = historyOrders.filter((o) => !isActiveStatus(o.status));

    return (
      <div className="animate-slideUp">
        {renderBack(t("fuel.order_history"), () => setView("menu"))}

        {historyLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
          </div>
        ) : historyOrders.length === 0 ? (
          <div className="text-center py-12 space-y-3">
            <History className="w-10 h-10 text-dark-300 dark:text-ivory-500 mx-auto" />
            <p className="text-sm text-dark-500 dark:text-ivory-400">{t("fuel.no_history")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeOrders.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
                  {t("fuel.active_orders")}
                </div>
                {activeOrders.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => openOrderTracking(order)}
                    className="w-full p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-200 dark:border-amber-800 text-left hover:border-amber-400 active:scale-[0.98] transition-all"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] || ""}`}>
                        {getStatusLabel(order.status)}
                      </span>
                      <span className="text-[10px] text-dark-400">#{order.invoice}</span>
                    </div>
                    <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
                      {order.station_name} • {order.liters}{t("fuel.liters_input")}
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-dark-500 dark:text-ivory-400">
                        {order.final_amount.toLocaleString()} {order.payment_currency}
                      </span>
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                        {t("txn.continue")} <ChevronRight className="w-3 h-3" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {pastOrders.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-dark-500 dark:text-ivory-400 uppercase tracking-wide">
                  {t("fuel.past_orders")}
                </div>
                {pastOrders.map((order) => (
                  <button
                    key={order.id}
                    onClick={() => openOrderTracking(order)}
                    className="w-full p-3 bg-white dark:bg-dark-800 rounded-2xl border border-silver/60 dark:border-dark-600 text-left"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] || ""}`}>
                        {getStatusLabel(order.status)}
                      </span>
                      <span className="text-[10px] text-dark-400">
                        {new Date(order.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "mn-MN")}
                      </span>
                    </div>
                    <div className="text-xs text-dark-800 dark:text-ivory-200">
                      {order.station_name} • {order.liters}{t("fuel.liters_input")} • {order.final_amount.toLocaleString()} {order.payment_currency}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ============== VIEW: TRACKING ==============
  if (view === "tracking" && activeOrder) {
    const isApproved = ["approved", "paid", "in_progress", "fueling_complete"].includes(activeOrder.status);
    const isPending = ["pending", "pending_payment"].includes(activeOrder.status);
    const isCompleted = activeOrder.status === "completed";
    const isRejected = activeOrder.status === "rejected";
    const isCancelled = activeOrder.status === "cancelled";
    const isTerminal = isCompleted || isRejected || isCancelled;

    const statusSteps = [
      { key: "pending", label: t("fuel.status_pending"), emoji: "⏳", active: isPending, done: isApproved || isCompleted },
      { key: "approved", label: t("fuel.status_approved"), emoji: "✅", active: isApproved, done: isCompleted },
      { key: "completed", label: t("fuel.status_completed"), emoji: "🎉", active: isCompleted, done: false },
    ];

    return (
      <div className="animate-slideUp">
        {renderBack(t("fuel.order_progress"), () => {
          setOrderPolling(false);
          setView("menu");
        })}
        <div className="space-y-4">
          {/* Order info */}
          <div className="bg-white dark:bg-dark-800 p-5 rounded-2xl border border-silver/60 dark:border-dark-600">
            <div className="text-xs text-dark-500 dark:text-ivory-400 mb-1">
              Invoice: <code className="font-mono">{activeOrder.invoice}</code>
            </div>
            <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200 mb-3">
              {activeOrder.station_name} — {activeOrder.liters}{t("fuel.liters_input")} — {activeOrder.final_amount.toLocaleString()} {activeOrder.payment_currency}
            </div>

            {isRejected ? (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl">
                <div className="text-red-600 dark:text-red-400 font-semibold text-sm">{t("fuel.cancelled_title")}</div>
                {activeOrder.rejection_comment && (
                  <div className="text-xs text-red-500 mt-1">{activeOrder.rejection_comment}</div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                {statusSteps.map((s) => (
                  <div
                    key={s.key}
                    className={`flex items-center gap-3 p-2 rounded-lg transition ${
                      s.active
                        ? "bg-amber-50 dark:bg-amber-900/20"
                        : s.done
                        ? "opacity-60"
                        : "opacity-30"
                    }`}
                  >
                    <span className="text-base">{s.done ? "✅" : s.emoji}</span>
                    <span
                      className={`text-xs ${
                        s.active ? "font-bold text-amber-700 dark:text-amber-400" : "text-dark-600 dark:text-ivory-400"
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dispenser number display */}
          {activeOrder.dispenser_number && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-2xl border border-blue-200 dark:border-blue-800 flex items-center gap-3">
              <span className="text-2xl">🔢</span>
              <div>
                <div className="text-sm font-bold text-dark-800 dark:text-ivory-200">
                  {t("fuel.dispenser_col", { number: activeOrder.dispenser_number })}
                </div>
                <div className="text-xs text-blue-600 dark:text-blue-400">
                  {isPending ? t("fuel.dispenser_pending") : t("fuel.dispenser_active")}
                </div>
              </div>
            </div>
          )}

          {/* Approval image (QR/barcode) from admin */}
          {isApproved && activeOrder.approval_image_url && (
            <div className="bg-green-50 dark:bg-green-900/10 p-4 rounded-2xl border border-green-200 dark:border-green-800 space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
                  {t("fuel.admin_qr")}
                </span>
              </div>
              <img
                src={activeOrder.approval_image_url}
                alt="QR/Barcode"
                className="max-h-48 mx-auto rounded-lg border border-green-300 dark:border-green-700"
              />
            </div>
          )}

          {/* Waiting notice for pending */}
          {isPending && (
            <div className="bg-yellow-50 dark:bg-yellow-900/10 p-4 rounded-2xl border border-yellow-200 dark:border-yellow-800">
              <div className="flex items-center gap-2 mb-1">
                <Clock className="w-4 h-4 text-yellow-600" />
                <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
                  {t("fuel.admin_checking")}
                </span>
              </div>
              <p className="text-xs text-yellow-700 dark:text-yellow-400">
                {t("fuel.please_wait")}
              </p>
            </div>
          )}

          {/* Approved notice without image */}
          {isApproved && !activeOrder.approval_image_url && (
            <div className="bg-green-50 dark:bg-green-900/10 p-4 rounded-2xl border border-green-200 dark:border-green-800">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
                  {t("fuel.order_approved")}
                </span>
              </div>
              <p className="text-xs text-green-700 dark:text-green-400">
                {t("fuel.photo_after_fuel")}
              </p>
            </div>
          )}

          {/* Completion photo upload - show when order is approved */}
          {isApproved && (
            <div className="bg-white dark:bg-dark-800 p-5 rounded-2xl border border-silver/60 dark:border-dark-600 space-y-3">
              <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
                {t("fuel.upload_pump_title")}
              </div>
              <p className="text-xs text-dark-500 dark:text-ivory-400">
                {t("fuel.upload_pump_desc")}
              </p>
              <label className="block cursor-pointer">
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileUpload(file, setPumpPhotoUrl, setPumpUploading, "pump");
                  }}
                />
                <div
                  className={`border-2 border-dashed rounded-xl p-4 text-center ${
                    pumpPhotoUrl
                      ? "border-green-400 bg-green-50 dark:bg-green-900/10"
                      : "border-silver/60 dark:border-dark-600 hover:border-amber-400"
                  }`}
                >
                  {pumpUploading ? (
                    <Loader2 className="w-6 h-6 text-amber-500 animate-spin mx-auto" />
                  ) : pumpPhotoUrl ? (
                    <div className="space-y-2">
                      <CheckCircle2 className="w-6 h-6 text-green-500 mx-auto" />
                      <img src={pumpPhotoUrl} alt="pump" className="max-h-24 mx-auto rounded-lg" />
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPumpPhotoUrl(""); }}
                        className="flex items-center gap-1 mx-auto px-3 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 transition"
                      >
                        <X className="w-3 h-3" /> {t("fuel.delete_btn")}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Camera className="w-6 h-6 text-dark-400 mx-auto" />
                      <div className="text-xs text-dark-500 dark:text-ivory-400">{t("fuel.upload_pump_btn")}</div>
                    </div>
                  )}
                </div>
              </label>
              {pumpPhotoUrl && (
                <button
                  onClick={handlePumpPhotoSubmit}
                  disabled={loading}
                  className="w-full py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {loading ? t("fuel.sending") : t("fuel.send_close_order")}
                </button>
              )}
              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-xs text-red-600">{error}</div>
              )}
            </div>
          )}

          {/* Completed success */}
          {isCompleted && (
            <div className="bg-green-50 dark:bg-green-900/10 p-5 rounded-2xl border border-green-200 dark:border-green-800 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto" />
              <div className="font-bold text-green-700 dark:text-green-400">{t("fuel.order_completed")}</div>
            </div>
          )}

          {/* Chat - for support/questions */}
          {!isTerminal && (
            <FuelChat orderId={activeOrder.id} isAdmin={false} />
          )}

          {/* Done / Back */}
          {isTerminal && (
            <button
              onClick={onSuccess}
              className="w-full py-3 bg-dark-800 dark:bg-ivory-200 text-white dark:text-dark-800 rounded-xl font-semibold transition"
            >
              {t("fuel.back")}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ============== VIEW: NEW ORDER ==============
  // Step 0: Select Station
  if (view === "new" && step === 0) {
    return (
      <div className="animate-slideUp">
        {renderBack(t("fuel.select_station"), () => setView("menu"))}
        <div className="grid grid-cols-2 gap-3">
          {stations.map((s) => (
            <button
              key={s.name}
              onClick={() => {
                setStationName(s.name);
                setDiscountPercent(s.discount_percent);
                setRequiresDispenser(s.requires_dispenser);
                setStep(1);
              }}
              className="relative bg-white dark:bg-dark-800 p-4 rounded-2xl border border-silver/60 dark:border-dark-600 text-left hover:border-amber-400 dark:hover:border-amber-500 active:scale-[0.97] transition-all"
            >
              <div className="font-semibold text-sm text-dark-800 dark:text-ivory-200 mb-1">{s.name}</div>
              <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {t("fuel.discount_badge", { percent: String(s.discount_percent) })}
              </div>
              {s.requires_dispenser && (
                <div className="text-[10px] text-blue-500 dark:text-blue-400 mt-0.5">{t("fuel.dispenser_badge")}</div>
              )}
              <div className="absolute top-2 right-2 w-6 h-6 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center">
                <Fuel className="w-3 h-3 text-amber-600" />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 1: Geolocation + Dispenser
  if (view === "new" && step === 1) {
    const hasLocation = (latitude !== null && longitude !== null) || locationText.trim().length > 0;
    const dispenserValid = !requiresDispenser || dispenserNumber.trim().length > 0;
    return (
      <div className="animate-slideUp">
        {renderBack(t("fuel.location"))}
        <div className="bg-white dark:bg-dark-800 p-5 rounded-2xl border border-silver/60 dark:border-dark-600 space-y-4">
          <div className="text-center">
            <MapPin className="w-10 h-10 text-amber-500 mx-auto mb-2" />
            <h3 className="font-bold text-dark-800 dark:text-ivory-200 text-sm">
              {t("fuel.location_title")}
            </h3>
            <p className="text-xs text-dark-500 dark:text-ivory-400 mt-1">
              {t("fuel.location_desc")}
            </p>
          </div>

          <button
            onClick={requestGeolocation}
            disabled={geoLoading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition disabled:opacity-50"
          >
            {geoLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Navigation className="w-4 h-4" />}
            {geoLoading ? t("fuel.detecting") : t("fuel.detect_location")}
          </button>

          {latitude !== null && longitude !== null && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-xl">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="text-xs text-green-700 dark:text-green-400">
                {t("fuel.location_found")} {latitude.toFixed(6)}, {longitude.toFixed(6)}
              </span>
            </div>
          )}

          {geoError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-xs text-red-600 dark:text-red-400">{geoError}</div>
          )}

          <div>
            <label className="text-xs text-dark-500 dark:text-ivory-400 mb-1 block">{t("fuel.enter_address")}</label>
            <input
              type="text"
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              placeholder={t("fuel.address_placeholder")}
              className="w-full px-4 py-3 border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {requiresDispenser && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-base">🔢</span>
                <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">{t("fuel.dispenser_number")}</span>
              </div>
              <p className="text-xs text-dark-500 dark:text-ivory-400">
                {t("fuel.dispenser_required", { station: stationName })}
              </p>
              <input
                type="text"
                inputMode="numeric"
                value={dispenserNumber}
                onChange={(e) => setDispenserNumber(e.target.value)}
                placeholder={t("fuel.dispenser_example")}
                className="w-full px-4 py-3 border border-blue-300 dark:border-blue-700 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          )}

          <button
            onClick={() => setStep(2)}
            disabled={!hasLocation || !dispenserValid}
            className="w-full py-3 bg-dark-800 dark:bg-ivory-200 text-white dark:text-dark-800 rounded-xl font-semibold transition disabled:opacity-30"
          >
            {t("txn.continue")}
          </button>
        </div>
      </div>
    );
  }

  // Step 2: Liters & Price
  if (view === "new" && step === 2) {
    const l = parseFloat(liters);
    const p = parseFloat(pricePerLiter);
    const validInput = l > 0 && p > 0;
    const previewGross = validInput ? l * p : 0;
    const previewDiscount = previewGross * discountPercent / 100;
    const previewNet = previewGross - previewDiscount;

    return (
      <div className="animate-slideUp">
        {renderBack(t("fuel.fuel_info"))}
        <div className="bg-white dark:bg-dark-800 p-5 rounded-2xl border border-silver/60 dark:border-dark-600 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-dark-800 dark:text-ivory-200">{stationName}</span>
            <span className="text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg font-medium">-{discountPercent}%</span>
          </div>

          <div>
            <label className="text-xs text-dark-500 dark:text-ivory-400 mb-1 block">{t("fuel.liters_input")}</label>
            <input
              type="number"
              inputMode="decimal"
              value={liters}
              onChange={(e) => setLiters(e.target.value)}
              placeholder={t("fuel.liters_example")}
              min="1"
              className="w-full px-4 py-3 border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>

          <div>
            <label className="text-xs text-dark-500 dark:text-ivory-400 mb-1 block">{t("fuel.dt_price")}</label>
            <div className="relative">
              <input
                type="number"
                inputMode="decimal"
                value={pricePerLiter}
                onChange={(e) => setPricePerLiter(e.target.value)}
                placeholder={t("fuel.price_example")}
                min="0.01"
                step="0.01"
                className="w-full px-4 py-3 pr-10 border border-silver/60 dark:border-dark-600 rounded-xl bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-dark-400 text-sm">₽</span>
            </div>
          </div>

          {validInput && (() => {
            const previewRounded = Math.round(previewNet / 100) * 100;
            const roundingDiff = previewRounded - previewNet;
            return (
              <div className="p-3 bg-amber-50 dark:bg-amber-900/10 rounded-xl space-y-1 text-xs">
                <div className="flex justify-between text-dark-600 dark:text-ivory-400">
                  <span>{l} {t("fuel.liters_short")} × {p}₽</span>
                  <span>{previewGross.toFixed(0)}₽</span>
                </div>
                <div className="flex justify-between text-green-600 dark:text-green-400">
                  <span>{t("fuel.discount_label", { percent: String(discountPercent) })}</span>
                  <span>-{previewDiscount.toFixed(0)}₽</span>
                </div>
                <div className="flex justify-between text-dark-600 dark:text-ivory-400">
                  <span>{t("fuel.net_amount")}</span>
                  <span>{previewNet.toFixed(0)}₽</span>
                </div>
                {roundingDiff !== 0 && (
                  <div className="flex justify-between text-dark-400 dark:text-ivory-500">
                    <span>{t("fuel.rounding")}</span>
                    <span>{roundingDiff > 0 ? "+" : ""}{roundingDiff.toFixed(0)}₽</span>
                  </div>
                )}
                <div className="border-t border-amber-200 dark:border-amber-800 pt-1 flex justify-between font-bold text-dark-800 dark:text-ivory-200">
                  <span>{t("fuel.total_pay_rub")}</span>
                  <span>{previewRounded.toLocaleString()}₽</span>
                </div>
              </div>
            );
          })()}

          <button
            onClick={() => setStep(3)}
            disabled={!validInput}
            className="w-full py-3 bg-dark-800 dark:bg-ivory-200 text-white dark:text-dark-800 rounded-xl font-semibold transition disabled:opacity-30"
          >
            {t("txn.continue")}
          </button>
        </div>
      </div>
    );
  }

  // Step 3: Payment Method
  if (view === "new" && step === 3) {
    return (
      <div className="animate-slideUp">
        {renderBack(t("fuel.payment_method"))}
        <div className="space-y-4">
          <button
            onClick={() => {
              setPaymentCurrency("RUB");
              setStep(4);
              if (!invoiceId) setInvoiceId(generateInvoiceId());
            }}
            className={`w-full p-5 rounded-2xl border-2 text-left transition-all ${
              paymentCurrency === "RUB"
                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                : "border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center text-lg">₽</div>
              <div>
                <div className="font-semibold text-sm text-dark-800 dark:text-ivory-200">{t("fuel.pay_rub")}</div>
                {calculation && (
                  <div className="text-xs text-dark-500 dark:text-ivory-400 mt-0.5">{calculation.rounded_amount.toLocaleString()}₽</div>
                )}
              </div>
            </div>
          </button>

          <button
            onClick={() => {
              setPaymentCurrency("MNT");
              setStep(4);
              if (!invoiceId) setInvoiceId(generateInvoiceId());
            }}
            className={`w-full p-5 rounded-2xl border-2 text-left transition-all ${
              paymentCurrency === "MNT"
                ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                : "border-silver/60 dark:border-dark-600 bg-white dark:bg-dark-800"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center text-lg">₮</div>
              <div>
                <div className="font-semibold text-sm text-dark-800 dark:text-ivory-200">{t("fuel.pay_mnt")}</div>
                {calculation && sellRate > 0 && (
                  <div className="text-xs text-dark-500 dark:text-ivory-400 mt-0.5">
                    {Math.round(calculation.rounded_amount * sellRate).toLocaleString()}₮ ({t("fuel.rate_hint", { rate: String(sellRate) })})
                  </div>
                )}
              </div>
            </div>
          </button>

          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div>
                <div className="font-bold text-sm text-red-700 dark:text-red-400">{t("fuel.rub_warning_title")}</div>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 leading-relaxed">
                  {t("fuel.rub_warning_text")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 4: Bank + Receipt + Submit (combined)
  if (view === "new" && step === 4) {
    return (
      <div className="animate-slideUp">
        {renderBack(t("fuel.payment_receipt_step"))}
        <div className="space-y-4">
          {/* Invoice */}
          <div className="bg-white dark:bg-dark-800 p-4 rounded-2xl border border-silver/60 dark:border-dark-600">
            <div className="text-xs text-dark-500 dark:text-ivory-400 mb-1">{t("fuel.invoice_number")}</div>
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono text-dark-800 dark:text-ivory-200">{invoiceId}</code>
              <button onClick={() => copyToClipboard(invoiceId, "invoice")} className="p-1 hover:bg-surface-100 dark:hover:bg-dark-700 rounded">
                {copied === "invoice" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-dark-400" />}
              </button>
            </div>
          </div>

          {/* Calculation summary */}
          {calculation && (
            <div className="bg-amber-50 dark:bg-amber-900/10 p-4 rounded-2xl space-y-2 text-xs">
              <div className="flex justify-between text-dark-600 dark:text-ivory-400">
                <span>🏪 {stationName}</span>
                <span>-{calculation.discount_percent}%</span>
              </div>
              <div className="flex justify-between text-dark-600 dark:text-ivory-400">
                <span>{calculation.liters}{t("fuel.liters_short")} × {calculation.station_price_per_liter}₽</span>
                <span>{calculation.gross_amount.toLocaleString()}₽</span>
              </div>
              <div className="flex justify-between text-green-600 dark:text-green-400">
                <span>{t("fuel.discount_short")}</span>
                <span>-{calculation.discount_amount.toLocaleString()}₽</span>
              </div>
              {calculation.payment_currency === "MNT" && calculation.exchange_rate && (
                <div className="flex justify-between text-dark-500 dark:text-ivory-400">
                  <span>{t("fuel.rate_prefix")} {calculation.exchange_rate}</span>
                  <span>{calculation.rounded_amount.toLocaleString()}₽ × {calculation.exchange_rate}</span>
                </div>
              )}
              <div className="border-t border-amber-200 dark:border-amber-800 pt-2 flex justify-between font-bold text-dark-800 dark:text-ivory-200 text-sm">
                <span>{t("fuel.total_pay")}</span>
                <span>{calculation.final_amount.toLocaleString()}{calculation.payment_currency === "RUB" ? "₽" : "₮"}</span>
              </div>
            </div>
          )}

          {/* RUB warning */}
          {paymentCurrency === "RUB" && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                {t("fuel.rub_warning_short")}
              </span>
            </div>
          )}

          {/* Bank selection */}
          <div className="space-y-2">
            <div className="text-xs text-dark-500 dark:text-ivory-400 font-medium">{t("fuel.transfer_to")}</div>
            {filteredBanks.length === 0 ? (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl text-xs text-yellow-700 dark:text-yellow-400">
                {t("fuel.no_bank_found", { currency: paymentCurrency || "" })}
              </div>
            ) : (
              filteredBanks.map((bank) => (
                <button
                  key={bank.id}
                  onClick={() => setSelectedBank(bank)}
                  className={`w-full p-4 rounded-xl border-2 text-left transition relative overflow-hidden ${
                    selectedBank?.id === bank.id
                      ? "border-amber-500 bg-amber-50 dark:bg-amber-900/20"
                      : "border-silver/40 dark:border-dark-600 bg-white dark:bg-dark-800"
                  }`}
                >
                  {bank.logo_url && (
                    <img
                      src={bank.logo_url}
                      alt=""
                      className="absolute right-3 top-1/2 -translate-y-1/2 h-[70%] w-auto max-w-[60px] object-contain opacity-80"
                    />
                  )}
                  <div className="font-semibold text-sm text-dark-800 dark:text-ivory-200 pr-16">{bank.bank_name}</div>
                  <div className="text-xs text-dark-500 dark:text-ivory-400 mt-1 space-y-0.5">
                    {bank.card_number && (
                      <div className="flex items-center gap-1">
                        {t("fuel.card_label")} {bank.card_number}
                        <button onClick={(e) => { e.stopPropagation(); copyToClipboard(bank.card_number!.replace(/\s/g, ""), "card"); }} className="p-0.5">
                          {copied === "card" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-dark-400" />}
                        </button>
                      </div>
                    )}
                    {bank.account_number && (
                      <div className="flex items-center gap-1">
                        {t("fuel.account_number_label")} {bank.account_number}
                        <button onClick={(e) => { e.stopPropagation(); copyToClipboard(bank.account_number!, "account"); }} className="p-0.5">
                          {copied === "account" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-dark-400" />}
                        </button>
                      </div>
                    )}
                    {bank.phone && (
                      <div className="flex items-center gap-1">
                        {t("fuel.phone_number_label")} {bank.phone}
                        <button onClick={(e) => { e.stopPropagation(); copyToClipboard(bank.phone!, "phone"); }} className="p-0.5">
                          {copied === "phone" ? <CheckCircle2 className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-dark-400" />}
                        </button>
                      </div>
                    )}
                    <div>{t("fuel.owner_label")} {bank.owner_name}</div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* MNT bank warning */}
          {paymentCurrency === "MNT" && (
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0" />
              <span className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">
                {t("fuel.mnt_bank_warning")}
              </span>
            </div>
          )}

          {/* Receipt upload */}
          <div className="bg-white dark:bg-dark-800 p-4 rounded-2xl border border-silver/60 dark:border-dark-600 space-y-3">
            <div className="text-sm font-semibold text-dark-800 dark:text-ivory-200">
              <Upload className="w-4 h-4 inline mr-1 text-amber-500" /> {t("fuel.receipt_title")}
            </div>
            <label className="block cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file, setReceiptUrl, setUploading, "receipt");
                }}
              />
              <div className={`border-2 border-dashed rounded-xl p-6 text-center transition ${
                receiptUrl
                  ? "border-green-400 bg-green-50 dark:bg-green-900/10"
                  : "border-silver/60 dark:border-dark-600 hover:border-amber-400"
              }`}>
                {uploading ? (
                  <Loader2 className="w-8 h-8 text-amber-500 animate-spin mx-auto" />
                ) : receiptUrl ? (
                  <div className="space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto" />
                    <div className="text-xs text-green-600 dark:text-green-400">{t("fuel.receipt_uploaded")}</div>
                    <img src={receiptUrl} alt="receipt" className="max-h-32 mx-auto rounded-lg" />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setReceiptUrl(""); }}
                      className="flex items-center gap-1 mx-auto px-3 py-1 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 transition"
                    >
                      <X className="w-3 h-3" /> {t("fuel.delete_photo")}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Camera className="w-8 h-8 text-dark-400 mx-auto" />
                    <div className="text-xs text-dark-500 dark:text-ivory-400">{t("fuel.select_photo")}</div>
                  </div>
                )}
              </div>
            </label>
          </div>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-xl text-xs text-red-600 dark:text-red-400">{error}</div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!receiptUrl || !selectedBank || loading}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold transition disabled:opacity-30 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fuel className="w-4 h-4" />}
            {loading ? t("fuel.submitting") : t("fuel.submit_order")}
          </button>
        </div>
      </div>
    );
  }

  // Fallback
  return null;
}
