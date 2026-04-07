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


class AppSettingsResponse(BaseModel):
    min_rub_amount: int = 5000  # Default minimum RUB for MNT->RUB


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
    email: Optional[str] = None
    phone: Optional[str] = None
    phone_mnt: Optional[str] = None  # Mongolian phone number
    bank_rub: Optional[str] = None
    bank_mnt: Optional[str] = None
    passport_storage_url: Optional[str] = None
    ready_for_verification: Optional[bool] = None
    verified: Optional[bool] = None
    agreed_terms: Optional[bool] = None
    lang: Optional[str] = None
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
    bank_mismatch: bool = False  # True if user used different bank account than saved
    saved_bank_info: Optional[str] = None  # User's saved bank info for comparison
    admin_label: Optional[str] = None  # Admin label for user (e.g. Тэмдэглэл, Сэжигтэй)
    admin_label_note: Optional[str] = None  # Admin note for the label


class UserLabelUpdateRequest(BaseModel):
    user_id: int
    admin_label: Optional[str] = None  # max 30 chars
    admin_label_note: Optional[str] = None


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
    email: Optional[str] = None
    # RUB bank info: bank_name, phone_sbp, card_number, owner_name (optional)
    rub_bank_name: str = ""
    rub_phone_sbp: str = ""
    rub_card_number: str = ""
    rub_owner_name: str = ""
    # MNT bank info: bank_name, account_number, owner_name, phone
    mnt_bank_name: str
    mnt_account_number: str
    mnt_owner_name: str
    mnt_phone: str  # Mongolian phone number
    passport_storage_url: str  # Passport image URL


class UpdateBankInfoRequest(BaseModel):
    """Request to update only bank info (not name or passport)"""
    phone: str  # Russian phone number
    email: Optional[str] = None  # Email address
    # RUB bank info
    rub_bank_name: str
    rub_phone_sbp: str
    rub_card_number: str
    rub_owner_name: str
    # MNT bank info
    mnt_bank_name: str
    mnt_account_number: str
    mnt_owner_name: str
    mnt_phone: Optional[str] = None  # Mongolian phone number (4th part of bank_mnt)


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
    is_priority: bool = False  # Priority card for rotation


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
    user_saved_bank: Optional[str] = None  # User's saved bank info for comparison (bank_mnt or bank_rub based on currency_to)
    is_custom_bank: Optional[bool] = None  # True if bank_details differs from user's saved bank
    receipt_id: Optional[str] = None
    bill_url: Optional[str] = None
    admin_bill_url: Optional[str] = None
    rejection_comment: Optional[str] = None
    direction: Optional[str] = None
    completed_by_admin: Optional[int] = None


class AdminHistoryResponse(BaseModel):
    items: list[AdminHistoryItem]
    total: int = 0


# ============= Gift Feature Models =============

class GiftCard(BaseModel):
    id: str
    name: str
    image_url: str
    is_active: bool = True
    display_order: int = 0


class GiftCardsResponse(BaseModel):
    cards: list[GiftCard]


class GiftCreateRequest(BaseModel):
    invoice: str
    recipient_phone: str
    recipient_user_id: int
    gift_card_url: str
    message: str = ""
    direction: str  # "buy" or "sell"
    amount: float
    currency_from: str
    currency_to: str
    rate: float
    admin_bank_id: str
    sender_receipt_url: str
    from_name: Optional[str] = None  # "From who" field displayed on gift


class GiftCreateResponse(BaseModel):
    id: str
    invoice: str
    status: str


class RecipientLookupResponse(BaseModel):
    found: bool
    user: Optional[dict] = None  # { id, first_name, last_name }


class PendingGift(BaseModel):
    id: str
    invoice: str
    sender_user_id: int
    sender_first_name: Optional[str] = None
    sender_last_name: Optional[str] = None
    from_name: Optional[str] = None
    gift_card_url: str
    message: str = ""
    direction: str
    amount: Decimal
    currency_from: str
    currency_to: str
    rate: Decimal
    created_at: datetime


class PendingGiftsResponse(BaseModel):
    gifts: list[PendingGift]


class SentGift(BaseModel):
    id: str
    invoice: str
    recipient_first_name: Optional[str] = None
    recipient_last_name: Optional[str] = None
    amount: Decimal
    currency_from: str
    currency_to: str
    status: str
    created_at: datetime


class SentGiftsResponse(BaseModel):
    gifts: list[SentGift]


class GiftConfirmRequest(BaseModel):
    bank_details: str


class AdminGift(BaseModel):
    id: str
    invoice: str
    sender_user_id: int
    sender_first_name: Optional[str] = None
    sender_last_name: Optional[str] = None
    recipient_user_id: int
    recipient_first_name: Optional[str] = None
    recipient_last_name: Optional[str] = None
    recipient_phone: str
    gift_card_url: str
    message: str = ""
    direction: str
    amount: Decimal
    currency_from: str
    currency_to: str
    rate: Decimal
    status: str
    sender_receipt_url: Optional[str] = None
    recipient_bank_details: Optional[str] = None
    admin_bill_url: Optional[str] = None
    rejection_comment: Optional[str] = None
    created_at: datetime
    confirmed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class AdminGiftsResponse(BaseModel):
    gifts: list[AdminGift]


class GiftRejectRequest(BaseModel):
    comment: str


class GiftPreapproveRequest(BaseModel):
    admin_bill_urls: Optional[list[str]] = None  # Optional bill photos during preapproval


class GiftFinalizeRequest(BaseModel):
    admin_bill_urls: Optional[list[str]] = None  # Bill photos when finalizing


