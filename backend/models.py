from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, Field


class AuthenticatedUser(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None


class AuthRequest(BaseModel):
    init_data: str = Field(..., description="Telegram initData string")


class AuthResponse(BaseModel):
    token: str
    user: AuthenticatedUser


class RateResponse(BaseModel):
    buy_rate: Decimal
    sell_rate: Decimal
    updated_at: Optional[datetime]


class ExchangeCreateRequest(BaseModel):
    direction: str = Field(..., description="buy or sell")
    amount: Decimal
    currency_from: str
    currency_to: str
    rate: Decimal
    bank_details: str
    promo_code: Optional[str] = None
    receipt_path: Optional[str] = None
    receipt_paths: Optional[list[str]] = None  # Multiple receipt images
    invoice: Optional[str] = None


class ExchangeCreateResponse(BaseModel):
    id: str
    invoice: str
    status: str
    bill_url: Optional[str] = None
    created_at: datetime


class AdminActionRequest(BaseModel):
    invoice: str
    status: str  # "approved", "completed", "rejected"
    rejection_comment: Optional[str] = None
    admin_comment: Optional[str] = None
    admin_bill_url: Optional[str] = None  # Admin's transaction proof
    completed_by_admin: Optional[int] = None


class PresignRequest(BaseModel):
    bucket: str
    path: str
    expires_in: int | None = None


class PresignResponse(BaseModel):
    upload_url: str
    public_url: Optional[str]
    expires_in: int
    path: str


class UpsertUserPayload(BaseModel):
    id: int
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    bank_rub: Optional[str] = None
    bank_mnt: Optional[str] = None
    passport_storage_url: Optional[str] = None
    ready_for_verification: Optional[bool] = None
    verified: Optional[bool] = None
    agreed_terms: Optional[bool] = None
    updated_at: Optional[datetime] = None


class HistoryItem(BaseModel):
    invoice: str
    amount: Decimal
    currency_from: str
    currency_to: str
    status: str
    timestamp: datetime
    rate: Decimal
    bill_url: Optional[str] = None
    receipt_id: Optional[str] = None
    admin_comment: Optional[str] = None


class HistoryResponse(BaseModel):
    items: list[HistoryItem]


class HealthResponse(BaseModel):
    service: str = "oyunsbot-webapp"
    version: str = "0.1.0"


class AdminInboxItem(BaseModel):
    invoice: str
    user_id: int
    amount: Decimal
    currency_from: str
    currency_to: str
    status: str
    timestamp: datetime
    rate: Decimal
    bank_details: Optional[str]
    receipt_id: Optional[str]
    bill_url: Optional[str]
    admin_bill_url: Optional[str] = None
    rejection_comment: Optional[str] = None
    direction: Optional[str] = None


class AdminInboxResponse(BaseModel):
    items: list[AdminInboxItem]


class KycItem(BaseModel):
    user_id: int
    first_name: Optional[str]
    last_name: Optional[str]
    phone: Optional[str] = None
    bank_rub: Optional[str] = None
    bank_mnt: Optional[str] = None
    passport_storage_url: Optional[str]
    ready_for_verification: bool
    verified: bool
    updated_at: Optional[datetime] = None


class KycResponse(BaseModel):
    items: list[KycItem]


class RegistrationRequest(BaseModel):
    last_name: str
    first_name: str
    # RUB bank info: bank_name, phone_sbp, card_number, owner_name
    rub_bank_name: str
    rub_phone_sbp: str
    rub_card_number: str
    rub_owner_name: str
    # MNT bank info: bank_name, account_number, owner_name, phone
    mnt_bank_name: str
    mnt_account_number: str
    mnt_owner_name: str
    mnt_phone: str  # Mongolian phone number
    passport_storage_url: str  # Passport image URL


class UpdateBankInfoRequest(BaseModel):
    """Request to update only bank info (not name or passport)"""
    phone: str  # Russian phone number
    # RUB bank info
    rub_bank_name: str
    rub_phone_sbp: str
    rub_card_number: str
    rub_owner_name: str
    # MNT bank info
    mnt_bank_name: str
    mnt_account_number: str
    mnt_owner_name: str
    mnt_phone: Optional[str] = None  # Mongolian phone number


class KycActionRequest(BaseModel):
    user_id: int
    action: str  # "approve" or "reject"
    rejection_reason: Optional[str] = None


class MeResponse(BaseModel):
    user: UpsertUserPayload
    is_admin: bool = False


# Admin Bank Accounts
class AdminBankAccount(BaseModel):
    id: str
    bank_name: str
    account_number: Optional[str] = None
    card_number: Optional[str] = None
    phone: Optional[str] = None
    owner_name: str
    currency: str  # "RUB" or "MNT"
    is_active: bool = True
    admin_id: Optional[int] = None  # Telegram user ID of admin who owns this account


class AdminBankAccountsResponse(BaseModel):
    accounts: list[AdminBankAccount]


# Promo Code
class PromoCodeValidateRequest(BaseModel):
    code: str
    direction: str  # "buy" or "sell"


class PromoCodeValidateResponse(BaseModel):
    valid: bool
    discount_amount: Optional[float] = None  # Amount to adjust rate (not percentage)
    message: Optional[str] = None


# User Promo Codes
class UserPromoCode(BaseModel):
    code: str
    discount: float
    active: bool
    expires_at: Optional[datetime] = None
    source: Optional[str] = None


class UserPromoCodesResponse(BaseModel):
    promo_codes: list[UserPromoCode]


# Admin Shift Management
class AdminShift(BaseModel):
    id: int = 1
    current_admin_id: Optional[int] = None  # Telegram user ID
    current_admin_name: Optional[str] = None  # Fetched separately or passed
    last_updated: Optional[datetime] = None


class AdminShiftResponse(BaseModel):
    current_admin_id: Optional[int] = None
    current_admin_name: Optional[str] = None
    last_updated: Optional[datetime] = None
    is_shift_active: bool = False


class ShiftOpenRequest(BaseModel):
    admin_id: int
    admin_name: Optional[str] = None


class ShiftTransferRequest(BaseModel):
    from_admin_id: int
    to_admin_id: int
    to_admin_name: Optional[str] = None


class ShiftCloseRequest(BaseModel):
    admin_id: int


# Admin Users List
class AdminUser(BaseModel):
    id: int  # Telegram user ID
    name: str
    is_active: bool = True


class AdminUsersResponse(BaseModel):
    admins: list[AdminUser]


# Service Status (public)
class ServiceStatusResponse(BaseModel):
    is_open: bool = False
    is_within_hours: bool = False
    is_shift_active: bool = False
    working_hours: str = "09:00 - 04:00"  # UB time
    message: Optional[str] = None


# Working Hours Management
class WorkingHoursConfig(BaseModel):
    id: int = 1
    start_hour_moscow: int = 4  # 04:00 Moscow time
    end_hour_moscow: int = 23   # 23:00 Moscow time
    is_enabled: bool = True
    updated_at: Optional[datetime] = None
    updated_by: Optional[int] = None  # Admin who last updated


class WorkingHoursResponse(BaseModel):
    start_hour_moscow: int = 4
    end_hour_moscow: int = 23
    start_time_moscow: str = "04:00"  # Formatted time
    end_time_moscow: str = "23:00"
    start_time_ub: str = "09:00"  # Equivalent UB time
    end_time_ub: str = "04:00"
    is_enabled: bool = True
    updated_at: Optional[datetime] = None


class WorkingHoursUpdateRequest(BaseModel):
    start_hour_moscow: int  # 0-23
    end_hour_moscow: int    # 0-23
    is_enabled: bool = True


# User Search for Admin
class UserSearchItem(BaseModel):
    id: int  # Telegram user ID
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    phone: Optional[str] = None
    verified: bool = False
    total_transactions: int = 0
    created_at: Optional[datetime] = None


class UserSearchResponse(BaseModel):
    users: list[UserSearchItem]
    total: int = 0


# Admin Transaction History (all transactions)
class AdminHistoryItem(BaseModel):
    invoice: str
    user_id: int
    user_name: Optional[str] = None  # first_name + last_name from users table
    amount: Decimal
    currency_from: str
    currency_to: str
    status: str
    timestamp: datetime
    rate: Decimal
    bank_details: Optional[str] = None
    receipt_id: Optional[str] = None
    bill_url: Optional[str] = None
    admin_bill_url: Optional[str] = None
    rejection_comment: Optional[str] = None
    direction: Optional[str] = None
    completed_by_admin: Optional[int] = None


class AdminHistoryResponse(BaseModel):
    items: list[AdminHistoryItem]
    total: int = 0
