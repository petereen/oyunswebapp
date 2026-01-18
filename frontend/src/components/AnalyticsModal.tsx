import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, BarChart3 } from "lucide-react";
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
  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ["analytics"],
    queryFn: () => fetchAnalytics(),
  });

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split("-");
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString("mn-MN", { year: "numeric", month: "short" });
  };

  const maxBuy = data?.monthly_buy.length ? Math.max(...data.monthly_buy.map(d => d.amount)) : 0;
  const maxSell = data?.monthly_sell.length ? Math.max(...data.monthly_sell.map(d => d.amount)) : 0;
  const maxValue = Math.max(maxBuy, maxSell) || 1;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-ocean-100 rounded-lg">
              <BarChart3 className="w-6 h-6 text-ocean-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-ocean-700">Гүйлгээний статистик</h2>
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
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ocean-600 mx-auto"></div>
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
                    <span className="text-sm font-medium text-green-700">Худалдан авсан</span>
                  </div>
                  <div className="text-2xl font-bold text-green-800">
                    {data.total_buy_rub.toLocaleString()} ₽
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-xl border border-blue-200">
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingDown className="w-5 h-5 text-blue-600" />
                    <span className="text-sm font-medium text-blue-700">Зарсан</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-800">
                    {data.total_sell_rub.toLocaleString()} ₮
                  </div>
                </div>

                <div className="bg-gradient-to-br from-ocean-50 to-ocean-100 p-4 rounded-xl border border-ocean-200">
                  <div className="flex items-center gap-2 mb-2">
                    <BarChart3 className="w-5 h-5 text-ocean-600" />
                    <span className="text-sm font-medium text-ocean-700">Нийт гүйлгээ</span>
                  </div>
                  <div className="text-2xl font-bold text-ocean-800">
                    {data.total_transactions}
                  </div>
                </div>
              </div>

              {/* Charts */}
              {data.monthly_buy.length === 0 && data.monthly_sell.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl">
                  <BarChart3 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                  <p className="text-slate-500">Одоогоор гүйлгээний мэдээлэл байхгүй байна</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Buy Transactions Chart */}
                  {data.monthly_buy.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-green-700 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5" />
                        Худалдан авалт (₽)
                      </h3>
                      <div className="space-y-2">
                        {data.monthly_buy.map((item, idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">{formatMonth(item.month)}</span>
                              <span className="font-semibold text-green-700">
                                {item.amount.toLocaleString()} ₽
                              </span>
                            </div>
                            <div className="h-8 bg-slate-100 rounded-lg overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-green-400 to-green-500 transition-all duration-500"
                                style={{ width: `${(item.amount / maxValue) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sell Transactions Chart */}
                  {data.monthly_sell.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-blue-700 flex items-center gap-2">
                        <TrendingDown className="w-5 h-5" />
                        Борлуулалт (₮)
                      </h3>
                      <div className="space-y-2">
                        {data.monthly_sell.map((item, idx) => (
                          <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-600">{formatMonth(item.month)}</span>
                              <span className="font-semibold text-blue-700">
                                {item.amount.toLocaleString()} ₮
                              </span>
                            </div>
                            <div className="h-8 bg-slate-100 rounded-lg overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-blue-400 to-blue-500 transition-all duration-500"
                                style={{ width: `${(item.amount / maxValue) * 100}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
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
            className="w-full bg-ocean-600 text-white py-3 rounded-xl font-semibold hover:bg-ocean-700 transition"
          >
            Хаах
          </button>
        </div>
      </div>
    </div>
  );
}
