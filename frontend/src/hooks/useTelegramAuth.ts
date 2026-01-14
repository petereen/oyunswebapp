import { useEffect, useState } from "react";

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
      
      if (tg.initDataUnsafe?.user) {
        console.log("✅ User data retrieved:", tg.initDataUnsafe.user);
        setUser(tg.initDataUnsafe.user as TelegramUser);
      } else {
        console.warn("⚠️ initDataUnsafe.user is missing!");
        setUser(null);
      }
      return;
    }
    
    console.warn("⚠️ initData not available - might be running outside Telegram Mini App");
    setInitData("");
    setUser(null);
  }, []);

  return { initData, user };
}
