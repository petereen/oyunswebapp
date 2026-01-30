import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dashboard } from "./pages/Dashboard";
import { AdminPanel } from "./pages/AdminPanel";
import { useTelegramAuth } from "./hooks/useTelegramAuth";
import { Shield, MessageCircle } from "lucide-react";
import { TelegramDiagnostic } from "./components/TelegramDiagnostic";
import { DevToolbar } from "./components/DevToolbar";
import { fetchMe } from "./api";

export default function App() {
  const { initData, user, isAuthenticating, authError } = useTelegramAuth();
  const [view, setView] = useState<"client" | "admin">("client");

  // Fetch profile at App level to determine admin status immediately
  const { data: profile } = useQuery({
    queryKey: ["me", user?.id],
    queryFn: () => fetchMe(),
    enabled: Boolean(user?.id) && !isAuthenticating,
    staleTime: 0,
  });

  const isAdmin = profile?.is_admin || false;

  return (
    <div className="min-h-screen bg-gradient-to-br from-ocean-50 to-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header with Logo */}
        <div className="flex items-center justify-between mb-6">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <img
              src="https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/oyuns%20finance%20logo%203%20tp.png"
              alt="OYUNS FINANCE"
              className="h-10 w-auto"
            />
          </div>

          {/* Admin toggle - always visible to admins */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView("client")}
                className={`px-4 py-2 rounded-full text-sm font-semibold transition ${view === "client" ? "bg-ocean-600 text-white" : "bg-white text-ocean-700 hover:bg-ocean-50"}`}
              >
                Хэрэглэгч
              </button>
              <button
                onClick={() => setView("admin")}
                className={`px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1 transition ${view === "admin" ? "bg-ocean-600 text-white" : "bg-white text-ocean-700 hover:bg-ocean-50"}`}
              >
                <Shield className="w-4 h-4" /> Админ
              </button>
            </div>
          )}
        </div>

        {view === "client" || !isAdmin ? (
          <Dashboard initData={initData} user={user} isAuthenticating={isAuthenticating} authError={authError} />
        ) : (
          <AdminPanel />
        )}
      </div>

      {/* Diagnostic Helper */}
      <TelegramDiagnostic />
      <DevToolbar />

      {/* Support Chat Button */}
      <a
        href="https://t.me/oyuns_finance"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-4 py-3 bg-ocean-600 text-white rounded-full shadow-lg hover:bg-ocean-700 transition-all hover:scale-105"
      >
        <MessageCircle className="w-5 h-5" />
        <span className="font-medium">Тусламж</span>
      </a>
    </div>
  );
}
