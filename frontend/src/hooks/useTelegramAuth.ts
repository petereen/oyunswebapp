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

// DEV MODE: Telegram auth is disabled
export function useTelegramAuth() {
  const [initData, setInitData] = useState<string>("");
  const [user, setUser] = useState<TelegramUser | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    // DEV MODE: Always use mock user without Telegram auth
    console.log("🔧 DEV MODE: Telegram auth disabled, using mock user");
    
    // Load dev user from local storage or use default (using real admin ID for testing)
    const storedDevUser = localStorage.getItem("oyuns_dev_user");
    const defaultDevUser: TelegramUser = {
      id: 1932946217,  // Real admin user ID for testing
      first_name: "Test",
      last_name: "Admin",
      username: "test_admin"
    };
    
    const mockUser: TelegramUser = storedDevUser ? JSON.parse(storedDevUser) : defaultDevUser;
    const mockInitData = `dev_mode_bypass:${JSON.stringify(mockUser)}`;
    
    // Mock window.Telegram for components that check it
    if (!window.Telegram) {
      window.Telegram = {} as any;
    }
    window.Telegram!.WebApp = {
      initData: mockInitData,
      initDataUnsafe: {
        user: mockUser
      },
      ready: () => console.log("Mock Telegram WebApp ready"),
      expand: () => {},
      close: () => {},
      MainButton: { 
        show: () => {}, 
        hide: () => {}, 
        setText: () => {},
        onClick: () => {},
        offClick: () => {},
        enable: () => {},
        disable: () => {},
        showProgress: () => {},
        hideProgress: () => {},
      } as any,
      BackButton: {
        show: () => {},
        hide: () => {},
        onClick: () => {},
        offClick: () => {},
      } as any,
    } as any;

    setInitData(mockInitData);
    setUser(mockUser);
    setIsAuthenticating(false);
    setAuthError(null);
    
    console.log("✅ Dev user loaded:", mockUser);
  }, []);

  return { initData, user, isAuthenticating, authError };
}
