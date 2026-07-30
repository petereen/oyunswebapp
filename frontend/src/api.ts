import axios from "axios";
import { toSafeNumber } from "./utils/exchangePricing";

// Use relative '/api' by default for production behind Nginx.
// Override with VITE_API_BASE (e.g., http://localhost:8000/api) for local dev.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
});

const JWT_STORAGE_KEY = 'oyuns_jwt_v2';
const FUEL_ADMIN_KEY_STORAGE = 'fuel_admin_key';
const OYUNS_SAGS_ADMIN_KEY_STORAGE = 'oyuns_sags_admin_key';
export const DASHBOARD_KEY_STORAGE = 'oyuns_dashboard_key';

export type AuthenticatedUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
};

export type AuthSession = {
  token: string;
  user: AuthenticatedUser;
};

export type TelegramBrowserAuthChallenge = {
  client_id: string;
  nonce: string;
  expires_in: number;
};

async function parseFetchError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string" && data.detail.trim()) {
      return data.detail;
    }
  } catch {
    // Ignore JSON parse failures and fall back to the status text.
  }

  return response.statusText || `Request failed: ${response.status}`;
}

export async function authenticateWithTelegramInitData(initData: string): Promise<AuthSession> {
  const response = await fetch(
    (import.meta.env.VITE_API_BASE || '/api') + '/auth',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ init_data: initData }),
    }
  );

  if (!response.ok) {
    throw new Error(await parseFetchError(response));
  }

  return response.json();
}

export async function fetchTelegramBrowserAuthChallenge(): Promise<TelegramBrowserAuthChallenge> {
  const response = await fetch(
    (import.meta.env.VITE_API_BASE || '/api') + '/auth/browser/challenge',
    {
      method: 'GET',
      credentials: 'same-origin',
    }
  );

  if (!response.ok) {
    throw new Error(await parseFetchError(response));
  }

  return response.json();
}

export async function authenticateWithTelegramBrowserIdToken(idToken: string): Promise<AuthSession> {
  const response = await fetch(
    (import.meta.env.VITE_API_BASE || '/api') + '/auth/browser',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ id_token: idToken }),
    }
  );

  if (!response.ok) {
    throw new Error(await parseFetchError(response));
  }

  return response.json();
}

export async function authenticateWithTelegramBrowserCode(payload: {
  code: string;
  code_verifier: string;
  redirect_uri: string;
}): Promise<AuthSession> {
  const response = await fetch(
    (import.meta.env.VITE_API_BASE || '/api') + '/auth/browser/code',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw new Error(await parseFetchError(response));
  }

  return response.json();
}

// Fuel admin axios instance - sends API key header for browser-based admin access
const fuelAdminApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
});

const oyunsSagsAdminApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
});

const dashboardApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
});

dashboardApi.interceptors.request.use(config => {
  const apiKey = localStorage.getItem(DASHBOARD_KEY_STORAGE);
  if (apiKey) {
    config.headers['X-Dashboard-Key'] = apiKey;
  }
  return config;
});

fuelAdminApi.interceptors.request.use(config => {
  // Try JWT first (if inside Telegram)
  const token = localStorage.getItem(JWT_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // Always send API key header for fuel-admin routes
  const apiKey = localStorage.getItem(FUEL_ADMIN_KEY_STORAGE);
  if (apiKey) {
    config.headers['X-Fuel-Admin-Key'] = apiKey;
  }
  return config;
});

oyunsSagsAdminApi.interceptors.request.use(config => {
  const apiKey = localStorage.getItem(OYUNS_SAGS_ADMIN_KEY_STORAGE);
  if (apiKey) {
    config.headers['X-Oyuns-Sags-Key'] = apiKey;
  }
  return config;
});

// Request interceptor - add JWT token to all requests
api.interceptors.request.use(config => {
  const token = localStorage.getItem(JWT_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  console.log(`📤 API Request: ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

// Response interceptor - handle errors and 401 unauthorized
api.interceptors.response.use(
  response => {
    console.log(`✅ API Response: ${response.status} ${response.config.url}`);
    return response;
  },
  async error => {
    console.error(`❌ API Error: ${error.response?.status || error.message} ${error.config?.url}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    
    // On 401 Unauthorized, try to re-authenticate using Telegram initData
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      console.warn('🔒 401 Unauthorized - attempting to re-authenticate');
      
      // Check if we can re-authenticate via Telegram
      const tg = (window as any).Telegram?.WebApp;
      if (tg?.initData && tg.initData.length > 0) {
        try {
          console.log('🔄 Re-authenticating with Telegram initData...');
          const authData = await authenticateWithTelegramInitData(tg.initData);
          localStorage.setItem(JWT_STORAGE_KEY, authData.token);
          localStorage.setItem('oyuns_user_v2', JSON.stringify(authData.user));
          console.log('✅ Re-authentication successful, retrying original request');

          // Retry the original request with new token
          error.config.headers.Authorization = `Bearer ${authData.token}`;
          return api.request(error.config);
        } catch (authError) {
          console.error('❌ Re-authentication failed:', authError);
        }
      } else {
        // Browser user (no Telegram context) — retry once with the same token
        // in case this is a transient server error or deploy-in-progress
        const storedToken = localStorage.getItem(JWT_STORAGE_KEY);
        if (storedToken) {
          console.warn('🔄 Browser 401 — retrying request once before giving up...');
          try {
            error.config.headers.Authorization = `Bearer ${storedToken}`;
            return api.request(error.config);
          } catch {
            console.warn('⚠️ Retry also failed, dispatching auth:unauthorized');
          }
        }
      }
      
      // Only dispatch unauthorized event — do NOT clear localStorage here.
      // The auth hook (refreshAuth) will handle state transitions properly.
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }
    
    return Promise.reject(error);
  }
);

export type Rate = { buy_rate: number; sell_rate: number; updated_at?: string };

export type ServiceStatus = {
  is_open: boolean;
  is_within_hours: boolean;
  is_shift_active: boolean;
  working_hours: string;
  message: string | null;
};

export type UserProfile = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  email?: string;
  phone?: string;
  phone_mnt?: string;
  phone_intl?: string;
  bank_rub?: string;
  bank_mnt?: string;
  verified?: boolean;
  ready_for_verification?: boolean;
  agreed_terms?: boolean;
  email_verification_pending?: boolean;
  email_verified_at?: string;
  email_auth_user_id?: string;
  passport_storage_url?: string;
  verification_level?: number; // 0=new, 1=basic (unverified), 2=fully verified
  referral_code?: string;
  referred_by_user_id?: number;
  referred_by_code?: string;
};

export type AdminBankAccount = {
  id: number | string;  // Backend returns string, but we need to convert to number for some APIs
  bank_name: string;
  account_number: string;
  card_number?: string;
  phone?: string;
  owner_name: string;
  currency: "RUB" | "MNT";
  is_active: boolean;
  is_priority?: boolean;
  logo_url?: string;
};

export type RegistrationInput = {
  rub_bank_name: string;
  rub_phone_sbp: string;
  rub_card_number: string;
  rub_owner_name: string;
  mnt_bank_name: string;
  mnt_account_number: string;
  mnt_owner_name: string;
  mnt_phone: string;
  passport_storage_url: string;
};

export type BasicRegistrationInput = {
  last_name: string;
  first_name: string;
  phone_intl: string;  // Full international phone e.g. "+97699112233"
  email: string;
  referral_code?: string;
};

export type BasicRegistrationResponse = {
  ok: boolean;
  message: string;
  verification_level: number;
  email_verification_pending: boolean;
  email: string;
};

export type EmailVerificationStartResponse = {
  ok: boolean;
  email: string;
  email_verification_pending: boolean;
};

export type EmailVerificationCompleteInput = {
  access_token: string;
};

export type EmailVerificationCompleteResponse = {
  ok: boolean;
  message: string;
  verification_level: number;
  email_verified_at: string;
};

export type KycItem = {
  user_id: number;
  first_name?: string;
  last_name?: string;
  phone?: string;
  bank_rub?: string;
  bank_mnt?: string;
  passport_storage_url?: string;
  ready_for_verification: boolean;
  verified: boolean;
  updated_at?: string;
};

export type ExchangeCreateInput = {
  direction: "buy" | "sell";
  amount: number;
  currency_from: string;
  currency_to: string;
  rate: number;
  bank_details: string;
  promo_code?: string;
  receipt_path?: string;
  receipt_paths?: string[]; // Multiple receipt images
  invoice?: string;
  admin_bank_id?: string;
};

export type PhoneTopupCreateInput = {
  rub_amount: number;
  sell_rate: number;
  phone: string;
  telecom: string;
  receipt_path?: string;
  receipt_paths?: string[];
  invoice?: string;
  admin_bank_id?: string;
};

export type ExchangeCreateResponse = {
  id: string;
  invoice: string;
  status: string;
  bill_url?: string;
  created_at: string;
};

export type PresignRequest = {
  bucket: string;
  path: string;
};

// NO AUTH MODE - All API calls work without authentication

export type AppSettings = {
  min_rub_amount: number;
  min_rub_buy: number;
  oyuns_plus_enabled: number;
  oyuns_plus_threshold_rub: number;
  oyuns_plus_points_per_threshold: number;
  oyuns_plus_referral_reward_points: number;
  oyuns_plus_referral_max_uses: number;
  home_banner_enabled: number;
  home_banner_image_url: string;
  home_banner_link_url: string;
  email_verification_enabled: number;
};

export const DEFAULT_MIN_RUB_AMOUNT = 2000;
export const DEFAULT_MIN_RUB_BUY = 2000;
export const DEFAULT_OYUNS_PLUS_ENABLED = 1;
export const DEFAULT_OYUNS_PLUS_THRESHOLD_RUB = 10000;
export const DEFAULT_OYUNS_PLUS_POINTS_PER_THRESHOLD = 10;
export const DEFAULT_OYUNS_PLUS_REFERRAL_REWARD_POINTS = 50;
export const DEFAULT_OYUNS_PLUS_REFERRAL_MAX_USES = 5;
export const DEFAULT_HOME_BANNER_ENABLED = 0;
export const DEFAULT_HOME_BANNER_IMAGE_URL = '';
export const DEFAULT_HOME_BANNER_LINK_URL = '';
export const DEFAULT_EMAIL_VERIFICATION_ENABLED = 1;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  min_rub_amount: DEFAULT_MIN_RUB_AMOUNT,
  min_rub_buy: DEFAULT_MIN_RUB_BUY,
  oyuns_plus_enabled: DEFAULT_OYUNS_PLUS_ENABLED,
  oyuns_plus_threshold_rub: DEFAULT_OYUNS_PLUS_THRESHOLD_RUB,
  oyuns_plus_points_per_threshold: DEFAULT_OYUNS_PLUS_POINTS_PER_THRESHOLD,
  oyuns_plus_referral_reward_points: DEFAULT_OYUNS_PLUS_REFERRAL_REWARD_POINTS,
  oyuns_plus_referral_max_uses: DEFAULT_OYUNS_PLUS_REFERRAL_MAX_USES,
  home_banner_enabled: DEFAULT_HOME_BANNER_ENABLED,
  home_banner_image_url: DEFAULT_HOME_BANNER_IMAGE_URL,
  home_banner_link_url: DEFAULT_HOME_BANNER_LINK_URL,
  email_verification_enabled: DEFAULT_EMAIL_VERIFICATION_ENABLED,
};

