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
        platform?: string;
        version?: string;
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

const JWT_STORAGE_KEY = 'oyuns_jwt_v2';
const USER_STORAGE_KEY = 'oyuns_user_v2';
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
      console.log('🔐 Authenticating with initData length:', initData.length);
      console.log('🔐 initData preview:', initData.substring(0, 100) + '...');
      
      // First, call debug endpoint to see validation details
      try {
        const debugRes = await fetch(
          (import.meta.env.VITE_API_BASE || '/api') + '/auth/debug',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ init_data: initData }),
          }
        );
        const debugData = await debugRes.json();
        console.log('🔍 Auth Debug Info:', debugData);
      } catch (e) {
        console.warn('Debug endpoint failed:', e);
      }
      
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
      const tg = window.Telegram?.WebApp;
      
      // Debug logging
      console.log('=== Telegram Auth Debug ===');
      console.log('DEV_MODE:', DEV_MODE);
      console.log('VITE_DEV_MODE env:', import.meta.env.VITE_DEV_MODE);
      console.log('Telegram object exists:', !!window.Telegram);
      console.log('WebApp object exists:', !!tg);
      console.log('initData:', tg?.initData ? `${tg.initData.substring(0, 50)}... (${tg.initData.length} chars)` : 'EMPTY');
      console.log('initDataUnsafe.user:', tg?.initDataUnsafe?.user);
      console.log('Platform:', tg?.platform);
      console.log('Version:', tg?.version);
      console.log('===========================');

      // Always signal ready + expand immediately so Telegram dismisses its loading overlay,
      // regardless of whether initData is populated (e.g. opened via menu/keyboard button).
      if (tg) {
        tg.ready();
        tg.expand();
      }

      // PRIORITY 1: Real Telegram WebApp context (always use if available)
      if (tg?.initData && tg.initData.length > 0) {
        console.log('📱 Real Telegram WebApp detected! Using initData for authentication...');
        // tg.ready() / tg.expand() already called above
        // Clear any old dev mode tokens to force fresh auth with real user
        localStorage.removeItem(JWT_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        
        try {
          await authenticate(tg.initData);
          return;
        } catch {
          // Auth failed, error already set in state
          return;
        }
      }

      // PRIORITY 2: Check for existing valid JWT token (only if no Telegram context)
      const storedToken = localStorage.getItem(JWT_STORAGE_KEY);
      const storedUser = localStorage.getItem(USER_STORAGE_KEY);
      
      if (storedToken && storedUser) {
        try {
          const user = JSON.parse(storedUser) as TelegramUser;
          // Don't use cached dev user (id 1932946217) in production
          if (!DEV_MODE && user.id === DEV_USER.id) {
            console.log('🚫 Clearing cached dev user in production mode');
            localStorage.removeItem(JWT_STORAGE_KEY);
            localStorage.removeItem(USER_STORAGE_KEY);
          } else {
            setState({
              initData: '',
              user,
              isAuthenticating: false,
              authError: null,
              token: storedToken,
            });
            console.log('✅ Restored auth from localStorage:', user);
            return;
          }
        } catch {
          // Invalid stored data, clear and re-authenticate
          localStorage.removeItem(JWT_STORAGE_KEY);
          localStorage.removeItem(USER_STORAGE_KEY);
        }
      }

      // PRIORITY 3: Dev mode fallback (only in dev mode, no Telegram context)
      if (DEV_MODE) {
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
        return;
      }

      // PRIORITY 4: Production without Telegram context - show error
      console.error('❌ No Telegram context and not in dev mode');
      setState({
        initData: '',
        user: null,
        isAuthenticating: false,
        authError: 'Telegram-ээс нээнэ үү / Please open from Telegram',
        token: null,
      });
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
