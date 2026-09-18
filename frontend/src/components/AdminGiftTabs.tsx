import { useState } from "react";
import { AdminGifts } from "./AdminGifts";
import { AdminOyunsPlusRequests } from "./admin/AdminOyunsPlusRequests";

export function AdminGiftTabs() {
  const [tab, setTab] = useState<"legacy" | "oyuns-plus">("legacy");
  return (
    <div className="space-y-4">
      <div className="admin-radio-group admin-radio-group--split" role="tablist" aria-label="Бэлгийн хүсэлтүүд">
        {([
          ["legacy", "Бэлгийн хүсэлтүүд"],
          ["oyuns-plus", "Oyuns+"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`admin-radio ${tab === key ? "admin-radio--active" : ""}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "legacy" ? <AdminGifts /> : <AdminOyunsPlusRequests />}
    </div>
  );
}
