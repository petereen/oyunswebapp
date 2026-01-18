import { useState } from "react";
import { Shield, FileText, Inbox, Users } from "lucide-react";
import { AdminInbox } from "../components/AdminInbox";
import { AdminKyc } from "../components/AdminKyc";
import { AdminUserSearch } from "../components/AdminUserSearch";

type Tab = "inbox" | "kyc" | "users";

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("inbox");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-ocean-700">
        <Shield className="w-5 h-5" /> Админ самбар
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab("inbox")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "inbox"
              ? "bg-ocean-600 text-white"
              : "bg-white/50 text-ocean-700 hover:bg-ocean-100"
          }`}
        >
          <Inbox className="w-4 h-4" />
          Гүйлгээ
        </button>
        <button
          onClick={() => setActiveTab("kyc")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "kyc"
              ? "bg-ocean-600 text-white"
              : "bg-white/50 text-ocean-700 hover:bg-ocean-100"
          }`}
        >
          <FileText className="w-4 h-4" />
          Баталгаажуулалт
        </button>
        <button
          onClick={() => setActiveTab("users")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "users"
              ? "bg-ocean-600 text-white"
              : "bg-white/50 text-ocean-700 hover:bg-ocean-100"
          }`}
        >
          <Users className="w-4 h-4" />
          Хэрэглэгч
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "inbox" ? (
        <AdminInbox />
      ) : activeTab === "kyc" ? (
        <AdminKyc />
      ) : (
        <AdminUserSearch />
      )}
    </div>
  );
}