import { useState, useEffect, useRef } from "react";
import oyunsLogo from "./assets/oyuns-logo.png";
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
import { useLang } from "./i18n/useLang";
import { DevToolbar } from "./components/DevToolbar";
import { useEntitlements } from "./hooks/useEntitlements";

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
  const entitlements = useEntitlements({ userId: user?.id, isAuthenticating });
  const { t } = useLang();
  const [view, setView] = useState<"client" | "admin">("client");
  const initialActiveTab = urlOyunsPlusTab ? 3 : urlEditInvoice ? 1 : urlFuelOrderId ? 2 : 0;
  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const effectiveActiveTab = user ? activeTab : 0;
  const [showProfile, setShowProfile] = useState(false);
  const [transactionDirection, setTransactionDirection] = useState<"buy" | "sell" | null>(null);
  const [fuelOrderId, setFuelOrderId] = useState<string | null>(urlFuelOrderId);
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(urlEditInvoice);
  const [visitedTabs, setVisitedTabs] = useState<Set<number>>(() => new Set([0, initialActiveTab]));
  const scrollPositionsRef = useRef<Record<number, number>>({});
  const previousTabRef = useRef(effectiveActiveTab);

  useEffect(() => {
    if (!user) {
      setVisitedTabs(new Set([0, initialActiveTab]));
      return;
    }
    setVisitedTabs((previous) => {
      if (previous.has(effectiveActiveTab)) return previous;
      const next = new Set(previous);
      next.add(effectiveActiveTab);
      return next;
    });
  }, [user, effectiveActiveTab]);

  // Listen for auth:unauthorized events and trigger re-authentication
  useEffect(() => {
    const handleUnauthorized = () => {
      console.log('🔄 Received auth:unauthorized event, refreshing auth...');
      refreshAuth();
    };
    
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, [refreshAuth]);

  const isAdmin = entitlements.isAdmin;
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
    scrollPositionsRef.current[effectiveActiveTab] = window.scrollY;
    setShowProfile(true);
  };

  const handleBackFromProfile = () => {
    setShowProfile(false);
    requestAnimationFrame(() => window.scrollTo({ top: scrollPositionsRef.current[effectiveActiveTab] || 0, behavior: "auto" }));
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
    scrollPositionsRef.current[previousTabRef.current] = window.scrollY;
    previousTabRef.current = tab;
    setVisitedTabs((previous) => new Set(previous).add(tab));
    setActiveTab(tab);
    setShowProfile(false);
    requestAnimationFrame(() => window.scrollTo({ top: scrollPositionsRef.current[tab] || 0, behavior: "auto" }));
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

        {/* Visited tabs remain mounted so local state and data observers survive navigation. */}
        {visitedTabs.has(0) && (
          <div className={showProfile || effectiveActiveTab !== 0 ? "hidden" : "block"} aria-hidden={showProfile || effectiveActiveTab !== 0}>
              <HomeTab
                initData={initData}
                user={user}
                isAuthenticating={isAuthenticating}
                authError={authError}
                entitlements={entitlements}
                needsBrowserLogin={needsBrowserLogin}
                onStartBrowserLogin={startBrowserLogin}
                onNavigateToTransaction={handleNavigateToTransaction}
                onNavigateToProfile={handleNavigateToProfile}
                onNavigateToFuelOrder={handleNavigateToFuelOrder}
                openEmailVerify={urlVerifyEmail}
              />
          </div>
        )}
        {user && visitedTabs.has(1) && (
          <div className={showProfile || effectiveActiveTab !== 1 ? "hidden" : "block"} aria-hidden={showProfile || effectiveActiveTab !== 1}>
              <TransactionTab
                initData={initData}
                user={user}
                isAuthenticating={isAuthenticating}
                entitlements={entitlements}
                initialDirection={transactionDirection}
                initialEditInvoice={editInvoiceId}
                onResetDirection={() => setTransactionDirection(null)}
                onEditInvoiceHandled={handleEditInvoiceConsumed}
              />
          </div>
        )}
        {user && visitedTabs.has(2) && (
          <div className={showProfile || effectiveActiveTab !== 2 ? "hidden" : "block"} aria-hidden={showProfile || effectiveActiveTab !== 2}>
            <ServicesTab userId={user.id} isAuthenticating={isAuthenticating} entitlements={entitlements} initialFuelOrderId={fuelOrderId} onFuelOrderOpened={() => setFuelOrderId(null)} />
          </div>
        )}
        {user && visitedTabs.has(3) && (
          <div className={showProfile || effectiveActiveTab !== 3 ? "hidden" : "block"} aria-hidden={showProfile || effectiveActiveTab !== 3}>
              <OyunsPlusTab
                userId={user?.id}
                verificationLevel={entitlements.verificationLevel}
                emailVerificationPending={entitlements.emailVerificationPending}
                emailAddress={entitlements.profile?.user?.email}
                isProfileLoading={entitlements.isResolving}
                isProfileResolved={Boolean(entitlements.profile)}
                initialTournamentSection={urlTournamentSection}
                initialTournamentInnerTab={urlTournamentInnerTab}
              />
          </div>
        )}
        {user && visitedTabs.has(4) && (
          <div className={showProfile || effectiveActiveTab !== 4 ? "hidden" : "block"} aria-hidden={showProfile || effectiveActiveTab !== 4}>
            <StatsTab userId={user.id} isAuthenticating={isAuthenticating} entitlements={entitlements} />
          </div>
        )}
        {showProfile && <ProfilePage userId={user?.id} onBack={handleBackFromProfile} onLogout={handleLogout} />}
      </div>

      {/* Bottom Nav */}
      {user && <BottomNavBar activeTab={activeTab} onTabChange={handleTabChange} />}

      {/* Diagnostic Helper */}
      <DevToolbar />
    </div>
  );
}
