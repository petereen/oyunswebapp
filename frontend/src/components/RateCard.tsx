import { Wallet, TrendingUp, Clock3 } from "lucide-react";
import { Rate } from "../api";
import { useLang } from "../i18n/useLang";

interface Props {
  rate?: Rate;
}

export function RateCard({ rate }: Props) {
  const { t, lang } = useLang();
  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-maroon-600 via-maroon-700 to-maroon-800 dark:from-maroon-800 dark:via-maroon-900 dark:to-dark-900 p-5 rounded-3xl shadow-card-dark text-white">
      {/* Decorative gradient orb */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-gold-400/20 rounded-full blur-2xl" />
      <div className="absolute -bottom-8 -left-8 w-24 h-24 bg-gold-500/10 rounded-full blur-xl" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 bg-gold-400/20 rounded-xl flex items-center justify-center">
              <Wallet className="w-4.5 h-4.5 text-gold-400" />
            </div>
            <span className="font-semibold text-sm text-white/90">{t("rate.title")}</span>
          </div>
          <div className="text-[10px] text-white/40 flex items-center gap-1">
            <Clock3 className="w-3 h-3" />
            <span>{rate?.updated_at ? new Date(rate.updated_at).toLocaleTimeString(lang === "ru" ? "ru-RU" : "mn-MN", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="p-3.5 rounded-2xl bg-white/[0.07] border border-white/[0.06]">
            <div className="text-white/50 flex items-center gap-1 text-[11px] mb-2">
              <TrendingUp className="w-3 h-3" /> RUB → MNT
            </div>
            <div className="text-2xl font-bold tracking-tight text-gold-400">{rate?.buy_rate ?? "–"} <span className="text-base font-semibold text-white/50">₮</span></div>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/[0.07] border border-white/[0.06]">
            <div className="text-white/50 flex items-center gap-1 text-[11px] mb-2">
              <TrendingUp className="w-3 h-3" /> MNT → RUB
            </div>
            <div className="text-2xl font-bold tracking-tight text-gold-400">{rate?.sell_rate ?? "–"} <span className="text-base font-semibold text-white/50">₮</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
