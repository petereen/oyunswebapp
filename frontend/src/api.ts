import axios from "axios";

// Use relative '/api' by default for production behind Nginx.
// Override with VITE_API_BASE (e.g., http://localhost:8000/api) for local dev.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
});

const JWT_STORAGE_KEY = 'oyuns_jwt';

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
  error => {
    console.error(`❌ API Error: ${error.response?.status || error.message} ${error.config?.url}`, {
      status: error.response?.status,
      data: error.response?.data,
    });
    
    // On 401 Unauthorized, clear stored auth and let the app re-authenticate
    if (error.response?.status === 401) {
      console.warn('🔒 401 Unauthorized - clearing stored auth');
      localStorage.removeItem(JWT_STORAGE_KEY);
      localStorage.removeItem('oyuns_user');
      // Optionally trigger re-auth by dispatching a custom event
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
  email?: string;
  phone?: string;
  bank_rub?: string;
  bank_mnt?: string;
  verified?: boolean;
  ready_for_verification?: boolean;
  agreed_terms?: boolean;
  passport_storage_url?: string;
};

export type AdminBankAccount = {
  id: number;
  bank_name: string;
  account_number: string;
  card_number?: string;
  phone?: string;
  owner_name: string;
  currency: "RUB" | "MNT";
  is_active: boolean;
};

export type RegistrationInput = {
  last_name: string;
  first_name: string;
  email?: string;
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
  admin_bank_id?: number;
};

export type PresignRequest = {
  bucket: string;
  path: string;
};

// NO AUTH MODE - All API calls work without authentication

export async function fetchRates() {
  const res = await api.get<Rate>('/rates');
  return res.data;
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
  rub_bank_name: string;
  rub_phone_sbp: string;
  rub_card_number: string;
  rub_owner_name: string;
  mnt_bank_name: string;
  mnt_account_number: string;
  mnt_owner_name: string;
};

export async function updateBankInfo(payload: UpdateBankInfoInput) {
  const res = await api.post('/update-bank-info', payload);
  return res.data as { ok: boolean; message: string };
}

export async function createExchange(payload: ExchangeCreateInput) {
  const res = await api.post('/exchange/create', payload);
  return res.data;
}

export async function requestPresign(payload: PresignRequest) {
  const res = await api.post('/storage/presign', payload);
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
  status: 'pending' | 'approved' | 'completed' | 'successful' | 'rejected';
  timestamp: string;
  admin_comment?: string;
};

export async function fetchActiveTransactions(): Promise<{ transactions: ActiveTransaction[] }> {
  try {
    const res = await api.get('/active-transactions');
    return res.data as { transactions: ActiveTransaction[] };
  } catch {
    return { transactions: [] };
  }
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

export async function fetchInbox() {
  const res = await api.get('/admin/inbox');
  return res.data as { items: any[] };
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
  receipt_id?: string;
  bill_url?: string;
  admin_bill_url?: string;
  rejection_comment?: string;
  direction?: string;
  completed_by_admin?: number;
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
}) {
  const res = await api.post('/admin/action', payload);
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
  display_order: number;
  admin_id?: number;
  created_at?: string;
  updated_at?: string;
}

export async function fetchAllAdminBankAccounts(): Promise<{ accounts: AdminBankAccountFull[] }> {
  const res = await api.get('/admin/bank-accounts');
  return res.data;
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
  admin_bank_id: number;
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

export async function approveGift(giftId: string) {
  const res = await api.post(`/admin/gift/${giftId}/approve`);
  return res.data;
}

export async function rejectGift(giftId: string, comment: string) {
  const res = await api.post(`/admin/gift/${giftId}/reject`, { comment });
  return res.data;
}
