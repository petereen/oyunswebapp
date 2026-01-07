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

// Dev mode user for local testing (matches ADMIN_CHAT_ID)
const DEV_USER: TelegramUser = {
  id: 1932946217,
  first_name: "Dev",
  last_name: "User",
  username: "devuser",
};

export function useTelegramAuth() {
  const [initData, setInitData] = useState<string>("");
  const [user, setUser] = useState<TelegramUser | null>(null);

  useEffect(() => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) {
      setInitData(tg.initData);
      tg.ready?.();
      if (tg.initDataUnsafe?.user) {
        setUser(tg.initDataUnsafe.user as TelegramUser);
      }
      return;
    }
    // fallback for local dev - use dev user
    const fallback = localStorage.getItem("tg_initdata") || "dev-mode";
    setInitData(fallback);
    const fallbackUser = localStorage.getItem("tg_user");
    if (fallbackUser) {
      try {
        setUser(JSON.parse(fallbackUser));
      } catch {
        setUser(DEV_USER);
      }
    } else {
      // In dev mode without Telegram, use dev user
      setUser(DEV_USER);
    }
  }, []);

  return { initData, user };
}
