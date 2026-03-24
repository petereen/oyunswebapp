import { useState, useEffect, useMemo } from "react";
import { ArrowUpDown, Info } from "lucide-react";
import { Rate } from "../api";

interface Props {
  rate?: Rate;
  initialDirection?: "buy" | "sell" | null;
  onProceed: (direction: "buy" | "sell", amount: number, effectiveRate: number) => void;
}

export function ExchangeCard({ rate, initialDirection, onProceed }: Props) {
  const [direction, setDirection] = useState<"buy" | "sell">(initialDirection || "buy");
  const [inputValue, setInputValue] = useState("");
  const [swapRotation, setSwapRotation] = useState(0);

  useEffect(() => {
    if (initialDirection) setDirection(initialDirection);
  }, [initialDirection]);

  // RUB→MNT (buy): min 100₽ | MNT→RUB (sell): min 5000₽
  const effectiveMinRub = direction === "buy" ? 100 : 5000;

  const currentRate = useMemo(() => {
    if (!rate) return 0;
    return direction === "buy" ? Number(rate.buy_rate) : Number(rate.sell_rate);
  }, [direction, rate]);

  const amount = useMemo(() => {
    const cleaned = inputValue.replace(/[^0-9.]/g, "");
    return parseFloat(cleaned) || 0;
  }, [inputValue]);

  const convertedAmount = useMemo(() => {
    if (!currentRate || !amount) return 0;
    return direction === "buy" ? amount * currentRate : amount / currentRate;
  }, [amount, currentRate, direction]);

  const fromCurrency = direction === "buy"
    ? { symbol: "₽", flag: "🇷🇺", code: "RUB" }
    : { symbol: "₮", flag: "🇲🇳", code: "MNT" };
  const toCurrency = direction === "buy"
    ? { symbol: "₮", flag: "🇲🇳", code: "MNT" }
    : { symbol: "₽", flag: "🇷🇺", code: "RUB" };

  const formatDisplay = (value: number) =>
    value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  const formatInput = (raw: string) => {
    const cleaned = raw.replace(/[^0-9]/g, "");
    if (!cleaned) return "";
    return Number(cleaned).toLocaleString("en-US");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, "");
    if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
      setInputValue(raw ? formatInput(raw) : "");
    }
  };

  const handleSwap = () => {
    setDirection((d) => (d === "buy" ? "sell" : "buy"));
    setSwapRotation((r) => r + 180);
    setInputValue("");
  };

  const isBelowMin = amount > 0 && (direction === "sell" ? convertedAmount < effectiveMinRub : amount < effectiveMinRub);
  const canProceed = amount > 0 && !isBelowMin;

  const rateDisplay = direction === "buy"
    ? `1 RUB = ${currentRate} MNT`
    : `1 RUB = ${currentRate} MNT`;

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Main Exchange Card */}
      <div className="bg-white dark:bg-dark-800 rounded-3xl shadow-card-md p-6 border border-silver/60 dark:border-dark-600">
        {/* You Give section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium text-dark-600 dark:text-ivory-300 uppercase tracking-wider">Илгээх</span>
            <span className="text-[11px] text-dark-600 dark:text-ivory-300">
              Мин: {direction === "buy" ? `${effectiveMinRub.toLocaleString()} ₽` : `${Math.round(effectiveMinRub * currentRate).toLocaleString()} ₮`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSwap}
              className="flex items-center gap-2 bg-surface-100 dark:bg-dark-700 rounded-xl px-4 py-3 text-sm font-semibold text-dark-800 dark:text-ivory-200 hover:bg-surface-200 dark:hover:bg-dark-600 transition flex-shrink-0"
            >
              <span className="text-lg">{fromCurrency.flag}</span>
              <span>{fromCurrency.code}</span>
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={inputValue}
              onChange={handleInputChange}
              placeholder="0"
              className="text-3xl font-bold text-right w-full border-none outline-none bg-transparent text-dark-800 dark:text-ivory-200 placeholder:text-silver dark:placeholder:text-dark-600"
            />
          </div>
        </div>

        {/* Swap separator */}
        <div className="relative my-5">
          <div className="border-t border-silver dark:border-dark-600" />
          <button
            onClick={handleSwap}
            className="absolute left-6 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-white dark:bg-dark-700 border border-silver dark:border-dark-600 flex items-center justify-center hover:bg-surface-50 dark:hover:bg-dark-600 hover:border-dark-600 transition-all shadow-card-xs"
            aria-label="Чиглэл солих"
          >
            <ArrowUpDown
              className="w-4 h-4 text-dark-600 dark:text-ivory-300 transition-transform duration-300"
              style={{ transform: `rotate(${swapRotation}deg)` }}
            />
          </button>
        </div>

        {/* You Receive section */}
        <div className="mt-2">
          <div className="mb-3">
            <span className="text-[11px] font-medium text-dark-600 dark:text-ivory-300 uppercase tracking-wider">Хүлээн авах</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-surface-100 dark:bg-dark-700 rounded-xl px-4 py-3 text-sm font-semibold text-dark-800 dark:text-ivory-200 flex-shrink-0">
              <span className="text-lg">{toCurrency.flag}</span>
              <span>{toCurrency.code}</span>
            </div>
            <div className="text-3xl font-bold text-right w-full text-dark-800 dark:text-ivory-200">
              {amount > 0 ? formatDisplay(convertedAmount) : "0.00"}
            </div>
          </div>
        </div>
      </div>

      {/* Rate display strip */}
      <div className="flex items-center justify-center gap-1.5 text-[12px] text-dark-600 dark:text-ivory-300 font-medium">
        <Info className="w-3.5 h-3.5" />
        <span>{rateDisplay}</span>
      </div>

      {/* Min amount warning */}
      {isBelowMin && (
        <div className="text-sm text-red-500 text-center font-medium">
          Хамгийн бага дүн {effectiveMinRub.toLocaleString()} рубль
        </div>
      )}

      {/* Proceed button */}
      <button
        onClick={() => canProceed && onProceed(direction, amount, currentRate)}
        disabled={!canProceed}
        className="w-full bg-maroon-600 text-white py-4 rounded-2xl font-bold text-base shadow-btn hover:bg-maroon-500 active:scale-[0.97] transition-all disabled:bg-silver disabled:text-dark-600 disabled:shadow-none"
      >
        Үргэлжлүүлэх
      </button>
    </div>
  );
}
