import { useState, useEffect } from "react";
import { Fuel, Inbox, History, CreditCard, Lock, Eye, EyeOff, MapPin, Power } from "lucide-react";
import { FuelAdminInbox } from "../components/FuelAdminInbox";
import { FuelAdminHistory } from "../components/FuelAdminHistory";
import { FuelAdminBankAccounts } from "../components/FuelAdminBankAccounts";
import { FuelAdminStations } from "../components/FuelAdminStations";
import { FuelAdminShift } from "../components/FuelAdminShift";

type Tab = "inbox" | "history" | "banks" | "stations" | "shift";

const FUEL_ADMIN_API_KEY = import.meta.env.VITE_FUEL_ADMIN_API_KEY || "oyuns-fuel-admin-key-2026";
const STORAGE_KEY = "fuel_admin_authenticated";
const KEY_STORAGE = "fuel_admin_key";

export function FuelAdminPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("inbox");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "true" && localStorage.getItem(KEY_STORAGE)) {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = () => {
    if (apiKey === FUEL_ADMIN_API_KEY) {
      setIsAuthenticated(true);
      localStorage.setItem(STORAGE_KEY, "true");
      localStorage.setItem(KEY_STORAGE, apiKey);
      setError("");
    } else {
      setError("Буруу API түлхүүр");
    }
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(KEY_STORAGE);
    setApiKey("");
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 dark:from-dark-900 dark:to-dark-800 p-4">
        <div className="bg-white dark:bg-dark-800 rounded-2xl p-8 shadow-sm max-w-md mx-auto mt-20">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-ivory-200">⛽ OYUNS FINANCE ADMIN-F</h2>
            <p className="text-sm text-slate-500 dark:text-ivory-400 mt-1">API түлхүүр оруулна уу</p>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="API түлхүүр"
                className="w-full px-4 py-3 pr-12 border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
            {error && <div className="text-red-500 text-sm text-center">{error}</div>}
            <button
              onClick={handleLogin}
              className="w-full bg-amber-600 text-white py-3 rounded-xl font-semibold hover:bg-amber-700 transition"
            >
              Нэвтрэх
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Fuel }[] = [
    { key: "inbox", label: "Хүсэлт", icon: Inbox },
    { key: "history", label: "Түүх", icon: History },
    { key: "banks", label: "Данс", icon: CreditCard },
    { key: "stations", label: "АЗС", icon: MapPin },
    { key: "shift", label: "Ээлж", icon: Power },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-orange-50 dark:from-dark-900 dark:to-dark-800 p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold text-lg">
            <Fuel className="w-5 h-5" /> OYUNS FINANCE ADMIN-F
          </div>
          <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700 underline">
            Гарах
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2">
          {tabs.map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
                  activeTab === t.key
                    ? "bg-amber-600 text-white"
                    : "bg-white/50 dark:bg-dark-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-dark-600"
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        {activeTab === "inbox" && <FuelAdminInbox />}
        {activeTab === "history" && <FuelAdminHistory />}
        {activeTab === "banks" && <FuelAdminBankAccounts />}
        {activeTab === "stations" && <FuelAdminStations />}
        {activeTab === "shift" && <FuelAdminShift />}
      </div>
    </div>
  );
}
