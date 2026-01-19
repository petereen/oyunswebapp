import { useState, useEffect } from "react";
import { Shield, FileText, Inbox, Users, Lock, Eye, EyeOff, CreditCard } from "lucide-react";
import { AdminInbox } from "../components/AdminInbox";
import { AdminKyc } from "../components/AdminKyc";
import { AdminUserSearch } from "../components/AdminUserSearch";
import { AdminBankAccounts } from "../components/AdminBankAccounts";

type Tab = "inbox" | "kyc" | "users" | "banks";

const ADMIN_API_KEY = "oyuns-admin-key-07012026";
const STORAGE_KEY = "admin_authenticated";

export function AdminPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("inbox");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");

  // Check if already authenticated on mount
  useEffect(() => {
    const storedAuth = localStorage.getItem(STORAGE_KEY);
    if (storedAuth === "true") {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = () => {
    if (apiKey === ADMIN_API_KEY) {
      setIsAuthenticated(true);
      localStorage.setItem(STORAGE_KEY, "true");
      setError("");
    } else {
      setError("Буруу API түлхүүр");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem(STORAGE_KEY);
    setApiKey("");
  };

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-ocean-700">
          <Shield className="w-5 h-5" /> Админ самбар
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-sm max-w-md mx-auto">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-ocean-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-ocean-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">Админ нэвтрэлт</h2>
            <p className="text-sm text-slate-500 mt-1">API түлхүүр оруулна уу</p>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="API түлхүүр"
                className="w-full px-4 py-3 pr-12 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-ocean-500"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {error && (
              <div className="text-red-500 text-sm text-center">{error}</div>
            )}

            <button
              onClick={handleLogin}
              className="w-full bg-ocean-600 text-white py-3 rounded-xl font-semibold hover:bg-ocean-700 transition"
            >
              Нэвтрэх
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-ocean-700">
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
              ? "bg-ocean-600 text-white"
              : "bg-white/50 text-ocean-700 hover:bg-ocean-100"
          }`}
        >
          <Inbox className="w-4 h-4" />
          Гүйлгээ
        </button>
        <button
          onClick={() => setActiveTab("kyc")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "kyc"
              ? "bg-ocean-600 text-white"
              : "bg-white/50 text-ocean-700 hover:bg-ocean-100"
          }`}
        >
          <FileText className="w-4 h-4" />
          KYC
        </button>
        <button
          onClick={() => setActiveTab("users")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "users"
              ? "bg-ocean-600 text-white"
              : "bg-white/50 text-ocean-700 hover:bg-ocean-100"
          }`}
        >
          <Users className="w-4 h-4" />
          Хэрэглэгч
        </button>
        <button
          onClick={() => setActiveTab("banks")}
          className={`flex-1 min-w-[100px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
            activeTab === "banks"
              ? "bg-ocean-600 text-white"
              : "bg-white/50 text-ocean-700 hover:bg-ocean-100"
          }`}
        >
          <CreditCard className="w-4 h-4" />
          Данс
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "inbox" ? (
        <AdminInbox />
      ) : activeTab === "kyc" ? (
        <AdminKyc />
      ) : activeTab === "users" ? (
        <AdminUserSearch />
      ) : (
        <AdminBankAccounts />
      )}
    </div>
  );
}