export function normalizeAppSettings(settings?: Partial<AppSettings> | null): AppSettings {
  return {
    min_rub_amount: Math.max(0, toSafeNumber(settings?.min_rub_amount, DEFAULT_MIN_RUB_AMOUNT)),
    min_rub_buy: Math.max(0, toSafeNumber(settings?.min_rub_buy, DEFAULT_MIN_RUB_BUY)),
    oyuns_plus_enabled: toSafeNumber(settings?.oyuns_plus_enabled, DEFAULT_OYUNS_PLUS_ENABLED) > 0 ? 1 : 0,
    oyuns_plus_threshold_rub: Math.max(1, toSafeNumber(settings?.oyuns_plus_threshold_rub, DEFAULT_OYUNS_PLUS_THRESHOLD_RUB)),
    oyuns_plus_points_per_threshold: Math.max(1, toSafeNumber(settings?.oyuns_plus_points_per_threshold, DEFAULT_OYUNS_PLUS_POINTS_PER_THRESHOLD)),
    oyuns_plus_referral_reward_points: Math.max(0, toSafeNumber(settings?.oyuns_plus_referral_reward_points, DEFAULT_OYUNS_PLUS_REFERRAL_REWARD_POINTS)),
    oyuns_plus_referral_max_uses: Math.max(1, toSafeNumber(settings?.oyuns_plus_referral_max_uses, DEFAULT_OYUNS_PLUS_REFERRAL_MAX_USES)),
    home_banner_enabled: toSafeNumber(settings?.home_banner_enabled, DEFAULT_HOME_BANNER_ENABLED) > 0 ? 1 : 0,
    home_banner_image_url: typeof settings?.home_banner_image_url === 'string' ? settings.home_banner_image_url.trim() : DEFAULT_HOME_BANNER_IMAGE_URL,
    home_banner_link_url: typeof settings?.home_banner_link_url === 'string' ? settings.home_banner_link_url.trim() : DEFAULT_HOME_BANNER_LINK_URL,
    email_verification_enabled: toSafeNumber(settings?.email_verification_enabled, DEFAULT_EMAIL_VERIFICATION_ENABLED) > 0 ? 1 : 0,
  };
}

export async function fetchRates() {
  const res = await api.get<Rate>('/rates');
  return {
    ...res.data,
    buy_rate: toSafeNumber(res.data?.buy_rate, 0),
    sell_rate: toSafeNumber(res.data?.sell_rate, 0),
  } as Rate;
}

export interface RateHistoryPoint {
  date: string;
  buy_rate: number | null;
  sell_rate: number | null;
}

export async function fetchRateHistory(days: number = 30) {
  const res = await api.get<{ points: RateHistoryPoint[]; days: number }>(`/rate-history?days=${days}`);
  return res.data;
}

export async function fetchAppSettings() {
  const res = await api.get<Partial<AppSettings>>('/settings');
  return normalizeAppSettings(res.data);
}

export async function fetchServiceStatus() {
  const res = await api.get<ServiceStatus>('/service-status');
  return res.data;
}

export async function fetchMe() {
  const res = await api.get<{ user: UserProfile; is_admin: boolean }>('/me');
  return res.data;
}

export async function agreeToTerms() {
  const res = await api.post('/agree-terms', {});
  return res.data as { ok: boolean; agreed_terms: boolean };
}

export type UpdateBankInfoInput = {
  phone: string;
  email?: string;
  rub_bank_name: string;
  rub_phone_sbp: string;
  rub_card_number: string;
  rub_owner_name: string;
  mnt_bank_name: string;
  mnt_account_number: string;
  mnt_owner_name: string;
  mnt_phone?: string;
};

export async function updateBankInfo(payload: UpdateBankInfoInput) {
  const res = await api.post('/update-bank-info', payload);
  return res.data as { ok: boolean; message: string };
}

export async function createExchange(payload: ExchangeCreateInput) {
  const res = await api.post('/exchange/create', payload);
  return res.data as ExchangeCreateResponse;
}

export async function createPhoneTopup(payload: PhoneTopupCreateInput) {
  const safeSellRate = toSafeNumber(payload.sell_rate, 0);
  const safeRubAmount = toSafeNumber(payload.rub_amount, 0);
  const payableMnt = Number((safeRubAmount * safeSellRate).toFixed(2));
  return createExchange({
    direction: 'sell',
    amount: payableMnt,
    currency_from: 'MNT',
    currency_to: 'RUB',
    rate: safeSellRate,
    bank_details: `${payload.phone}, ${payload.telecom}`,
    receipt_path: payload.receipt_path,
    receipt_paths: payload.receipt_paths,
    invoice: payload.invoice,
    admin_bank_id: payload.admin_bank_id,
  });
}

export async function requestPresign(payload: PresignRequest) {
  const res = await api.post('/storage/presign', payload);
  return res.data as { upload_url: string; public_url: string; path: string };
}

export async function logUploadIssue(payload: {
  issue_type: string;
  bucket: string;
  path: string;
  user_id?: number | null;
  message: string;
  details?: Record<string, unknown>;
}) {
  const res = await api.post('/storage/upload-issue', payload);
  return res.data as { ok: boolean };
}

export async function requestPresignAdmin(payload: PresignRequest) {
  const res = await fuelAdminApi.post('/fuel-admin/presign', payload);
  return res.data as { upload_url: string; public_url: string; path: string };
}

