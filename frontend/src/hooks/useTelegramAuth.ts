import { useState, useEffect, useCallback } from 'react';
import {
  authenticateWithTelegramBrowserIdToken,
  authenticateWithTelegramInitData,
  fetchTelegramBrowserAuthChallenge,
  type AuthSession,
  type TelegramBrowserAuthChallenge,
} from '../api';

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
  needsBrowserLogin: boolean;
}

interface TelegramLoginCallbackData {
  id_token?: string;
  error?: string;
}

interface TelegramLoginPopupMessage {
  event?: string;
  result?: string;
  error?: string;
}

interface TelegramLoginSdkResult {
  id_token?: string;
  error?: string;
}

interface TelegramLoginSdkAuthOptions {
  client_id: number;
  nonce?: string;
  lang?: string;
}

// Extend Window interface for Telegram WebApp
declare global {
  interface Window {
    Telegram?: {
      Login?: {
        auth: (
          options: TelegramLoginSdkAuthOptions,
          callback: (result: TelegramLoginSdkResult) => void,
        ) => void;
      };
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
const INIT_DATA_STORAGE_KEY = 'oyuns_init_data_v2'; // cached for menu-button / refresh reopens
const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true';
const LANG_STORAGE_KEY = 'oyuns_lang';
const TELEGRAM_LOGIN_ORIGIN = 'https://oauth.telegram.org';
const TELEGRAM_LOGIN_URL = `${TELEGRAM_LOGIN_ORIGIN}/auth`;
const TELEGRAM_LOGIN_REDIRECT_URI = import.meta.env.VITE_TELEGRAM_LOGIN_REDIRECT_URI?.trim();
const TELEGRAM_LOGIN_SDK_URL = 'https://oauth.telegram.org/js/telegram-login.js?25';

let telegramLoginSdkPromise: Promise<void> | null = null;

// When telegram-web-app.js fails to load (ERR_CONNECTION_CLOSED), the SDK never parses
// the URL hash. Extract initData from the hash directly as a fallback.
function getInitDataFromHash(): string {
  try {
    const hash = window.location.hash.slice(1); // strip leading #
    const params = new URLSearchParams(hash);
    const raw = params.get('tgWebAppData');
    return raw ? decodeURIComponent(raw) : '';
  } catch {
    return '';
  }
}

function getStoredLang(): 'mn' | 'ru' | undefined {
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (stored === 'mn' || stored === 'ru') {
    return stored;
  }
  return undefined;
}

function createSignedOutState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    initData: '',
    user: null,
    isAuthenticating: false,
    authError: null,
    token: null,
    needsBrowserLogin: false,
    ...overrides,
  };
}

function normalizeBrowserLoginError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Telegram browser login failed';
  if (message === 'access_denied' || message === 'popup_closed') {
    return 'Telegram login was cancelled';
  }
  if (message === 'popup_blocked') {
    return 'Allow popups and try Telegram login again';
  }
  return message;
}

function getTelegramLoginRedirectUri(): string {
  if (TELEGRAM_LOGIN_REDIRECT_URI) {
    return TELEGRAM_LOGIN_REDIRECT_URI;
  }
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
}

function buildTelegramLoginUrl(challenge: TelegramBrowserAuthChallenge): string {
  const params = new URLSearchParams({
    response_type: 'post_message',
    client_id: challenge.client_id,
    redirect_uri: getTelegramLoginRedirectUri(),
    scope: 'openid profile',
  });
  params.set('nonce', challenge.nonce);

  const lang = getStoredLang();
  if (lang) {
    params.set('lang', lang);
  }

  return `${TELEGRAM_LOGIN_URL}?${params.toString()}`;
}

function parseTelegramLoginMessage(data: unknown): TelegramLoginCallbackData | null {
  let parsed = data;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed) as TelegramLoginPopupMessage;
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const message = parsed as TelegramLoginPopupMessage;
  if (message.event !== 'auth_result') {
    return null;
  }
  if (message.error) {
    return { error: message.error };
  }
  if (!message.result || typeof message.result !== 'string') {
    return { error: 'missing id_token' };
  }

  return { id_token: message.result };
}

function getTelegramLoginPopupFeatures(): string {
  const width = 550;
  const height = 650;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));

  return [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'status=0',
    'location=0',
    'menubar=0',
    'toolbar=0',
  ].join(',');
}

function loadTelegramLoginSdk(): Promise<void> {
  if (window.Telegram?.Login?.auth) {
    return Promise.resolve();
  }

  if (telegramLoginSdkPromise) {
    return telegramLoginSdkPromise;
  }

  telegramLoginSdkPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-telegram-login-sdk="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Telegram Login SDK')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = TELEGRAM_LOGIN_SDK_URL;
    script.async = true;
    script.defer = true;
    script.dataset.telegramLoginSdk = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Telegram Login SDK'));
    document.head.appendChild(script);
  });

  return telegramLoginSdkPromise;
}

