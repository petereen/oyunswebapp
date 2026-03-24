import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { TrendingUp, TrendingDown, BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { fetchAnalytics } from "../api";

interface AnalyticsModalProps {
  onClose: () => void;
}

interface MonthlyData {
  month: string;
  amount: number;
}

interface AnalyticsData {
  monthly_buy: MonthlyData[];
  monthly_sell: MonthlyData[];
  total_buy_rub: number;
  total_sell_rub: number;
  total_transactions: number;
}

export function AnalyticsModal({ onClose }: AnalyticsModalProps) {
  const [periodOffset, setPeriodOffset] = useState(0); // 0 = current 6 months, 1 = previous 6 months, etc.

  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ["analytics"],
    queryFn: () => fetchAnalytics(),
  });

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split("-");
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString("mn-MN", { month: "short" });
  };

  const formatMonthFull = (monthStr: string) => {
    const [year, month] = monthStr.split("-");
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString("mn-MN", { year: "numeric", month: "short" });
  };

  // Generate all months for the current period (last 6 months from current offset)
  const periodMonths = useMemo(() => {
    const months: string[] = [];
    const now = new Date();
    const startMonth = new Date(now.getFullYear(), now.getMonth() - (periodOffset * 6) - 5, 1);
    
    for (let i = 0; i < 6; i++) {
      const date = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
      months.push(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }, [periodOffset]);

  // Get period label
  const periodLabel = useMemo(() => {
    if (periodMonths.length === 0) return "";
    const start = formatMonthFull(periodMonths[0]);
    const end = formatMonthFull(periodMonths[periodMonths.length - 1]);
    return `${start} - ${end}`;
  }, [periodMonths]);

  // Filter data for current period
  const filteredBuyData = useMemo(() => {
    if (!data?.monthly_buy) return [];
    return periodMonths.map(month => {
      const found = data.monthly_buy.find(d => d.month === month);
      return { month, amount: found?.amount || 0 };
    });
  }, [data, periodMonths]);

  const filteredSellData = useMemo(() => {
    if (!data?.monthly_sell) return [];
    return periodMonths.map(month => {
      const found = data.monthly_sell.find(d => d.month === month);
      return { month, amount: found?.amount || 0 };
    });
  }, [data, periodMonths]);

  // Calculate max for chart scaling
  const maxValue = useMemo(() => {
    const allValues = [...filteredBuyData.map(d => d.amount), ...filteredSellData.map(d => d.amount)];
    return Math.max(...allValues, 1);
  }, [filteredBuyData, filteredSellData]);

  // Period totals
  const periodBuyTotal = filteredBuyData.reduce((sum, d) => sum + d.amount, 0);
  const periodSellTotal = filteredSellData.reduce((sum, d) => sum + d.amount, 0);

  // Check if there are older periods with data
  const hasOlderData = useMemo(() => {
    if (!data) return false;
    const allMonths = [...(data.monthly_buy || []).map(d => d.month), ...(data.monthly_sell || []).map(d => d.month)];
    const minMonth = allMonths.length > 0 ? allMonths.sort()[0] : null;
    if (!minMonth) return false;
    const oldestPeriodMonth = periodMonths[0];
    return minMonth < oldestPeriodMonth;
  }, [data, periodMonths]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-maroon-100 rounded-lg">
              <BarChart3 className="w-6 h-6 text-maroon-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-maroon-700">Гүйлгээний статистик</h2>
              <p className="text-sm text-slate-500">Сарын гүйлгээний түүх</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {isLoading && (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-maroon-600 mx-auto"></div>
              <p className="mt-4 text-slate-500">Уншиж байна...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl">
              Статистик татахад алдаа гарлаа
            </div>
          )}

          {data && !isLoading && (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-xl border border-green-200">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-5 h-5 text-green-600" />
                    <span className="text-sm font-medium text-green-700">Нийт худалдан авсан </span>
                  </div>
                  <div className="text-2xl font-bold text-green-800">
                    {data.total_buy_rub.toLocaleString()} ₽
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingDown className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">Нийт худалдан авсан төгрөг</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-800">
                    {data.total_sell_rub.toLocaleString()} ₮
                  </div>
                </div>

                <div className="bg-gradient-to-br from-maroon-50 to-maroon-100 p-4 rounded-xl border border-maroon-200">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-5 h-5 text-maroon-600" />
                    <span className="text-sm font-medium text-maroon-700">Нийт гүйлгээ</span>
                  </div>
                  <div className="text-2xl font-bold text-maroon-800">
                    {data.total_transactions}
                  </div>
                </div>
              </div>

              {/* Period Navigation */}
              <div className="flex items-center justify-between bg-slate-50 rounded-xl p-3">
                <button
                  onClick={() => setPeriodOffset(prev => prev + 1)}
                  disabled={!hasOlderData}
                  className="p-2 rounded-lg hover:bg-slate-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Өмнөх үе"
                >
                  <ChevronLeft className="w-5 h-5 text-slate-600" />
                </button>
                <span className="font-medium text-slate-700">{periodLabel}</span>
                <button
                  onClick={() => setPeriodOffset(prev => Math.max(0, prev - 1))}
                  disabled={periodOffset === 0}
                  className="p-2 rounded-lg hover:bg-slate-200 transition disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Дараах үе"
                >
                  <ChevronRight className="w-5 h-5 text-slate-600" />
                </button>
              </div>

              {/* Line Chart */}
              {(periodBuyTotal > 0 || periodSellTotal > 0) ? (
                <div className="space-y-6">
                  {/* Chart Container */}
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                        <span className="text-xs text-slate-600">Рубль худалдан авалт (₽)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="text-xs text-slate-600">Төгрөг худалдан авалт (₮)</span>
                      </div>
                    </div>

                    {/* Line Chart SVG */}
                    <div className="relative h-64">
                      <svg className="w-full h-full" viewBox="0 0 600 200" preserveAspectRatio="none">
                        {/* Grid lines */}
                        {[0, 25, 50, 75, 100].map((y) => (
                          <line
                            key={y}
                            x1="50"
                            y1={200 - y * 1.8}
                            x2="580"
                            y2={200 - y * 1.8}
                            stroke="#e2e8f0"
                            strokeWidth="1"
                          />
                        ))}

                        {/* Y-axis labels */}
                        {[0, 25, 50, 75, 100].map((percent) => (
                          <text
                            key={percent}
                            x="45"
                            y={200 - percent * 1.8 + 4}
                            textAnchor="end"
                            className="text-[10px] fill-slate-400"
                          >
                            {Math.round((maxValue * percent) / 100).toLocaleString()}
                          </text>
                        ))}

                        {/* Buy Line (Green) */}
                        <polyline
                          fill="none"
                          stroke="#22c55e"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={filteredBuyData
                            .map((d, i) => {
                              const x = 50 + (i * 530) / (filteredBuyData.length - 1 || 1);
                              const y = 200 - (d.amount / maxValue) * 180;
                              return `${x},${y}`;
                            })
                            .join(" ")}
                        />

                        {/* Buy Points */}
                        {filteredBuyData.map((d, i) => {
                          const x = 50 + (i * 530) / (filteredBuyData.length - 1 || 1);
                          const y = 200 - (d.amount / maxValue) * 180;
                          return (
                            <g key={`buy-${i}`}>
                              <circle cx={x} cy={y} r="6" fill="#22c55e" />
                              <circle cx={x} cy={y} r="3" fill="white" />
                            </g>
                          );
                        })}

                        {/* Sell Line (Blue) */}
                        <polyline
                          fill="none"
                          stroke="#3b82f6"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          points={filteredSellData
                            .map((d, i) => {
                              const x = 50 + (i * 530) / (filteredSellData.length - 1 || 1);
                              const y = 200 - (d.amount / maxValue) * 180;
                              return `${x},${y}`;
                            })
                            .join(" ")}
                        />

                        {/* Sell Points */}
                        {filteredSellData.map((d, i) => {
                          const x = 50 + (i * 530) / (filteredSellData.length - 1 || 1);
                          const y = 200 - (d.amount / maxValue) * 180;
                          return (
                            <g key={`sell-${i}`}>
                              <circle cx={x} cy={y} r="6" fill="#3b82f6" />
                              <circle cx={x} cy={y} r="3" fill="white" />
                            </g>
                          );
                        })}

                        {/* X-axis labels */}
                        {filteredBuyData.map((d, i) => {
                          const x = 50 + (i * 530) / (filteredBuyData.length - 1 || 1);
                          return (
                            <text
                              key={`label-${i}`}
                              x={x}
                              y="218"
                              textAnchor="middle"
                              className="text-[10px] fill-slate-500"
                            >
                              {formatMonth(d.month)}
                            </text>
                          );
                        })}
                      </svg>
                    </div>
                  </div>

                  {/* Period Summary */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-green-50 p-4 rounded-xl border border-green-100">
                      <div className="text-sm text-green-600 mb-1">Энэ үеийн рубль худалдан авалт</div>
                      <div className="text-xl font-bold text-green-700">
                        {periodBuyTotal.toLocaleString()} ₽
                      </div>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                      <div className="text-sm text-blue-600 mb-1">Энэ үеийн төгрөг худалдан авалт</div>
                      <div className="text-xl font-bold text-blue-700">
                        {periodSellTotal.toLocaleString()} ₮
                      </div>
                    </div>
                  </div>

                  {/* Monthly Details */}
                  <div className="space-y-4">
                    <h3 className="font-semibold text-slate-700">Сар бүрийн задаргаа</h3>
                    <div className="space-y-2">
                      {periodMonths.map((month) => {
                        const buyAmount = filteredBuyData.find(d => d.month === month)?.amount || 0;
                        const sellAmount = filteredSellData.find(d => d.month === month)?.amount || 0;
                        
                        if (buyAmount === 0 && sellAmount === 0) return null;
                        
                        return (
                          <div key={month} className="flex items-center justify-between p-3 bg-white rounded-lg border border-slate-100">
                            <span className="text-sm font-medium text-slate-700">{formatMonthFull(month)}</span>
                            <div className="flex gap-4">
                              {buyAmount > 0 && (
                                <span className="text-sm text-green-600">+{buyAmount.toLocaleString()} ₽</span>
                              )}
                              {sellAmount > 0 && (
                                <span className="text-sm text-blue-600">+{sellAmount.toLocaleString()} ₮</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                  <BarChart3 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500">Энэ үед гүйлгээний мэдээлэл байхгүй байна</p>
                  {hasOlderData && (
                    <button
                      onClick={() => setPeriodOffset(prev => prev + 1)}
                      className="mt-4 text-maroon-600 hover:text-maroon-700 text-sm font-medium"
                    >
                      ← Өмнөх үе харах
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t p-6 bg-slate-50">
          <button
            onClick={onClose}
            className="w-full bg-maroon-600 text-white py-3 rounded-xl font-semibold hover:bg-maroon-700 transition"
          >
            Хаах
          </button>
        </div>
      </div>
    </div>
  );
}