export async function fetchHistory() {
  const res = await api.get('/history');
  return res.data as { items: any[] };
}

export async function fetchAnalytics() {
  const res = await api.get('/analytics');
  return res.data;
}

export type ActiveTransaction = {
  invoice: string;
  amount: number;
  currency_from: string;
  currency_to: string;
  status: 'pending' | 'approved' | 'completed' | 'successful' | 'rejected' | 'waiting_edit';
  timestamp: string;
  admin_comment?: string;
  can_edit?: boolean;
};

export async function fetchActiveTransactions(): Promise<{ transactions: ActiveTransaction[] }> {
  try {
    const res = await api.get('/active-transactions');
    const payload = res.data as { transactions?: ActiveTransaction[] };
    const transactions = (payload.transactions || []).map((trx) => ({
      ...trx,
      amount: toSafeNumber(trx.amount, 0),
      can_edit: Boolean((trx as any).can_edit),
    }));
    return { transactions };
  } catch {
    return { transactions: [] };
  }
}

export interface ExchangeEditableResponse {
  invoice: string;
  direction: 'buy' | 'sell';
  amount: number;
  currency_from: string;
  currency_to: string;
  rate: number;
  base_rate: number;
  promo_discount: number;
  bank_details: string;
  receipt_urls: string[];
  admin_bank_id?: string;
  can_edit: boolean;
}

export async function fetchEditableExchange(invoice: string): Promise<ExchangeEditableResponse> {
  const params = new URLSearchParams({ invoice });
  const res = await api.get(`/exchange/editable?${params.toString()}`);
  const data = res.data as ExchangeEditableResponse;
  return {
    ...data,
    amount: toSafeNumber(data.amount, 0),
    rate: toSafeNumber(data.rate, 0),
    base_rate: toSafeNumber(data.base_rate, toSafeNumber(data.rate, 0)),
    promo_discount: toSafeNumber(data.promo_discount, 0),
    receipt_urls: Array.isArray(data.receipt_urls) ? data.receipt_urls : [],
    can_edit: Boolean(data.can_edit),
  };
}

export interface ExchangeResubmitInput {
  invoice: string;
  amount: number;
  rate: number;
  bank_details: string;
  receipt_path?: string;
  receipt_paths?: string[];
  admin_bank_id?: string;
}

export async function resubmitExchange(payload: ExchangeResubmitInput) {
  const res = await api.post('/exchange/resubmit', payload);
  return res.data as ExchangeCreateResponse;
}

export async function fetchAdminBankAccounts(): Promise<{ accounts: AdminBankAccount[] }> {
  try {
    const res = await api.get('/admin-banks');
    return res.data as { accounts: AdminBankAccount[] };
  } catch {
    // Return empty if endpoint not available yet
    return { accounts: [] };
  }
}

export async function validatePromoCode(code: string, direction: string) {
  const res = await api.post('/promo/validate', { code, direction });
  return res.data as { valid: boolean; discount_amount?: number; message?: string };
}

export async function submitRegistration(payload: RegistrationInput) {
  const res = await api.post('/register', payload);
  return res.data as { ok: boolean; message: string };
}

export async function submitBasicRegistration(payload: BasicRegistrationInput) {
  const res = await api.post('/register-basic', payload);
  return res.data as BasicRegistrationResponse;
}

export async function startEmailVerification(email: string) {
  const res = await api.post('/email-verification/start', { email });
  return res.data as EmailVerificationStartResponse;
}

export async function completeEmailVerification(payload: EmailVerificationCompleteInput) {
  const res = await api.post('/email-verification/complete', payload);
  return res.data as EmailVerificationCompleteResponse;
}

export interface ReferralCodeValidation {
  valid: boolean;
  message?: string;
  inviter_user_id?: number;
  inviter_name?: string;
  remaining_uses?: number;
}

export async function validateReferralCode(code: string): Promise<ReferralCodeValidation> {
  const res = await api.get(`/referral/validate?code=${encodeURIComponent(code)}`);
  return res.data as ReferralCodeValidation;
}

export interface OyunsPlusSummary {
  enabled: boolean;
  points_balance: number;
  point_value_rub: number;
  threshold_rub: number;
  points_per_threshold: number;
  referral_reward_points: number;
  referral_max_uses: number;
  referral_code?: string;
  referral_uses: number;
  referral_uses_remaining: number;
  invited_total: number;
  invited_verified: number;
}

export async function fetchOyunsPlusSummary(): Promise<OyunsPlusSummary> {
  const res = await api.get('/oyuns-plus/summary');
  return res.data as OyunsPlusSummary;
}

export interface OyunsPlusHistoryEntry {
  id?: number;
  source_type: string;
  source_id?: string;
  points: number;
  rub_equivalent?: number;
  created_at?: string;
}

export interface OyunsPlusHistory {
  entries: OyunsPlusHistoryEntry[];
}

export async function fetchOyunsPlusHistory(): Promise<OyunsPlusHistory> {
  const res = await api.get('/oyuns-plus/history');
  return res.data as OyunsPlusHistory;
}

export const OYUNS_PLUS_LOGO_DEFAULT_URL = 'https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/OYUNS%20Plus.png';

export type TournamentCategory = 'men' | 'women';
export type TournamentVenue = 'a_hall' | 'b_hall';
export type TournamentGameStatus = 'scheduled' | 'live' | 'completed' | 'cancelled';

export interface TournamentTeam {
  id: string;
  name: string;
  short_name?: string;
  category: TournamentCategory;
  logo_url?: string;
  is_active: boolean;
  display_order: number;
  votes_count: number;
}

export interface TournamentGame {
  id: string;
  category: TournamentCategory;
  venue: TournamentVenue;
  home_team_id: string;
  away_team_id: string;
  starts_at: string;
  status: TournamentGameStatus;
  home_score: number;
  away_score: number;
  is_featured: boolean;
  home_team_name?: string;
  away_team_name?: string;
  home_team_logo_url?: string;
  away_team_logo_url?: string;
}

export interface TournamentGroup {
  id: string;
  category: TournamentCategory;
  name: string;
  team_ids: string[];
  display_order: number;
  teams: TournamentTeam[];
}

export interface TournamentKnockoutMatch {
  id: string;
  round_key: string;
  title: string;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_label?: string | null;
  away_label?: string | null;
  home_score: number;
  away_score: number;
  status: TournamentGameStatus;
  home_team_name?: string | null;
  away_team_name?: string | null;
  home_team_logo_url?: string | null;
  away_team_logo_url?: string | null;
}

export interface TournamentKnockoutPhase {
  category: TournamentCategory;
  team_count: 4 | 8;
  matches: TournamentKnockoutMatch[];
}

export interface TournamentGroupInput {
  id?: string;
  category: TournamentCategory;
  name: string;
  team_ids: string[];
  display_order: number;
}

export interface TournamentKnockoutMatchInput {
  id: string;
  round_key: string;
  title: string;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_label?: string | null;
  away_label?: string | null;
  home_score: number;
  away_score: number;
  status: TournamentGameStatus;
}

export interface TournamentKnockoutPhaseInput {
  category: TournamentCategory;
  team_count: 4 | 8;
  matches: TournamentKnockoutMatchInput[];
}

export interface TournamentVoteStatus {
  category: TournamentCategory;
  team_id?: string | null;
  voted: boolean;
}

export interface TournamentOverview {
  enabled: boolean;
  logo_url?: string;
  teams: TournamentTeam[];
  games: TournamentGame[];
  groups: TournamentGroup[];
  knockout: TournamentKnockoutPhase[];
  votes: TournamentVoteStatus[];
}

export interface TournamentVoteResponse {
  ok: boolean;
  message: string;
  vote: TournamentVoteStatus;
}

export async function fetchTournamentOverview(params?: {
  category?: TournamentCategory;
  venue?: TournamentVenue;
  status?: TournamentGameStatus;
}): Promise<TournamentOverview> {
  const qp = new URLSearchParams();
  if (params?.category) qp.set('category', params.category);
  if (params?.venue) qp.set('venue', params.venue);
  if (params?.status) qp.set('status', params.status);
  const query = qp.toString();
  const res = await api.get(`/tournament/overview${query ? `?${query}` : ''}`);
  const data = res.data as TournamentOverview;
  return {
    enabled: Boolean(data.enabled),
    logo_url: data.logo_url || OYUNS_PLUS_LOGO_DEFAULT_URL,
    teams: Array.isArray(data.teams) ? data.teams : [],
    games: Array.isArray(data.games) ? data.games : [],
    groups: Array.isArray(data.groups) ? data.groups : [],
    knockout: Array.isArray(data.knockout) ? data.knockout : [],
    votes: Array.isArray(data.votes) ? data.votes : [],
  };
}

