import { useState } from "react";
import { FileText, Search } from "lucide-react";
import { AdminKyc } from "../AdminKyc";
import { AdminUserSearch } from "../AdminUserSearch";

type UserView = "kyc" | "search";

export function AdminUsersContainer() {
  const [activeView, setActiveView] = useState<UserView>("kyc");
  const [visitedViews, setVisitedViews] = useState<Set<UserView>>(() => new Set(["kyc"]));

  const selectView = (view: UserView) => {
    setActiveView(view);
    setVisitedViews((previous) => {
      if (previous.has(view)) return previous;
      return new Set(previous).add(view);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-xl bg-white/60 dark:bg-dark-800/70 p-1 border border-white/60 dark:border-dark-600" role="tablist" aria-label="Хэрэглэгчийн хэсэг">
        <button
          type="button"
          role="tab"
          id="admin-users-kyc-tab"
          aria-selected={activeView === "kyc"}
          aria-controls="admin-users-kyc-panel"
          onClick={() => selectView("kyc")}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition ${activeView === "kyc" ? "bg-maroon-600 text-white" : "text-maroon-700 dark:text-gold-400 hover:bg-maroon-50 dark:hover:bg-dark-700"}`}
        >
          <FileText className="w-4 h-4" /> Баталгаажуулалт (KYC)
        </button>
        <button
          type="button"
          role="tab"
          id="admin-users-search-tab"
          aria-selected={activeView === "search"}
          aria-controls="admin-users-search-panel"
          onClick={() => selectView("search")}
          className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold transition ${activeView === "search" ? "bg-maroon-600 text-white" : "text-maroon-700 dark:text-gold-400 hover:bg-maroon-50 dark:hover:bg-dark-700"}`}
        >
          <Search className="w-4 h-4" /> Хэрэглэгч хайх
        </button>
      </div>

      {visitedViews.has("kyc") && (
        <section id="admin-users-kyc-panel" role="tabpanel" aria-labelledby="admin-users-kyc-tab" hidden={activeView !== "kyc"}>
          <AdminKyc />
        </section>
      )}
      {visitedViews.has("search") && (
        <section id="admin-users-search-panel" role="tabpanel" aria-labelledby="admin-users-search-tab" hidden={activeView !== "search"}>
          <AdminUserSearch />
        </section>
      )}
    </div>
  );
}
