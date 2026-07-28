import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flame, Gift, Lock, Plane, Smartphone } from "lucide-react";
import { GiftFlow } from "../components/GiftFlow";
import { FuelFlow } from "../components/FuelFlow";
import { TopupFlow } from "../components/TopupFlow";
import { EmailVerificationModal } from "../components/EmailVerificationModal";
import { fetchRates, fetchMe, fetchAppSettings, fetchServiceStatus } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  initialFuelOrderId?: string | null;
  onFuelOrderOpened?: () => void;
}

export function ServicesTab({ initialFuelOrderId, onFuelOrderOpened }: Props = {}) {
  const [activeService, setActiveService] = useState<"gift" | "fuel" | "topup" | null>(null);
  const [pendingFuelOrderId, setPendingFuelOrderId] = useState<string | null>(null);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const queryClient = useQueryClient();
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

  const { data: serviceStatus } = useQuery({
    queryKey: ["service-status"],
    queryFn: fetchServiceStatus,
    refetchInterval: 60000,
  });
  const { data: appSettings } = useQuery({
    queryKey: ["app-settings"],
    queryFn: fetchAppSettings,
    retry: 1,
  });

  const verificationLevel = profile?.user?.verification_level ?? (profile?.user?.verified ? 2 : 0);
  const isVerified = verificationLevel >= 2;
  const isBasicRegistered = verificationLevel >= 1;
  const emailVerificationPending = Boolean(profile?.user?.email_verification_pending);
  const needsEmailVerification = (isBasicRegistered || Boolean(profile?.user?.verified) || Boolean(profile?.user?.ready_for_verification))
    && (appSettings?.email_verification_enabled ?? 1) > 0
    && (emailVerificationPending || !profile?.user?.email_verified_at);
  const isServiceOpen = serviceStatus?.is_open ?? true;
  const serviceBlockedMessage = serviceStatus?.message || "Үйлчилгээ түр хаалттай байна";
  const isGiftDisabled = !isVerified || !isServiceOpen;
  const isTopupDisabled = !isBasicRegistered || !isServiceOpen;

  const openMoneyService = (service: "gift" | "fuel" | "topup") => {
    if (needsEmailVerification) {
      setShowEmailVerification(true);
      return;
    }
    setActiveService(service);
  };

  // Auto-open FuelFlow when navigating from status card
  useEffect(() => {
    if (initialFuelOrderId) {
      setPendingFuelOrderId(initialFuelOrderId);
      if (needsEmailVerification) {
        setShowEmailVerification(true);
      } else {
        setActiveService("fuel");
      }
      onFuelOrderOpened?.();
    }
  }, [initialFuelOrderId, needsEmailVerification, onFuelOrderOpened]);

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

  if (activeService === "topup") {
    return (
      <div className="animate-fadeIn">
        <TopupFlow
          sellRate={rate?.sell_rate || 0}
          onBack={() => setActiveService(null)}
          onSuccess={() => setActiveService(null)}
        />
      </div>
    );
  }

  const handleTicketBooking = () => {
    const url = "https://t.me/OYUNS_Finance";
    const telegram = (window as any).Telegram?.WebApp;
    if (telegram?.openTelegramLink) {
      telegram.openTelegramLink(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="animate-fadeIn">
      <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200 mb-4">{t("services.title")}</h2>

      {!isServiceOpen && (
        <div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-200">
          {serviceBlockedMessage}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Gift Flow Card */}
        <button
          onClick={() => !isGiftDisabled ? openMoneyService("gift") : undefined}
          className={`relative overflow-hidden bg-gradient-to-br from-violet-500 to-purple-600 p-5 rounded-3xl text-left text-white active:scale-[0.97] transition-all shadow-lg shadow-purple-200/50 ${isGiftDisabled ? "opacity-60 cursor-not-allowed" : "hover:from-violet-600 hover:to-purple-700"}`}
          disabled={isGiftDisabled}
        >
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-lg" />
          {isGiftDisabled && (
            <div className="absolute top-2 right-2">
              <Lock className="w-4 h-4 text-white/60" />
            </div>
          )}
          <Gift className="w-8 h-8 mb-3 opacity-90" />
          <div className="font-bold text-sm mb-0.5">{t("services.gift_title")}</div>
          <div className="text-[11px] text-white/60 leading-relaxed">
            {!isServiceOpen ? serviceBlockedMessage : (!isVerified ? t("services.requires_verification") : t("services.gift_desc"))}
          </div>
        </button>

        {/* Fuel Purchase Card */}
        <button
          onClick={() => isBasicRegistered ? openMoneyService("fuel") : undefined}
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

        <button
          onClick={() => !isTopupDisabled ? openMoneyService("topup") : undefined}
          className={`relative overflow-hidden bg-gradient-to-br from-sky-500 to-cyan-600 p-5 rounded-3xl text-left text-white active:scale-[0.97] transition-all shadow-lg shadow-sky-200/50 ${isTopupDisabled ? "opacity-60 cursor-not-allowed" : "hover:from-sky-600 hover:to-cyan-700"}`}
          disabled={isTopupDisabled}
        >
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-lg" />
          {isTopupDisabled && (
            <div className="absolute top-2 right-2">
              <Lock className="w-4 h-4 text-white/60" />
            </div>
          )}
          <Smartphone className="w-8 h-8 mb-3 opacity-90" />
          <div className="font-bold text-sm mb-0.5">{t("services.topup_title")}</div>
          <div className="text-[11px] text-white/60 leading-relaxed">
            {!isServiceOpen ? serviceBlockedMessage : (!isBasicRegistered ? t("services.requires_registration") : t("services.topup_desc"))}
          </div>
        </button>

        <button
          onClick={handleTicketBooking}
          className="relative overflow-hidden bg-gradient-to-br from-rose-500 to-red-600 p-5 rounded-3xl text-left text-white active:scale-[0.97] transition-all shadow-lg shadow-rose-200/50 hover:from-rose-600 hover:to-red-700"
        >
          <div className="absolute -top-4 -right-4 w-20 h-20 bg-white/10 rounded-full blur-lg" />
          <Plane className="w-8 h-8 mb-3 opacity-90" />
          <div className="font-bold text-sm mb-0.5">{t("services.ticket_title")}</div>
          <div className="text-[11px] text-white/60 leading-relaxed">{t("services.ticket_desc")}</div>
        </button>
      </div>

      {showEmailVerification && (
        <EmailVerificationModal
          emailAddress={profile?.user?.email || ""}
          allowEditEmail
          onClose={() => setShowEmailVerification(false)}
          onVerified={() => {
            setShowEmailVerification(false);
            queryClient.invalidateQueries({ queryKey: ["me"] });
          }}
        />
      )}
    </div>
  );
}