export async function fetchTournamentMyVotes(): Promise<TournamentVoteStatus[]> {
  const res = await api.get('/tournament/my-votes');
  return Array.isArray(res.data) ? (res.data as TournamentVoteStatus[]) : [];
}

export async function submitTournamentVote(payload: { category: TournamentCategory; team_id: string }): Promise<TournamentVoteResponse> {
  const res = await api.post('/tournament/vote', payload);
  return res.data as TournamentVoteResponse;
}

export interface OyunsSagsAdminSettings {
  oyuns_tournament_enabled: number;
  oyuns_plus_logo_url: string;
}

export async function fetchOyunsSagsAdminTeams(params?: { category?: TournamentCategory; include_inactive?: boolean }): Promise<{ items: TournamentTeam[] }> {
  const qp = new URLSearchParams();
  if (params?.category) qp.set('category', params.category);
  if (typeof params?.include_inactive === 'boolean') qp.set('include_inactive', String(params.include_inactive));
  const query = qp.toString();
  const res = await oyunsSagsAdminApi.get(`/oyuns-sags/admin/teams${query ? `?${query}` : ''}`);
  return res.data as { items: TournamentTeam[] };
}

export async function createOyunsSagsAdminTeam(payload: {
  name: string;
  short_name?: string;
  category: TournamentCategory;
  logo_url?: string;
  is_active?: boolean;
  display_order?: number;
}): Promise<TournamentTeam> {
  const res = await oyunsSagsAdminApi.post('/oyuns-sags/admin/teams', payload);
  return res.data as TournamentTeam;
}

export async function updateOyunsSagsAdminTeam(teamId: string, payload: Partial<{
  name: string;
  short_name: string;
  category: TournamentCategory;
  logo_url: string;
  is_active: boolean;
  display_order: number;
}>): Promise<TournamentTeam> {
  const res = await oyunsSagsAdminApi.put(`/oyuns-sags/admin/teams/${teamId}`, payload);
  return res.data as TournamentTeam;
}

export async function deleteOyunsSagsAdminTeam(teamId: string): Promise<{ ok: boolean }> {
  const res = await oyunsSagsAdminApi.delete(`/oyuns-sags/admin/teams/${teamId}`);
  return res.data as { ok: boolean };
}

export async function fetchOyunsSagsAdminGames(params?: {
  category?: TournamentCategory;
  venue?: TournamentVenue;
  status?: TournamentGameStatus;
}): Promise<{ items: TournamentGame[] }> {
  const qp = new URLSearchParams();
  if (params?.category) qp.set('category', params.category);
  if (params?.venue) qp.set('venue', params.venue);
  if (params?.status) qp.set('status', params.status);
  const query = qp.toString();
  const res = await oyunsSagsAdminApi.get(`/oyuns-sags/admin/games${query ? `?${query}` : ''}`);
  return res.data as { items: TournamentGame[] };
}

export async function createOyunsSagsAdminGame(payload: {
  category: TournamentCategory;
  venue: TournamentVenue;
  home_team_id: string;
  away_team_id: string;
  starts_at: string;
  status?: TournamentGameStatus;
  home_score?: number;
  away_score?: number;
  is_featured?: boolean;
}): Promise<TournamentGame> {
  const res = await oyunsSagsAdminApi.post('/oyuns-sags/admin/games', payload);
  return res.data as TournamentGame;
}

export async function updateOyunsSagsAdminGame(gameId: string, payload: Partial<{
  category: TournamentCategory;
  venue: TournamentVenue;
  home_team_id: string;
  away_team_id: string;
  starts_at: string;
  status: TournamentGameStatus;
  home_score: number;
  away_score: number;
  is_featured: boolean;
}>): Promise<TournamentGame> {
  const res = await oyunsSagsAdminApi.put(`/oyuns-sags/admin/games/${gameId}`, payload);
  return res.data as TournamentGame;
}

export async function deleteOyunsSagsAdminGame(gameId: string): Promise<{ ok: boolean }> {
  const res = await oyunsSagsAdminApi.delete(`/oyuns-sags/admin/games/${gameId}`);
  return res.data as { ok: boolean };
}

export interface OyunsSagsAdminStages {
  groups: TournamentGroup[];
  knockout: TournamentKnockoutPhase[];
}

export async function fetchOyunsSagsAdminStages(): Promise<OyunsSagsAdminStages> {
  const res = await oyunsSagsAdminApi.get('/oyuns-sags/admin/stages');
  const data = res.data as OyunsSagsAdminStages;
  return {
    groups: Array.isArray(data.groups) ? data.groups : [],
    knockout: Array.isArray(data.knockout) ? data.knockout : [],
  };
}

export async function updateOyunsSagsAdminStages(payload: Partial<{
  groups: TournamentGroupInput[];
  knockout: TournamentKnockoutPhaseInput[];
}>): Promise<OyunsSagsAdminStages> {
  const res = await oyunsSagsAdminApi.put('/oyuns-sags/admin/stages', payload);
  const data = res.data as OyunsSagsAdminStages;
  return {
    groups: Array.isArray(data.groups) ? data.groups : [],
    knockout: Array.isArray(data.knockout) ? data.knockout : [],
  };
}

export async function fetchOyunsSagsAdminVotes(): Promise<{ items: TournamentTeam[]; total_votes: number }> {
  const res = await oyunsSagsAdminApi.get('/oyuns-sags/admin/votes');
  return res.data as { items: TournamentTeam[]; total_votes: number };
}

export async function fetchOyunsSagsAdminSettings(): Promise<OyunsSagsAdminSettings> {
  const res = await oyunsSagsAdminApi.get('/oyuns-sags/admin/settings');
  const data = res.data as OyunsSagsAdminSettings;
  return {
    oyuns_tournament_enabled: data.oyuns_tournament_enabled > 0 ? 1 : 0,
    oyuns_plus_logo_url: data.oyuns_plus_logo_url || OYUNS_PLUS_LOGO_DEFAULT_URL,
  };
}

export async function updateOyunsSagsAdminSettings(payload: Partial<OyunsSagsAdminSettings>): Promise<OyunsSagsAdminSettings> {
  const res = await oyunsSagsAdminApi.put('/oyuns-sags/admin/settings', payload);
  const data = res.data as OyunsSagsAdminSettings;
  return {
    oyuns_tournament_enabled: data.oyuns_tournament_enabled > 0 ? 1 : 0,
    oyuns_plus_logo_url: data.oyuns_plus_logo_url || OYUNS_PLUS_LOGO_DEFAULT_URL,
  };
}

export interface AdminInboxItem {
  invoice: string;
  user_id: number;
  amount: number;
  currency_from: string;
  currency_to: string;
  status: string;
  timestamp: string;
  rate: number;
  bank_details?: string;
  receipt_id?: string;
  bill_url?: string;
  admin_bill_url?: string;
  rejection_comment?: string;
  direction?: string;
  service_kind?: 'exchange' | 'phone_topup';
  topup_phone?: string;
  topup_telecom?: string;
  bank_mismatch?: boolean;
  saved_bank_info?: string;
  admin_label?: string;
  admin_label_note?: string;
  admin_bank_id?: string;
  admin_bank_name?: string;
  automation_managed?: boolean;
  group_dispatch_status?: 'queued' | 'sending' | 'awaiting_proof' | 'processing' | 'completed';
  group_dispatch_error?: string;
}

export interface AdminInboxResponse {
  items: AdminInboxItem[];
}

export async function fetchInbox(): Promise<AdminInboxResponse> {
  const res = await api.get('/admin/inbox');
  return res.data as AdminInboxResponse;
}

export interface ExchangeGroupAutomationSettings {
  mnt_to_rub_enabled: number;
  rub_to_mnt_enabled: number;
  telegram_group_id: number | null;
}

export async function fetchExchangeGroupSettings(): Promise<ExchangeGroupAutomationSettings> {
  const res = await api.get('/admin/exchange-group-settings');
  return res.data as ExchangeGroupAutomationSettings;
}

