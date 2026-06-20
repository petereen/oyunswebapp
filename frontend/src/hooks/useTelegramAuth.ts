import { useState, useEffect, useCallback, useRef } from 'react';
import {
  authenticateWithTelegramBrowserCode,
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
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
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
const LAST_ACTIVE_AT_STORAGE_KEY = 'oyuns_last_active_at_v1';
const MAX_INACTIVITY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000; // write at most once per minute
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
  if (message === 'access_denied') {
    return 'Telegram login was cancelled';
  }
  if (message === 'popup_closed') {
    return `Telegram login popup was closed. If it closes immediately every time, check BotFather > Web Login Allowed URLs includes: ${window.location.origin}${window.location.pathname}`;
  }
  if (message === 'popup_blocked') {
    return 'Allow popups and try Telegram login again';
  }
  if (message === 'telegram_login_timeout') {
    return `Telegram login did not return to the app. If the popup shows \"redirect_uri required\", add this exact URL in BotFather > Web Login Allowed URLs: ${window.location.origin}${window.location.pathname}`;
  }
  if (message.toLowerCase().includes('redirect_uri required')) {
    return `Telegram Login is not configured for this URL. In BotFather > Bot Settings > Web Login, add exact Allowed URL: ${window.location.origin}${window.location.pathname}`;
  }
  return message;
}

