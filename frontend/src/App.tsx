import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminPanel } from "./pages/AdminPanel";
import { HomeTab } from "./pages/HomeTab";
import { TransactionTab } from "./pages/TransactionTab";
import { ServicesTab } from "./pages/ServicesTab";
import { StatsTab } from "./pages/StatsTab";
import { ProfilePage } from "./pages/ProfilePage";
import { BottomNavBar } from "./components/BottomNavBar";
import { useTelegramAuth } from "./hooks/useTelegramAuth";
import { Shield } from "lucide-react";
import { TelegramDiagnostic } from "./components/TelegramDiagnostic";
import { DevToolbar } from "./components/DevToolbar";
import { fetchMe } from "./api";

export default function App() {
  const { initData, user, isAuthenticating, authError, refreshAuth } = useTelegramAuth();
  const [view, setView] = useState<"client" | "admin">("client");
  const [activeTab, setActiveTab] = useState(0);
  const [showProfile, setShowProfile] = useState(false);
  const [transactionDirection, setTransactionDirection] = useState<"buy" | "sell" | null>(null);

  // Listen for auth:unauthorized events and trigger re-authentication
  useEffect(() => {
    const handleUnauthorized = () => {
      console.log('🔄 Received auth:unauthorized event, refreshing auth...');
      refreshAuth();
    };
    
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [refreshAuth]);

  // Fetch profile at App level to determine admin status immediately
  const { data: profile } = useQuery({
    queryKey: ["me", user?.id],
    queryFn: () => fetchMe(),
    enabled: Boolean(user?.id) && !isAuthenticating,
    staleTime: 0,
  });

  const isAdmin = profile?.is_admin || false;

  const handleNavigateToTransaction = (direction?: "buy" | "sell") => {
    setTransactionDirection(direction || null);
    setActiveTab(1);
  };

  const handleNavigateToProfile = () => {
    setShowProfile(true);
  };

  const handleBackFromProfile = () => {
    setShowProfile(false);
  };

  const handleTabChange = (tab: number) => {
    setActiveTab(tab);
    setShowProfile(false);
    if (tab !== 1) setTransactionDirection(null);
  };

  // Admin view
  if (view === "admin" && isAdmin) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-dark-900 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <img
                src="https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/oyuns%20finance%20logo%203%20tp.png"
                alt="OYUNS FINANCE"
                className="h-10 w-auto object-contain"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView("client")}
                className="px-4 py-2 rounded-full text-sm font-semibold transition bg-white dark:bg-dark-700 text-maroon-600 dark:text-gold-400 hover:bg-maroon-50 dark:hover:bg-dark-600"
              >
                Хэрэглэгч
              </button>
              <button
                className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1 transition bg-maroon-600 text-white"
              >
                <Shield className="w-4 h-4" /> Админ
              </button>
            </div>
          </div>
          <AdminPanel />
        </div>
        <DevToolbar />
      </div>
    );
  }

  // Client view - Tab-based
  return (
    <div className="min-h-screen bg-surface-50 dark:bg-dark-900">
      <div className="max-w-lg mx-auto p-4 pb-28">
        {/* Admin toggle for admins */}
        {isAdmin && (
          <div className="flex justify-end mb-2">
            <button
              onClick={() => setView("admin")}
              className="px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 transition bg-maroon-700 text-gold-400 hover:bg-maroon-600"
            >
              <Shield className="w-3.5 h-3.5" /> Админ
            </button>
          </div>
        )}

        {/* Profile Page (overlays tabs) */}
        {showProfile ? (
          <ProfilePage userId={user?.id} onBack={handleBackFromProfile} />
        ) : (
          <>
            {activeTab === 0 && (
              <HomeTab
                initData={initData}
                user={user}
                isAuthenticating={isAuthenticating}
                authError={authError}
                onNavigateToTransaction={handleNavigateToTransaction}
                onNavigateToProfile={handleNavigateToProfile}
              />
            )}
            {activeTab === 1 && (
              <TransactionTab
                initData={initData}
                user={user}
                initialDirection={transactionDirection}
                onResetDirection={() => setTransactionDirection(null)}
              />
            )}
            {activeTab === 2 && <ServicesTab />}
            {activeTab === 3 && <StatsTab userId={user?.id} />}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <BottomNavBar activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Diagnostic Helper */}
      <DevToolbar />
    </div>
  );
}