export async function updateExchangeGroupSettings(
  payload: Partial<ExchangeGroupAutomationSettings>,
): Promise<ExchangeGroupAutomationSettings> {
  const res = await api.put('/admin/exchange-group-settings', payload);
  return res.data as ExchangeGroupAutomationSettings;
}

// ============= Admin History =============

export interface AdminHistoryItem {
  invoice: string;
  user_id: number;
  user_name?: string;
  amount: number;
  currency_from: string;
  currency_to: string;
  status: string;
  timestamp: string;
  rate: number;
  bank_details?: string;
  user_saved_bank?: string;
  is_custom_bank?: boolean;
  receipt_id?: string;
  bill_url?: string;
  admin_bill_url?: string;
  rejection_comment?: string;
  direction?: string;
  completed_by_admin?: number;
  admin_bank_id?: string;
  admin_bank_name?: string;
}

export interface AdminHistoryResponse {
  items: AdminHistoryItem[];
  total: number;
}

export async function fetchAdminHistory(status?: string, limit: number = 100, offset: number = 0): Promise<AdminHistoryResponse> {
  const params = new URLSearchParams();
  if (status && status !== "all") params.append("status", status);
  params.append("limit", limit.toString());
  params.append("offset", offset.toString());
  
  const res = await api.get(`/admin/history?${params.toString()}`);
  return res.data as AdminHistoryResponse;
}

export async function fetchKycPending(): Promise<{ items: KycItem[] }> {
  const res = await api.get('/admin/kyc');
  return res.data as { items: KycItem[] };
}

export async function kycAction(payload: { user_id: number; action: 'approve' | 'reject'; rejection_reason?: string }) {
  const res = await api.post('/admin/kyc/action', payload);
  return res.data as { ok: boolean; message: string };
}

export async function adminAction(payload: { 
  invoice: string; 
  status: string; 
  rejection_comment?: string; 
  admin_comment?: string;
  admin_bill_url?: string;
  completed_by_admin?: number;
  admin_bank_id?: string;
  admin_bank_name?: string;
}) {
  const res = await api.post('/admin/action', payload);
  return res.data;
}

export async function updateUserLabel(payload: { user_id: number; admin_label: string | null; admin_label_note: string | null }) {
  const res = await api.put('/admin/user-label', payload);
  return res.data;
}

export type UserPromoCode = {
  code: string;
  discount: number;
  active: boolean;
  expires_at?: string;
  source?: string;
};

export async function fetchUserPromoCodes(): Promise<{ promo_codes: UserPromoCode[] }> {
  try {
    const res = await api.get('/user/promo-codes');
    return res.data as { promo_codes: UserPromoCode[] };
  } catch {
    return { promo_codes: [] };
  }
}

// ============= Admin Shift Management =============

export interface AdminUser {
  id: number;
  name: string;
  is_active: boolean;
}

export interface AdminUsersResponse {
  admins: AdminUser[];
}

export interface ShiftResponse {
  current_admin_id: number | null;
  current_admin_name: string | null;
  last_updated: string | null;
  is_shift_active: boolean;
}

export async function fetchAdminUsers(): Promise<AdminUsersResponse> {
  const res = await api.get('/admin/users');
  return res.data as AdminUsersResponse;
}

export async function fetchCurrentShift(): Promise<ShiftResponse> {
  const res = await api.get('/admin/shift');
  return res.data as ShiftResponse;
}

export async function openShift(adminId: number, adminName?: string) {
  const res = await api.post('/admin/shift/open', { admin_id: adminId, admin_name: adminName });
  return res.data;
}

export async function transferShift(fromAdminId: number, toAdminId: number, toAdminName?: string) {
  const res = await api.post('/admin/shift/transfer', { 
    from_admin_id: fromAdminId, 
    to_admin_id: toAdminId, 
    to_admin_name: toAdminName 
  });
  return res.data;
}

export async function closeShift(adminId: number) {
  const res = await api.post('/admin/shift/close', { admin_id: adminId });
  return res.data;
}

// ============= Working Hours Management =============

export interface WorkingHoursConfig {
  start_hour_moscow: number;
  end_hour_moscow: number;
  start_time_moscow: string;
  end_time_moscow: string;
  start_time_ub: string;
  end_time_ub: string;
  is_enabled: boolean;
  updated_at: string | null;
}

export interface WorkingHoursUpdatePayload {
  start_hour_moscow: number;
  end_hour_moscow: number;
  is_enabled: boolean;
}

export async function fetchWorkingHours(): Promise<WorkingHoursConfig> {
  const res = await api.get('/admin/working-hours');
  return res.data as WorkingHoursConfig;
}

export async function updateWorkingHours(payload: WorkingHoursUpdatePayload) {
  const res = await api.put('/admin/working-hours', payload);
  return res.data;
}

// ============= User Search =============

export interface UserSearchItem {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  phone?: string;
  verified: boolean;
  total_transactions: number;
  created_at?: string;
}

export interface UserSearchResponse {
  users: UserSearchItem[];
  total: number;
}

export async function searchUsers(query: string = ""): Promise<UserSearchResponse> {
  const res = await api.get(`/admin/user-search?q=${encodeURIComponent(query)}`);
  return res.data as UserSearchResponse;
}

// ============= Admin Bank Account Management =============

export interface AdminBankAccountFull {
  id: string;
  bank_name: string;
  account_number?: string;
  card_number?: string;
  phone?: string;
  owner_name: string;
  currency: "RUB" | "MNT";
  is_active: boolean;
  is_priority: boolean;
  display_order: number;
  admin_id?: number;
  logo_url?: string;
  created_at?: string;
  updated_at?: string;
}

export async function fetchAllAdminBankAccounts(): Promise<{ accounts: AdminBankAccountFull[] }> {
  const res = await api.get('/admin/bank-accounts');
  return res.data;
}

export async function fetchDashboardAdminBankAccounts(): Promise<{ accounts: AdminBankAccountFull[] }> {
  const res = await dashboardApi.get('/dashboard/admin-bank-accounts');
  return res.data as { accounts: AdminBankAccountFull[] };
}

export async function createAdminBankAccount(payload: Partial<AdminBankAccountFull>) {
  const res = await api.post('/admin/bank-accounts', payload);
  return res.data;
}

export async function updateAdminBankAccount(id: string, payload: Partial<AdminBankAccountFull>) {
  const res = await api.put(`/admin/bank-accounts/${id}`, payload);
  return res.data;
}

export async function deleteAdminBankAccount(id: string) {
  const res = await api.delete(`/admin/bank-accounts/${id}`);
  return res.data;
}

// ============= Admin Exchange Limits =============

export async function updateAppSettings(payload: Partial<AppSettings>): Promise<AppSettings> {
  const res = await api.put<Partial<AppSettings>>('/admin/settings', payload);
  return normalizeAppSettings(res.data);
}

// ============= Gift Feature =============

export interface GiftCard {
  id: string;
  name: string;
  image_url: string;
  is_active: boolean;
  display_order: number;
}

export interface GiftCreateInput {
  invoice: string;
  recipient_phone: string;
  recipient_user_id: number;
  gift_card_url: string;
  message: string;
  direction: "buy" | "sell";
  amount: number;
  currency_from: string;
  currency_to: string;
  rate: number;
  admin_bank_id: string;
  sender_receipt_url: string;
  from_name?: string;
}

export interface PendingGift {
  id: string;
  invoice: string;
  sender_user_id: number;
  sender_first_name: string;
  sender_last_name: string;
  from_name?: string;
  gift_card_url: string;
  message: string;
  direction: "buy" | "sell";
  amount: number;
  currency_from: string;
  currency_to: string;
  rate: number;
  created_at: string;
}

export interface AdminGift {
  id: string;
  invoice: string;
  sender_user_id: number;
  sender_first_name: string;
  sender_last_name: string;
  recipient_user_id: number;
  recipient_first_name: string;
  recipient_last_name: string;
  recipient_phone: string;
  gift_card_url: string;
  message: string;
  direction: "buy" | "sell";
  amount: number;
  currency_from: string;
  currency_to: string;
  rate: number;
  status: string;
  sender_receipt_url: string;
  recipient_bank_details?: string;
  admin_bill_url?: string;
  rejection_comment?: string;
  created_at: string;
  confirmed_at?: string;
  completed_at?: string;
}

export async function fetchGiftCards(): Promise<{ cards: GiftCard[] }> {
  try {
    const res = await api.get('/gift/cards');
    return res.data;
  } catch {
    return { cards: [] };
  }
}

