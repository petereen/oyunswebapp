import { useState } from "react";
import { Shield, FileText, Inbox, Users, CreditCard, History, Gift, Wrench } from "lucide-react";
import { AdminInbox } from "../components/AdminInbox";
import { AdminKyc } from "../components/AdminKyc";
import { AdminUserSearch } from "../components/AdminUserSearch";
import { AdminBankAccounts } from "../components/AdminBankAccounts";
import { AdminHistory } from "../components/AdminHistory";
import { AdminGifts } from "../components/AdminGifts";
import { AdminManualTransaction } from "../components/AdminManualTransaction";

type Tab = "inbox" | "kyc" | "users" | "banks" | "history" | "gifts" | "manual";

interface Props {
  onExit?: () => void;
}

export function AdminPanel({ onExit }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("inbox");

  const handleLogout = () => {
    onExit?.();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-maroon-700">
          <Shield className="w-5 h-5" /> Админ самбар
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-slate-500 hover:text-slate-700 underline"
        >
          Гарах
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveTab("inbox")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "inbox"
              ? "bg-maroon-600 text-white"
              : "bg-white/50 text-maroon-700 hover:bg-maroon-100"
          }`}
        >
          <Inbox className="w-4 h-4" />
          Гүйлгээ
        </button>
        <button
          onClick={() => setActiveTab("kyc")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "kyc"
              ? "bg-maroon-600 text-white"
              : "bg-white/50 text-maroon-700 hover:bg-maroon-100"
          }`}
        >
          <FileText className="w-4 h-4" />
          Хэрэглэгч
        </button>
        <button
          onClick={() => setActiveTab("users")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "users"
              ? "bg-maroon-600 text-white"
              : "bg-white/50 text-maroon-700 hover:bg-maroon-100"
          }`}
        >
          <Users className="w-4 h-4" />
          Хайлт
        </button>
        <button
          onClick={() => setActiveTab("banks")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "banks"
              ? "bg-maroon-600 text-white"
              : "bg-white/50 text-maroon-700 hover:bg-maroon-100"
          }`}
        >
          <CreditCard className="w-4 h-4" />
          Данс
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "history"
              ? "bg-maroon-600 text-white"
              : "bg-white/50 text-maroon-700 hover:bg-maroon-100"
          }`}
        >
          <History className="w-4 h-4" />
          Түүх
        </button>
        <button
          onClick={() => setActiveTab("manual")}
          className={`flex-1 min-w-[130px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "manual"
              ? "bg-[#2D62EC] text-white"
              : "bg-[#2D62EC]/10 text-[#2D62EC] hover:bg-[#2D62EC]/20"
          }`}
        >
          <Wrench className="w-4 h-4" />
          Гараар үүсгэх
        </button>
        <button
          onClick={() => setActiveTab("gifts")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "gifts"
              ? "bg-pink-500 text-white"
              : "bg-pink-50 text-pink-700 hover:bg-pink-100"
          }`}
        >
          <Gift className="w-4 h-4" />
          Бэлэг
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "inbox" ? (
        <AdminInbox />
      ) : activeTab === "manual" ? (
        <AdminManualTransaction onOpenInbox={() => setActiveTab("inbox")} />
      ) : activeTab === "kyc" ? (
        <AdminKyc />
      ) : activeTab === "users" ? (
        <AdminUserSearch />
      ) : activeTab === "history" ? (
        <AdminHistory />
      ) : activeTab === "gifts" ? (
        <AdminGifts />
      ) : (
        <AdminBankAccounts />
      )}
    </div>
  );
}
