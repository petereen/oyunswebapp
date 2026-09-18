import { useState } from "react";
import { AdminGifts } from "./AdminGifts";
import { AdminOyunsPlusRequests } from "./admin/AdminOyunsPlusRequests";

export function AdminGiftTabs() {
  const [tab, setTab] = useState<"legacy" | "oyuns-plus">("legacy");
  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-dark-700" role="tablist" aria-label="Бэлгийн хүсэлтүүд">
        {([
          ["legacy", "Бэлгийн хүсэлтүүд"],
          ["oyuns-plus", "Oyuns+"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${tab === key ? "bg-white text-maroon-700 shadow-sm dark:bg-dark-800 dark:text-gold-400" : "text-slate-500 hover:text-slate-800 dark:text-ivory-400 dark:hover:text-ivory-100"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "legacy" ? <AdminGifts /> : <AdminOyunsPlusRequests />}
    </div>
  );
}
