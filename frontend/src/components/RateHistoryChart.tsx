import { useState } from "react";
import { TrendingUp, BarChart3 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { fetchRateHistory } from "../api";

const PERIODS = [
  { label: "7 хоног", days: 7 },
  { label: "1 сар", days: 30 },
  { label: "3 сар", days: 90 },
  { label: "6 сар", days: 180 },
] as const;

export function RateHistoryChart() {
  const [selectedDays, setSelectedDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["rateHistory", selectedDays],
    queryFn: () => fetchRateHistory(selectedDays),
    staleTime: 5 * 60_000,
  });

  const points = data?.points || [];

  const formatDate = (d: string) => {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("mn-MN", { month: "short", day: "numeric" });
  };

  const hasData = points.some(p => p.buy_rate !== null || p.sell_rate !== null);

  return (
    <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card-xs border border-silver/60 dark:border-dark-600">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-dark-800 dark:text-ivory-200">
          <TrendingUp className="w-4 h-4 text-maroon-600 dark:text-gold-400" />
          <span className="text-sm font-bold">Ханшийн түүх</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[9px] text-dark-600 dark:text-ivory-400">Авах</span></div>
          <div className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-blue-500" /><span className="text-[9px] text-dark-600 dark:text-ivory-400">Зарах</span></div>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-1 bg-surface-100 dark:bg-dark-700 p-1 rounded-xl mb-4">
        {PERIODS.map(p => (
          <button
            key={p.days}
            onClick={() => setSelectedDays(p.days)}
            className={`flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
              selectedDays === p.days
                ? "bg-white dark:bg-dark-800 text-dark-800 dark:text-ivory-200 shadow-card-xs"
                : "text-dark-600 dark:text-ivory-400"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-maroon-600" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <BarChart3 className="w-10 h-10 text-silver dark:text-dark-600 mb-2" />
          <p className="text-xs text-dark-600 dark:text-ivory-400">Энэ хугацааны мэдээлэл байхгүй</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={points.map(p => ({
            date: formatDate(p.date),
            buy: p.buy_rate,
            sell: p.sell_rate,
          }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10 }}
              interval="preserveStartEnd"
              minTickGap={30}
            />
            <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} width={35} />
            <Tooltip
              contentStyle={{ borderRadius: 12, fontSize: 12, border: "1px solid #e2e8f0" }}
              formatter={(value: number, name: string) => [
                `${value} ₮`,
                name === "buy" ? "Авах (RUB→MNT)" : "Зарах (MNT→RUB)",
              ]}
            />
            <Line type="monotone" dataKey="buy" stroke="#22c55e" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="sell" stroke="#3b82f6" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