export async function searchUserByPhone(phone: string): Promise<{ found: boolean; user?: { id: number; first_name: string; last_name: string } }> {
  const res = await api.get(`/gift/lookup-recipient?phone=${encodeURIComponent(phone)}`);
  return res.data;
}

export async function createGift(payload: GiftCreateInput) {
  console.log("Creating gift with payload:", JSON.stringify(payload, null, 2));
  try {
    const res = await api.post('/gift/create', payload);
    return res.data;
  } catch (err: any) {
    console.error("Gift create error details:", err.response?.data);
    throw err;
  }
}

export async function fetchPendingGifts(): Promise<{ gifts: PendingGift[] }> {
  try {
    const res = await api.get('/gift/pending');
    return res.data;
  } catch {
    return { gifts: [] };
  }
}

export interface SentGift {
  id: string;
  invoice: string;
  recipient_first_name: string;
  recipient_last_name: string;
  amount: number;
  currency_from: string;
  currency_to: string;
  status: string;
  created_at: string;
}

export async function fetchSentGifts(): Promise<{ gifts: SentGift[] }> {
  try {
    const res = await api.get('/gift/sent');
    return res.data;
  } catch {
    return { gifts: [] };
  }
}

export async function confirmGiftReceipt(giftId: string, bankDetails: string) {
  const res = await api.post(`/gift/${giftId}/confirm`, { bank_details: bankDetails });
  return res.data;
}

export async function fetchAdminGifts(status?: string): Promise<{ gifts: AdminGift[] }> {
  const params = status ? `?status=${status}` : '';
  const res = await api.get(`/admin/gifts${params}`);
  return res.data;
}

export async function approveGift(giftId: string, billUrls: string[]) {
  const res = await api.post(`/admin/gift/${giftId}/approve`, { admin_bill_urls: billUrls });
  return res.data;
}

export async function rejectGift(giftId: string, comment: string) {
  const res = await api.post(`/admin/gift/${giftId}/reject`, { comment });
  return res.data;
}

// ============= Fuel Purchase Feature =============

export interface FuelStation {
  id: string;
  name: string;
  discount_percent: number;
  is_active: boolean;
  requires_dispenser: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
}

// Hardcoded fallback (used if API fails)
export const FUEL_STATIONS_FALLBACK: FuelStation[] = [
  { id: '', name: 'Роснефть', discount_percent: 13, is_active: true, requires_dispenser: false, display_order: 0 },
  { id: '', name: 'Башнефть', discount_percent: 13, is_active: true, requires_dispenser: false, display_order: 1 },
  { id: '', name: 'ТНК', discount_percent: 13, is_active: true, requires_dispenser: false, display_order: 2 },
  { id: '', name: 'Газпромнефть', discount_percent: 13, is_active: true, requires_dispenser: false, display_order: 3 },
  { id: '', name: 'Лукойл', discount_percent: 13, is_active: true, requires_dispenser: false, display_order: 4 },
  { id: '', name: 'Татнефть', discount_percent: 13, is_active: true, requires_dispenser: true, display_order: 5 },
  { id: '', name: 'Топлайн', discount_percent: 13, is_active: true, requires_dispenser: true, display_order: 6 },
  { id: '', name: 'ННК', discount_percent: 10, is_active: true, requires_dispenser: true, display_order: 7 },
];

export async function fetchFuelStations(): Promise<FuelStation[]> {
  try {
    const res = await api.get('/fuel/stations');
    return res.data.stations || [];
  } catch {
    return FUEL_STATIONS_FALLBACK;
  }
}

export interface FuelCalculation {
  station_name: string;
  liters: number;
  station_price_per_liter: number;
  discount_percent: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  rounded_amount: number;
  payment_currency: string;
  exchange_rate?: number;
  final_amount: number;
}

export interface FuelOrderCreateInput {
  invoice: string;
  station_name: string;
  dispenser_number?: string;
  station_latitude?: number;
  station_longitude?: number;
  location_text?: string;
  liters: number;
  station_price_per_liter: number;
  payment_currency: string;
  exchange_rate?: number;
  payment_receipt_url: string;
  admin_bank_id?: string;
}

export interface FuelOrder {
  id: string;
  invoice: string;
  user_id: number;
  station_name: string;
  dispenser_number?: string;
  station_latitude?: number;
  station_longitude?: number;
  location_text?: string;
  liters: number;
  station_price_per_liter: number;
  discount_percent: number;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  rounded_amount: number;
  payment_currency: string;
  exchange_rate?: number;
  final_amount: number;
  payment_receipt_url?: string;
  pump_photo_url?: string;
  approval_image_url?: string;
  admin_bank_id?: string;
  admin_bank_name?: string;
  admin_bank_owner?: string;
  admin_bank_card?: string;
  status: 'pending' | 'pending_payment' | 'approved' | 'paid' | 'in_progress' | 'fueling_complete' | 'completed' | 'rejected' | 'cancelled';
  rejection_comment?: string;
  admin_comment?: string;
  completed_by_admin?: number;
  created_at: string;
  updated_at?: string;
  completed_at?: string;
}

export interface FuelChatMessage {
  id: string;
  fuel_order_id: string;
  sender_type: 'user' | 'admin';
  sender_id: number;
  message?: string;
  image_url?: string;
  created_at: string;
}

