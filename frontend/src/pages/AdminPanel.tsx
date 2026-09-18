import { memo, useCallback, useState } from "react";
import {
  ArrowLeftRight,
  Gift,
  LucideIcon,
  PlusCircle,
  Shield,
  SlidersHorizontal,
  History,
  Users,
} from "lucide-react";
import { AdminGiftTabs } from "../components/AdminGiftTabs";
import { AdminHistory } from "../components/AdminHistory";
import { AdminInbox } from "../components/AdminInbox";
import { AdminManualTransaction } from "../components/AdminManualTransaction";
import { AdminSettingsContainer } from "../components/admin/AdminSettingsContainer";
import { AdminUsersContainer } from "../components/admin/AdminUsersContainer";

export type AdminTab = "inbox" | "users" | "settings";
type AdminTransactionTab = "inbox" | "manual" | "history" | "gifts";

type AdminTabDefinition = { key: AdminTab; label: string; icon: LucideIcon };
type AdminTransactionTabDefinition = { key: AdminTransactionTab; label: string; icon: LucideIcon };

const ADMIN_TABS: AdminTabDefinition[] = [
  { key: "inbox", label: "Гүйлгээ", icon: ArrowLeftRight },
  { key: "users", label: "Хэрэглэгч", icon: Users },
  { key: "settings", label: "Тохиргоо", icon: SlidersHorizontal },
];

const ADMIN_TRANSACTION_TABS: AdminTransactionTabDefinition[] = [
  { key: "inbox", label: "Ирсэн хүсэлт", icon: ArrowLeftRight },
  { key: "manual", label: "Гараар үүсгэх", icon: PlusCircle },
  { key: "history", label: "Түүх", icon: History },
  { key: "gifts", label: "Бэлэг", icon: Gift },
];

const PersistentInbox = memo(AdminInbox);
const PersistentUsers = memo(AdminUsersContainer);
const PersistentHistory = memo(AdminHistory);
const PersistentManual = memo(AdminManualTransaction);
const PersistentGifts = memo(AdminGiftTabs);
const PersistentSettings = memo(AdminSettingsContainer);

interface Props { onExit?: () => void; }

export function AdminPanel({ onExit }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>("inbox");
  const [visitedTabs, setVisitedTabs] = useState<Set<AdminTab>>(() => new Set(["inbox"]));
  const [activeTransactionTab, setActiveTransactionTab] = useState<AdminTransactionTab>("inbox");
  const [visitedTransactionTabs, setVisitedTransactionTabs] = useState<Set<AdminTransactionTab>>(() => new Set(["inbox"]));

  const selectTab = useCallback((tab: AdminTab) => {
    setActiveTab(tab);
    if (tab === "inbox") setActiveTransactionTab("inbox");
    setVisitedTabs((previous) => previous.has(tab) ? previous : new Set(previous).add(tab));
  }, []);

  const openInbox = useCallback(() => {
    selectTab("inbox");
    setActiveTransactionTab("inbox");
    setVisitedTransactionTabs((previous) => previous.has("inbox") ? previous : new Set(previous).add("inbox"));
  }, [selectTab]);

  const selectTransactionTab = useCallback((tab: AdminTransactionTab) => {
    setActiveTab("inbox");
    setActiveTransactionTab(tab);
    setVisitedTransactionTabs((previous) => previous.has(tab) ? previous : new Set(previous).add(tab));
    setVisitedTabs((previous) => previous.has("inbox") ? previous : new Set(previous).add("inbox"));
  }, []);

  const renderTransactionPanel = (tab: AdminTransactionTab) => {
    switch (tab) {
      case "inbox": return <PersistentInbox />;
      case "history": return <PersistentHistory />;
      case "manual": return <PersistentManual onOpenInbox={openInbox} />;
      case "gifts": return <PersistentGifts />;
    }
  };

  const renderPanel = (tab: AdminTab) => {
    switch (tab) {
      case "inbox":
        return (
          <div className="space-y-4">
            <div data-slot="transaction-tabs" className="grid grid-cols-4 gap-2" role="tablist" aria-label="Гүйлгээний хэсгүүд">
              {ADMIN_TRANSACTION_TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  id={`admin-transaction-tab-${key}`}
                  role="tab"
                  aria-selected={activeTransactionTab === key}
                  aria-controls={`admin-transaction-panel-${key}`}
                  onClick={() => selectTransactionTab(key)}
                  data-slot="transaction-tab"
                  className={`flex min-h-[4.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-[1.35rem] px-1 py-3 text-center text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-400 sm:px-2 sm:text-sm ${activeTransactionTab === key ? "bg-maroon-600 text-white shadow-btn" : "bg-white/70 text-maroon-700 hover:bg-maroon-100 dark:bg-dark-800 dark:text-gold-400 dark:hover:bg-dark-700"}`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
            <div>
              {ADMIN_TRANSACTION_TABS.map(({ key }) => visitedTransactionTabs.has(key) && (
                <section key={key} id={`admin-transaction-panel-${key}`} role="tabpanel" aria-labelledby={`admin-transaction-tab-${key}`} hidden={activeTransactionTab !== key}>
                  {renderTransactionPanel(key)}
                </section>
              ))}
            </div>
          </div>
        );
      case "users": return <PersistentUsers />;
      case "settings": return <PersistentSettings />;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-maroon-700 dark:text-gold-400"><Shield className="w-5 h-5" /> Админ самбар</div>
        <button onClick={onExit} className="text-sm text-slate-500 dark:text-ivory-400 hover:text-slate-700 dark:hover:text-ivory-200 underline">Гарах</button>
      </div>

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
