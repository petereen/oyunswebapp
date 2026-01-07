import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import { Rate } from "../api";

interface Props {
  rate?: Rate;
  onAmountChange?: (payload: { amountFrom: number; amountTo: number; direction: "buy" | "sell" }) => void;
}

export function Converter({ rate, onAmountChange }: Props) {
  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [amountFrom, setAmountFrom] = useState<number>(0);
  const [amountTo, setAmountTo] = useState<number>(0);

  useEffect(() => {
    compute(direction, amountFrom);
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
    <div className="glass-card p-5 rounded-2xl border border-white/60 flex flex-col gap-3">
      <div className="flex items-center justify-between text-sm">
        <div className="font-semibold text-ocean-700">ВАЛЮТ ТООЦООЛУУР</div>
        <button
          className="px-3 py-1 text-xs rounded-full bg-ocean-600 text-white flex items-center gap-1"
          onClick={() => setDirection(direction === "buy" ? "sell" : "buy")}
        >
          <ArrowLeftRight className="w-4 h-4" /> 
          {direction === "buy" ? `₽ RUB → ₮ MNT` : `₮ MNT → ₽ RUB`}
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <label className="text-xs text-slate-500 flex items-center gap-1">
          Та илгээнэ ({fromCurrency.code})
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400">{fromCurrency.symbol}</span>
          <input
            type="number"
            min={0}
            value={amountFrom}
            onChange={(e) => {
              const val = Number(e.target.value || 0);
              setAmountFrom(val);
              compute(direction, val);
            }}
            className="w-full rounded-xl border border-ocean-100 bg-white/70 p-3 pl-8 text-lg focus:outline-none focus:ring-2 focus:ring-ocean-500"
          />
        </div>
        <div className="text-xs text-slate-500 flex items-center gap-1">
          Та хүлээн авна ({toCurrency.code})
        </div>
        <div className="text-2xl font-bold text-ocean-700 flex items-center gap-2">
          <span className="text-slate-400">{toCurrency.symbol}</span>
          {formatNumber(amountTo)}
        </div>
      </div>
    </div>
  );
}
