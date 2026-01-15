import { useEffect, useState } from "react";
import { loginWithTelegram, getJwtToken } from "../api";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
          };
        };
        ready?: () => void;
      };
    };
  }
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export function useTelegramAuth() {
  const [initData, setInitData] = useState<string>("");
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    
    // Debug logging
    console.log("=== Telegram Auth Debug ===");
    console.log("Telegram WebApp available:", !!tg);
    console.log("Telegram object:", window.Telegram);
    
    if (!tg) {
      console.error("Telegram WebApp not available!");
      setInitData("");
      setUser(null);
      return;
    }
    
    console.log("initData:", tg.initData ? "✅ Present" : "❌ Missing");
    console.log("initDataUnsafe:", tg.initDataUnsafe ? "✅ Present" : "❌ Missing");
    console.log("initDataUnsafe.user:", tg.initDataUnsafe?.user ? "✅ Present" : "❌ Missing");
    
    if (tg.initData) {
      console.log("initData length:", tg.initData.length);
      console.log("initData preview:", tg.initData.substring(0, 100) + "...");
      setInitData(tg.initData);
      tg.ready?.();

      // If we have a local JWT already, prefer it and skip immediate auth
      if (getJwtToken()) {
        console.log("Found existing JWT, skipping auth call");
        // rely on backend /me to populate full user later
      }

      // If there's an unsafe user available, set it immediately for UI
      if (tg.initDataUnsafe?.user) {
        console.log("✅ User data retrieved:", tg.initDataUnsafe.user);
        setUser(tg.initDataUnsafe.user as TelegramUser);
      } else {
        console.warn("⚠️ initDataUnsafe.user is missing!");
        setUser(null);
      }

      // Attempt server-side login to get authoritative JWT and user
      (async () => {
        try {
          setIsAuthenticating(true);
          setAuthError(null);
          const res = await loginWithTelegram(tg.initData);
          if (res && res.user) {
            setUser(res.user as TelegramUser);
          }
        } catch (e: any) {
          console.error("Login with Telegram failed:", e);
          setAuthError(e?.message || "Authentication failed");
        } finally {
          setIsAuthenticating(false);
        }
      })();

      return;
    }
    
    console.warn("⚠️ initData not available - might be running outside Telegram Mini App");
    setInitData("");
    setUser(null);
  }, []);

  return { initData, user, isAuthenticating, authError };
}
