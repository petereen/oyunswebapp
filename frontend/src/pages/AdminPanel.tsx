import { memo, useCallback, useEffect, useState } from "react";
import {
  ArrowLeftRight,
  Gift,
  LucideIcon,
  PlusCircle,
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
import { fetchAdminGifts, fetchAdminOyunsPlusRequests, fetchInbox, fetchKycPending } from "../api";
import { AdminPendingBadge } from "../components/admin/AdminPanelPrimitives";

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

interface Props { onExit?: () => void; initialTransactionTab?: AdminTransactionTab; }

export function AdminPanel({ onExit, initialTransactionTab = "inbox" }: Props) {
  const [activeTab, setActiveTab] = useState<AdminTab>("inbox");
  const [visitedTabs, setVisitedTabs] = useState<Set<AdminTab>>(() => new Set(["inbox"]));
  const [activeTransactionTab, setActiveTransactionTab] = useState<AdminTransactionTab>(initialTransactionTab);
  const [visitedTransactionTabs, setVisitedTransactionTabs] = useState<Set<AdminTransactionTab>>(() => new Set(["inbox", initialTransactionTab]));
  const [pendingCounts, setPendingCounts] = useState({ verifications: 0, transactions: 0, gifts: 0, oyunsPlus: 0 });

  useEffect(() => {
    let active = true;
    const refreshPendingCounts = async () => {
      const [kycResult, inboxResult, giftsResult, oyunsPlusResult] = await Promise.allSettled([
        fetchKycPending(),
        fetchInbox(),
        fetchAdminGifts("pending"),
        fetchAdminOyunsPlusRequests("pending"),
      ]);
      if (!active) return;
      setPendingCounts((current) => ({
        verifications: kycResult.status === "fulfilled" ? kycResult.value.items.length : current.verifications,
        transactions: inboxResult.status === "fulfilled" ? inboxResult.value.items.filter((item) => item.status === "pending").length : current.transactions,
        gifts: giftsResult.status === "fulfilled" ? giftsResult.value.gifts.length : current.gifts,
        oyunsPlus: oyunsPlusResult.status === "fulfilled" ? oyunsPlusResult.value.requests.length : current.oyunsPlus,
      }));
    };

    void refreshPendingCounts();
    const intervalId = window.setInterval(() => void refreshPendingCounts(), 30000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

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
      case "gifts": return <PersistentGifts pendingGifts={pendingCounts.gifts} pendingOyunsPlus={pendingCounts.oyunsPlus} initialTab={initialTransactionTab === "gifts" ? "oyuns-plus" : "legacy"} />;
    }
  };

  const renderPanel = (tab: AdminTab) => {
    switch (tab) {
      case "inbox":
        return (
          <div className="space-y-3">
            <div data-slot="transaction-tabs" className="admin-radio-group admin-radio-group--transactions" role="tablist" aria-label="Гүйлгээний хэсгүүд">
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
                  className={`admin-radio ${activeTransactionTab === key ? "admin-radio--active" : ""}`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{label}</span>
                  {key === "inbox" && <AdminPendingBadge count={pendingCounts.transactions} />}
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
      case "users": return <PersistentUsers pendingCount={pendingCounts.verifications} />;
      case "settings": return <PersistentSettings onExit={onExit} />;
    }
  };

  return (
    <div className="space-y-3">
      <div className="admin-radio-group" role="tablist" aria-label="Админ самбарын хэсгүүд">
        {ADMIN_TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" id={`admin-tab-${key}`} role="tab" aria-selected={activeTab === key} aria-controls={`admin-panel-${key}`} onClick={() => selectTab(key)} className={`admin-radio ${activeTab === key ? "admin-radio--active" : ""}`}>
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