async function openTelegramLoginWithSdk(challenge: TelegramBrowserAuthChallenge): Promise<TelegramLoginCallbackData> {
  await loadTelegramLoginSdk();

  const auth = window.Telegram?.Login?.auth;
  if (!auth) {
    throw new Error('Telegram Login SDK is unavailable');
  }

  const clientId = Number(challenge.client_id);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    throw new Error('Invalid Telegram client_id');
  }

  const lang = getStoredLang();

  return new Promise((resolve, reject) => {
    auth(
      {
        client_id: clientId,
        nonce: challenge.nonce,
        ...(lang ? { lang } : {}),
      },
      (result) => {
        if (result?.error) {
          reject(new Error(result.error));
          return;
        }
        if (!result?.id_token) {
          reject(new Error('Telegram login did not return an id_token'));
          return;
        }
        resolve({ id_token: result.id_token });
      },
    );
  });
}

function openTelegramLoginPopup(challenge: TelegramBrowserAuthChallenge): Promise<TelegramLoginCallbackData> {
  return new Promise((resolve, reject) => {
    let popup: Window | null = null;
    let settled = false;
    let closeCheck: number | null = null;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      if (closeCheck !== null) {
        window.clearInterval(closeCheck);
      }
    };

    const finish = (result?: TelegramLoginCallbackData, error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();

      if (popup && !popup.closed) {
        popup.close();
      }

      if (error) {
        reject(error);
        return;
      }

      if (!result?.id_token) {
        reject(new Error('Telegram login did not return an id_token'));
        return;
      }

      resolve(result);
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== TELEGRAM_LOGIN_ORIGIN) {
        return;
      }
      if (popup && event.source !== popup) {
        return;
      }

      const result = parseTelegramLoginMessage(event.data);
      if (!result) {
        return;
      }
      if (result.error) {
        finish(undefined, new Error(result.error));
        return;
      }

      finish(result);
    };

    window.addEventListener('message', handleMessage);

    popup = window.open(
      buildTelegramLoginUrl(challenge),
      'telegram_oidc_login',
      getTelegramLoginPopupFeatures(),
    );

    if (!popup) {
      cleanup();
      reject(new Error('popup_blocked'));
      return;
    }

    popup.focus();
    closeCheck = window.setInterval(() => {
      if (popup?.closed) {
        finish(undefined, new Error('popup_closed'));
      }
    }, 200);
  });
}

// Default dev user for local testing without Telegram
const DEV_USER: TelegramUser = {
  id: 1932946217,
  first_name: "Test",
  last_name: "User",
  username: "test_user"
};

