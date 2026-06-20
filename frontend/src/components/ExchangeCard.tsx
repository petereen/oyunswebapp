import { useState, useEffect, useMemo } from "react";
import { ArrowUpDown, Info } from "lucide-react";
import { DEFAULT_MIN_RUB_AMOUNT, DEFAULT_MIN_RUB_BUY, Rate, fetchAppSettings } from "../api";
import { useLang } from "../i18n/useLang";
import { getAppliedRateAdjustment, toSafeNumber } from "../utils/exchangePricing";

interface Props {
  rate?: Rate;
  initialDirection?: "buy" | "sell" | null;
  onProceed: (direction: "buy" | "sell", amount: number, effectiveRate: number) => void;
}

export function ExchangeCard({ rate, initialDirection, onProceed }: Props) {
  const { t } = useLang();
  const [direction, setDirection] = useState<"buy" | "sell">(initialDirection || "buy");
  const [inputValue, setInputValue] = useState("");
  const [receiveInputValue, setReceiveInputValue] = useState("");
  const [activeField, setActiveField] = useState<"from" | "to">("from");
  const [swapRotation, setSwapRotation] = useState(0);

  // Fetch exchange limits from DB
  const [minRubBuy, setMinRubBuy] = useState(DEFAULT_MIN_RUB_BUY);
  const [minRubSell, setMinRubSell] = useState(DEFAULT_MIN_RUB_AMOUNT);

  useEffect(() => {
    fetchAppSettings()
      .then((res) => {
        setMinRubBuy(res.min_rub_buy);
        setMinRubSell(res.min_rub_amount);
      })
      .catch(() => {
        setMinRubBuy(DEFAULT_MIN_RUB_BUY);
        setMinRubSell(DEFAULT_MIN_RUB_AMOUNT);
      });
  }, []);

  useEffect(() => {
    if (initialDirection) setDirection(initialDirection);
  }, [initialDirection]);

  const effectiveMinRub = direction === "buy" ? minRubBuy : minRubSell;

  const currentRate = useMemo(() => {
    if (!rate) return 0;
    return direction === "buy" ? toSafeNumber(rate.buy_rate, 0) : toSafeNumber(rate.sell_rate, 0);
  }, [direction, rate]);

  const amount = useMemo(() => {
    const cleaned = inputValue.replace(/[^0-9.]/g, "");
    return parseFloat(cleaned) || 0;
  }, [inputValue]);

  const pricing = useMemo(
    () =>
      getAppliedRateAdjustment({
        direction,
        amount,
        baseRate: currentRate,
      }),
    [direction, amount, currentRate],
  );

  const effectiveRate = pricing.effectiveRate;
  const volumeAdjustment = pricing.adjustmentSource === "volume" ? pricing.adjustment : 0;
  const rubEquivalent = pricing.rubEquivalent;

  const convertedAmount = useMemo(() => {
    if (!effectiveRate || !amount) return 0;
    return direction === "buy" ? amount * effectiveRate : amount / effectiveRate;
  }, [amount, effectiveRate, direction]);

  useEffect(() => {
    if (activeField === "from") {
      return;
    }
    if (!inputValue || !effectiveRate) {
      setReceiveInputValue("");
      return;
    }
    setReceiveInputValue(formatInput(String(Math.round(convertedAmount))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveRate, direction]);

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
      setActiveField("from");
      setInputValue(raw ? formatInput(raw) : "");
      setReceiveInputValue("");
    }
  };

  const handleReceiveInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/,/g, "");
    if (!(raw === "" || /^\d*\.?\d*$/.test(raw))) {
      return;
    }

    setActiveField("to");
    setReceiveInputValue(raw ? formatInput(raw) : "");

    if (!raw || !effectiveRate) {
      setInputValue("");
      return;
    }

    const receiveAmount = Number(raw);
    const sendAmount = direction === "buy"
      ? receiveAmount / effectiveRate
      : receiveAmount * effectiveRate;
    const normalizedSendAmount = Number.isFinite(sendAmount) ? Math.round(sendAmount) : 0;
    setInputValue(normalizedSendAmount > 0 ? formatInput(String(normalizedSendAmount)) : "");
  };

  const handleSwap = () => {
    setDirection((d) => (d === "buy" ? "sell" : "buy"));
    setSwapRotation((r) => r + 180);
    setInputValue("");
    setReceiveInputValue("");
    setActiveField("from");
  };

  const isBelowMin = amount > 0 && (direction === "sell" ? convertedAmount < effectiveMinRub : amount < effectiveMinRub);
  const canProceed = amount > 0 && !isBelowMin;

  const rateDisplay = `1 RUB = ${effectiveRate.toFixed(2)} MNT`;

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Main Exchange Card */}
      <div className="bg-white dark:bg-dark-800 rounded-3xl shadow-card-md p-6 border border-silver/60 dark:border-dark-600">
        {/* You Give section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium text-dark-600 dark:text-ivory-300 uppercase tracking-wider">{t("exchange.send")}</span>
            <span className="text-[11px] text-dark-600 dark:text-ivory-300">
              {t("exchange.min")}: {direction === "buy" ? `${effectiveMinRub.toLocaleString()} ₽` : `${Math.round(effectiveMinRub * currentRate).toLocaleString()} ₮`}
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
              onFocus={() => setActiveField("from")}
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
            aria-label={t("exchange.swap")}
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
            <span className="text-[11px] font-medium text-dark-600 dark:text-ivory-300 uppercase tracking-wider">{t("exchange.receive")}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-surface-100 dark:bg-dark-700 rounded-xl px-4 py-3 text-sm font-semibold text-dark-800 dark:text-ivory-200 flex-shrink-0">
              <span className="text-lg">{toCurrency.flag}</span>
              <span>{toCurrency.code}</span>
            </div>
            <input
              type="text"
              inputMode="numeric"
              value={activeField === "to" ? receiveInputValue : (amount > 0 ? formatDisplay(convertedAmount) : "")}
              onFocus={() => {
                if (activeField !== "to") {
                  setDirection((d) => (d === "buy" ? "sell" : "buy"));
                  setSwapRotation((r) => r + 180);
                  setInputValue("");
                  setReceiveInputValue("");
                }
                setActiveField("to");
              }}
              onChange={handleReceiveInputChange}
              placeholder="0"
              className="text-3xl font-bold text-right w-full border-none outline-none bg-transparent text-dark-800 dark:text-ivory-200 placeholder:text-silver dark:placeholder:text-dark-600"
            />
          </div>
        </div>
      </div>

      {/* Rate display strip */}
      <div className="flex items-center justify-center gap-1.5 text-[12px] text-dark-600 dark:text-ivory-300 font-medium">
        <Info className="w-3.5 h-3.5" />
        <span>{rateDisplay}</span>
        {volumeAdjustment > 0 && (
          <span className="text-green-600 dark:text-green-400">
            ({direction === "buy" ? "+" : "-"}{volumeAdjustment.toFixed(1)})
          </span>
        )}
      </div>

      {volumeAdjustment > 0 && (
        <div className="text-sm text-center text-green-700 dark:text-green-400 font-medium">
          {t("exchange.volume_discount_applied", {
            threshold: rubEquivalent >= 100_000 ? "100,000" : "50,000",
            discount: volumeAdjustment.toFixed(1),
          })}
        </div>
      )}

      {/* Min amount warning */}
      {isBelowMin && (
        <div className="text-sm text-red-500 text-center font-medium">
          {t("exchange.min_amount", { amount: effectiveMinRub.toLocaleString() })}
        </div>
      )}

      {/* Proceed button */}
      <button
        onClick={() => canProceed && onProceed(direction, amount, currentRate)}
        disabled={!canProceed}
        className="w-full bg-maroon-600 text-white py-4 rounded-2xl font-bold text-base shadow-btn hover:bg-maroon-500 active:scale-[0.97] transition-all disabled:bg-silver disabled:text-dark-600 disabled:shadow-none"
      >
        {t("exchange.proceed")}
      </button>
    </div>
  );
}
