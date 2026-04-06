import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, Flame } from "lucide-react";
import { GiftFlow } from "../components/GiftFlow";
import { FuelPlaceholder } from "../components/FuelPlaceholder";
import { FuelFlow } from "../components/FuelFlow";
import { fetchRates } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  initialFuelOrderId?: string | null;
  onFuelOrderOpened?: () => void;
}

export function ServicesTab({ initialFuelOrderId, onFuelOrderOpened }: Props = {}) {
  const [activeService, setActiveService] = useState<"gift" | "fuel" | "fuel-dev" | null>(null);
  const [pendingFuelOrderId, setPendingFuelOrderId] = useState<string | null>(null);
  const { t } = useLang();

  const { data: rate } = useQuery({
    queryKey: ["rates"],
    queryFn: fetchRates,
    retry: 2,
  });

  // Auto-open FuelFlow when navigating from status card
  useEffect(() => {
    if (initialFuelOrderId) {
      setPendingFuelOrderId(initialFuelOrderId);
      setActiveService("fuel-dev");
      onFuelOrderOpened?.();
    }
  }, [initialFuelOrderId]);

  if (activeService === "gift") {
    return (
      <div className="animate-fadeIn">
        <GiftFlow
          buyRate={rate?.buy_rate || 0}
          sellRate={rate?.sell_rate || 0}
          onBack={() => setActiveService(null)}
          onSuccess={() => setActiveService(null)}
        />
      </div>
    );
  }

  if (activeService === "fuel-dev") {
    return (
      <div className="animate-fadeIn">
        <FuelFlow
          sellRate={rate?.sell_rate || 0}
          onBack={() => { setActiveService(null); setPendingFuelOrderId(null); }}
          onSuccess={() => { setActiveService(null); setPendingFuelOrderId(null); }}
          initialOrderId={pendingFuelOrderId || undefined}
        />
      </div>
    );
  }

  if (activeService === "fuel") {
    return <FuelPlaceholder onBack={() => setActiveService(null)} onDevEnter={() => setActiveService("fuel-dev")} />;
  }

  return (
    <div className="animate-fadeIn">
      <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200 mb-4">{t("services.title")}</h2>

      <div className="grid grid-cols-2 gap-3">
        {/* Gift Flow Card */}
        <button
          onClick={() => setActiveService("gift")}
          className="relative overflow-hidden bg-gradient-to-br from-violet-500 to-purple-600 p-5 rounded-3xl text-left text-white hover:from-violet-600 hover:to-purple-700 active:scale-[0.97] transition-all shadow-lg shadow-purple-200/50"
        >
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-lg" />
          <Gift className="w-8 h-8 mb-3 opacity-90" />
          <div className="font-bold text-sm mb-0.5">{t("services.gift_title")}</div>
          <div className="text-[11px] text-white/60 leading-relaxed">{t("services.gift_desc")}</div>
        </button>

        {/* Fuel Purchase Card */}
        <button
          onClick={() => setActiveService("fuel")}
          className="relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-600 p-5 rounded-3xl text-left text-white hover:from-amber-600 hover:to-orange-700 active:scale-[0.97] transition-all shadow-lg shadow-amber-200/50"
        >
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-lg" />
          <Flame className="w-8 h-8 mb-3 opacity-90" />
          <div className="font-bold text-sm mb-0.5">{t("services.fuel_title")}</div>
          <div className="text-[11px] text-white/60 leading-relaxed">{t("services.fuel_desc")}</div>
        </button>
      </div>
    </div>
  );
}