# ============= Fuel Purchase Feature Models =============

# Hardcoded fallback (used only if DB fetch fails)
FUEL_STATION_DISCOUNTS = {
    "Роснефть": 13,
    "Башнефть": 13,
    "ТНК": 13,
    "Газпромнефть": 13,
    "Лукойл": 13,
    "Татнефть": 13,
    "Топлайн": 13,
    "ННК": 10,
}

FUEL_STATIONS = list(FUEL_STATION_DISCOUNTS.keys())


class FuelStationItem(BaseModel):
    id: str
    name: str
    discount_percent: int
    is_active: bool
    requires_dispenser: bool = False
    display_order: int
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class FuelStationsResponse(BaseModel):
    stations: list[FuelStationItem]


class FuelStationCreateRequest(BaseModel):
    name: str
    discount_percent: int = 13
    is_active: bool = True
    requires_dispenser: bool = False
    display_order: int = 0


class FuelStationUpdateRequest(BaseModel):
    name: Optional[str] = None
    discount_percent: Optional[int] = None
    is_active: Optional[bool] = None
    requires_dispenser: Optional[bool] = None
    display_order: Optional[int] = None


class FuelCalculateRequest(BaseModel):
    station_name: str
    liters: float
    station_price_per_liter: float
    payment_currency: str  # "RUB" or "MNT"
    exchange_rate: Optional[float] = None  # sell rate for MNT conversion


class FuelCalculateResponse(BaseModel):
    station_name: str
    liters: float
    station_price_per_liter: float
    discount_percent: int
    gross_amount: float
    discount_amount: float
    net_amount: float
    rounded_amount: float  # ceil to 100 for RUB
    payment_currency: str
    exchange_rate: Optional[float] = None
    final_amount: float  # what user pays


class FuelOrderCreateRequest(BaseModel):
    invoice: str
    station_name: str
    dispenser_number: Optional[str] = None
    station_latitude: Optional[float] = None
    station_longitude: Optional[float] = None
    location_text: Optional[str] = None
    liters: float
    station_price_per_liter: float
    payment_currency: str  # "RUB" or "MNT"
    exchange_rate: Optional[float] = None
    payment_receipt_url: str
    admin_bank_id: Optional[str] = None
    # Pre-calculated (validated server-side)
    discount_percent: Optional[int] = None
    gross_amount: Optional[float] = None
    discount_amount: Optional[float] = None
    net_amount: Optional[float] = None
    rounded_amount: Optional[float] = None
    final_amount: Optional[float] = None


class FuelOrderCreateResponse(BaseModel):
    id: str
    invoice: str
    status: str
    gross_amount: float
    discount_percent: int
    discount_amount: float
    net_amount: float
    rounded_amount: float
    final_amount: float
    created_at: datetime


class FuelOrderItem(BaseModel):
    id: str
    invoice: str
    user_id: int
    station_name: str
    dispenser_number: Optional[str] = None
    station_latitude: Optional[float] = None
    station_longitude: Optional[float] = None
    location_text: Optional[str] = None
    liters: float
    station_price_per_liter: float
    discount_percent: int
    gross_amount: float
    discount_amount: float
    net_amount: float
    rounded_amount: float
    payment_currency: str
    exchange_rate: Optional[float] = None
    final_amount: float
    payment_receipt_url: Optional[str] = None
    pump_photo_url: Optional[str] = None
    approval_image_url: Optional[str] = None
    admin_bank_id: Optional[str] = None
    admin_bank_name: Optional[str] = None
    admin_bank_owner: Optional[str] = None
    admin_bank_card: Optional[str] = None
    status: str
    rejection_comment: Optional[str] = None
    admin_comment: Optional[str] = None
    completed_by_admin: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class FuelOrdersResponse(BaseModel):
    orders: list[FuelOrderItem]
    total: int = 0


class FuelAdminActionRequest(BaseModel):
    order_id: str
    status: str  # "approved", "completed", "rejected"
    rejection_comment: Optional[str] = None
    admin_comment: Optional[str] = None
    approval_image_url: Optional[str] = None


class FuelPumpPhotoRequest(BaseModel):
    order_id: str
    pump_photo_url: str


class FuelChatMessageRequest(BaseModel):
    message: Optional[str] = None
    image_url: Optional[str] = None


class FuelChatMessage(BaseModel):
    id: str
    fuel_order_id: str
    sender_type: str  # "user" or "admin"
    sender_id: int
    message: Optional[str] = None
    image_url: Optional[str] = None
    created_at: datetime


class FuelChatMessagesResponse(BaseModel):
    messages: list[FuelChatMessage]


class FuelAdminBankAccount(BaseModel):
    id: str
    bank_name: str
    account_number: Optional[str] = None
    card_number: Optional[str] = None
    phone: Optional[str] = None
    owner_name: str
    currency: str
    is_active: bool = True
    display_order: int = 0
    admin_id: Optional[int] = None
    logo_url: Optional[str] = None
    emoji_id: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class FuelAdminBankAccountsResponse(BaseModel):
    accounts: list[FuelAdminBankAccount]


class FuelShiftAdmin(BaseModel):
    admin_id: int
    admin_name: str
    chat_id: Optional[int] = None


class FuelShiftStatus(BaseModel):
    is_active: bool
    current_admin: Optional[FuelShiftAdmin] = None
    admins: list[FuelShiftAdmin] = []


class FuelShiftUpdateRequest(BaseModel):
    is_active: bool
    admin_id: Optional[int] = None
