import { useState, useEffect, useCallback } from 'react';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface AuthState {
  initData: string;
  user: TelegramUser | null;
  isAuthenticating: boolean;
  authError: string | null;
  token: string | null;
}

// Extend Window interface for Telegram WebApp
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe?: {
          user?: TelegramUser;
          auth_date?: number;
          hash?: string;
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        MainButton: {
          text: string;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
        };
      };
    };
  }
}

const JWT_STORAGE_KEY = 'oyuns_jwt';
const USER_STORAGE_KEY = 'oyuns_user';
const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';

// Default dev user for local testing without Telegram
const DEV_USER: TelegramUser = {
  id: 1932946217,
  first_name: "Test",
  last_name: "User",
  username: "test_user"
};

export function useTelegramAuth() {
  const [state, setState] = useState<AuthState>({
    initData: '',
    user: null,
    isAuthenticating: true,
    authError: null,
    token: null,
  });

  const authenticate = useCallback(async (initData: string) => {
    try {
      const response = await fetch(
        (import.meta.env.VITE_API_BASE || '/api') + '/auth',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ init_data: initData }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Auth failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Store JWT and user in localStorage
      localStorage.setItem(JWT_STORAGE_KEY, data.token);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(data.user));

      setState({
        initData,
        user: data.user,
        isAuthenticating: false,
        authError: null,
        token: data.token,
      });

      console.log('✅ Telegram auth successful:', data.user);
      return data;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Authentication failed';
      console.error('❌ Telegram auth failed:', errorMessage);
      
      setState(prev => ({
        ...prev,
        isAuthenticating: false,
        authError: errorMessage,
      }));
      
      throw error;
    }
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      // Check for existing JWT token first
      const storedToken = localStorage.getItem(JWT_STORAGE_KEY);
      const storedUser = localStorage.getItem(USER_STORAGE_KEY);
      
      if (storedToken && storedUser) {
        try {
          const user = JSON.parse(storedUser) as TelegramUser;
          setState({
            initData: '',
            user,
            isAuthenticating: false,
            authError: null,
            token: storedToken,
          });
          console.log('✅ Restored auth from localStorage:', user);
          return;
        } catch {
          // Invalid stored data, clear and re-authenticate
          localStorage.removeItem(JWT_STORAGE_KEY);
          localStorage.removeItem(USER_STORAGE_KEY);
        }
      }

      // Check for Telegram WebApp context
      const tg = window.Telegram?.WebApp;
      
      if (tg?.initData) {
        // Real Telegram WebApp - use initData for authentication
        console.log('📱 Telegram WebApp detected, authenticating...');
        tg.ready();
        tg.expand();
        
        try {
          await authenticate(tg.initData);
        } catch {
          // Auth failed, error already set in state
        }
      } else if (DEV_MODE) {
        // Dev mode without Telegram - use bypass
        console.log('🔧 Dev mode: Using mock user (no Telegram context)');
        
        // Check if DevToolbar set a custom user
        const devUserStr = localStorage.getItem('dev_telegram_user');
        const devUser = devUserStr ? JSON.parse(devUserStr) : DEV_USER;
        
        try {
          const devInitData = `dev_mode_bypass:${JSON.stringify(devUser)}`;
          await authenticate(devInitData);
        } catch {
          // Fallback to mock user without server auth
          setState({
            initData: '',
            user: devUser,
            isAuthenticating: false,
            authError: null,
            token: null,
          });
        }
      } else {
        // Production without Telegram context - error
        setState({
          initData: '',
          user: null,
          isAuthenticating: false,
          authError: 'Please open this app from Telegram',
          token: null,
        });
      }
    };

    initAuth();
  }, [authenticate]);

  // Function to clear auth (logout)
  const clearAuth = useCallback(() => {
    localStorage.removeItem(JWT_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    setState({
      initData: '',
      user: null,
      isAuthenticating: false,
      authError: null,
      token: null,
    });
  }, []);

  // Function to re-authenticate (e.g., on 401 error)
  const refreshAuth = useCallback(async () => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData) {
      setState(prev => ({ ...prev, isAuthenticating: true }));
      try {
        await authenticate(tg.initData);
      } catch {
        clearAuth();
      }
    } else {
      clearAuth();
    }
  }, [authenticate, clearAuth]);

  return {
    initData: state.initData,
    user: state.user,
    isAuthenticating: state.isAuthenticating,
    authError: state.authError,
    token: state.token,
    clearAuth,
    refreshAuth,
  };
}
