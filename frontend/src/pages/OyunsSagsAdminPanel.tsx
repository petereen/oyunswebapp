import { useEffect, useState } from "react";
import { Trophy, Lock, Eye, EyeOff, Users, Calendar, Settings, BarChart3 } from "lucide-react";

type Tab = "teams" | "games" | "votes" | "settings";

const OYUNS_SAGS_ADMIN_API_KEY = import.meta.env.VITE_OYUNS_SAGS_ADMIN_KEY || "oyuns-sags-admin-key-2026";
const AUTH_STORAGE_KEY = "oyuns_sags_admin_authenticated";
const KEY_STORAGE = "oyuns_sags_admin_key";

export function OyunsSagsAdminPanel() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("teams");

  useEffect(() => {
    if (localStorage.getItem(AUTH_STORAGE_KEY) === "true" && localStorage.getItem(KEY_STORAGE)) {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = () => {
    if (apiKey === OYUNS_SAGS_ADMIN_API_KEY) {
      setIsAuthenticated(true);
      localStorage.setItem(AUTH_STORAGE_KEY, "true");
      localStorage.setItem(KEY_STORAGE, apiKey);
      setError("");
      return;
    }
    setError("Invalid admin key");
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(KEY_STORAGE);
    setApiKey("");
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-dark-900 dark:to-dark-800 p-4">
        <div className="bg-white dark:bg-dark-800 rounded-2xl p-8 shadow-sm max-w-md mx-auto mt-20 border border-silver/60 dark:border-dark-600">
          <div className="text-center mb-6">
            <div className="w-16 h-16 bg-sky-100 dark:bg-sky-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <Lock className="w-8 h-8 text-sky-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-ivory-200">OYUNS SAGS Admin</h1>
            <p className="text-sm text-slate-500 dark:text-ivory-400 mt-1">Standalone admin access by API key (no Telegram auth)</p>
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
                placeholder="Enter admin key"
                className="w-full px-4 py-3 pr-12 border border-slate-200 dark:border-dark-600 bg-white dark:bg-dark-700 text-dark-800 dark:text-ivory-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-500"
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
              className="w-full bg-sky-600 text-white py-3 rounded-xl font-semibold hover:bg-sky-700 transition"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; icon: typeof Trophy }[] = [
    { key: "teams", label: "Teams", icon: Users },
    { key: "games", label: "Games", icon: Calendar },
    { key: "votes", label: "Votes", icon: BarChart3 },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white dark:from-dark-900 dark:to-dark-800 p-4">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sky-700 dark:text-sky-400 font-bold text-lg">
            <Trophy className="w-5 h-5" /> OYUNS SAGS Admin
          </div>
          <button onClick={handleLogout} className="text-sm text-slate-500 hover:text-slate-700 underline">
            Logout
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 min-w-[120px] flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition ${
                  activeTab === tab.key
                    ? "bg-sky-600 text-white"
                    : "bg-white dark:bg-dark-700 text-slate-700 dark:text-ivory-300 border border-slate-200 dark:border-dark-600 hover:bg-slate-50 dark:hover:bg-dark-600"
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="bg-white dark:bg-dark-800 rounded-2xl p-6 border border-silver/60 dark:border-dark-600 shadow-card-xs">
          <div className="text-base font-bold text-dark-800 dark:text-ivory-200 mb-2">
            {activeTab === "teams" && "Team Management"}
            {activeTab === "games" && "Game Schedule & Scores"}
            {activeTab === "votes" && "Voting Overview"}
            {activeTab === "settings" && "Tournament Settings"}
          </div>
          <div className="text-sm text-dark-600 dark:text-ivory-300">
            This panel is intentionally independent from Telegram auth and is available at /oyuns-sags using API-key login.
          </div>
        </div>
      </div>
    </div>
  );
}
