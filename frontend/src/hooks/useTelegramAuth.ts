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
    console.log("Telegram WebApp:", tg);
    console.log("initData:", tg?.initData);
    console.log("initDataUnsafe:", tg?.initDataUnsafe);
    
    if (tg?.initData) {
      setInitData(tg.initData);
      tg.ready?.();
      if (tg.initDataUnsafe?.user) {
        console.log("User from Telegram:", tg.initDataUnsafe.user);
        setUser(tg.initDataUnsafe.user as TelegramUser);
      }
      return;
    }
    // No Telegram init data available: leave empty for production safety
    setInitData("");
    setUser(null);
  }, []);

  return { initData, user };
}
