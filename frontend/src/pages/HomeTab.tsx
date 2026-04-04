import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { User, UserPlus, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Loader2, Clock, AlertCircle, Sun, Moon, Languages } from "lucide-react";
import { Converter } from "../components/Converter";
import { RateCard } from "../components/RateCard";
import { RateHistoryChart } from "../components/RateHistoryChart";
import { TransactionStatusTracker } from "../components/TransactionStatusTracker";
import { PendingGiftBanner } from "../components/PendingGiftBanner";
import { GiftStatusTracker } from "../components/GiftStatusTracker";
import { FuelStatusTracker } from "../components/FuelStatusTracker";
import { RegistrationModal } from "../components/RegistrationModal";
import { RequiredInfoModal } from "../components/RequiredInfoModal";
import { fetchRates, fetchMe, fetchServiceStatus } from "../api";
import { TelegramUser } from "../hooks/useTelegramAuth";
import { useTheme } from "../hooks/useTheme";
import { useLang } from "../i18n/useLang";

interface Props {
  initData: string;
  user: TelegramUser | null;
  isAuthenticating?: boolean;
  authError?: string | null;
  onNavigateToTransaction: (direction?: "buy" | "sell") => void;
  onNavigateToProfile: () => void;
  onNavigateToFuelOrder?: (orderId: string) => void;
}

