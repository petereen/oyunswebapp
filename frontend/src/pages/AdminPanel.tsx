import { memo, useCallback, useState } from "react";
import {
  ArrowLeftRight,
  Gift,
  History,
  Landmark,
  LucideIcon,
  PlusCircle,
  Shield,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { AdminBankAccounts } from "../components/AdminBankAccounts";
import { AdminGifts } from "../components/AdminGifts";
import { AdminHistory } from "../components/AdminHistory";
import { AdminInbox } from "../components/AdminInbox";
import { AdminManualTransaction } from "../components/AdminManualTransaction";
import { AdminSettings } from "../components/admin/AdminSettings";
import { AdminShiftBar } from "../components/admin/AdminShiftBar";
import { AdminUsersContainer } from "../components/admin/AdminUsersContainer";

export type AdminTab = "inbox" | "users" | "accounts" | "history" | "manual" | "gifts" | "settings";

type AdminTabDefinition = { key: AdminTab; label: string; icon: LucideIcon };

const ADMIN_TABS: AdminTabDefinition[] = [
  { key: "inbox", label: "Гүйлгээ", icon: ArrowLeftRight },
  { key: "users", label: "Хэрэглэгч", icon: Users },
  { key: "accounts", label: "Данс", icon: Landmark },
  { key: "history", label: "Түүх", icon: History },
  { key: "manual", label: "Гараар үүсгэх", icon: PlusCircle },
  { key: "gifts", label: "Бэлэг", icon: Gift },
  { key: "settings", label: "Тохиргоо", icon: SlidersHorizontal },
];

const PersistentInbox = memo(AdminInbox);
const PersistentShiftBar = memo(AdminShiftBar);
const PersistentUsers = memo(AdminUsersContainer);
const PersistentAccounts = memo(AdminBankAccounts);
const PersistentHistory = memo(AdminHistory);
const PersistentManual = memo(AdminManualTransaction);
const PersistentGifts = memo(AdminGifts);
const PersistentSettings = memo(AdminSettings);

interface Props { onExit?: () => void; }

export function AdminPanel({ onExit }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>("inbox");
  const [visitedTabs, setVisitedTabs] = useState<Set<AdminTab>>(() => new Set(["inbox"]));

  const selectTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    setVisitedTabs((previous) => previous.has(tab) ? previous : new Set(previous).add(tab));
  }, []);

  const openInbox = useCallback(() => selectTab("inbox"), [selectTab]);

  const renderPanel = (tab: AdminTab) => {
    switch (tab) {
      case "inbox": return <PersistentInbox />;
      case "users": return <PersistentUsers />;
      case "accounts": return <PersistentAccounts />;
      case "history": return <PersistentHistory />;
      case "manual": return <PersistentManual onOpenInbox={openInbox} />;
      case "gifts": return <PersistentGifts />;
      case "settings": return <PersistentSettings />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-maroon-700 dark:text-gold-400"><Shield className="w-5 h-5" /> Админ самбар</div>
        <button onClick={onExit} className="text-sm text-slate-500 dark:text-ivory-400 hover:text-slate-700 dark:hover:text-ivory-200 underline">Гарах</button>
      </div>

      <PersistentShiftBar />

      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Админ самбарын хэсгүүд">
        {ADMIN_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" id={`admin-tab-${key}`} role="tab" aria-selected={activeTab === key} aria-controls={`admin-panel-${key}`} onClick={() => selectTab(key)} className={`flex-1 min-w-[110px] flex items-center justify-center gap-2 py-3 px-2 rounded-xl font-semibold transition ${activeTab === key ? "bg-maroon-600 text-white shadow-btn" : "bg-white/60 dark:bg-dark-800 text-maroon-700 dark:text-gold-400 hover:bg-maroon-100 dark:hover:bg-dark-700"}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      <div>
        {ADMIN_TABS.map(({ key }) => visitedTabs.has(key) && (
          <section key={key} id={`admin-panel-${key}`} role="tabpanel" aria-labelledby={`admin-tab-${key}`} hidden={activeTab !== key}>
            {renderPanel(key)}
          </section>
        ))}
      </div>
    </div>
  );
}
