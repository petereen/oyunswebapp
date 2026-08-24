import { useState, useEffect } from "react";
import oyunsLogo from "./assets/oyuns-logo.png";
import { useQuery } from "@tanstack/react-query";
import { AdminPanel } from "./pages/AdminPanel";
import { FuelAdminPanel } from "./pages/FuelAdminPanel";
import { HomeTab } from "./pages/HomeTab";
import { TransactionTab } from "./pages/TransactionTab";
import { ServicesTab } from "./pages/ServicesTab";
import { OyunsPlusTab } from "./pages/OyunsPlusTab";
import { StatsTab } from "./pages/StatsTab";
import { ProfilePage } from "./pages/ProfilePage";
import { OyunsSagsAdminPanel } from "./pages/OyunsSagsAdminPanel";
import { DashboardPanel } from "./pages/DashboardPanel";
import { BottomNavBar } from "./components/BottomNavBar";
import { useTelegramAuth } from "./hooks/useTelegramAuth";
import { Shield } from "lucide-react";
import { TelegramDiagnostic } from "./components/TelegramDiagnostic";
import { useLang } from "./i18n/useLang";
import { DevToolbar } from "./components/DevToolbar";
import { fetchMe } from "./api";

export default function App() {
  const queryParams = new URLSearchParams(window.location.search);
  const rawPath = window.location.pathname;
  const hostname = window.location.hostname.toLowerCase();
  const allowedHosts = new Set([
    "app.oyuns.mn",
    "dashboard.oyuns.mn",
    "localhost",
    "127.0.0.1",
    "::1",
  ]);
  const isAllowedHost = allowedHosts.has(hostname);
  const normalizedPath = rawPath === "/" ? "/" : rawPath.replace(/\/+$/, "");
  const requestedTab = queryParams.get("tab");
  const requestedTournament = queryParams.get("tournament");
  const requestedTournamentSection = queryParams.get("section");

  if (!isAllowedHost) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-dark-900 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl bg-white dark:bg-dark-800 p-6 text-center shadow-lg">
          <h1 className="text-xl font-bold text-maroon-700 dark:text-gold-400 mb-2">Unavailable Host</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300">
            This app is only available on app.oyuns.mn and dashboard.oyuns.mn.
          </p>
        </div>
      </div>
    );
  }

  // Standalone tournament admin panel without Telegram auth
  const isOyunsSagsAdmin = normalizedPath === "/oyuns-sags" || normalizedPath === "/omoh-sags";
  if (isOyunsSagsAdmin) return <OyunsSagsAdminPanel />;

  // Standalone analytics dashboard without Telegram auth
  if (hostname === "dashboard.oyuns.mn" || normalizedPath === "/dashboard") return <DashboardPanel />;

  // Check URL for fuel admin panel
  const isFuelAdmin = queryParams.has("fuel-admin");
  if (isFuelAdmin) return <FuelAdminPanel />;

  // Check URL for fuel order deep link
  const urlFuelOrderId = queryParams.get("fuel-order");
  const urlEditInvoice = queryParams.get("edit-invoice");
  const urlVerifyEmail = queryParams.has("verify-email");
  const urlOyunsPlusTab = requestedTab === "oyuns-plus";
  const urlTournamentSection = requestedTournament === "basketball" ? "basketball" : null;
  const urlTournamentInnerTab = requestedTournamentSection === "schedule" || requestedTournamentSection === "leaderboard" || requestedTournamentSection === "stages"
    ? requestedTournamentSection
    : "schedule";

  const { initData, user, isAuthenticating, authError, clearAuth, refreshAuth, needsBrowserLogin, startBrowserLogin } = useTelegramAuth();
  const { t } = useLang();
  const [view, setView] = useState<"client" | "admin">("client");
  const [activeTab, setActiveTab] = useState(urlOyunsPlusTab ? 3 : urlEditInvoice ? 1 : urlFuelOrderId ? 2 : 0);
  const [showProfile, setShowProfile] = useState(false);
  const [transactionDirection, setTransactionDirection] = useState<"buy" | "sell" | null>(null);
  const [fuelOrderId, setFuelOrderId] = useState<string | null>(urlFuelOrderId);
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(urlEditInvoice);

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
  const { data: profile, isLoading: isProfileLoading } = useQuery({
    queryKey: ["me", user?.id],
    queryFn: () => fetchMe(),
    enabled: Boolean(user?.id) && !isAuthenticating,
    staleTime: 0,
  });

  const isAdmin = profile?.is_admin || false;
  const verificationLevel = profile?.user?.verification_level ?? (profile?.user?.verified ? 2 : profile?.user?.ready_for_verification ? 1 : 0);
  const effectiveActiveTab = user ? activeTab : 0;

  const handleNavigateToTransaction = (direction?: "buy" | "sell", editInvoice?: string) => {
    if (editInvoice) {
      setEditInvoiceId(editInvoice);
      setTransactionDirection(null);
    } else {
      setEditInvoiceId(null);
      setTransactionDirection(direction || null);
    }
    setActiveTab(1);
  };

  const handleEditInvoiceConsumed = () => {
    setEditInvoiceId(null);
    const params = new URLSearchParams(window.location.search);
    if (params.has("edit-invoice")) {
      params.delete("edit-invoice");
      const nextQuery = params.toString();
      const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
      window.history.replaceState({}, "", nextUrl);
    }
  };

  const handleNavigateToProfile = () => {
    setShowProfile(true);
  };

  const handleBackFromProfile = () => {
    setShowProfile(false);
  };

  const handleLogout = () => {
    clearAuth();
    setShowProfile(false);
    setActiveTab(0);
    setTransactionDirection(null);
    setFuelOrderId(null);
    setEditInvoiceId(null);
  };

  const handleNavigateToFuelOrder = (orderId: string) => {
    setFuelOrderId(orderId);
    setActiveTab(2);
    setShowProfile(false);
  };

  const handleTabChange = (tab: number) => {
    setActiveTab(tab);
    setShowProfile(false);
    if (tab !== 1) setTransactionDirection(null);
    if (tab !== 1) setEditInvoiceId(null);
    if (tab !== 2) setFuelOrderId(null);
  };

  // Admin view
  if (view === "admin" && isAdmin) {
    return (
      <div className="min-h-screen bg-surface-50 dark:bg-dark-900 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <img
                src={oyunsLogo}
                alt="OYUNS ALL-IN-ONE"
                className="h-10 w-auto object-contain"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setView("client")}
                className="px-4 py-2 rounded-full text-sm font-semibold transition bg-white dark:bg-dark-700 text-maroon-600 dark:text-gold-400 hover:bg-maroon-50 dark:hover:bg-dark-600"
              >
                {t("app.user")}
              </button>
              <button
                className="px-4 py-2 rounded-full text-sm font-semibold flex items-center gap-1 transition bg-maroon-600 text-white"
              >
                <Shield className="w-4 h-4" /> {t("app.admin")}
              </button>
            </div>
          </div>
          <AdminPanel onExit={() => setView("client")} />
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
              <Shield className="w-3.5 h-3.5" /> {t("app.admin")}
            </button>
          </div>
        )}

        {/* Profile Page (overlays tabs) */}
        {showProfile ? (
          <ProfilePage userId={user?.id} onBack={handleBackFromProfile} onLogout={handleLogout} />
        ) : (
          <>
            {effectiveActiveTab === 0 && (
              <HomeTab
                initData={initData}
                user={user}
                isAuthenticating={isAuthenticating}
                authError={authError}
                needsBrowserLogin={needsBrowserLogin}
                onStartBrowserLogin={startBrowserLogin}
                onNavigateToTransaction={handleNavigateToTransaction}
                onNavigateToProfile={handleNavigateToProfile}
                onNavigateToFuelOrder={handleNavigateToFuelOrder}
                openEmailVerify={urlVerifyEmail}
              />
            )}
            {user && effectiveActiveTab === 1 && (
              <TransactionTab
                initData={initData}
                user={user}
                initialDirection={transactionDirection}
                initialEditInvoice={editInvoiceId}
                onResetDirection={() => setTransactionDirection(null)}
                onEditInvoiceHandled={handleEditInvoiceConsumed}
              />
            )}
            {user && effectiveActiveTab === 2 && <ServicesTab initialFuelOrderId={fuelOrderId} onFuelOrderOpened={() => setFuelOrderId(null)} />}
            {user && effectiveActiveTab === 3 && (
              <OyunsPlusTab
                userId={user?.id}
                verificationLevel={verificationLevel}
                emailVerificationPending={Boolean(profile?.user?.email_verification_pending)}
                emailAddress={profile?.user?.email}
                isProfileLoading={Boolean(user?.id) && isProfileLoading}
                initialTournamentSection={urlTournamentSection}
                initialTournamentInnerTab={urlTournamentInnerTab}
              />
            )}
            {user && effectiveActiveTab === 4 && <StatsTab userId={user?.id} />}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      {user && <BottomNavBar activeTab={activeTab} onTabChange={handleTabChange} />}

      {/* Diagnostic Helper */}
      <DevToolbar />
    </div>
  );
}
