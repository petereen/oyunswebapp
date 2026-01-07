import { Wallet, TrendingUp, Clock3 } from "lucide-react";
import { Rate } from "../api";

interface Props {
  rate?: Rate;
}

export function RateCard({ rate }: Props) {
  return (
    <div className="glass-card p-5 rounded-2xl border border-white/60 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-ocean-700">
        <Wallet className="w-5 h-5" />
        <span className="font-semibold">Ханшийн мэдээлэл</span>
      </div>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="p-3 rounded-xl bg-ocean-100/80">
          <div className="text-ocean-700 flex items-center gap-1">
            <TrendingUp className="w-4 h-4" /> Төгрөг худалдан авах RUB→MNT
          </div>
          <div className="text-2xl font-bold text-ocean-700">{rate?.buy_rate ?? "–"}</div>
        </div>
        <div className="p-3 rounded-xl bg-white/80 border border-ocean-100">
          <div className="text-ocean-700 flex items-center gap-1">
            <TrendingUp className="w-4 h-4" /> Руб худалдан авах MNT→RUB
          </div>
          <div className="text-2xl font-bold text-ocean-700">{rate?.sell_rate ?? "–"}</div>
        </div>
      </div>
      <div className="text-xs text-slate-500 flex items-center gap-2">
        <Clock3 className="w-4 h-4" /> Шинэчлэгдсэн {rate?.updated_at ? new Date(rate.updated_at).toLocaleString() : "удахгүй"}
      </div>
    </div>
  );
}