export interface FuelAdminBankAccount {
  id: string;
  bank_name: string;
  account_number?: string;
  card_number?: string;
  phone?: string;
  owner_name: string;
  currency: 'RUB' | 'MNT';
  is_active: boolean;
  is_primary: boolean;
  display_order: number;
  admin_id?: number;
  logo_url?: string;
  emoji_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface FuelShiftAdmin {
  admin_id: number;
  admin_name: string;
  chat_id?: number;
}

export interface FuelShiftStatus {
  is_active: boolean;
  current_admin?: FuelShiftAdmin;
  admins: FuelShiftAdmin[];
  always_notify_admin_id?: number;
}

// --- Fuel User API ---

export async function calculateFuel(params: {
  station_name: string;
  liters: number;
  station_price_per_liter: number;
  payment_currency: string;
  exchange_rate?: number;
}): Promise<FuelCalculation> {
  const res = await api.post('/fuel/calculate', params);
  return res.data;
}

export async function createFuelOrder(payload: FuelOrderCreateInput) {
  const res = await api.post('/fuel/create', payload);
  return res.data as { id: string; invoice: string; status: string; gross_amount: number; discount_percent: number; discount_amount: number; net_amount: number; rounded_amount: number; final_amount: number; created_at: string };
}

export async function fetchFuelOrders(): Promise<{ orders: FuelOrder[]; total: number }> {
  try {
    const res = await api.get('/fuel/orders');
    return res.data;
  } catch {
    return { orders: [], total: 0 };
  }
}

export async function fetchActiveFuelOrders(): Promise<{ orders: FuelOrder[]; total: number }> {
  try {
    const res = await api.get('/fuel/active');
    return res.data;
  } catch {
    return { orders: [], total: 0 };
  }
}

export async function uploadFuelPumpPhoto(orderId: string, pumpPhotoUrl: string) {
  const res = await api.post('/fuel/upload-pump-photo', { order_id: orderId, pump_photo_url: pumpPhotoUrl });
  return res.data;
}

export async function fetchFuelChat(orderId: string): Promise<{ messages: FuelChatMessage[] }> {
  try {
    const res = await api.get(`/fuel/chat/${orderId}`);
    return res.data;
  } catch {
    return { messages: [] };
  }
}

export async function sendFuelChatMessage(orderId: string, message?: string, imageUrl?: string) {
  const res = await api.post(`/fuel/chat/${orderId}`, { message, image_url: imageUrl });
  return res.data;
}

export async function fetchFuelAdminBanks(): Promise<{ accounts: FuelAdminBankAccount[] }> {
  try {
    const res = await api.get('/fuel/admin-banks');
    return res.data;
  } catch {
    return { accounts: [] };
  }
}

// --- Fuel Admin API ---

export async function fetchFuelAdminInbox(): Promise<{ orders: FuelOrder[]; total: number; unread_counts?: Record<string, number> }> {
  const res = await fuelAdminApi.get('/fuel-admin/inbox');
  return res.data;
}

export async function fuelAdminAction(params: {
  order_id: string;
  status: string;
  rejection_comment?: string;
  admin_comment?: string;
  approval_image_url?: string;
}) {
  const res = await fuelAdminApi.post('/fuel-admin/action', params);
  return res.data;
}

export async function fetchFuelAdminHistory(status?: string, limit = 50, offset = 0): Promise<{ orders: FuelOrder[]; total: number }> {
  const params = new URLSearchParams();
  if (status && status !== "all") params.append("status", status);
  params.append("limit", limit.toString());
  params.append("offset", offset.toString());
  const res = await fuelAdminApi.get(`/fuel-admin/history?${params.toString()}`);
  return res.data;
}

export async function fetchFuelAdminBankAccounts(): Promise<{ accounts: FuelAdminBankAccount[] }> {
  const res = await fuelAdminApi.get('/fuel-admin/bank-accounts');
  return res.data;
}

export async function createFuelAdminBankAccount(payload: Partial<FuelAdminBankAccount>) {
  const res = await fuelAdminApi.post('/fuel-admin/bank-accounts', payload);
  return res.data;
}

export async function updateFuelAdminBankAccount(id: string, payload: Partial<FuelAdminBankAccount>) {
  const res = await fuelAdminApi.put(`/fuel-admin/bank-accounts/${id}`, payload);
  return res.data;
}

export async function deleteFuelAdminBankAccount(id: string) {
  const res = await fuelAdminApi.delete(`/fuel-admin/bank-accounts/${id}`);
  return res.data;
}

export async function fetchFuelAdminChat(orderId: string): Promise<{ messages: FuelChatMessage[] }> {
  try {
    const res = await fuelAdminApi.get(`/fuel-admin/chat/${orderId}`);
    return res.data;
  } catch {
    return { messages: [] };
  }
}

export async function sendFuelAdminChatMessage(orderId: string, message?: string, imageUrl?: string) {
  const res = await fuelAdminApi.post(`/fuel-admin/chat/${orderId}`, { message, image_url: imageUrl });
  return res.data;
}

// --- Fuel Admin: Station Management ---

export async function fetchFuelAdminStations(): Promise<FuelStation[]> {
  const res = await fuelAdminApi.get('/fuel-admin/stations');
  return res.data.stations || [];
}

export async function createFuelAdminStation(payload: { name: string; discount_percent: number; is_active?: boolean; requires_dispenser?: boolean; display_order?: number }) {
  const res = await fuelAdminApi.post('/fuel-admin/stations', payload);
  return res.data as FuelStation;
}

export async function updateFuelAdminStation(id: string, payload: Partial<{ name: string; discount_percent: number; is_active: boolean; requires_dispenser: boolean; display_order: number }>) {
  const res = await fuelAdminApi.put(`/fuel-admin/stations/${id}`, payload);
  return res.data as FuelStation;
}

export async function deleteFuelAdminStation(id: string) {
  const res = await fuelAdminApi.delete(`/fuel-admin/stations/${id}`);
  return res.data;
}

// --- Fuel: Shift Status (user-facing) ---

export async function fetchFuelShiftStatus(): Promise<{ is_active: boolean }> {
  try {
    const res = await api.get('/fuel/shift-status');
    return res.data;
  } catch {
    return { is_active: true };
  }
}

// --- Fuel Admin: Shift Management ---

export async function fetchFuelAdminShift(): Promise<FuelShiftStatus> {
  const res = await fuelAdminApi.get('/fuel-admin/shift');
  return res.data;
}

export async function updateFuelAdminShift(params: { is_active: boolean; admin_id?: number; always_notify_admin_id?: number }) {
  const res = await fuelAdminApi.put('/fuel-admin/shift', params);
  return res.data;
}

// --- Standalone Analytics Dashboard (no Telegram auth) ---

export type DashboardTransaction = {
  invoice: string | null;
  timestamp: string;
  user_id: number | null;
  user_name: string | null;
  direction: "buy" | "sell";
  amount: number;
  currency_from: string | null;
  currency_to: string | null;
  rate: number;
  rub_equivalent: number;
  status: string | null;
  promo_code: string | null;
  bank_details: string | null;
  completed_by_admin: number | null;
  admin_name: string | null;
  duration_minutes: number | null;
};

export type DashboardSummary = {
  total_count: number;
  valid_count: number;
  completed_count: number;
  pending_count: number;
  rejected_count: number;
  waiting_edit_count: number;
  total_volume_rub: number;
  completed_volume_rub: number;
  buy_count: number;
  sell_count: number;
  buy_volume_rub: number;
  sell_volume_rub: number;
  unique_users: number;
  avg_transaction_rub: number;
  avg_duration_minutes: number | null;
};

export type DashboardAdminStat = {
  admin_id: number;
  admin_name: string | null;
  count: number;
  volume_rub: number;
  avg_duration_minutes: number | null;
};

export type DashboardData = {
  summary: DashboardSummary;
  status_breakdown: { status: string; count: number; volume_rub: number }[];
  direction_breakdown: { direction: "buy" | "sell"; count: number; volume_rub: number }[];
  time_series: { period: string; buy_volume_rub: number; sell_volume_rub: number; count: number }[];
  top_users: { user_id: number; user_name: string | null; count: number; volume_rub: number }[];
  admin_stats: DashboardAdminStat[];
  admins: { admin_id: number; name: string | null }[];
  transactions: DashboardTransaction[];
  row_count: number;
  window_count: number;
  truncated: boolean;
};

export type DashboardAdminOption = {
  admin_id: number;
  name: string | null;
};

export type DashboardStatusFilter = "all" | "successful" | "pending" | "waiting_edit" | "rejected";

export async function verifyDashboardKey(): Promise<boolean> {
  try {
    const res = await dashboardApi.get('/dashboard/verify');
    return Boolean(res.data?.ok);
  } catch {
    return false;
  }
}

export async function fetchDashboardData(params: {
  start?: string;
  end?: string;
  granularity?: "day" | "month";
  status?: DashboardStatusFilter;
  admin_id?: number;
}): Promise<DashboardData> {
  const search = new URLSearchParams();
  if (params.start) search.set("start", params.start);
  if (params.end) search.set("end", params.end);
  if (params.granularity) search.set("granularity", params.granularity);
  if (params.status && params.status !== "all") search.set("status", params.status);
  if (params.admin_id != null) search.set("admin_id", String(params.admin_id));
  const query = search.toString();
  const res = await dashboardApi.get(`/dashboard/transactions${query ? `?${query}` : ""}`);
  return res.data as DashboardData;
}

// --- Dashboard Page 1: Balance accounting + Profit calculator ---

export type TreasuryAccount = {
  id: string;
  name: string;
  admin_id?: number | null;
  admin_name?: string | null;
  admin_bank_id?: string | null;
  admin_bank_name?: string | null;
  admin_bank_owner?: string | null;
  admin_bank_currency?: string | null;
  prev_balance: number;
  rub_to_mnt: number;
  mnt_to_rub: number;
  adjustment: number;
  adjustment_total?: number;
  entered_balance?: number | null;
  calculated_balance?: number;
  discrepancy?: number | null;
  balance_date?: string | null;
  currency: string;
  is_active: boolean;
  display_order: number;
  created_at?: string;
  updated_at?: string;
};

export type DailyBalanceRow = {
  admin_id: number;
  admin_name: string | null;
  balance_date: string;
  opening_balance: number;
  entered_balance: number | null;
  rub_to_mnt_rub: number;
  mnt_to_rub_rub: number;
  adjustment_total: number;
  calculated_balance: number;
  discrepancy: number | null;
};

export type BalanceHistoryRow = {
  row_key: string;
  balance_date: string;
  scope_type: "all" | "admin";
  admin_id: number | null;
  admin_name: string | null;
  opening_balance: number;
  rub_to_mnt_rub: number;
  mnt_to_rub_rub: number;
  adjustment_total: number;
  calculated_balance: number;
  entered_balance: number | null;
  discrepancy: number | null;
  created_at?: string;
  updated_at?: string;
};

export type BalanceHistoryResponse = {
  days: string[];
  rows: BalanceHistoryRow[];
};

export type BalanceAdjustment = {
  id: string;
  admin_id: number;
  admin_name?: string | null;
  treasury_account_id?: string | null;
  account_name?: string | null;
  balance_date: string;
  amount: number;
  tag: string;
  description?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type BalanceSummary = {
  date: string;
  admins: DashboardAdminOption[];
  selected_admin_id?: number | null;
  accounts: TreasuryAccount[];
  daily_balances: DailyBalanceRow[];
  selected_daily_balance?: DailyBalanceRow | null;
  adjustments: BalanceAdjustment[];
  rub_to_mnt_rub: number;
  mnt_to_rub_rub: number;
  prev_balance_total: number;
  adjustment_total: number;
  total_balance: number;
  entered_balance_total: number;
  difference_total: number | null;
  missing_entered_balance_count: number;
  setup_required?: boolean;
  setup_error?: string | null;
};

export type CostRate = {
  rate_date: string;
  usd_rate: number | null;
  black_rate: number | null;
  cost_rate: number | null;
  updated_at?: string;
};

export type ProfitSummary = {
  total_profit: number;
  buy_profit: number;
  sell_profit: number;
  ticket_profit: number;
  currency: string;
  counted: number;
  ticket_count: number;
  by_day: { date: string; profit: number; count: number }[];
  missing_rate_dates: string[];
};

export type ProfitTransactionItem = {
  invoice_id: string | null;
  transaction_type: "exchange" | "ticket";
  timestamp: string;
  direction: "buy" | "sell" | "ticket";
  amount: number;
  currency_from: string;
  currency_to: string;
  rate: number;
  cost_rate: number;
  rub_equivalent: number;
  profit_mnt: number;
  status: string | null;
  note?: string | null;
};

export type ProfitTransactionsResponse = {
  items: ProfitTransactionItem[];
  count: number;
};

export type PlaneTicketSale = {
  id: string;
  sale_date: string;
  sold_price_mnt: number;
  exchange_rate: number;
  cost_rate: number;
  rub_equivalent: number;
  profit_mnt: number;
  note?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PlaneTicketSalesSummary = {
  count: number;
  total_profit: number;
  total_sold_price_mnt: number;
};

export type PlaneTicketSalesResponse = {
  sales: PlaneTicketSale[];
  summary: PlaneTicketSalesSummary;
};

export type DashboardTimeZone = "moscow" | "ub";

export async function fetchTreasuryAccounts(): Promise<TreasuryAccount[]> {
  const res = await dashboardApi.get("/dashboard/treasury-accounts");
  return (res.data?.accounts || []) as TreasuryAccount[];
}

export async function createTreasuryAccount(payload: Partial<TreasuryAccount> & { tz?: DashboardTimeZone }): Promise<TreasuryAccount> {
  const res = await dashboardApi.post("/dashboard/treasury-accounts", payload);
  return res.data.account as TreasuryAccount;
}

export async function updateTreasuryAccount(id: string, payload: Partial<TreasuryAccount> & { tz?: DashboardTimeZone }): Promise<TreasuryAccount> {
  const res = await dashboardApi.put(`/dashboard/treasury-accounts/${id}`, payload);
  return res.data.account as TreasuryAccount;
}

export async function deleteTreasuryAccount(id: string): Promise<void> {
  await dashboardApi.delete(`/dashboard/treasury-accounts/${id}`);
}

export async function fetchBalanceSummary(params: { date?: string; admin_id?: number; tz?: DashboardTimeZone } = {}): Promise<BalanceSummary> {
  const search = new URLSearchParams();
  if (params.date) search.set("date", params.date);
  if (params.admin_id != null) search.set("admin_id", String(params.admin_id));
  if (params.tz) search.set("tz", params.tz);
  const query = search.toString();
  const res = await dashboardApi.get(`/dashboard/balance${query ? `?${query}` : ""}`);
  return res.data as BalanceSummary;
}

export async function upsertBalanceDaily(payload: {
  admin_id: number;
  balance_date?: string;
  entered_balance: number | null;
}): Promise<DailyBalanceRow> {
  const res = await dashboardApi.put("/dashboard/balance/daily", payload);
  return res.data.daily_balance as DailyBalanceRow;
}

export async function fetchBalanceHistory(params: { days?: number; tz?: DashboardTimeZone } = {}): Promise<BalanceHistoryResponse> {
  const search = new URLSearchParams();
  if (params.days != null) search.set("days", String(params.days));
  if (params.tz) search.set("tz", params.tz);
  const query = search.toString();
  const res = await dashboardApi.get(`/dashboard/balance/history${query ? `?${query}` : ""}`);
  return res.data as BalanceHistoryResponse;
}

export async function createBalanceAdjustment(payload: {
  admin_id: number;
  treasury_account_id?: string;
  balance_date?: string;
  amount: number;
  tag: string;
  description?: string;
}): Promise<BalanceAdjustment> {
  const res = await dashboardApi.post("/dashboard/balance/adjustments", payload);
  return res.data.adjustment as BalanceAdjustment;
}

export async function deleteBalanceAdjustment(id: string): Promise<void> {
  await dashboardApi.delete(`/dashboard/balance/adjustments/${id}`);
}

export async function fetchBlackRates(params: { start?: string; end?: string; date?: string } = {}): Promise<{
  configured: boolean; rates: Record<string, number | null>;
  latest?: number | null; latest_date?: string | null; error?: string;
}> {
  const search = new URLSearchParams();
  if (params.start) search.set("start", params.start);
  if (params.end) search.set("end", params.end);
  if (params.date) search.set("date", params.date);
  const query = search.toString();
  const res = await dashboardApi.get(`/dashboard/black-rate${query ? `?${query}` : ""}`);
  return res.data;
}

export async function fetchCostRates(params: { start?: string; end?: string; tz?: DashboardTimeZone } = {}): Promise<CostRate[]> {
  const search = new URLSearchParams();
  if (params.start) search.set("start", params.start);
  if (params.end) search.set("end", params.end);
  if (params.tz) search.set("tz", params.tz);
  const query = search.toString();
  const res = await dashboardApi.get(`/dashboard/cost-rates${query ? `?${query}` : ""}`);
  return (res.data?.cost_rates || []) as CostRate[];
}

export async function saveCostRate(payload: { date: string; usd_rate: number; black_rate: number }): Promise<CostRate> {
  const res = await dashboardApi.post("/dashboard/cost-rates", payload);
  return res.data.cost_rate as CostRate;
}

export async function saveCostRatePeriodUsd(payload: {
  start: string;
  end: string;
  usd_rate: number;
  tz?: DashboardTimeZone;
}): Promise<{ ok: boolean; updated_count: number; start: string; end: string; usd_rate: number }> {
  const res = await dashboardApi.post("/dashboard/cost-rates/period-usd", payload);
  return res.data;
}

export async function fetchProfit(params: { start?: string; end?: string; tz?: DashboardTimeZone }): Promise<ProfitSummary> {
  const search = new URLSearchParams();
  if (params.start) search.set("start", params.start);
  if (params.end) search.set("end", params.end);
  if (params.tz) search.set("tz", params.tz);
  const query = search.toString();
  const res = await dashboardApi.get(`/dashboard/profit${query ? `?${query}` : ""}`);
  return res.data as ProfitSummary;
}

export async function fetchProfitTransactions(params: {
  start?: string;
  end?: string;
  tz?: DashboardTimeZone;
  include_tickets?: boolean;
}): Promise<ProfitTransactionsResponse> {
  const search = new URLSearchParams();
  if (params.start) search.set("start", params.start);
  if (params.end) search.set("end", params.end);
  if (params.tz) search.set("tz", params.tz);
  if (params.include_tickets != null) search.set("include_tickets", String(params.include_tickets));
  const query = search.toString();
  const res = await dashboardApi.get(`/dashboard/profit/transactions${query ? `?${query}` : ""}`);
  return res.data as ProfitTransactionsResponse;
}

export async function fetchPlaneTicketSales(params: { start?: string; end?: string; tz?: DashboardTimeZone } = {}): Promise<PlaneTicketSalesResponse> {
  const search = new URLSearchParams();
  if (params.start) search.set("start", params.start);
  if (params.end) search.set("end", params.end);
  if (params.tz) search.set("tz", params.tz);
  const query = search.toString();
  const res = await dashboardApi.get(`/dashboard/plane-ticket-sales${query ? `?${query}` : ""}`);
  return res.data as PlaneTicketSalesResponse;
}

export async function createPlaneTicketSale(payload: {
  sale_date?: string;
  sold_price_mnt: number;
  exchange_rate: number;
  notes?: string;
}): Promise<PlaneTicketSale> {
  const res = await dashboardApi.post("/dashboard/plane-ticket-sales", payload);
  return res.data.sale as PlaneTicketSale;
}

export async function deletePlaneTicketSale(id: string): Promise<void> {
  await dashboardApi.delete(`/dashboard/plane-ticket-sales/${id}`);
}
