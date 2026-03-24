import { TrendingUp, Clock3 } from "lucide-react";

export function RateHistoryChart() {
  return (
    <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card-xs border border-silver/60 dark:border-dark-600">
      <div className="flex items-center gap-2 text-dark-800 dark:text-ivory-200 mb-4">
        <TrendingUp className="w-4 h-4 text-maroon-600 dark:text-gold-400" />
        <span className="text-sm font-bold">Ханшийн түүх</span>
      </div>
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="w-14 h-14 bg-surface-100 dark:bg-dark-700 rounded-2xl flex items-center justify-center mb-3">
          <Clock3 className="w-7 h-7 text-silver dark:text-dark-600" />
        </div>
        <p className="text-sm font-medium text-dark-600 dark:text-ivory-400 mb-0.5">Удахгүй нэмэгдэнэ</p>
        <p className="text-[11px] text-dark-600 dark:text-ivory-400">Ханшийн өөрчлөлтийн график</p>
      </div>
    </div>
  );
}
