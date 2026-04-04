import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Rate } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  rate?: Rate;
  onAmountChange?: (payload: { amountFrom: number; amountTo: number; direction: "buy" | "sell" }) => void;
}

export function Converter({ rate, onAmountChange }: Props) {
  const { t } = useLang();
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [amountFrom, setAmountFrom] = useState<string>("");
  const [amountTo, setAmountTo] = useState<number>(0);

  useEffect(() => {
    compute(direction, amountFrom ? Number(amountFrom) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, rate]);

  const formatNumber = (value: number) =>
    value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const compute = (dir: "buy" | "sell", input: number) => {
    if (!rate) return;
    const fx = dir === "buy" ? rate.buy_rate : rate.sell_rate;
    const converted = dir === "buy" ? input * fx : input / fx;
    setAmountTo(Number(converted.toFixed(2)));
    onAmountChange?.({ amountFrom: input, amountTo: converted, direction: dir });
  };

  const fromCurrency = direction === "buy" ? { symbol: "₽", flag: "🇷🇺", code: "RUB" } : { symbol: "₮", flag: "🇲🇳", code: "MNT" };
  const toCurrency = direction === "buy" ? { symbol: "₮", flag: "🇲🇳", code: "MNT" } : { symbol: "₽", flag: "🇷🇺", code: "RUB" };

  return (
    <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-dark-800 dark:text-ivory-200 tracking-wide">{t("converter.title")}</div>
        <button
          className="px-3 py-1.5 text-[11px] rounded-xl bg-surface-100 dark:bg-dark-700 text-dark-600 dark:text-ivory-300 font-medium flex items-center gap-1.5 hover:bg-surface-200 dark:hover:bg-dark-600 transition"
          onClick={() => setDirection(direction === "buy" ? "sell" : "buy")}
        >
          <ArrowLeftRight className="w-3.5 h-3.5" /> 
          {direction === "buy" ? `RUB → MNT` : `MNT → RUB`}
        </button>
      </div>
      <div className="space-y-3">
        <div className="bg-surface-50 dark:bg-dark-700 rounded-xl p-3.5">
          <div className="text-[11px] text-dark-600 dark:text-ivory-300 font-medium mb-1">{t("converter.send")} ({fromCurrency.code})</div>
          <div className="relative">
            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-base text-dark-600 dark:text-ivory-300 font-medium">{fromCurrency.flag}</span>
            <input
              type="number"
              min={0}
              value={amountFrom}
              placeholder="0"
              onChange={(e) => {
                const val = e.target.value;
                setAmountFrom(val);
                compute(direction, val ? Number(val) : 0);
              }}
              className="w-full bg-transparent pl-7 text-2xl font-bold text-dark-800 dark:text-ivory-200 focus:outline-none"
            />
          </div>
        </div>
        <div className="bg-surface-50 dark:bg-dark-700 rounded-xl p-3.5">
          <div className="text-[11px] text-dark-600 dark:text-ivory-300 font-medium mb-1">{t("converter.receive")} ({toCurrency.code})</div>
          <div className="text-2xl font-bold text-dark-800 dark:text-ivory-200 flex items-center gap-2">
            <span className="text-base">{toCurrency.flag}</span>
            {formatNumber(amountTo)}
          </div>
        </div>
      </div>
    </div>
  );
}
