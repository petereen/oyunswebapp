import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, Check, Sparkles, Users } from "lucide-react";
import { fetchOyunsPlusSummary } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  userId?: number;
}

export function OyunsPlusTab({ userId }: Props) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["oyuns-plus-summary", userId],
    queryFn: () => fetchOyunsPlusSummary(),
    enabled: Boolean(userId),
    retry: 1,
  });

  const handleCopyCode = async () => {
    const code = data?.referral_code;
    if (!code) return;

    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (isLoading) {
    return (
      <div className="animate-fadeIn space-y-4">
        <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200">{t("profile.oyuns_title")}</h2>
        <div className="bg-white dark:bg-dark-800 rounded-2xl p-5 border border-silver/60 dark:border-dark-600 text-sm text-dark-600 dark:text-ivory-300">
          {t("profile.loading")}
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="animate-fadeIn space-y-4">
        <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200">{t("profile.oyuns_title")}</h2>
        <div className="bg-white dark:bg-dark-800 rounded-2xl p-5 border border-silver/60 dark:border-dark-600 text-sm text-dark-600 dark:text-ivory-300">
          {t("profile.load_failed")}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn space-y-4">
      <h2 className="text-base font-bold text-dark-800 dark:text-ivory-200">{t("profile.oyuns_title")}</h2>

      <div className="bg-gradient-to-br from-maroon-700 via-maroon-800 to-dark-900 dark:from-maroon-900 dark:via-dark-900 dark:to-black rounded-3xl p-5 text-white shadow-card-dark">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5 text-gold-400" />
          <div className="font-bold text-base">{t("profile.oyuns_title")}</div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[11px] text-white/70">{t("profile.oyuns_points")}</div>
            <div className="text-2xl font-bold text-gold-400">{data.points_balance}</div>
          </div>
          <div className="bg-white/10 rounded-xl p-3">
            <div className="text-[11px] text-white/70 flex items-center gap-1">
              <Users className="w-3 h-3" />
              {t("profile.oyuns_verified_out_of_invited")}
            </div>
            <div className="text-2xl font-bold">{data.invited_verified}/{data.invited_total}</div>
          </div>
        </div>

        <div className="bg-white/10 rounded-xl p-3 space-y-2">
          <div className="text-[11px] text-white/70">{t("profile.oyuns_referral_code")}</div>
          <div className="flex items-center justify-between gap-2">
            <div className="font-mono font-bold tracking-wide text-gold-300 text-sm">{data.referral_code || "-"}</div>
            <button
              onClick={handleCopyCode}
              disabled={!data.referral_code}
              className="px-2.5 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition text-[11px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? t("profile.oyuns_copied") : t("profile.oyuns_copy")}
            </button>
          </div>
          <div className="text-[11px] text-white/70">
            {t("profile.oyuns_uses")}: {data.referral_uses}/{data.referral_max_uses} • {t("profile.oyuns_remaining")}: {data.referral_uses_remaining}
          </div>
          <div className="text-[10px] text-white/60">{t("profile.oyuns_reward_note")}</div>
        </div>
      </div>
    </div>
  );
}
