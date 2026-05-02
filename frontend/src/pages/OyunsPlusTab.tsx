import { useQuery } from "@tanstack/react-query";
import { Sparkles, Trophy, Calendar, MapPin, Users } from "lucide-react";
import { fetchOyunsPlusSummary } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  userId?: number;
}

export function OyunsPlusTab({ userId }: Props) {
  const { t } = useLang();

  const { data, isLoading } = useQuery({
    queryKey: ["oyuns-plus-summary", userId],
    queryFn: () => fetchOyunsPlusSummary(),
    enabled: Boolean(userId),
    retry: 1,
  });

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

        <div className="grid grid-cols-2 gap-3">
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
      </div>

      <div className="bg-white dark:bg-dark-800 rounded-3xl p-5 border border-silver/60 dark:border-dark-600 shadow-card">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          <h3 className="text-sm font-bold text-dark-800 dark:text-ivory-200">{t("oyuns_plus.tournament_title")}</h3>
        </div>
        <p className="text-xs text-dark-600 dark:text-ivory-300">{t("oyuns_plus.tournament_desc")}</p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          <div className="rounded-xl bg-surface-50 dark:bg-dark-700 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-dark-700 dark:text-ivory-300">
              <Users className="w-3.5 h-3.5 text-maroon-600 dark:text-gold-400" />
              {t("oyuns_plus.tournament_categories")}
            </div>
          </div>
          <div className="rounded-xl bg-surface-50 dark:bg-dark-700 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-dark-700 dark:text-ivory-300">
              <MapPin className="w-3.5 h-3.5 text-maroon-600 dark:text-gold-400" />
              {t("oyuns_plus.tournament_venues")}
            </div>
          </div>
          <div className="rounded-xl bg-surface-50 dark:bg-dark-700 p-3">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-dark-700 dark:text-ivory-300">
              <Calendar className="w-3.5 h-3.5 text-maroon-600 dark:text-gold-400" />
              {t("oyuns_plus.tournament_schedule")}
            </div>
          </div>
        </div>

        <div className="mt-3 text-[11px] text-dark-600 dark:text-ivory-400">{t("oyuns_plus.tournament_note")}</div>
      </div>
    </div>
  );
}
