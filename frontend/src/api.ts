import axios from "axios";

// Use relative '/api' by default for production behind Nginx.
// Override with VITE_API_BASE (e.g., http://localhost:8000/api) for local dev.
const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api",
});

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
  phone: string;
  rub_bank_name: string;
  rub_phone_sbp: string;
  rub_card_number: string;
  rub_owner_name: string;
  mnt_bank_name: string;
  mnt_account_number: string;
  mnt_owner_name: string;
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
  invoice?: string;
  admin_bank_id?: number;
};

export type PresignRequest = {
  bucket: string;
  path: string;
};

export const withInitData = (initData: string) => ({
  headers: { "X-Telegram-Init-Data": initData },
});

export const withAdminKey = (key?: string) =>
  key
    ? {
        headers: { "X-Admin-Key": key },
      }
    : undefined;

export async function fetchRates() {
  const res = await api.get<Rate>('/rates');
  return res.data;
}

export async function fetchServiceStatus() {
  const res = await api.get<ServiceStatus>('/service-status');
  return res.data;
}

export async function fetchMe(initData: string) {
  const res = await api.get<{ user: UserProfile }>('/me', withInitData(initData));
  return res.data.user;
}

export async function agreeToTerms(initData: string) {
  const res = await api.post('/agree-terms', {}, withInitData(initData));
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

export async function updateBankInfo(initData: string, payload: UpdateBankInfoInput) {
  const res = await api.post('/update-bank-info', payload, withInitData(initData));
  return res.data as { ok: boolean; message: string };
}

export async function createExchange(initData: string, payload: ExchangeCreateInput) {
  const res = await api.post('/exchange/create', payload, withInitData(initData));
  return res.data;
}

export async function requestPresign(initData: string, payload: PresignRequest) {
  const res = await api.post('/storage/presign', payload, withInitData(initData));
  return res.data as { upload_url: string; public_url: string; path: string };
}

export async function fetchHistory(initData: string) {
  const res = await api.get('/history', withInitData(initData));
  return res.data as { items: any[] };
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

export async function validatePromoCode(initData: string, code: string, direction: string) {
  const res = await api.post('/promo/validate', { code, direction }, withInitData(initData));
  return res.data as { valid: boolean; discount_amount?: number; message?: string };
}

export async function submitRegistration(initData: string, payload: RegistrationInput) {
  const res = await api.post('/register', payload, withInitData(initData));
  return res.data as { ok: boolean; message: string };
}

export async function fetchInbox(adminKey?: string) {
  const res = await api.get('/admin/inbox', withAdminKey(adminKey));
  return res.data as { items: any[] };
}

export async function fetchKycPending(adminKey: string): Promise<{ items: KycItem[] }> {
  const res = await api.get('/admin/kyc', withAdminKey(adminKey));
  return res.data as { items: KycItem[] };
}

export async function kycAction(adminKey: string, payload: { user_id: number; action: 'approve' | 'reject'; rejection_reason?: string }) {
  const res = await api.post('/admin/kyc/action', payload, withAdminKey(adminKey));
  return res.data as { ok: boolean; message: string };
}

export async function adminAction(adminKey: string, payload: { 
  invoice: string; 
  status: string; 
  rejection_comment?: string; 
  admin_comment?: string;
  admin_bill_url?: string;
  completed_by_admin?: number;
}) {
  const res = await api.post('/admin/action', payload, withAdminKey(adminKey));
  return res.data;
}

export type UserPromoCode = {
  code: string;
  discount: number;
  active: boolean;
  expires_at?: string;
};

export async function fetchUserPromoCodes(initData: string): Promise<{ promo_codes: UserPromoCode[] }> {
  try {
    const res = await api.get('/api/user/promo-codes', withInitData(initData));
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

export async function fetchAdminUsers(adminKey: string): Promise<AdminUsersResponse> {
  const res = await api.get('/api/admin/users', withAdminKey(adminKey));
  return res.data as AdminUsersResponse;
}

export async function fetchCurrentShift(adminKey: string): Promise<ShiftResponse> {
  const res = await api.get('/api/admin/shift', withAdminKey(adminKey));
  return res.data as ShiftResponse;
}

export async function openShift(adminKey: string, adminId: number, adminName?: string) {
  const res = await api.post('/api/admin/shift/open', { admin_id: adminId, admin_name: adminName }, withAdminKey(adminKey));
  return res.data;
}

export async function transferShift(adminKey: string, fromAdminId: number, toAdminId: number, toAdminName?: string) {
  const res = await api.post('/api/admin/shift/transfer', { 
    from_admin_id: fromAdminId, 
    to_admin_id: toAdminId, 
    to_admin_name: toAdminName 
  }, withAdminKey(adminKey));
  return res.data;
}

export async function closeShift(adminKey: string, adminId: number) {
  const res = await api.post('/api/admin/shift/close', { admin_id: adminId }, withAdminKey(adminKey));
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

export async function fetchWorkingHours(adminKey: string): Promise<WorkingHoursConfig> {
  const res = await api.get('/api/admin/working-hours', withAdminKey(adminKey));
  return res.data as WorkingHoursConfig;
}

export async function updateWorkingHours(adminKey: string, payload: WorkingHoursUpdatePayload) {
  const res = await api.put('/api/admin/working-hours', payload, withAdminKey(adminKey));
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

export async function searchUsers(adminKey: string, query: string = ""): Promise<UserSearchResponse> {
  const res = await api.get(`/api/admin/user-search?q=${encodeURIComponent(query)}`, withAdminKey(adminKey));
  return res.data as UserSearchResponse;
}