export function useTelegramAuth() {
  const [state, setState] = useState<AuthState>({
    ...createSignedOutState(),
    isAuthenticating: true,
  });

  const clearStoredAuth = useCallback(() => {
    localStorage.removeItem(JWT_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(INIT_DATA_STORAGE_KEY);
  }, []);

  const applyAuthenticatedState = useCallback((authData: AuthSession, initData = '') => {
    localStorage.setItem(JWT_STORAGE_KEY, authData.token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(authData.user));
    if (initData && !initData.startsWith('dev_mode_bypass')) {
      localStorage.setItem(INIT_DATA_STORAGE_KEY, initData);
    }

    setState(createSignedOutState({
      initData,
      user: authData.user,
      token: authData.token,
    }));
  }, []);

  const requireBrowserLogin = useCallback((authError: string | null = null) => {
    clearStoredAuth();
    setState(createSignedOutState({
      authError,
      needsBrowserLogin: true,
    }));
  }, [clearStoredAuth]);

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

      const data = await authenticateWithTelegramInitData(initData);
      applyAuthenticatedState(data, initData);

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
  }, [applyAuthenticatedState]);

  const startBrowserLogin = useCallback(async () => {
    setState(prev => ({
      ...prev,
      isAuthenticating: true,
      authError: null,
      needsBrowserLogin: true,
    }));

    try {
      const challenge = await fetchTelegramBrowserAuthChallenge();
      let loginResult: TelegramLoginCallbackData;

      try {
        loginResult = await openTelegramLoginWithSdk(challenge);
      } catch (sdkError) {
        console.warn('Telegram Login SDK flow failed, falling back to popup OAuth URL:', sdkError);
        loginResult = await openTelegramLoginPopup(challenge);
      }

      const authData = await authenticateWithTelegramBrowserIdToken(loginResult.id_token || '');

      applyAuthenticatedState(authData);
      console.log('✅ Telegram browser login successful:', authData.user);
      return authData;
    } catch (error) {
      const errorMessage = normalizeBrowserLoginError(error);
      console.error('❌ Telegram browser login failed:', errorMessage);
      requireBrowserLogin(errorMessage);
      throw error;
    }
  }, [applyAuthenticatedState, requireBrowserLogin]);

  useEffect(() => {
    const initAuth = async () => {
      const tg = window.Telegram?.WebApp;
      // Fallback: when telegram-web-app.js fails to load (CDN blocked/closed),
      // the SDK never parses the URL hash → read tgWebAppData from hash directly.
      const hashInitData = getInitDataFromHash();
      // Use SDK initData if available, otherwise fall back to URL hash
      const liveInitData = (tg?.initData && tg.initData.length > 0) ? tg.initData : hashInitData;
      
      // Debug logging
      console.log('=== Telegram Auth Debug ===');
      console.log('DEV_MODE:', DEV_MODE);
      console.log('VITE_DEV_MODE env:', import.meta.env.VITE_DEV_MODE);
      console.log('Telegram object exists:', !!window.Telegram);
      console.log('WebApp object exists:', !!tg);
      console.log('initData (SDK):', tg?.initData ? `${tg.initData.substring(0, 50)}... (${tg.initData.length} chars)` : 'EMPTY');
      console.log('initData (hash):', hashInitData ? `present (${hashInitData.length} chars)` : 'absent');
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

      // PRIORITY 1: Live initData from SDK or URL hash (we are inside Telegram Mini App)
      if (liveInitData) {
        console.log('📱 Real Telegram WebApp detected! Using initData for authentication...');
        // Clear any old dev mode tokens to force fresh auth with real user
        localStorage.removeItem(JWT_STORAGE_KEY);
        localStorage.removeItem(USER_STORAGE_KEY);
        // Don't remove INIT_DATA_STORAGE_KEY here — we're about to overwrite it on success
        
        try {
          await authenticate(liveInitData);
          return;
        } catch {
          // Auth failed, error already set in state
          return;
        }
      }

      // PRIORITY 2: Telegram context exists but initData is EMPTY (menu button / page refresh on mobile).
      // Replay the cached initData from the last successful real auth.
      if (tg && (!tg.initData || tg.initData.length === 0)) {
        const cachedInitData = localStorage.getItem(INIT_DATA_STORAGE_KEY);
        if (cachedInitData) {
          console.log('📲 Menu button / refresh detected (empty initData). Replaying cached initData...');
          try {
            await authenticate(cachedInitData);
            return;
          } catch {
            // Cached initData expired or invalid — clear it and fall through
            console.warn('⚠️ Cached initData auth failed, clearing cache');
            localStorage.removeItem(INIT_DATA_STORAGE_KEY);
            localStorage.removeItem(JWT_STORAGE_KEY);
            localStorage.removeItem(USER_STORAGE_KEY);
          }
        }
      }

      // PRIORITY 3: Check for existing valid JWT token (no live Telegram initData available)
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
              ...createSignedOutState({
                user,
                token: storedToken,
              }),
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

      // PRIORITY 4: Dev mode fallback (only in dev mode, no Telegram context)
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
            ...createSignedOutState({ user: devUser }),
          });
        }
        return;
      }

      // PRIORITY 5: Production without Telegram context - show Telegram browser login
      console.log('🌐 No Telegram initData available. Waiting for browser login...');
      setState(createSignedOutState({ needsBrowserLogin: true }));
    };

    initAuth();
  }, [authenticate]);

  // Function to clear auth (logout)
  const clearAuth = useCallback(() => {
    clearStoredAuth();
    setState(createSignedOutState());
  }, [clearStoredAuth]);

  // Function to re-authenticate (e.g., on 401 error)
  const refreshAuth = useCallback(async () => {
    const tg = window.Telegram?.WebApp;
    if (tg?.initData && tg.initData.length > 0) {
      setState(prev => ({ ...prev, isAuthenticating: true }));
      try {
        await authenticate(tg.initData);
      } catch {
        clearAuth();
      }
    } else if (!DEV_MODE) {
      requireBrowserLogin('Session expired. Sign in with Telegram again.');
    } else {
      clearAuth();
    }
  }, [authenticate, clearAuth, requireBrowserLogin]);

  return {
    initData: state.initData,
    user: state.user,
    isAuthenticating: state.isAuthenticating,
    authError: state.authError,
    token: state.token,
    needsBrowserLogin: state.needsBrowserLogin,
    clearAuth,
    refreshAuth,
    startBrowserLogin,
  };
}
