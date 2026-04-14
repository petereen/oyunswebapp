import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, Flame, Lock } from "lucide-react";
import { GiftFlow } from "../components/GiftFlow";
import { FuelFlow } from "../components/FuelFlow";
import { fetchRates, fetchMe } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  initialFuelOrderId?: string | null;
  onFuelOrderOpened?: () => void;
}

export function ServicesTab({ initialFuelOrderId, onFuelOrderOpened }: Props = {}) {
  const [activeService, setActiveService] = useState<"gift" | "fuel" | null>(null);
  const [pendingFuelOrderId, setPendingFuelOrderId] = useState<string | null>(null);
  const { t } = useLang();

  const { data: rate } = useQuery({
    queryKey: ["rates"],
    queryFn: fetchRates,
    retry: 2,
  });

  const { data: profile } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 0,
  });

  const verificationLevel = profile?.user?.verification_level ?? (profile?.user?.verified ? 2 : 0);
  const isVerified = verificationLevel >= 2;
  const isBasicRegistered = verificationLevel >= 1;

  // Auto-open FuelFlow when navigating from status card
  useEffect(() => {
    if (initialFuelOrderId) {
      setPendingFuelOrderId(initialFuelOrderId);
      setActiveService("fuel");
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

  if (activeService === "fuel") {
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

  return (
    <div className="animate-fadeIn">
      <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200 mb-4">{t("services.title")}</h2>

      <div className="grid grid-cols-2 gap-3">
        {/* Gift Flow Card */}
        <button
          onClick={() => isVerified ? setActiveService("gift") : undefined}
          className={`relative overflow-hidden bg-gradient-to-br from-violet-500 to-purple-600 p-5 rounded-3xl text-left text-white active:scale-[0.97] transition-all shadow-lg shadow-purple-200/50 ${!isVerified ? "opacity-60 cursor-not-allowed" : "hover:from-violet-600 hover:to-purple-700"}`}
          disabled={!isVerified}
        >
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-lg" />
          {!isVerified && (
            <div className="absolute top-2 right-2">
              <Lock className="w-4 h-4 text-white/60" />
            </div>
          )}
          <Gift className="w-8 h-8 mb-3 opacity-90" />
          <div className="font-bold text-sm mb-0.5">{t("services.gift_title")}</div>
          <div className="text-[11px] text-white/60 leading-relaxed">
            {!isVerified ? t("services.requires_verification") : t("services.gift_desc")}
          </div>
        </button>

        {/* Fuel Purchase Card */}
        <button
          onClick={() => isBasicRegistered ? setActiveService("fuel") : undefined}
          className={`relative overflow-hidden bg-gradient-to-br from-amber-500 to-orange-600 p-5 rounded-3xl text-left text-white active:scale-[0.97] transition-all shadow-lg shadow-amber-200/50 ${!isBasicRegistered ? "opacity-60 cursor-not-allowed" : "hover:from-amber-600 hover:to-orange-700"}`}
          disabled={!isBasicRegistered}
        >
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-lg" />
          {!isBasicRegistered && (
            <div className="absolute top-2 right-2">
              <Lock className="w-4 h-4 text-white/60" />
            </div>
          )}
          <Flame className="w-8 h-8 mb-3 opacity-90" />
          <div className="font-bold text-sm mb-0.5">{t("services.fuel_title")}</div>
          <div className="text-[11px] text-white/60 leading-relaxed">
            {!isBasicRegistered ? t("services.requires_registration") : t("services.fuel_desc")}
          </div>
        </button>
      </div>
    </div>
  );
}
