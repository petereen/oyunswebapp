import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { User, History, Clock, AlertCircle, Loader2, BarChart3, RefreshCw, UserPlus, Gift } from "lucide-react";
import { Converter } from "../components/Converter";
import { ExchangeFlow } from "../components/ExchangeFlow";
import { GiftFlow } from "../components/GiftFlow";
import { RateCard } from "../components/RateCard";
import { ProfileModal } from "../components/ProfileModal";
import { HistoryModal } from "../components/HistoryModal";
import { AnalyticsModal } from "../components/AnalyticsModal";
import { RegistrationModal } from "../components/RegistrationModal";
import { RequiredInfoModal } from "../components/RequiredInfoModal";
import { TransactionStatusTracker } from "../components/TransactionStatusTracker";
import { PendingGiftBanner } from "../components/PendingGiftBanner";
import { GiftStatusTracker } from "../components/GiftStatusTracker";
import { fetchRates, fetchMe, fetchServiceStatus } from "../api";
import { TelegramUser } from "../hooks/useTelegramAuth";

interface Props {
  initData: string;
  user: TelegramUser | null;
  isAuthenticating?: boolean;
  authError?: string | null;
}

export function Dashboard({ initData, user, isAuthenticating, authError }: Props) {
  const queryClient = useQueryClient();
  
  const { data: rate, isLoading: ratesLoading, error: ratesError } = useQuery({
    queryKey: ["rates"],
    queryFn: () => fetchRates(),
    retry: 2,
  });

  const { data: serviceStatus } = useQuery({
    queryKey: ["serviceStatus"],
    queryFn: () => fetchServiceStatus(),
    retry: 2,
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: profile, isLoading: profileLoading, error: profileError } = useQuery({
    queryKey: ["me", user?.id],
    queryFn: () => fetchMe(),
    enabled: Boolean(user?.id) && !isAuthenticating,
    staleTime: 0, // Always refetch to ensure fresh user data
  });

  // Debug logging
  useEffect(() => {
    console.log("Dashboard Debug:", {
      hasInitData: !!initData,
      initDataLength: initData.length,
      hasUser: !!user,
      userId: user?.id,
      profileLoading,
      profileError: profileError?.message || null,
      profile: profile ? "✅ Loaded" : "❌ Not loaded",
    });
  }, [initData, user, profileLoading, profileError, profile]);

  // Extract user profile
  const userProfile = profile?.user;

  // Check if user is verified (can use exchange)
  const isVerified = userProfile?.verified === true;
  
  // Check if user needs registration (not verified and not pending verification)
  const needsRegistration = userProfile && userProfile.verified === false && userProfile.ready_for_verification === false;
  
  // Check if user is waiting for verification
  const pendingVerification = userProfile && userProfile.verified === false && userProfile.ready_for_verification === true;
  
  // Check if user is missing required email or Mongolian phone (from bank_mnt 4th part)
  const missingEmail = isVerified && !userProfile?.email?.trim();
  // bank_mnt format: "Банк,Данс,Нэр,Утас" - phone is 4th part (index 3)
  const getMntPhone = (bankMnt: string | undefined) => {
    if (!bankMnt) return "";
    const parts = bankMnt.split(",");
    return parts[3]?.trim() || "";
  };
  const mntPhone = getMntPhone(userProfile?.bank_mnt);
  // Phone in bank_mnt is required for ALL users (not just verified)
  const missingPhoneMnt = !mntPhone;
  const missingRequiredInfo = missingEmail || missingPhoneMnt;

  // State to show registration modal manually
  const [showRegistration, setShowRegistration] = useState(false);
  
  // State to show required info modal
  const [showRequiredInfo, setShowRequiredInfo] = useState(false);

  const handleRegistered = () => {
    // Refetch profile to update registration status
    queryClient.invalidateQueries({ queryKey: ["me", user?.id] });
    setShowRegistration(false);
  };
  
  const handleRequiredInfoSaved = () => {
    // Refetch profile to update info
    queryClient.invalidateQueries({ queryKey: ["me", user?.id] });
    setShowRequiredInfo(false);
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [showExchange, setShowExchange] = useState(false);
  const [showGift, setShowGift] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  
  // Handler for exchange button that checks required info
  const handleExchangeClick = () => {
    if (missingRequiredInfo) {
      setShowRequiredInfo(true);
    } else {
      setShowExchange(true);
    }
  };
  
  // Handler for gift button that checks required info
  const handleGiftClick = () => {
    if (missingRequiredInfo) {
      setShowRequiredInfo(true);
    } else {
      setShowGift(true);
    }
  };

  const effectiveRate = useMemo(() => {
    if (!rate) return 0;
    return direction === "buy" ? Number(rate.buy_rate) : Number(rate.sell_rate);
  }, [direction, rate]);

  // Show loading state while authenticating
  if (isAuthenticating) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-12 h-12 text-ocean-600 animate-spin" />
        <div className="text-lg font-medium text-ocean-700">Нэвтэрч байна...</div>
        <div className="text-sm text-slate-500">Түр хүлээнэ үү</div>
      </div>
    );
  }

  // Show error state if authentication failed
  if (authError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <AlertCircle className="w-12 h-12 text-red-500" />
        <div className="text-lg font-medium text-red-700">Нэвтрэлт амжилтгүй</div>
        <div className="text-sm text-slate-500 text-center max-w-md">{authError}</div>
        <div className="text-xs text-slate-400 mt-2">
          Telegram Mini App-аас нээнэ үү
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Profile */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-ocean-600">OYUNS FINANCE</div>
          <div className="text-2xl font-bold text-ocean-700">ВАЛЮТ СОЛИХ ПЛАТФОРМ</div>
          {user && (
            <div className="text-sm text-slate-500">Сайн байна уу, {user.first_name}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Refresh Button */}
          <button
            onClick={handleRefresh}
            className="p-2 rounded-full bg-white text-ocean-700 hover:bg-ocean-50 transition"
            title="Шинэчлэх"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          {/* Profile or Register Button */}
          {isVerified ? (
            <button
              onClick={() => setShowProfile(true)}
              className="p-2 rounded-full bg-ocean-100 text-ocean-700 hover:bg-ocean-200 transition"
              title="Профайл"
            >
              <User className="w-5 h-5" />
            </button>
          ) : (
            <button
              onClick={() => setShowRegistration(true)}
              className="p-2 rounded-full bg-ocean-600 text-white hover:bg-ocean-700 transition"
              title="Бүртгүүлэх"
            >
              <UserPlus className="w-5 h-5" />
            </button>
          )}
          <button
            onClick={() => setShowHistory(true)}
            className="p-2 rounded-full bg-white text-ocean-700 hover:bg-ocean-50 transition"
            title="Түүх"
          >
            <History className="w-5 h-5" />
          </button>
          <button
            onClick={() => setShowAnalytics(true)}
            className="p-2 rounded-full bg-white text-ocean-700 hover:bg-ocean-50 transition"
            title="Статистик"
          >
            <BarChart3 className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Auth Debug Info */}
      {!initData || !user ? (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm mb-4">
          <strong>⚠️ Telegram нэвтрэлтийн асуудал:</strong>
          <div className="text-xs mt-2 space-y-1">
            <div>initData: {initData ? `✅ ${initData.length} chars` : "❌ Missing"}</div>
            <div>User ID: {user?.id ? `✅ ${user.id}` : "❌ Missing"}</div>
            <div>Дэлгэцийн консолыг шалгаж, "=== Telegram Auth Debug ===" гэсэн мэдээлэл олоорой</div>
          </div>
        </div>
      ) : null}

      {/* Transaction Status Tracker - shows pending/approved transactions */}
      {user?.id && <TransactionStatusTracker userId={user.id} />}

      {/* Gift Status Tracker - shows sent gifts status */}
      {user?.id && isVerified && <GiftStatusTracker userId={user.id} />}

      {/* Pending Gift Banner - shows gifts waiting for recipient confirmation */}
      {user?.id && isVerified && <PendingGiftBanner onGiftConfirmed={() => queryClient.invalidateQueries({ queryKey: ["me", user?.id] })} />}

      {/* Profile Error */}
      {profileError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm mb-4">
          <strong>❌ Профайл ачаалж чадсангүй:</strong>
          <div className="text-xs mt-2">
            {profileError instanceof Error ? profileError.message : "Unknown error"}
          </div>
        </div>
      )}

      {/* Rates Error */}
      {ratesError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm">
          Валютын ханш татаж чадсангүй.
        </div>
      )}

      {/* Main Content */}
      {showGift ? (
        <GiftFlow
          buyRate={rate?.buy_rate || 0}
          sellRate={rate?.sell_rate || 0}
          onBack={() => setShowGift(false)}
          onSuccess={() => setShowGift(false)}
        />
      ) : !showExchange ? (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-4">
              <RateCard rate={rate} />
            </div>
            <div className="flex flex-col gap-4">
              {/* Exchange CTA */}
              <div className="glass-card p-6 rounded-2xl border border-white/60 flex flex-col items-center justify-center gap-4 min-h-[200px]">
                {!isVerified && !pendingVerification ? (
                  // User not registered - can use calculator but not exchange
                  <>
                    <div className="flex items-center justify-center w-16 h-16 bg-ocean-100 rounded-full">
                      <UserPlus className="w-8 h-8 text-ocean-600" />
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-ocean-700 mb-2">Бүртгүүлэх шаардлагатай</div>
                      <div className="text-sm text-slate-500">
                        Валют солихын тулд эхлээд бүртгүүлнэ үү. Баруун дээр байрлах <UserPlus className="w-4 h-4 inline-block text-ocean-600" /> товчийг дарна уу.
                      </div>
                    </div>
                    <button
                      onClick={() => setShowRegistration(true)}
                      className="w-full max-w-xs bg-ocean-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-ocean-200 hover:bg-ocean-700 transition"
                    >
                      БҮРТГҮҮЛЭХ
                    </button>
                  </>
                ) : pendingVerification ? (
                  // User is waiting for admin verification
                  <>
                    <div className="flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full">
                      <Loader2 className="w-8 h-8 text-amber-600 animate-spin" />
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-amber-700 mb-2">Баталгаажуулалт хүлээгдэж байна</div>
                      <div className="text-sm text-slate-500 mb-2">
                        Таны бүртгэлийг админ шалгаж байна
                      </div>
                      <div className="text-xs text-slate-400">
                        Баталгаажуулалт дууссаны дараа Telegram чатаар мэдэгдэл очих болно
                      </div>
                    </div>
                    <button
                      disabled
                      className="w-full max-w-xs bg-slate-300 text-slate-500 py-4 rounded-xl font-bold text-lg cursor-not-allowed"
                    >
                      ВАЛЮТ СОЛИХ
                    </button>
                  </>
                ) : serviceStatus?.is_open !== false ? (
                  <>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-ocean-700 mb-2">Та валют солиход бэлэн үү?</div>
                      <div className="text-sm text-slate-500">
                        {direction === "buy" ? "RUB → MNT" : "MNT → RUB"} ХАНШ {effectiveRate || "—"}
                      </div>
                    </div>
                    <button
                      onClick={handleExchangeClick}
                      disabled={!rate || ratesLoading}
                      className="w-full max-w-xs bg-ocean-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-ocean-200 hover:bg-ocean-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ВАЛЮТ СОЛИХ
                    </button>
                    <button
                      onClick={handleGiftClick}
                      disabled={!rate || ratesLoading}
                      className="w-full max-w-xs bg-gradient-to-r from-pink-500 to-purple-500 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-pink-200 hover:from-pink-600 hover:to-purple-600 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Gift className="w-5 h-5" />
                      БЭЛЭГ ИЛГЭЭХ
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-center w-16 h-16 bg-amber-100 rounded-full">
                      <Clock className="w-8 h-8 text-amber-600" />
                    </div>
                    <div className="text-center">
                      <div className="text-lg font-semibold text-slate-700 mb-2">
                        {!serviceStatus?.is_within_hours ? "Бидний ажлын цаг дууссан байна" : "Түр хаалттай"}
                      </div>
                      <div className="text-sm text-slate-500 mb-2">
                        {serviceStatus?.message}
                      </div>
                      <div className="text-xs text-slate-400">
                        Бид Москвагийн цагаар 04:00-23:00 хооронд, Улаанбаатарын цагаар 09:00–04:00(дараа өдрийн) цагийн хооронд ажиллаж байна.
                      </div>
                    </div>
                    <button
                      disabled
                      className="w-full max-w-xs bg-slate-300 text-slate-500 py-4 rounded-xl font-bold text-lg cursor-not-allowed"
                    >
                      ВАЛЮТ СОЛИХ
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
          
          {/* Calculator at the bottom */}
          <div className="mt-4">
            <Converter rate={rate} onAmountChange={(p) => setDirection(p.direction)} />
          </div>

          {/* Copyright */}
          <div className="mt-8 text-center text-xs text-slate-400">
            © 2026 OYUNS FINANCE. All rights reserved.
          </div>
        </>
      ) : (
        <ExchangeFlow
          initData={initData}
          buyRate={rate?.buy_rate || 0}
          sellRate={rate?.sell_rate || 0}
          savedBankRub={userProfile?.bank_rub}
          savedBankMnt={userProfile?.bank_mnt}
          onBack={() => setShowExchange(false)}
        />
      )}

      {/* Profile Modal - only for verified users */}
      {showProfile && isVerified && (
        <ProfileModal userId={user?.id} onClose={() => setShowProfile(false)} />
      )}

      {/* History Modal */}
      {showHistory && (
        <HistoryModal userId={user?.id} onClose={() => setShowHistory(false)} />
      )}

      {/* Analytics Modal */}
      {showAnalytics && (
        <AnalyticsModal onClose={() => setShowAnalytics(false)} />
      )}

      {/* Registration Modal - shown when user clicks register button */}
      {showRegistration && !isVerified && !pendingVerification && (
        <RegistrationModal onRegistered={handleRegistered} onClose={() => setShowRegistration(false)} />
      )}
      
      {/* Required Info Modal - shown when user tries to exchange/gift without email or Mongolian phone */}
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