export function HomeTab({ initData, user, isAuthenticating, authError, onNavigateToTransaction, onNavigateToProfile, onNavigateToFuelOrder }: Props) {
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const { lang, setLang, t } = useLang();

  const { data: rate } = useQuery({
    queryKey: ["rates"],
    queryFn: () => fetchRates(),
    retry: 2,
  });

  const { data: serviceStatus } = useQuery({
    queryKey: ["serviceStatus"],
    queryFn: () => fetchServiceStatus(),
    retry: 2,
    refetchInterval: 60000,
  });

  const { data: profile, error: profileError } = useQuery({
    queryKey: ["me", user?.id],
    queryFn: () => fetchMe(),
    enabled: Boolean(user?.id) && !isAuthenticating,
    staleTime: 0,
  });

  const userProfile = profile?.user;
  const isVerified = userProfile?.verified === true;
  const needsRegistration = userProfile && userProfile.verified === false && userProfile.ready_for_verification === false;
  const pendingVerification = userProfile && userProfile.verified === false && userProfile.ready_for_verification === true;

  const missingEmail = isVerified && !userProfile?.email?.trim();
  const getMntPhone = (bankMnt: string | undefined) => {
    if (!bankMnt) return "";
    const parts = bankMnt.split(",");
    return parts[3]?.trim() || "";
  };
  const mntPhone = getMntPhone(userProfile?.bank_mnt);
  const missingPhoneMnt = !mntPhone;
  const missingRequiredInfo = missingEmail || missingPhoneMnt;

  const [showRegistration, setShowRegistration] = useState(false);
  const [showRequiredInfo, setShowRequiredInfo] = useState(false);
  const [direction, setDirection] = useState<"buy" | "sell">("buy");

  const handleRegistered = () => {
    queryClient.invalidateQueries({ queryKey: ["me", user?.id] });
    setShowRegistration(false);
  };

  const handleRequiredInfoSaved = () => {
    queryClient.invalidateQueries({ queryKey: ["me", user?.id] });
    setShowRequiredInfo(false);
  };

  const handleBuySell = (dir: "buy" | "sell") => {
    if (missingRequiredInfo) {
      setShowRequiredInfo(true);
    } else {
      onNavigateToTransaction(dir);
    }
  };

  const handleTransactionShortcut = () => {
    if (missingRequiredInfo) {
      setShowRequiredInfo(true);
    } else {
      onNavigateToTransaction();
    }
  };

  const isServiceOpen = serviceStatus?.is_open !== false;

  if (isAuthenticating) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-12 h-12 text-maroon-600 animate-spin" />
        <div className="text-lg font-medium text-dark-800 dark:text-ivory-200">{t("home.logging_in")}</div>
        <div className="text-sm text-dark-600 dark:text-ivory-300">{t("home.please_wait")}</div>
      </div>
    );
  }

  if (authError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <div className="text-lg font-medium text-red-700 dark:text-red-400">{t("home.login_failed")}</div>
        <div className="text-sm text-dark-600 dark:text-ivory-300 text-center max-w-md">{authError}</div>
        <div className="text-xs text-dark-600 dark:text-ivory-400 mt-2">{t("home.open_in_telegram")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fadeIn">
      {/* Header Bar */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <img
            src="https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/icon%20only.png"
            alt="Oyuns Finance"
            className="h-10 w-10 shadow-card-xs object-contain"
          />
          <div>
            <div className="text-[11px] text-dark-600 dark:text-ivory-300 font-medium">{t("home.welcome")}</div>
            <div className="text-base font-bold text-dark-800 dark:text-ivory-200">{user?.first_name || t("home.user")}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Language Toggle */}
          <button
            onClick={() => setLang(lang === "ru" ? "mn" : "ru")}
            className="w-11 h-11 rounded-2xl bg-white dark:bg-dark-700 shadow-card-xs border border-silver/60 dark:border-dark-600 text-dark-600 dark:text-gold-400 flex items-center justify-center hover:shadow-card transition-all text-xs font-bold"
            aria-label="Switch language"
          >
            {lang === "ru" ? "MN" : "RU"}
          </button>
          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="w-11 h-11 rounded-2xl bg-white dark:bg-dark-700 shadow-card-xs border border-silver/60 dark:border-dark-600 text-dark-600 dark:text-gold-400 flex items-center justify-center hover:shadow-card transition-all"
            aria-label={t("home.theme_toggle")}
          >
            {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          {isVerified ? (
            <button
              onClick={onNavigateToProfile}
              className="w-11 h-11 rounded-2xl bg-white dark:bg-dark-700 shadow-card-xs border border-silver/60 dark:border-dark-600 text-dark-600 dark:text-ivory-200 flex items-center justify-center hover:shadow-card transition-all"
              aria-label={t("home.profile")}
            >
              <User className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => setShowRegistration(true)}
              className="w-11 h-11 rounded-2xl bg-maroon-600 text-white flex items-center justify-center hover:bg-maroon-500 shadow-btn transition-all"
              aria-label={t("home.register")}
            >
              <UserPlus className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Auth Debug Info */}
      {!initData || !user ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 p-4 rounded-xl text-sm">
          <strong>{t("home.auth_issue")}</strong>
          <div className="text-xs mt-2 space-y-1">
            <div>initData: {initData ? `✅ ${initData.length} chars` : "❌ Missing"}</div>
            <div>User ID: {user?.id ? `✅ ${user.id}` : "❌ Missing"}</div>
          </div>
        </div>
      ) : null}

      {/* Transaction Status Trackers */}
      {user?.id && <TransactionStatusTracker userId={user.id} />}
      {user?.id && isVerified && <GiftStatusTracker userId={user.id} />}
      {user?.id && <FuelStatusTracker userId={user.id} onOpenOrder={onNavigateToFuelOrder} />}
      {user?.id && isVerified && <PendingGiftBanner onGiftConfirmed={() => queryClient.invalidateQueries({ queryKey: ["me", user?.id] })} />}

      {/* Profile Error */}
      {profileError && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 p-4 rounded-xl text-sm">
          <strong>{t("home.profile_load_failed")}</strong>
          <div className="text-xs mt-2">
            {profileError instanceof Error ? profileError.message : "Unknown error"}
          </div>
        </div>
      )}

      {/* Registration / Verification States */}
      {!isVerified && !pendingVerification && needsRegistration && (
        <div className="bg-white dark:bg-dark-800 p-6 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 animate-slideUp">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 bg-maroon-50 dark:bg-maroon-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
              <UserPlus className="w-7 h-7 text-maroon-600 dark:text-maroon-400" />
            </div>
            <div>
              <div className="text-base font-bold text-dark-800 dark:text-ivory-200 mb-0.5">{t("home.register_required")}</div>
              <div className="text-sm text-dark-600 dark:text-ivory-300">{t("home.register_desc")}</div>
            </div>
          </div>
          <button
            onClick={() => setShowRegistration(true)}
            className="w-full bg-maroon-600 text-white py-3.5 rounded-2xl font-bold text-base shadow-btn hover:bg-maroon-500 active:scale-[0.98] transition-all"
          >
            {t("home.register")}
          </button>
        </div>
      )}

      {pendingVerification && (
        <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 animate-slideUp">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gold-50 dark:bg-gold-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Loader2 className="w-6 h-6 text-gold-500 animate-spin" />
            </div>
            <div>
              <div className="text-sm font-bold text-dark-800 dark:text-ivory-200 mb-0.5">{t("home.pending_verification")}</div>
              <div className="text-xs text-dark-600 dark:text-ivory-300">{t("home.pending_desc")}</div>
              <div className="text-[11px] text-dark-600 dark:text-ivory-400 mt-1">{t("home.pending_note")}</div>
            </div>
          </div>
        </div>
      )}

      {/* Buy/Sell Quick Action Row */}
      {isVerified && isServiceOpen && (
        <div className="flex gap-3">
          <button
            onClick={() => handleBuySell("sell")}
            className="flex-1 bg-emerald-500 text-white p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-emerald-600 active:scale-[0.97] transition-all shadow-btn-success"
          >
            <ArrowDownLeft className="w-5 h-5" />
            <span>{t("home.buy")}</span>
          </button>
          <button
            onClick={() => handleBuySell("buy")}
            className="flex-1 bg-rose-500 text-white p-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-rose-600 active:scale-[0.97] transition-all shadow-btn-danger"
          >
            <ArrowUpRight className="w-5 h-5" />
            <span>{t("home.sell")}</span>
          </button>
          <button
            onClick={handleTransactionShortcut}
            className="w-14 bg-maroon-700 text-gold-400 rounded-2xl flex items-center justify-center hover:bg-maroon-600 active:scale-[0.97] transition-all shadow-card-dark"
            aria-label={t("nav.transaction")}
          >
            <ArrowLeftRight className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Outside working hours */}
      {isVerified && !isServiceOpen && (
        <div className="bg-white dark:bg-dark-800 p-5 rounded-3xl shadow-card border border-silver/60 dark:border-dark-600 animate-slideUp">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gold-50 dark:bg-gold-900/30 rounded-2xl flex items-center justify-center flex-shrink-0">
              <Clock className="w-6 h-6 text-gold-500" />
            </div>
            <div>
              <div className="text-sm font-bold text-dark-800 dark:text-ivory-200 mb-0.5">
                {!serviceStatus?.is_within_hours ? t("home.working_hours_ended") : t("home.temporarily_closed")}
              </div>
              <div className="text-xs text-dark-600 dark:text-ivory-300">{serviceStatus?.message}</div>
              <div className="text-[11px] text-dark-600 dark:text-ivory-400 mt-1">
                {t("home.working_hours_schedule")}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Exchange Rates */}
      <RateCard rate={rate} />

      {/* Calculator */}
      <Converter rate={rate} onAmountChange={(p) => setDirection(p.direction)} />

      {/* Rate History Chart */}
      <RateHistoryChart />

      {/* Copyright */}
      <div className="text-center text-[11px] text-dark-600 dark:text-ivory-400 pb-4">
        © 2026 Oyuns Finance. All rights reserved.
      </div>

      {/* Registration Modal */}
      {showRegistration && !isVerified && !pendingVerification && (
        <RegistrationModal onRegistered={handleRegistered} onClose={() => setShowRegistration(false)} />
      )}

      {/* Required Info Modal */}
      {showRequiredInfo && (
        <RequiredInfoModal
          currentEmail={userProfile?.email}
          currentPhoneMnt={mntPhone}
          currentPhone={userProfile?.phone}
          currentBankMnt={userProfile?.bank_mnt}
          onSaved={handleRequiredInfoSaved}
          onClose={() => setShowRequiredInfo(false)}
        />
      )}
    </div>
  );
}
