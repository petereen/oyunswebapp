import { useState, useEffect, useRef } from "react";
import oyunsIcon from "./assets/oyuns-icon.png";
import { AdminPanel } from "./pages/AdminPanel";
import { useIsFetching } from "@tanstack/react-query";
import { FuelAdminPanel } from "./pages/FuelAdminPanel";
import { HomeTab } from "./pages/HomeTab";
import { TransactionTab } from "./pages/TransactionTab";
import { ServicesTab } from "./pages/ServicesTab";
import { OyunsPlusTab } from "./pages/OyunsPlusTab";
import { StatsTab } from "./pages/StatsTab";
import { ProfilePage } from "./pages/ProfilePage";
import { DashboardPanel } from "./pages/DashboardPanel";
import { BottomNavBar } from "./components/BottomNavBar";
import { useTelegramAuth } from "./hooks/useTelegramAuth";
import { DevToolbar } from "./components/DevToolbar";
import { useEntitlements } from "./hooks/useEntitlements";

const INITIAL_LOAD_IDLE_MS = 500;

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
  const urlAdminOyunsPlus = queryParams.get("admin-tab") === "oyuns-plus";

  const { initData, user, isAuthenticating, authError, clearAuth, refreshAuth, needsBrowserLogin, startBrowserLogin } = useTelegramAuth();
  const entitlements = useEntitlements({ userId: user?.id, isAuthenticating });
  const isFetchingInitialData = useIsFetching() > 0;
  const [view, setView] = useState<"client" | "admin">(urlAdminOyunsPlus ? "admin" : "client");
  const initialActiveTab = urlOyunsPlusTab ? 3 : urlEditInvoice ? 1 : urlFuelOrderId ? 2 : 0;
  const [activeTab, setActiveTab] = useState(initialActiveTab);
  const effectiveActiveTab = user ? activeTab : 0;
  const [showProfile, setShowProfile] = useState(false);
  const [hasCompletedInitialLoad, setHasCompletedInitialLoad] = useState(false);
  const [transactionDirection, setTransactionDirection] = useState<"buy" | "sell" | null>(null);
  const [fuelOrderId, setFuelOrderId] = useState<string | null>(urlFuelOrderId);
  const [editInvoiceId, setEditInvoiceId] = useState<string | null>(urlEditInvoice);
  const [visitedTabs, setVisitedTabs] = useState<Set<number>>(() => new Set([0, initialActiveTab]));
  const scrollPositionsRef = useRef<Record<number, number>>({});
  const previousTabRef = useRef(effectiveActiveTab);

  // Keep the first app view behind one stable loading screen while auth and
  // the data needed by the initial tab settle. This prevents individual page
  // skeletons from flashing during the startup handoff.
  const initialDataLoading = isAuthenticating || entitlements.isResolving || isFetchingInitialData;
  const showInitialLoadingScreen = !hasCompletedInitialLoad;

  useEffect(() => {
    if (hasCompletedInitialLoad || initialDataLoading) return;

    // Initial queries can arrive in waves as auth/profile results mount more
    // data-backed children. Only reveal the app after all queries have stayed
    // idle long enough for the next wave to register.
    const idleTimer = window.setTimeout(() => {
      setHasCompletedInitialLoad(true);
    }, INITIAL_LOAD_IDLE_MS);

    return () => window.clearTimeout(idleTimer);
  }, [hasCompletedInitialLoad, initialDataLoading]);

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
      <div className="min-h-screen bg-surface-50 dark:bg-dark-900 p-4 pb-24 md:p-8 md:pb-24">
        <div className="max-w-6xl mx-auto">
          <AdminPanel onExit={() => setView("client")} initialTransactionTab={urlAdminOyunsPlus ? "gifts" : "inbox"} />
        </div>
        <BottomNavBar
          activeTab={-1}
          onTabChange={(tab) => {
            setView("client");
            handleTabChange(tab);
          }}
          isAdmin
          isAdminView
          onSwitchView={() => setView("client")}
        />
        <DevToolbar />
      </div>
    );
  }

  // Client view - Tab-based
  return (
    <>
      {showInitialLoadingScreen && (
        <div className="startup-loading-screen" role="status" aria-live="polite" aria-label="Loading application">
          <div className="startup-loading-card">
            <div className="startup-loading-logo-wrap" aria-hidden="true">
              <img src={oyunsIcon} alt="OYUNS ALL-IN-ONE" className="startup-loading-logo" />
              <span className="startup-loading-spinner" aria-hidden="true" />
            </div>
            <span>OYUNS ALL-IN-ONE</span>
          </div>
        </div>
      )}
      <div className="client-shell min-h-screen bg-surface-50 dark:bg-dark-900" aria-busy={showInitialLoadingScreen}>
      <main className="client-content max-w-lg mx-auto p-4 pt-telegram-safe pb-32">
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
                userName={[entitlements.profile?.user?.first_name, entitlements.profile?.user?.last_name].filter(Boolean).join(" ") || user?.first_name || ""}
                verificationLevel={entitlements.verificationLevel}
                emailVerificationPending={entitlements.emailVerificationPending}
                emailAddress={entitlements.profile?.user?.email}
                isProfileLoading={entitlements.isResolving}
                isProfileResolved={Boolean(entitlements.profile)}
              />
          </div>
        )}
        {user && visitedTabs.has(4) && (
          <div className={showProfile || effectiveActiveTab !== 4 ? "hidden" : "block"} aria-hidden={showProfile || effectiveActiveTab !== 4}>
            <StatsTab userId={user.id} isAuthenticating={isAuthenticating} entitlements={entitlements} />
          </div>
        )}
        {showProfile && <ProfilePage userId={user?.id} onBack={handleBackFromProfile} onLogout={handleLogout} />}
      </main>

      {/* Bottom Nav */}
      {user && (
        <BottomNavBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isAdmin={isAdmin}
          onSwitchView={() => setView("admin")}
        />
      )}

      {/* Diagnostic Helper */}
      <DevToolbar />
      </div>
    </>
  );
}
