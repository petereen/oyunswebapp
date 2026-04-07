import { useQuery } from "@tanstack/react-query";
import { useState, useMemo, useCallback } from "react";
import {
  TrendingUp, TrendingDown, BarChart3, ChevronLeft, ChevronRight,
  ArrowRightLeft, Clock, CheckCircle2, XCircle, AlertCircle, Image, X,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from "recharts";
import { fetchAnalytics, fetchHistory, fetchMe } from "../api";
import { useLang } from "../i18n/useLang";

interface MonthlyData { month: string; amount: number; }
interface AnalyticsData {
  monthly_buy: MonthlyData[];
  monthly_sell: MonthlyData[];
  total_buy_rub: number;
  total_sell_rub: number;
  total_transactions: number;
}
interface HistoryItem {
  invoice: string;
  amount: number;
  currency_from: string;
  currency_to: string;
  status: string;
  timestamp: string;
  rate: number;
  bill_url?: string;
  receipt_id?: string;
  admin_comment?: string;
}

function getStatusInfo(status: string, t: (k: string) => string) {
  switch (status) {
    case "completed":
    case "successful":
      return { label: t("stats.successful"), color: "bg-green-100 text-green-700", icon: CheckCircle2 };
    case "approved":
      return { label: t("stats.confirmed"), color: "bg-blue-100 text-blue-700", icon: CheckCircle2 };
    case "pending":
      return { label: t("stats.pending"), color: "bg-amber-100 text-amber-700", icon: Clock };
    case "rejected":
      return { label: t("stats.rejected"), color: "bg-red-100 text-red-700", icon: XCircle };
    default:
      return { label: status, color: "bg-surface-100 dark:bg-dark-700 text-dark-600 dark:text-ivory-300", icon: AlertCircle };
  }
}

function formatDate(dateStr: string, locale: string): string {
  const date = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  return date.toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function getTimeAgo(dateStr: string, t: (k: string, p?: Record<string, string | number>) => string): string {
  const then = new Date(dateStr.endsWith("Z") || dateStr.includes("+") ? dateStr : dateStr + "Z");
  const diff = Date.now() - then.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t("time.just_now");
  if (mins < 60) return t("time.min_ago", { n: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("time.hour_ago", { n: hrs });
  return t("time.day_ago", { n: Math.floor(hrs / 24) });
}

interface Props {
  userId?: number;
}

export function StatsTab({ userId }: Props) {
  const { t, lang } = useLang();
  const [section, setSection] = useState<"analytics" | "history">("analytics");
  const [periodOffset, setPeriodOffset] = useState(0);
  const [photoModal, setPhotoModal] = useState<string | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["me", userId],
    queryFn: fetchMe,
    enabled: Boolean(userId),
    staleTime: 0,
  });
  const verificationLevel = profile?.user?.verification_level ?? (profile?.user?.verified ? 2 : 0);
  const isVerified = verificationLevel >= 2;

  // Analytics - only for verified users
  const { data: analyticsData, isLoading: analyticsLoading } = useQuery<AnalyticsData>({
    queryKey: ["analytics"],
    queryFn: () => fetchAnalytics(),
    enabled: Boolean(userId) && isVerified,
  });

  // History - only for verified users
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["history", userId],
    queryFn: () => fetchHistory(),
    enabled: Boolean(userId) && isVerified,
    staleTime: 0,
  });

  if (!isVerified) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-5 animate-fadeIn">
        <div className="w-20 h-20 bg-maroon-50 dark:bg-maroon-900/30 rounded-full flex items-center justify-center">
          <BarChart3 className="w-10 h-10 text-maroon-400" />
        </div>
        <div className="text-center space-y-2">
          <div className="text-lg font-semibold text-dark-800 dark:text-ivory-200">{t("stats.verification_required")}</div>
          <div className="text-sm text-dark-600 dark:text-ivory-300">{t("stats.verification_required_desc")}</div>
        </div>
      </div>
    );
  }

  const historyItems: HistoryItem[] = historyData?.items || [];

  // Analytics helpers
  const formatMonth = (m: string) => {
    const [y, mo] = m.split("-");
    return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString(lang === "ru" ? "ru-RU" : "mn-MN", { month: "short" });
  };
  const formatMonthFull = (m: string) => {
    const [y, mo] = m.split("-");
    return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString(lang === "ru" ? "ru-RU" : "mn-MN", { year: "numeric", month: "short" });
  };

  const periodMonths = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (periodOffset * 6) - 5, 1);
    for (let i = 0; i < 6; i++) {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return months;
  }, [periodOffset]);

  const periodLabel = useMemo(() => {
    if (!periodMonths.length) return "";
    return `${formatMonthFull(periodMonths[0])} - ${formatMonthFull(periodMonths[periodMonths.length - 1])}`;
  }, [periodMonths]);

  const filteredBuyData = useMemo(() => {
    if (!analyticsData?.monthly_buy) return [];
    return periodMonths.map(m => ({ month: m, amount: analyticsData.monthly_buy.find(d => d.month === m)?.amount || 0 }));
  }, [analyticsData, periodMonths]);

  const filteredSellData = useMemo(() => {
    if (!analyticsData?.monthly_sell) return [];
    return periodMonths.map(m => ({ month: m, amount: analyticsData.monthly_sell.find(d => d.month === m)?.amount || 0 }));
  }, [analyticsData, periodMonths]);

  const maxValue = useMemo(() => Math.max(...filteredBuyData.map(d => d.amount), ...filteredSellData.map(d => d.amount), 1), [filteredBuyData, filteredSellData]);
  const periodBuyTotal = filteredBuyData.reduce((s, d) => s + d.amount, 0);
  const periodSellTotal = filteredSellData.reduce((s, d) => s + d.amount, 0);

  const hasOlderData = useMemo(() => {
    if (!analyticsData) return false;
    const all = [...(analyticsData.monthly_buy || []).map(d => d.month), ...(analyticsData.monthly_sell || []).map(d => d.month)];
    const min = all.length ? all.sort()[0] : null;
    return min ? min < periodMonths[0] : false;
  }, [analyticsData, periodMonths]);

  return (
    <div className="animate-fadeIn space-y-5">
      <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200">{t("stats.title")}</h2>

      {/* Section Toggle */}
      <div className="flex gap-1 bg-surface-100 dark:bg-dark-700 p-1 rounded-xl">
        <button
          onClick={() => setSection("analytics")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${section === "analytics" ? "bg-white dark:bg-dark-800 text-dark-800 dark:text-ivory-200 shadow-card-xs" : "text-dark-600 dark:text-ivory-400"}`}
        >
          {t("stats.analytics")}
        </button>
        <button
          onClick={() => setSection("history")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all ${section === "history" ? "bg-white dark:bg-dark-800 text-dark-800 dark:text-ivory-200 shadow-card-xs" : "text-dark-600 dark:text-ivory-400"}`}
        >
          {t("stats.history")}
        </button>
      </div>

      {/* ───── Analytics Section ───── */}
      {section === "analytics" && (
        <div className="space-y-4">
          {analyticsLoading && (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-maroon-600 mx-auto" />
              <p className="mt-3 text-dark-600 dark:text-ivory-400 text-sm">{t("stats.loading")}</p>
            </div>
          )}

          {analyticsData && !analyticsLoading && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-gradient-to-br from-green-50 to-green-100 p-3 rounded-xl border border-green-200">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingUp className="w-4 h-4 text-green-600" />
                    <span className="text-[10px] font-medium text-green-700">{t("stats.bought")}</span>
                  </div>
                  <div className="text-base font-bold text-green-800">{analyticsData.total_buy_rub.toLocaleString()} ₽</div>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-3 rounded-xl border border-blue-200">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingDown className="w-4 h-4 text-blue-600" />
                    <span className="text-[10px] font-medium text-blue-700">{t("stats.sold")}</span>
                  </div>
                  <div className="text-base font-bold text-blue-800">{analyticsData.total_sell_rub.toLocaleString()} ₮</div>
                </div>
                <div className="bg-gradient-to-br from-maroon-50 to-maroon-100 dark:from-maroon-900/30 dark:to-maroon-800/20 p-3 rounded-xl border border-maroon-200 dark:border-maroon-800">
                  <div className="flex items-center gap-1 mb-1">
                    <BarChart3 className="w-4 h-4 text-maroon-600 dark:text-maroon-400" />
                    <span className="text-[10px] font-medium text-maroon-700 dark:text-maroon-300">{t("stats.total")}</span>
                  </div>
                  <div className="text-base font-bold text-maroon-800 dark:text-maroon-200">{analyticsData.total_transactions}</div>
                </div>
              </div>

              {/* Period Navigation */}
              <div className="flex items-center justify-between bg-surface-50 dark:bg-dark-700 rounded-xl p-2.5">
                <button onClick={() => setPeriodOffset(p => p + 1)} disabled={!hasOlderData} className="p-1.5 rounded-lg hover:bg-surface-200 dark:hover:bg-dark-600 transition disabled:opacity-30">
                  <ChevronLeft className="w-5 h-5 text-dark-600 dark:text-ivory-300" />
                </button>
                <span className="font-medium text-sm text-dark-800 dark:text-ivory-200">{periodLabel}</span>
                <button onClick={() => setPeriodOffset(p => Math.max(0, p - 1))} disabled={periodOffset === 0} className="p-1.5 rounded-lg hover:bg-surface-200 dark:hover:bg-dark-600 transition disabled:opacity-30">
                  <ChevronRight className="w-5 h-5 text-dark-600 dark:text-ivory-300" />
                </button>
              </div>

              {/* Chart */}
              {(periodBuyTotal > 0 || periodSellTotal > 0) ? (
                <>
                  <div className="bg-surface-50 dark:bg-dark-700 rounded-xl p-3">
                    <div className="flex items-center gap-4 mb-3">
                      <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /><span className="text-[10px] text-dark-600 dark:text-ivory-400">{t("stats.rub_currency")}</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-blue-500" /><span className="text-[10px] text-dark-600 dark:text-ivory-400">{t("stats.mnt_currency")}</span></div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={filteredBuyData.map((d, i) => ({
                        month: formatMonth(d.month),
                        buy: d.amount,
                        sell: filteredSellData[i]?.amount || 0,
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} width={40} />
                        <Tooltip
                          contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid #e2e8f0" }}
                          formatter={(value, name) => [
                            `${Number(value).toLocaleString()} ${name === "buy" ? "₽" : "₮"}`,
                            name === "buy" ? t("stats.bought_label") : t("stats.sold_label"),
                          ]}
                        />
                        <Line type="monotone" dataKey="buy" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 4, fill: "#22c55e", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="sell" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 4, fill: "#3b82f6", stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Period Summary */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-green-50 p-3 rounded-xl border border-green-100">
                      <div className="text-xs text-green-600 mb-1">{t("stats.period_rub")}</div>
                      <div className="text-lg font-bold text-green-700">{periodBuyTotal.toLocaleString()} ₽</div>
                    </div>
                    <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                      <div className="text-xs text-blue-600 mb-1">{t("stats.period_mnt")}</div>
                      <div className="text-lg font-bold text-blue-700">{periodSellTotal.toLocaleString()} ₮</div>
                    </div>
                  </div>

                  {/* Monthly Details */}
                  <div className="space-y-2">
                    <h3 className="font-semibold text-sm text-dark-800 dark:text-ivory-200">{t("stats.monthly_breakdown")}</h3>
                    {periodMonths.map(month => {
                      const b = filteredBuyData.find(d => d.month === month)?.amount || 0;
                      const s = filteredSellData.find(d => d.month === month)?.amount || 0;
                      if (!b && !s) return null;
                      return (
                        <div key={month} className="flex items-center justify-between p-3 bg-white dark:bg-dark-800 rounded-lg border border-silver/60 dark:border-dark-600">
                          <span className="text-sm font-medium text-dark-800 dark:text-ivory-200">{formatMonthFull(month)}</span>
                          <div className="flex gap-3">
                            {b > 0 && <span className="text-sm text-green-600">+{b.toLocaleString()} ₽</span>}
                            {s > 0 && <span className="text-sm text-blue-600">+{s.toLocaleString()} ₮</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="text-center py-10 bg-surface-50 dark:bg-dark-700 rounded-xl">
                  <BarChart3 className="w-14 h-14 text-silver dark:text-dark-600 mx-auto mb-3" />
                  <p className="text-dark-600 dark:text-ivory-400 text-sm">{t("stats.no_data")}</p>
                  {hasOlderData && (
                    <button onClick={() => setPeriodOffset(p => p + 1)} className="mt-3 text-maroon-600 dark:text-gold-400 text-sm font-medium">
                      {t("stats.view_older")}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ───── History Section ───── */}
      {section === "history" && (
        <div className="space-y-3">
          {historyLoading && (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-maroon-600 mx-auto" />
              <p className="mt-3 text-dark-600 dark:text-ivory-400 text-sm">{t("stats.loading")}</p>
            </div>
          )}

          {!historyLoading && historyItems.length === 0 && (
            <div className="text-center py-10">
              <ArrowRightLeft className="w-12 h-12 text-silver dark:text-dark-600 mx-auto mb-3" />
              <div className="text-dark-600 dark:text-ivory-400 text-sm">{t("stats.no_transactions")}</div>
              <div className="text-xs text-dark-600 dark:text-ivory-400 mt-1">{t("stats.no_transactions_desc")}</div>
            </div>
          )}

          {!historyLoading && historyItems.length > 0 && historyItems.map(item => {
            const statusInfo = getStatusInfo(item.status, t);
            const StatusIcon = statusInfo.icon;
            const isBuy = item.currency_from.toUpperCase() === "RUB";
            const rate = Number(item.rate);
            const amount = Number(item.amount);
            const receiveAmount = isBuy ? Math.round(amount * rate) : parseFloat((amount / rate).toFixed(2));

            return (
              <div key={item.invoice} className="bg-white dark:bg-dark-800 rounded-2xl p-4 shadow-card-xs border border-silver/60 dark:border-dark-600">
                <div className="flex items-center justify-between mb-3">
                  <span className={`text-xs font-bold px-2 py-1 rounded ${isBuy ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}`}>
                    {isBuy ? "RUB→MNT" : "MNT→RUB"}
                  </span>
                  <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${statusInfo.color}`}>
                    <StatusIcon className="w-3.5 h-3.5" />{statusInfo.label}
                  </div>
                </div>

                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-lg font-bold text-dark-800">{amount.toLocaleString()} {item.currency_from}</div>
                    <div className="text-sm text-dark-600 dark:text-ivory-400">→ {receiveAmount.toLocaleString()} {item.currency_to}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-dark-600 dark:text-ivory-400">{t("stats.rate")}</div>
                    <div className="text-sm font-medium text-maroon-600 dark:text-gold-400">{rate.toFixed(2)}</div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-dark-600 dark:text-ivory-400 pt-2 border-t border-silver/60 dark:border-dark-600">
                  <div className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{getTimeAgo(item.timestamp, t)}</div>
                  <div>{formatDate(item.timestamp, lang === "ru" ? "ru-RU" : "mn-MN")}</div>
                </div>

                {item.status === "rejected" && item.admin_comment && (
                  <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-100">
                    <div className="text-xs text-red-600 font-medium mb-1">{t("stats.rejection_reason")}</div>
                    <div className="text-sm text-red-700">{item.admin_comment}</div>
                  </div>
                )}

                {item.bill_url && (
                  <button onClick={() => setPhotoModal(item.bill_url!)} className="mt-2 flex items-center gap-1 text-xs text-maroon-600 dark:text-gold-400 hover:text-maroon-700 dark:hover:text-gold-300">
                    <Image className="w-3.5 h-3.5" />{t("stats.view_receipt")}
                  </button>
                )}

                <div className="mt-2 text-xs text-dark-600 dark:text-ivory-400 font-mono truncate">#{item.invoice}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Photo Modal */}
      {photoModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4" onClick={() => setPhotoModal(null)}>
          <div className="relative max-w-2xl max-h-[90vh] bg-white dark:bg-dark-800 rounded-xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPhotoModal(null)} className="absolute top-2 right-2 p-2 bg-white/80 dark:bg-dark-700/80 rounded-full hover:bg-white dark:hover:bg-dark-600">
              <X className="w-5 h-5" />
            </button>
            <img src={photoModal} alt={t("common.receipt")} className="max-w-full max-h-[85vh] object-contain" />
          </div>
        </div>
      )}
    </div>
  );
}
