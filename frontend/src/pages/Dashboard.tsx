import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { User, History, Clock, AlertCircle, Loader2, BarChart3 } from "lucide-react";
import { Converter } from "../components/Converter";
import { ExchangeFlow } from "../components/ExchangeFlow";
import { RateCard } from "../components/RateCard";
import { ProfileModal } from "../components/ProfileModal";
import { HistoryModal } from "../components/HistoryModal";
import { AnalyticsModal } from "../components/AnalyticsModal";
import { TermsAgreementModal } from "../components/TermsAgreementModal";
import { RegistrationModal } from "../components/RegistrationModal";
import { fetchRates, fetchMe, fetchServiceStatus } from "../api";
import { TelegramUser } from "../hooks/useTelegramAuth";

interface Props {
  initData: string;
  user: TelegramUser | null;
  onAdminStatusChange?: (isAdmin: boolean) => void;
}

export function Dashboard({ initData, user, onAdminStatusChange }: Props) {
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

  const { data: profile } = useQuery({
    queryKey: ["me", user?.id],
    queryFn: () => fetchMe(initData),
    enabled: Boolean(initData) && Boolean(user?.id),
    staleTime: 0, // Always refetch to ensure fresh user data
  });

  // Extract user profile and admin status
  const userProfile = profile?.user;
  const isAdmin = profile?.is_admin || false;

  // Notify parent component of admin status
  useEffect(() => {
    if (onAdminStatusChange && profile) {
      onAdminStatusChange(profile.is_admin);
    }
  }, [profile, onAdminStatusChange]);

  // Check if user needs to agree to terms - only show modal when agreed_terms is explicitly false
  const needsTermsAgreement = userProfile && userProfile.agreed_terms === false;

  // Check if user needs registration (not verified and not pending verification)
  const needsRegistration = userProfile && userProfile.verified === false && userProfile.ready_for_verification === false;
  
  // Check if user is waiting for verification
  const pendingVerification = userProfile && userProfile.verified === false && userProfile.ready_for_verification === true;

  const handleTermsAgreed = () => {
    // Refetch profile to update agreed_terms status
    queryClient.invalidateQueries({ queryKey: ["me", user?.id] });
  };

  const handleRegistered = () => {
    // Refetch profile to update registration status
    queryClient.invalidateQueries({ queryKey: ["me", user?.id] });
  };

  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [showExchange, setShowExchange] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  const effectiveRate = useMemo(() => {
    if (!rate) return 0;
    return direction === "buy" ? Number(rate.buy_rate) : Number(rate.sell_rate);
  }, [direction, rate]);

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
          <button
            onClick={() => setShowProfile(true)}
            className="p-2 rounded-full bg-ocean-100 text-ocean-700 hover:bg-ocean-200 transition"
            title="Профайл"
          >
            <User className="w-5 h-5" />
          </button>
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

      {/* Rates Error */}
      {ratesError && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm">
          Валютын ханш татаж чадсангүй.
        </div>
      )}

      {/* Main Content */}
      {!showExchange ? (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-4">
            <RateCard rate={rate} />
            <Converter rate={rate} onAmountChange={(p) => setDirection(p.direction)} />
          </div>
          <div className="flex flex-col gap-4">
            {/* Exchange CTA */}
            <div className="glass-card p-6 rounded-2xl border border-white/60 flex flex-col items-center justify-center gap-4 min-h-[200px]">
              {needsRegistration ? (
                // User needs to register
                <>
                  <div className="flex items-center justify-center w-16 h-16 bg-ocean-100 rounded-full">
                    <AlertCircle className="w-8 h-8 text-ocean-600" />
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-semibold text-ocean-700 mb-2">Бүртгүүлэх шаардлагатай</div>
                    <div className="text-sm text-slate-500">
                      Үйлчилгээг ашиглахын тулд эхлээд бүртгүүлнэ үү
                    </div>
                  </div>
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
                    onClick={() => setShowExchange(true)}
                    disabled={!rate || ratesLoading}
                    className="w-full max-w-xs bg-ocean-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-ocean-200 hover:bg-ocean-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ВАЛЮТ СОЛИХ
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

      {/* Profile Modal */}
      {showProfile && (
        <ProfileModal initData={initData} userId={user?.id} onClose={() => setShowProfile(false)} />
      )}

      {/* History Modal */}
      {showHistory && (
        <HistoryModal initData={initData} userId={user?.id} onClose={() => setShowHistory(false)} />
      )}

      {/* Analytics Modal */}
      {showAnalytics && (
        <AnalyticsModal initData={initData} onClose={() => setShowAnalytics(false)} />
      )}

      {/* Terms Agreement Modal - Required for first-time users */}
      {needsTermsAgreement && (
        <TermsAgreementModal initData={initData} onAgreed={handleTermsAgreed} />
      )}

      {/* Registration Modal - Required for unverified users */}
      {needsRegistration && !needsTermsAgreement && (
        <RegistrationModal initData={initData} onRegistered={handleRegistered} />
      )}
    </div>
  );
}