function getTelegramLoginRedirectUri(): string {
  if (TELEGRAM_LOGIN_REDIRECT_URI) {
    return TELEGRAM_LOGIN_REDIRECT_URI;
  }
  return new URL(import.meta.env.BASE_URL || '/', window.location.origin).toString();
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function sha256Base64Url(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toBase64Url(new Uint8Array(digest));
}

async function createPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string }> {
  const codeVerifier = randomBase64Url(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  return { codeVerifier, codeChallenge };
}

function buildTelegramLoginUrl(
  challenge: TelegramBrowserAuthChallenge,
  codeChallenge: string,
  state: string,
): { url: string; redirectUri: string } {
  const redirectUri = getTelegramLoginRedirectUri();
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: challenge.client_id,
    redirect_uri: redirectUri,
    scope: 'openid profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  params.set('nonce', challenge.nonce);

  const lang = getStoredLang();
  if (lang) {
    params.set('lang', lang);
  }

  return {
    url: `${TELEGRAM_LOGIN_URL}?${params.toString()}`,
    redirectUri,
  };
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
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error('telegram_login_timeout'));
    }, 30000);

    auth(
      {
        client_id: clientId,
        nonce: challenge.nonce,
        ...(lang ? { lang } : {}),
      },
      (result) => {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(timeoutId);

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
  return new Promise(async (resolve, reject) => {
    const { codeVerifier, codeChallenge } = await createPkcePair();
    const state = randomBase64Url(24);
    const { url, redirectUri } = buildTelegramLoginUrl(challenge, codeChallenge, state);

    let popup: Window | null = null;
    let settled = false;
    let closeCheck: number | null = null;

    const cleanup = () => {
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

      if (!result?.code || !result.code_verifier || !result.redirect_uri) {
        reject(new Error('Telegram login did not return an authorization code'));
        return;
      }

      resolve(result);
    };

    popup = window.open(
      url,
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
      if (!popup) {
        return;
      }
      if (popup.closed) {
        finish(undefined, new Error('popup_closed'));
        return;
      }

      try {
        const popupUrl = new URL(popup.location.href);
        if (popupUrl.origin !== window.location.origin) {
          return;
        }

        const error = popupUrl.searchParams.get('error');
        if (error) {
          const errorDescription = popupUrl.searchParams.get('error_description');
          finish(undefined, new Error(errorDescription || error));
          return;
        }

        const authCode = popupUrl.searchParams.get('code');
        const returnedState = popupUrl.searchParams.get('state');
        if (!authCode) {
          return;
        }
        if (returnedState && returnedState !== state) {
          finish(undefined, new Error('Telegram login state mismatch'));
          return;
        }

        finish({
          code: authCode,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        });
      } catch {
        // Expected while popup is still on Telegram origin.
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
  const lastActivityWriteRef = useRef(0);
  const [state, setState] = useState<AuthState>({
    ...createSignedOutState(),
    isAuthenticating: true,
  });

  const touchActivity = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastActivityWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) {
      return;
    }
    lastActivityWriteRef.current = now;
    localStorage.setItem(LAST_ACTIVE_AT_STORAGE_KEY, String(now));
  }, []);

  const clearStoredAuth = useCallback(() => {
    localStorage.removeItem(JWT_STORAGE_KEY);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(INIT_DATA_STORAGE_KEY);
    localStorage.removeItem(LAST_ACTIVE_AT_STORAGE_KEY);
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
    touchActivity(true);
  }, [touchActivity]);

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

      const preferManualFlow = Boolean(TELEGRAM_LOGIN_REDIRECT_URI);

      if (preferManualFlow) {
        try {
          loginResult = await openTelegramLoginPopup(challenge);
        } catch (manualError) {
          const manualMessage = manualError instanceof Error ? manualError.message : '';
          if (manualMessage === 'popup_blocked') {
            console.warn('Manual Telegram popup blocked; trying SDK flow:', manualError);
            loginResult = await openTelegramLoginWithSdk(challenge);
          } else {
            throw manualError;
          }
        }
      } else {
        try {
          loginResult = await openTelegramLoginWithSdk(challenge);
        } catch (sdkError) {
          const sdkErrorMessage = sdkError instanceof Error ? sdkError.message : '';
          const canFallback =
            sdkErrorMessage.includes('SDK is unavailable') ||
            sdkErrorMessage.includes('Failed to load Telegram Login SDK') ||
            sdkErrorMessage === 'popup_blocked';

          if (!canFallback) {
            throw sdkError;
          }

          console.warn('Telegram Login SDK unavailable/blocked, falling back to manual popup OAuth URL:', sdkError);
          loginResult = await openTelegramLoginPopup(challenge);
        }
      }

      let authData: AuthSession;
      if (loginResult.id_token) {
        authData = await authenticateWithTelegramBrowserIdToken(loginResult.id_token);
      } else if (loginResult.code && loginResult.code_verifier && loginResult.redirect_uri) {
        authData = await authenticateWithTelegramBrowserCode({
          code: loginResult.code,
          code_verifier: loginResult.code_verifier,
          redirect_uri: loginResult.redirect_uri,
        });
      } else {
        throw new Error('Telegram login returned neither id_token nor authorization code');
      }

      applyAuthenticatedState(authData);
      console.log('✅ Telegram browser login successful:', authData.user);
      return authData;
    } catch (error) {
      const errorMessage = normalizeBrowserLoginError(error);
      console.error('❌ Telegram browser login failed:', errorMessage);
      requireBrowserLogin(errorMessage);
      return null;
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
        const lastActiveRaw = localStorage.getItem(LAST_ACTIVE_AT_STORAGE_KEY);
        const lastActiveAt = lastActiveRaw ? Number(lastActiveRaw) : Date.now();
        if (!Number.isFinite(lastActiveAt) || Date.now() - lastActiveAt > MAX_INACTIVITY_MS) {
          console.log('⏰ Stored auth expired due to inactivity; forcing browser login');
          clearStoredAuth();
          setState(createSignedOutState({
            needsBrowserLogin: true,
            authError: 'Session expired after inactivity. Sign in again.',
          }));
          return;
        }

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
            touchActivity(true);
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
  }, [authenticate, clearStoredAuth, touchActivity]);

  // Function to clear auth (logout)
  const clearAuth = useCallback(() => {
    clearStoredAuth();
    const isInsideTelegram = Boolean(window.Telegram?.WebApp);
    setState(createSignedOutState({
      needsBrowserLogin: !isInsideTelegram,
    }));
  }, [clearStoredAuth]);

  useEffect(() => {
    if (!state.token) {
      return;
    }

    const onActivity = () => touchActivity();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        touchActivity();
      }
    };

    window.addEventListener('click', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('touchstart', onActivity);
    window.addEventListener('mousemove', onActivity);
    document.addEventListener('visibilitychange', onVisibility);

    touchActivity(true);

    return () => {
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      window.removeEventListener('mousemove', onActivity);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state.token, touchActivity]);

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
