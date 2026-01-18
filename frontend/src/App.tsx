import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { AdminPanel } from "./pages/AdminPanel";
import { useTelegramAuth } from "./hooks/useTelegramAuth";
import { Shield } from "lucide-react";
import { TelegramDiagnostic } from "./components/TelegramDiagnostic";
import { DevToolbar } from "./components/DevToolbar";

export default function App() {
  const { initData, user, isAuthenticating, authError } = useTelegramAuth();
  const [view, setView] = useState<"client" | "admin">("client");
  const [isAdmin, setIsAdmin] = useState(false);

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

          {/* Admin toggle only visible to admins */}
          {isAdmin && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView("client")}
                className={`px-4 py-2 rounded-full text-sm font-semibold ${view === "client" ? "bg-ocean-600 text-white" : "bg-white"}`}
              >
                Хэрэглэгч
              </button>
              <button
                onClick={() => setView("admin")}
                className={`px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1 ${view === "admin" ? "bg-ocean-600 text-white" : "bg-white"}`}
              >
                <Shield className="w-4 h-4" /> Админ
              </button>
            </div>
          )}
        </div>

        {view === "client" || !isAdmin ? (
          <Dashboard initData={initData} user={user} isAuthenticating={isAuthenticating} authError={authError} onAdminStatusChange={setIsAdmin} />
        ) : (
          <AdminPanel />
        )}
      </div>

      {/* Diagnostic Helper */}
      <TelegramDiagnostic />
      <DevToolbar />
    </div>
  );
}
