from datetime import datetime, timezone, timedelta
from typing import Annotated
from contextlib import asynccontextmanager
import asyncio
import logging
import math
import json
import secrets
import string
from decimal import Decimal, InvalidOperation

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from config import get_settings
from db import get_supabase
from models import (
    AdminActionRequest,
    AdminBankAccount,
    AdminBankAccountsResponse,
    AdminHistoryItem,
    AdminHistoryResponse,
    AdminInboxItem,
    AdminInboxResponse,
    AdminShift,
    AdminShiftResponse,
    AdminUser,
    AdminUsersResponse,
    DEFAULT_MIN_RUB_AMOUNT,
    DEFAULT_MIN_RUB_BUY,
    DEFAULT_OYUNS_PLUS_ENABLED,
    DEFAULT_OYUNS_PLUS_THRESHOLD_RUB,
    DEFAULT_OYUNS_PLUS_POINTS_PER_THRESHOLD,
    DEFAULT_OYUNS_PLUS_REFERRAL_REWARD_POINTS,
    DEFAULT_OYUNS_PLUS_REFERRAL_MAX_USES,
    AppSettingsResponse,
    AppSettingsUpdateRequest,
    AuthRequest,
    AuthResponse,
    BasicRegistrationRequest,
    ExchangeEditableResponse,
    ExchangeCreateRequest,
    ExchangeCreateResponse,
    ExchangeResubmitRequest,
    HealthResponse,
    HistoryItem,
    HistoryResponse,
    KycActionRequest,
    KycItem,
    KycResponse,
    MeResponse,
    OyunsPlusSummaryResponse,
    PresignRequest,
    PresignResponse,
    PromoCodeValidateRequest,
    PromoCodeValidateResponse,
    RateResponse,
    RegistrationRequest,
    ReferralCodeValidateResponse,
    ServiceStatusResponse,
    ShiftCloseRequest,
    UpdateBankInfoRequest,
    ShiftOpenRequest,
    ShiftTransferRequest,
    UpsertUserPayload,
    UserLabelUpdateRequest,
    UserPromoCode,
    UserPromoCodesResponse,
    UserSearchItem,
    UserSearchResponse,
    WorkingHoursConfig,
    WorkingHoursResponse,
    WorkingHoursUpdateRequest,
    # Gift-related models
    GiftCard,
    GiftCardsResponse,
    GiftCreateRequest,
    GiftCreateResponse,
    RecipientLookupResponse,
    PendingGift,
    PendingGiftsResponse,
    SentGift,
    SentGiftsResponse,
    GiftConfirmRequest,
    AdminGift,
    AdminGiftsResponse,
    GiftRejectRequest,
    GiftPreapproveRequest,
    GiftFinalizeRequest,
    # Fuel-related models
    FUEL_STATION_DISCOUNTS,
    FUEL_STATIONS,
    FuelStationItem,
    FuelStationsResponse,
    FuelStationCreateRequest,
    FuelStationUpdateRequest,
    FuelCalculateRequest,
    FuelCalculateResponse,
    FuelOrderCreateRequest,
    FuelOrderCreateResponse,
    FuelOrderItem,
    FuelOrdersResponse,
    FuelAdminActionRequest,
    FuelPumpPhotoRequest,
    FuelChatMessageRequest,
    FuelChatMessage,
    FuelChatMessagesResponse,
    FuelAdminBankAccount,
    FuelAdminBankAccountsResponse,
    FuelShiftAdmin,
    FuelShiftStatus,
    FuelShiftUpdateRequest,
    TournamentGame,
    TournamentGameCreateRequest,
    TournamentGameUpdateRequest,
    TournamentGamesResponse,
    TournamentOverviewResponse,
    TournamentTeam,
    TournamentTeamCreateRequest,
    TournamentTeamUpdateRequest,
    TournamentTeamsResponse,
    TournamentVoteRequest,
    TournamentVoteResponse,
    TournamentVoteStatus,
)
from storage import presign_upload, public_url
from telegram import send_admin_notification, send_user_notification, send_user_photo, send_user_photos
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, "/shared")
from bot_translations import tb
from utils import (
    TelegramAuthError,
    JWTAuthError,
    generate_invoice,
    verify_telegram_init_data,
    create_jwt_token,
    verify_jwt_token,
    log_admin_action,
    debug_telegram_validation,
)

logger = logging.getLogger("uvicorn.error")


VOLUME_DISCOUNT_TIERS: list[tuple[Decimal, Decimal]] = [
    (Decimal("100000"), Decimal("0.3")),
    (Decimal("50000"), Decimal("0.2")),
]
COMPENSATION_PROMO_MAX_RUB = Decimal("30000")

TOURNAMENT_CATEGORIES = {"men", "women"}
TOURNAMENT_VENUES = {"a_hall", "b_hall"}
TOURNAMENT_GAME_STATUSES = {"scheduled", "live", "completed", "cancelled"}
OYUNS_PLUS_LOGO_DEFAULT = "https://ldolpsylyatkxqsgxhkn.supabase.co/storage/v1/object/public/Oyuns%20Finance/OYUNS%20Plus.png"


def _to_decimal(value: object, default: Decimal = Decimal("0")) -> Decimal:
    try:
        if value is None:
            return default
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def _parse_receipt_urls(raw_bill_url: str | None, raw_receipt_id: str | None) -> list[str]:
    urls: list[str] = []
    if raw_bill_url:
        try:
            parsed = json.loads(raw_bill_url)
            if isinstance(parsed, list):
                urls.extend([str(url) for url in parsed if url])
            elif isinstance(parsed, str) and parsed:
                urls.append(parsed)
        except (json.JSONDecodeError, TypeError):
            urls.append(raw_bill_url)

    if raw_receipt_id and raw_receipt_id not in urls:
        urls.insert(0, raw_receipt_id)

    return urls


def _load_latest_rates(client) -> tuple[Decimal, Decimal]:
    rates_res = (
        client.table("bot_rates")
        .select("buy_rate,sell_rate,updated_at,created_at")
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    if not rates_res.data:
        return Decimal("0"), Decimal("0")

    row = rates_res.data[0]
    return _to_decimal(row.get("buy_rate")), _to_decimal(row.get("sell_rate"))


def _get_rub_equivalent(direction: str, amount: Decimal, base_rate: Decimal) -> Decimal:
    if amount <= 0 or base_rate <= 0:
        return Decimal("0")
    if direction.lower() == "buy":
        return amount
    return amount / base_rate


def _get_volume_adjustment(rub_equivalent: Decimal) -> Decimal:
    for threshold, adjustment in VOLUME_DISCOUNT_TIERS:
        if rub_equivalent >= threshold:
            return adjustment
    return Decimal("0")


def _compute_effective_rate(
    *,
    direction: str,
    amount: Decimal,
    base_rate: Decimal,
    promo_discount: Decimal = Decimal("0"),
) -> tuple[Decimal, str, Decimal, Decimal]:
    """Return effective rate and metadata (source, adjustment, rub_equivalent)."""
    if base_rate <= 0:
        return Decimal("0"), "none", Decimal("0"), Decimal("0")

    rub_equivalent = _get_rub_equivalent(direction, amount, base_rate)
    volume_adjustment = _get_volume_adjustment(rub_equivalent)

    adjustment = Decimal("0")
    source = "none"
    if volume_adjustment > 0:
        adjustment = volume_adjustment
        source = "volume"
    elif promo_discount > 0:
        adjustment = promo_discount
        source = "promo"

    effective = base_rate
    if adjustment > 0:
        if direction.lower() == "buy":
            effective = base_rate + adjustment
        else:
            effective = max(Decimal("0"), base_rate - adjustment)

    return effective.quantize(Decimal("0.01")), source, adjustment, rub_equivalent


def _get_user_lang(user_id: int) -> str:
    """Get user's language preference from DB. Returns 'mn' by default."""
    try:
        client = get_supabase()
        res = client.table("users").select("lang").eq("id", user_id).execute()
        if res.data and res.data[0].get("lang"):
            return res.data[0]["lang"]
    except Exception:
        pass
    return "mn"


# Background task for stale transaction reminders
async def stale_transaction_reminder():
    """Send reminder notifications for transactions pending/approved longer than 30 minutes"""
    settings = get_settings()
    client = get_supabase()
    
    while True:
        try:
            await asyncio.sleep(30 * 60)  # Wait 30 minutes
            
            # Calculate threshold time (30 minutes ago) - use Moscow time
            msk_tz = timezone(timedelta(hours=3))
            threshold = datetime.now(msk_tz) - timedelta(minutes=30)
            threshold_str = threshold.isoformat()
            
            # Get stale transactions (pending or approved, not completed/cancelled)
            stale_res = client.table("transactions").select(
                "id, invoice, amount, currency_from, currency_to, status, created_at, user_id"
            ).in_("status", ["pending", "approved"]).lt("created_at", threshold_str).execute()
            
            if not stale_res.data:
                logger.info("No stale transactions found")
                continue
            
            logger.info(f"Found {len(stale_res.data)} stale transactions")
            
            # Get current shift admin
            shift_res = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
            if not shift_res.data or not shift_res.data[0].get("current_admin_id"):
                logger.warning("No shift admin found for stale transaction reminder")
                continue
            
            shift_admin_id = shift_res.data[0].get("current_admin_id")
            
            # Build reminder message
            for tx in stale_res.data:
                invoice = tx.get("invoice", "N/A")
                status = tx.get("status", "unknown")
                amount = tx.get("amount", 0)
                currency_from = tx.get("currency_from", "")
                currency_to = tx.get("currency_to", "")
                created_at = tx.get("created_at", "")
                
                status_emoji = "⏳" if status == "pending" else "✅"
                reminder_text = (
                    f"⏰ <b>САНУУЛГА: Удаан хүлээгдэж буй хүсэлт!</b>\n\n"
                    f"📋 Invoice: <code>{invoice}</code>\n"
                    f"💰 Дүн: <b>{amount}</b> {currency_from} → {currency_to}\n"
                    f"{status_emoji} Төлөв: {status.upper()}\n"
                    f"🕐 Үүсгэсэн: {created_at}\n\n"
                    f"⚠️ Энэ хүсэлт 30 минутаас илүү хугацаанд хүлээгдэж байна!"
                )
                
                # Add reply markup with admin panel link (only for valid public HTTPS URLs)
                reply_markup = None
                if settings.admin_panel_url and "localhost" not in settings.admin_panel_url and settings.admin_panel_url.startswith("https://"):
                    separator = "&" if "?" in settings.admin_panel_url else "?"
                    reply_markup = {
                        "inline_keyboard": [
                            [
                                {
                                    "text": "🔗 Админ хэсэгт харах",
                                    "web_app": {"url": f"{settings.admin_panel_url}{separator}invoice={invoice}"},
                                }
                            ]
                        ]
                    }
                
                send_user_notification(shift_admin_id, reminder_text, reply_markup=reply_markup)
                logger.info(f"Sent stale transaction reminder for invoice {invoice} to admin {shift_admin_id}")
                
                # Small delay between messages to avoid rate limiting
                await asyncio.sleep(0.5)
                
        except Exception as e:
            logger.error(f"Error in stale transaction reminder: {e}")
            await asyncio.sleep(60)  # Wait 1 minute before retrying on error


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan context manager for background tasks"""
    # Start background task
    reminder_task = asyncio.create_task(stale_transaction_reminder())
    logger.info("Started stale transaction reminder background task")
    
    yield
    
    # Cleanup on shutdown
    reminder_task.cancel()
    try:
        await reminder_task
    except asyncio.CancelledError:
        logger.info("Stale transaction reminder task cancelled")


app = FastAPI(title="Oyunsbot WebApp", version="0.1.0", lifespan=lifespan)

# Add validation error handler to log detailed errors
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"Validation error on {request.url.path}: {exc.errors()}")
    logger.error(f"Request body: {exc.body}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": str(exc.body)[:500]}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


# Authentication dependencies - supports both dev mode (mock user) and production (JWT)
async def get_authenticated_user(
    authorization: str = Header(None, alias="Authorization")
):
    """
    Authenticate user from JWT token in Authorization header.
    In dev mode (DEV_MODE=true), falls back to mock user if no token provided.
    """
    from models import AuthenticatedUser
    from utils import verify_jwt_token, JWTAuthError
    
    settings = get_settings()
    
    # Try to extract and verify JWT token
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]  # Remove "Bearer " prefix
        try:
            user = verify_jwt_token(token, settings.jwt_secret)
            return user
        except JWTAuthError as e:
            if settings.dev_mode:
                logger.warning(f"JWT verification failed in dev mode: {e}")
                # Fall through to dev mode fallback
            else:
                raise HTTPException(status_code=401, detail=str(e))
    
    # Dev mode fallback - return mock user
    if settings.dev_mode:
        logger.debug("Dev mode: Using mock user (no valid JWT provided)")
        return AuthenticatedUser(
            id=1932946217,  # Default dev user ID
            first_name="Test",
            last_name="User",
            username="test_user",
        )
    
    # Production mode without valid token - unauthorized
    raise HTTPException(status_code=401, detail="Missing or invalid authorization token")


async def get_fuel_admin_auth(
    authorization: str = Header(None, alias="Authorization"),
    x_fuel_admin_key: str = Header(None, alias="X-Fuel-Admin-Key"),
):
    """
    Authenticate fuel admin via JWT token OR API key.
    Allows fuel admin panel to work outside Telegram (regular browser).
    """
    from models import AuthenticatedUser

    # First try JWT auth
    if authorization and authorization.startswith("Bearer "):
        try:
            return await get_authenticated_user(authorization)
        except HTTPException:
            pass  # Fall through to API key check

    # Then try API key auth
    settings = get_settings()
    if x_fuel_admin_key and settings.fuel_admin_api_key:
        if x_fuel_admin_key == settings.fuel_admin_api_key:
            fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
            admin_id = fuel_admin_ids[0] if fuel_admin_ids else 0
            return AuthenticatedUser(
                id=admin_id,
                first_name="Fuel",
                last_name="Admin",
                username="fuel_admin",
            )
        else:
            raise HTTPException(status_code=401, detail="Invalid fuel admin API key")

    raise HTTPException(status_code=401, detail="Missing authorization token or fuel admin API key")


async def get_oyuns_sags_admin_auth(
    x_oyuns_sags_key: str = Header(None, alias="X-Oyuns-Sags-Key"),
):
    """Standalone Oyuns Sags admin auth via API key only (no Telegram auth)."""
    settings = get_settings()
    expected = (settings.oyuns_sags_admin_api_key or "").strip()

    if not expected:
        raise HTTPException(status_code=500, detail="Oyuns Sags admin API key is not configured")

    if not x_oyuns_sags_key or x_oyuns_sags_key.strip() != expected:
        raise HTTPException(status_code=401, detail="Invalid Oyuns Sags admin API key")

    return {"ok": True}


async def get_jwt_authenticated_user(
    authorization: str = Header(None, alias="Authorization")
):
    """
    Authenticate user from JWT token in Authorization header.
    Same as get_authenticated_user - kept for compatibility.
    """
    return await get_authenticated_user(authorization)


async def require_admin(request: Request):
    """No admin key required in no-auth mode"""
    return True


async def require_admin_user(user=Depends(get_jwt_authenticated_user)):
    """No admin check in no-auth mode - all users are admins"""
    return user


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@app.post("/api/auth", response_model=AuthResponse)
async def authenticate(payload: AuthRequest):
    """
    Authenticate user with Telegram initData and return a JWT token.
    This endpoint should be called ONCE when the app loads.
    All subsequent requests should use the returned JWT token.
    """
    settings = get_settings()
    
    try:
        user = None
        # Check for dev mode bypass
        if settings.dev_mode and payload.init_data.startswith("dev_mode_bypass"):
            try:
                import json
                from models import AuthenticatedUser
                parts = payload.init_data.split(":", 1)
                if len(parts) > 1 and parts[1].strip():
                    user_data = json.loads(parts[1])
                    user = AuthenticatedUser(
                        id=user_data.get("id", 123456789),
                        first_name=user_data.get("first_name", "Dev"),
                        last_name=user_data.get("last_name", "User"),
                        username=user_data.get("username", "dev_user"),
                    )
            except Exception:
                pass
            
            if not user:
                from models import AuthenticatedUser
                user = AuthenticatedUser(
                    id=123456789,
                    first_name="Dev",
                    last_name="User",
                    username="dev_user",
                )
        else:
            # Verify Telegram initData
            user = verify_telegram_init_data(payload.init_data, settings.bot_token)
        
        # Upsert user in database (create if new, update if exists)
        # Only set first_name/last_name for NEW users, don't overwrite registered names
        try:
            client = get_supabase()
            # Check if user already exists
            existing = client.table("users").select("id,first_name").eq("id", user.id).limit(1).execute()
            if existing.data:
                # User exists - only update timestamp
                client.table("users").update({
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", user.id).execute()
            else:
                # New user - create with Telegram names
                user_data = {
                    "id": user.id,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
                client.table("users").insert(user_data).execute()
            logger.info(f"User {user.id} upserted in database")
        except Exception as e:
            # Don't fail auth if DB upsert fails - user can still use the app
            logger.warning(f"Failed to upsert user {user.id} in database: {e}")
        
        # Create JWT token
        token = create_jwt_token(user, settings.jwt_secret)
        
        logger.info(f"User {user.id} authenticated successfully, JWT token issued")
        
        return AuthResponse(
            token=token,
            user=user,
        )
    except TelegramAuthError as exc:
        logger.warning(f"Authentication failed for initData: {exc}")
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/api/auth/debug")
async def auth_debug(payload: AuthRequest):
    """Debug endpoint to verify initData validation details"""
    settings = get_settings()
    return debug_telegram_validation(payload.init_data, settings.bot_token)


@app.get("/api/rates", response_model=RateResponse)
async def get_rates():
    """Public endpoint - no auth required for rates"""
    client = get_supabase()
    # prioritize updated_at desc, fallback to created_at
    res = (
        client.table("bot_rates")
        .select("buy_rate,sell_rate,updated_at,created_at")
        .order("updated_at", desc=True)
        .limit(1)
        .execute()
    )
    if not res.data:
        # Return default rates if none configured
        return RateResponse(buy_rate=0, sell_rate=0, updated_at=None)
    row = res.data[0]
    return RateResponse(
        buy_rate=row.get("buy_rate"),
        sell_rate=row.get("sell_rate"),
        updated_at=row.get("updated_at") or row.get("created_at"),
    )


@app.get("/api/rate-history")
async def get_rate_history(days: int = 30):
    """Public endpoint - daily rates from bot_rates table (latest entry per day)."""
    if days < 1 or days > 365:
        days = 30
    client = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    res = (
        client.table("bot_rates")
        .select("buy_rate,sell_rate,updated_at")
        .gte("updated_at", cutoff)
        .order("updated_at", desc=False)
        .execute()
    )
    # Group by date, keep only the latest entry per day
    daily: dict[str, dict] = {}
    for row in (res.data or []):
        ts = row.get("updated_at", "")
        if not ts:
            continue
        date_key = ts[:10]  # YYYY-MM-DD
        # Data ordered asc, so later entries overwrite earlier ones (keeps latest per day)
        daily[date_key] = {
            "buy_rate": round(float(row["buy_rate"]), 2) if row.get("buy_rate") is not None else None,
            "sell_rate": round(float(row["sell_rate"]), 2) if row.get("sell_rate") is not None else None,
        }

    points = [
        {"date": dk, "buy_rate": d["buy_rate"], "sell_rate": d["sell_rate"]}
        for dk, d in sorted(daily.items())
    ]

    return {"points": points, "days": days}


APP_SETTINGS_KEYS = [
    "min_rub_amount",
    "min_rub_buy",
    "oyuns_plus_enabled",
    "oyuns_plus_threshold_rub",
    "oyuns_plus_points_per_threshold",
    "oyuns_plus_referral_reward_points",
    "oyuns_plus_referral_max_uses",
]


def _safe_int(value: object, default: int) -> int:
    try:
        if value is None:
            return default
        return int(str(value).strip())
    except Exception:
        return default


def _get_app_settings_dict(client, keys: list[str]) -> dict[str, str]:
    res = client.table("app_settings").select("key,value").in_("key", keys).execute()
    return {row["key"]: row["value"] for row in (res.data or [])}


def _get_oyuns_plus_settings(client) -> dict[str, int]:
    settings_dict = _get_app_settings_dict(
        client,
        [
            "oyuns_plus_enabled",
            "oyuns_plus_threshold_rub",
            "oyuns_plus_points_per_threshold",
            "oyuns_plus_referral_reward_points",
            "oyuns_plus_referral_max_uses",
        ],
    )

    enabled_raw = _safe_int(settings_dict.get("oyuns_plus_enabled"), DEFAULT_OYUNS_PLUS_ENABLED)
    threshold_rub = max(1, _safe_int(settings_dict.get("oyuns_plus_threshold_rub"), DEFAULT_OYUNS_PLUS_THRESHOLD_RUB))
    points_per_threshold = max(1, _safe_int(settings_dict.get("oyuns_plus_points_per_threshold"), DEFAULT_OYUNS_PLUS_POINTS_PER_THRESHOLD))
    referral_reward_points = max(0, _safe_int(settings_dict.get("oyuns_plus_referral_reward_points"), DEFAULT_OYUNS_PLUS_REFERRAL_REWARD_POINTS))
    referral_max_uses = max(1, _safe_int(settings_dict.get("oyuns_plus_referral_max_uses"), DEFAULT_OYUNS_PLUS_REFERRAL_MAX_USES))

    return {
        "oyuns_plus_enabled": 1 if enabled_raw > 0 else 0,
        "oyuns_plus_threshold_rub": threshold_rub,
        "oyuns_plus_points_per_threshold": points_per_threshold,
        "oyuns_plus_referral_reward_points": referral_reward_points,
        "oyuns_plus_referral_max_uses": referral_max_uses,
    }


def _calculate_oyuns_plus_points(rub_equivalent: Decimal, oyuns_plus_settings: dict[str, int]) -> int:
    if oyuns_plus_settings.get("oyuns_plus_enabled", 1) <= 0:
        return 0

    if rub_equivalent <= 0:
        return 0

    threshold = Decimal(str(oyuns_plus_settings.get("oyuns_plus_threshold_rub", DEFAULT_OYUNS_PLUS_THRESHOLD_RUB)))
    points_per_threshold = int(oyuns_plus_settings.get("oyuns_plus_points_per_threshold", DEFAULT_OYUNS_PLUS_POINTS_PER_THRESHOLD))
    if threshold <= 0 or points_per_threshold <= 0:
        return 0

    if rub_equivalent < threshold:
        return 0

    # Linear accrual after threshold gate (e.g. 15,000 RUB -> 15 points when 10,000=>10).
    proportional_points = (rub_equivalent * Decimal(points_per_threshold)) / threshold
    points = int(proportional_points)
    return max(0, points)


def _award_oyuns_plus_points_once(
    client,
    *,
    user_id: int,
    source_type: str,
    source_id: str,
    points: int,
    rub_equivalent: Decimal | None = None,
    metadata: dict | None = None,
) -> bool:
    if points == 0:
        return False

    payload = {
        "user_id": user_id,
        "source_type": source_type,
        "source_id": source_id,
        "points": int(points),
        "rub_equivalent": float(rub_equivalent) if rub_equivalent is not None else None,
        "metadata": metadata or {},
    }

    try:
        client.table("oyuns_plus_points_ledger").insert(payload).execute()
        return True
    except Exception as e:
        # Idempotency: ignore duplicate source awards.
        if "duplicate key value" in str(e).lower() or "oyuns_plus_points_ledger_source_unique" in str(e):
            return False
        raise


def _get_oyuns_plus_balance(client, user_id: int) -> int:
    res = client.table("oyuns_plus_points_ledger").select("points").eq("user_id", user_id).execute()
    total = 0
    for row in res.data or []:
        total += _safe_int(row.get("points"), 0)
    return total


def _generate_referral_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _ensure_user_referral_code(client, user_id: int) -> str | None:
    try:
        existing = client.table("users").select("referral_code").eq("id", user_id).limit(1).execute()
        if existing.data:
            current = (existing.data[0].get("referral_code") or "").strip().upper()
            if current:
                return current

        for _ in range(20):
            candidate = _generate_referral_code(8)
            dup = client.table("users").select("id").eq("referral_code", candidate).limit(1).execute()
            if dup.data:
                continue

            client.table("users").update({"referral_code": candidate}).eq("id", user_id).execute()
            return candidate
    except Exception as e:
        logger.warning(f"Referral code generation skipped for user {user_id}: {e}")

    return None


def _validate_referral_code_for_user(client, referral_code: str, user_id: int | None = None) -> ReferralCodeValidateResponse:
    try:
        normalized = "".join(ch for ch in (referral_code or "").upper().strip() if ch.isalnum())
        if not normalized:
            return ReferralCodeValidateResponse(valid=False, message="Referral code is empty")

        inviter_res = (
            client.table("users")
            .select("id,first_name,last_name,referral_code")
            .eq("referral_code", normalized)
            .limit(1)
            .execute()
        )
        if not inviter_res.data:
            return ReferralCodeValidateResponse(valid=False, message="Referral code is invalid")

        inviter = inviter_res.data[0]
        inviter_id = int(inviter.get("id"))
        inviter_name = f"{(inviter.get('last_name') or '').strip()} {(inviter.get('first_name') or '').strip()}".strip() or str(inviter_id)

        if user_id is not None and inviter_id == user_id:
            return ReferralCodeValidateResponse(valid=False, message="You cannot use your own referral code")

        settings = _get_oyuns_plus_settings(client)
        max_uses = settings["oyuns_plus_referral_max_uses"]

        use_res = client.table("users").select("id", count="exact").eq("referred_by_user_id", inviter_id).execute()
        use_count = use_res.count if use_res.count is not None else len(use_res.data or [])
        remaining = max_uses - int(use_count)
        if remaining <= 0:
            return ReferralCodeValidateResponse(
                valid=False,
                message="Referral code usage limit reached",
                inviter_user_id=inviter_id,
                inviter_name=inviter_name,
                remaining_uses=0,
            )

        return ReferralCodeValidateResponse(
            valid=True,
            message="Referral code is valid",
            inviter_user_id=inviter_id,
            inviter_name=inviter_name,
            remaining_uses=remaining,
        )
    except Exception as e:
        logger.warning(f"Referral validation unavailable: {e}")
        return ReferralCodeValidateResponse(valid=False, message="Referral system is temporarily unavailable")


def _normalize_tournament_category(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = (value or "").strip().lower()
    if not normalized:
        return None
    if normalized not in TOURNAMENT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid tournament category")
    return normalized


def _normalize_tournament_venue(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = (value or "").strip().lower()
    if not normalized:
        return None
    if normalized not in TOURNAMENT_VENUES:
        raise HTTPException(status_code=400, detail="Invalid tournament venue")
    return normalized


def _normalize_tournament_game_status(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = (value or "").strip().lower()
    if not normalized:
        return None
    if normalized not in TOURNAMENT_GAME_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid tournament game status")
    return normalized


def _get_oyuns_plus_logo_url(client) -> str:
    settings_dict = _get_app_settings_dict(client, ["oyuns_plus_logo_url"])
    logo_url = (settings_dict.get("oyuns_plus_logo_url") or "").strip()
    return logo_url or OYUNS_PLUS_LOGO_DEFAULT


def _is_tournament_enabled(client) -> bool:
    settings_dict = _get_app_settings_dict(client, ["oyuns_tournament_enabled"])
    enabled_raw = _safe_int(settings_dict.get("oyuns_tournament_enabled"), 1)
    return enabled_raw > 0


def _list_tournament_teams(
    client,
    *,
    category: str | None = None,
    include_inactive: bool = False,
) -> list[TournamentTeam]:
    query = client.table("oyuns_tournament_teams").select("*").order("display_order").order("created_at")
    if category:
        query = query.eq("category", category)
    if not include_inactive:
        query = query.eq("is_active", True)

    teams_res = query.execute()
    team_rows = teams_res.data or []

    vote_rows = client.table("oyuns_tournament_votes").select("team_id").execute().data or []
    votes_by_team: dict[str, int] = {}
    for row in vote_rows:
        team_id = str(row.get("team_id") or "")
        if not team_id:
            continue
        votes_by_team[team_id] = votes_by_team.get(team_id, 0) + 1

    return [
        TournamentTeam(
            id=str(row.get("id")),
            name=row.get("name") or "",
            short_name=row.get("short_name"),
            category=row.get("category") or "",
            logo_url=row.get("logo_url"),
            is_active=bool(row.get("is_active", True)),
            display_order=int(row.get("display_order") or 0),
            votes_count=votes_by_team.get(str(row.get("id")), 0),
        )
        for row in team_rows
    ]


def _list_tournament_games(
    client,
    *,
    category: str | None = None,
    venue: str | None = None,
    status: str | None = None,
    limit: int = 100,
) -> list[TournamentGame]:
    query = client.table("oyuns_tournament_games").select("*").order("starts_at", desc=False).limit(limit)
    if category:
        query = query.eq("category", category)
    if venue:
        query = query.eq("venue", venue)
    if status:
        query = query.eq("status", status)

    games_rows = query.execute().data or []

    team_ids: list[str] = []
    for row in games_rows:
        home_id = str(row.get("home_team_id") or "")
        away_id = str(row.get("away_team_id") or "")
        if home_id:
            team_ids.append(home_id)
        if away_id:
            team_ids.append(away_id)

    team_map: dict[str, dict] = {}
    unique_team_ids = sorted(set(team_ids))
    if unique_team_ids:
        teams_rows = (
            client
            .table("oyuns_tournament_teams")
            .select("id,name,logo_url")
            .in_("id", unique_team_ids)
            .execute()
            .data
            or []
        )
        team_map = {str(team.get("id")): team for team in teams_rows}

    items: list[TournamentGame] = []
    for row in games_rows:
        home_team_id = str(row.get("home_team_id") or "")
        away_team_id = str(row.get("away_team_id") or "")
        home_team = team_map.get(home_team_id, {})
        away_team = team_map.get(away_team_id, {})

        items.append(
            TournamentGame(
                id=str(row.get("id")),
                category=row.get("category") or "",
                venue=row.get("venue") or "",
                home_team_id=home_team_id,
                away_team_id=away_team_id,
                starts_at=row.get("starts_at"),
                status=row.get("status") or "scheduled",
                home_score=_safe_int(row.get("home_score"), 0),
                away_score=_safe_int(row.get("away_score"), 0),
                is_featured=bool(row.get("is_featured", False)),
                home_team_name=home_team.get("name"),
                away_team_name=away_team.get("name"),
                home_team_logo_url=home_team.get("logo_url"),
                away_team_logo_url=away_team.get("logo_url"),
            )
        )

    return items


def _list_user_tournament_votes(client, user_id: int) -> list[TournamentVoteStatus]:
    votes_rows = (
        client
        .table("oyuns_tournament_votes")
        .select("category,team_id")
        .eq("user_id", user_id)
        .execute()
        .data
        or []
    )
    vote_map = {str(row.get("category") or ""): str(row.get("team_id") or "") for row in votes_rows}

    return [
        TournamentVoteStatus(category="men", team_id=vote_map.get("men") or None, voted=bool(vote_map.get("men"))),
        TournamentVoteStatus(category="women", team_id=vote_map.get("women") or None, voted=bool(vote_map.get("women"))),
    ]


def _get_tournament_team_or_404(client, team_id: str) -> dict:
    team_res = (
        client
        .table("oyuns_tournament_teams")
        .select("*")
        .eq("id", team_id)
        .limit(1)
        .execute()
    )
    if not team_res.data:
        raise HTTPException(status_code=404, detail="Tournament team not found")
    return team_res.data[0]


def _get_tournament_game_or_404(client, game_id: str) -> dict:
    game_res = (
        client
        .table("oyuns_tournament_games")
        .select("*")
        .eq("id", game_id)
        .limit(1)
        .execute()
    )
    if not game_res.data:
        raise HTTPException(status_code=404, detail="Tournament game not found")
    return game_res.data[0]


@app.get("/api/settings", response_model=AppSettingsResponse)
async def get_app_settings():
    """Public endpoint - fetch configurable app settings"""
    client = get_supabase()
    settings_dict = _get_app_settings_dict(client, APP_SETTINGS_KEYS)
    oyuns_plus = _get_oyuns_plus_settings(client)

    return AppSettingsResponse(
        min_rub_amount=max(0, _safe_int(settings_dict.get("min_rub_amount"), DEFAULT_MIN_RUB_AMOUNT)),
        min_rub_buy=max(0, _safe_int(settings_dict.get("min_rub_buy"), DEFAULT_MIN_RUB_BUY)),
        oyuns_plus_enabled=oyuns_plus["oyuns_plus_enabled"],
        oyuns_plus_threshold_rub=oyuns_plus["oyuns_plus_threshold_rub"],
        oyuns_plus_points_per_threshold=oyuns_plus["oyuns_plus_points_per_threshold"],
        oyuns_plus_referral_reward_points=oyuns_plus["oyuns_plus_referral_reward_points"],
        oyuns_plus_referral_max_uses=oyuns_plus["oyuns_plus_referral_max_uses"],
    )


@app.put("/api/admin/settings", response_model=AppSettingsResponse)
async def update_app_settings(
    payload: AppSettingsUpdateRequest,
    admin=Depends(require_admin),
):
    """Admin endpoint - update exchange limit settings"""
    client = get_supabase()
    allowed_keys = {
        "min_rub_amount",
        "min_rub_buy",
        "oyuns_plus_enabled",
        "oyuns_plus_threshold_rub",
        "oyuns_plus_points_per_threshold",
        "oyuns_plus_referral_reward_points",
        "oyuns_plus_referral_max_uses",
    }

    updates = payload.model_dump(exclude_none=True)
    for key, value in updates.items():
        if key not in allowed_keys:
            continue
        if key == "oyuns_plus_enabled":
            if value not in (0, 1):
                raise HTTPException(status_code=400, detail="oyuns_plus_enabled must be 0 or 1")
        elif key in {"oyuns_plus_threshold_rub", "oyuns_plus_points_per_threshold", "oyuns_plus_referral_max_uses"}:
            if value <= 0:
                raise HTTPException(status_code=400, detail=f"{key} must be > 0")
        elif value < 0:
            raise HTTPException(status_code=400, detail=f"{key} must be >= 0")

        client.table("app_settings").upsert(
            {"key": key, "value": str(value)},
            on_conflict="key",
        ).execute()

    return await get_app_settings()


def moscow_to_ub_hour(moscow_hour: int) -> int:
    """Convert Moscow time hour to Ulaanbaatar time (Moscow + 5 hours)."""
    return (moscow_hour + 5) % 24


def format_working_hours_ub(start_moscow: int, end_moscow: int) -> str:
    """Format working hours in UB time."""
    start_ub = moscow_to_ub_hour(start_moscow)
    end_ub = moscow_to_ub_hour(end_moscow)
    return f"{start_ub:02d}:00 - {end_ub:02d}:00 (УБ)"


def _compute_service_status(client) -> dict:
    """Compute current service status from working-hours and shift settings."""
    from zoneinfo import ZoneInfo

    hours_res = client.table("working_hours").select("*").eq("id", 1).limit(1).execute()
    if hours_res.data:
        hours_config = hours_res.data[0]
        start_hour = hours_config.get("start_hour_moscow", 4)
        end_hour = hours_config.get("end_hour_moscow", 23)
        is_enabled = hours_config.get("is_enabled", True)
    else:
        start_hour = 4
        end_hour = 23
        is_enabled = True

    moscow_tz = ZoneInfo("Europe/Moscow")
    now_moscow = datetime.now(moscow_tz)
    hour_moscow = now_moscow.hour

    if start_hour < end_hour:
        is_within_hours = start_hour <= hour_moscow < end_hour
    else:
        is_within_hours = hour_moscow >= start_hour or hour_moscow < end_hour

    if not is_enabled:
        is_within_hours = False

    shift_res = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    is_shift_active = bool(shift_res.data and shift_res.data[0].get("current_admin_id"))

    is_open = is_within_hours and is_shift_active
    working_hours_str = format_working_hours_ub(start_hour, end_hour)

    if not is_enabled:
        message = "Үйлчилгээ түр хаалттай байна"
    elif not is_within_hours:
        message = f"Ажлын цаг: {working_hours_str} / {start_hour:02d}:00 - {end_hour:02d}:00 (Москва)"
    elif not is_shift_active:
        message = "Одоогоор админ ээлжинд алга байна"
    else:
        message = None

    return {
        "is_open": is_open,
        "is_within_hours": is_within_hours,
        "is_shift_active": is_shift_active,
        "working_hours": working_hours_str,
        "message": message,
    }


def _require_service_open(client) -> None:
    status = _compute_service_status(client)
    if not status["is_open"]:
        raise HTTPException(status_code=403, detail=status["message"] or "Service is currently closed")


@app.get("/api/service-status", response_model=ServiceStatusResponse)
async def get_service_status():
    """Public endpoint - check if service is open (within working hours AND shift is active).
    Working hours are configured dynamically via admin panel.
    """
    client = get_supabase()
    status = _compute_service_status(client)
    return ServiceStatusResponse(**status)


@app.post("/api/storage/presign", response_model=PresignResponse)
async def create_presigned_url(
    payload: PresignRequest,
    user=Depends(get_jwt_authenticated_user),
):
    settings = get_settings()
    client = get_supabase()
    bucket = payload.bucket
    if bucket not in {settings.storage_bucket_passports, settings.storage_bucket_receipts}:
        raise HTTPException(status_code=400, detail="Invalid bucket")
    signed_url, ttl = presign_upload(client, bucket, payload.path, payload.expires_in)
    public = public_url(client, bucket, payload.path)
    return PresignResponse(upload_url=signed_url, public_url=public, expires_in=ttl, path=payload.path)


@app.get("/api/active-transactions")
async def get_active_transactions(user=Depends(get_jwt_authenticated_user)):
    """Get user's active (pending/approved) and recently completed/rejected transactions."""
    client = get_supabase()
    # Get active and recently closed transactions (include legacy 'successful').
    res = (
        client.table("transactions")
        .select("invoice,amount,currency_from,currency_to,status,timestamp,admin_comment,rejection_comment")
        .eq("user_id", user.id)
        .in_("status", ["pending", "approved", "waiting_edit", "completed", "successful", "rejected"])
        .order("timestamp", desc=True)
        .limit(10)
        .execute()
    )
    
    # Filter to only pending/approved or recently (within 24h) completed/successful/rejected
    from datetime import datetime, timedelta
    now = datetime.now()
    items = []
    for row in res.data or []:
        status = row.get("status")
        if not row.get("admin_comment") and row.get("rejection_comment"):
            row["admin_comment"] = row.get("rejection_comment")

        if status == "waiting_edit":
            row["can_edit"] = True
            items.append(row)
        elif status in ["pending", "approved"]:
            row["can_edit"] = False
            items.append(row)
        elif status in ["completed", "successful", "rejected"]:
            # Include if completed/successful/rejected within last 24 hours
            timestamp_str = row.get("timestamp", "")
            if timestamp_str:
                try:
                    timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    if (now.astimezone() - timestamp).total_seconds() < 86400:  # 24 hours
                        row["can_edit"] = False
                        items.append(row)
                except:
                    pass
    
    return {"transactions": items}


@app.get("/api/history", response_model=HistoryResponse)
async def history(user=Depends(get_jwt_authenticated_user)):
    client = get_supabase()
    res = (
        client.table("transactions")
        .select(
            "invoice,amount,currency_from,currency_to,status,timestamp,rate,bill_url,receipt_id,admin_comment,rejection_comment"
        )
        .eq("user_id", user.id)
        .order("timestamp", desc=True)
        .limit(50)
        .execute()
    )
    items = [
        HistoryItem(
            invoice=row.get("invoice"),
            amount=row.get("amount"),
            currency_from=row.get("currency_from"),
            currency_to=row.get("currency_to"),
            status=row.get("status"),
            timestamp=row.get("timestamp"),
            rate=row.get("rate"),
            bill_url=row.get("bill_url"),
            receipt_id=row.get("receipt_id"),
            admin_comment=row.get("admin_comment") or row.get("rejection_comment"),
        )
        for row in res.data or []
    ]
    return HistoryResponse(items=items)


@app.get("/api/analytics")
async def get_analytics(user=Depends(get_jwt_authenticated_user)):
    """Get transaction analytics for the user - monthly spending by direction."""
    try:
        from zoneinfo import ZoneInfo
        from collections import defaultdict
        
        client = get_supabase()
        moscow_tz = ZoneInfo("Europe/Moscow")
        
        # Get all transactions for this user (include all statuses except rejected)
        res = (
            client.table("transactions")
            .select("amount,currency_from,currency_to,timestamp,status")
            .eq("user_id", user.id)
            .order("timestamp", desc=False)
            .execute()
        )
        
        logger.info(f"Analytics: Found {len(res.data or [])} transactions for user {user.id}")
    
        if not res.data:
            return {
                "monthly_buy": [],
                "monthly_sell": [],
                "total_buy_rub": 0,
                "total_sell_rub": 0,
                "total_transactions": 0,
            }
        
        # Filter out rejected transactions
        valid_transactions = [t for t in res.data if t.get("status", "").lower() != "rejected"]
        logger.info(f"Analytics: {len(valid_transactions)} valid transactions (non-rejected)")
        
        # Group by month and direction (inferred from currency_from)
        monthly_buy = defaultdict(float)
        monthly_sell = defaultdict(float)
        total_buy_rub = 0
        total_sell_rub = 0
        
        for trx in valid_transactions:
            try:
                timestamp_str = trx.get("timestamp", "")
                if not timestamp_str:
                    continue
                timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                month_key = timestamp.strftime("%Y-%m")  # Format: "2026-01"
                
                amount = float(trx.get("amount", 0) or 0)
                currency_from = (trx.get("currency_from", "") or "").upper()
                
                logger.debug(f"Analytics trx: {amount} {currency_from}, month={month_key}")
                
                # Infer direction from currency_from (case-insensitive)
                if currency_from == "RUB":
                    # User buying MNT with RUB (RUB -> MNT)
                    monthly_buy[month_key] += amount
                    total_buy_rub += amount
                elif currency_from == "MNT":
                    # User selling MNT for RUB (MNT -> RUB)
                    monthly_sell[month_key] += amount
                    total_sell_rub += amount
                        
            except Exception as e:
                logger.error(f"Error processing transaction for analytics: {e}")
                continue
        
        # Convert to sorted list format for frontend
        all_months = sorted(set(list(monthly_buy.keys()) + list(monthly_sell.keys())))
        
        monthly_buy_data = [
            {"month": month, "amount": round(monthly_buy.get(month, 0), 2)}
            for month in all_months
        ]
        
        monthly_sell_data = [
            {"month": month, "amount": round(monthly_sell.get(month, 0), 2)}
            for month in all_months
        ]
        
        return {
            "monthly_buy": monthly_buy_data,
            "monthly_sell": monthly_sell_data,
            "total_buy_rub": round(total_buy_rub, 2),
            "total_sell_rub": round(total_sell_rub, 2),
            "total_transactions": len(res.data),
        }
    except Exception as e:
        logger.error(f"Analytics error: {e}")
        # Return empty analytics on error
        return {
            "monthly_buy": [],
            "monthly_sell": [],
            "total_buy_rub": 0,
            "total_sell_rub": 0,
            "total_transactions": 0,
        }


@app.get("/api/me", response_model=MeResponse)
async def me(user=Depends(get_jwt_authenticated_user)):
    from zoneinfo import ZoneInfo
    
    settings = get_settings()
    client = get_supabase()
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz).isoformat()
    
    # Check if user already exists - don't overwrite registered names
    existing = client.table("users").select("id,first_name").eq("id", user.id).limit(1).execute()
    if existing.data:
        # User exists - only update timestamp
        client.table("users").update({"updated_at": now}).eq("id", user.id).execute()
    else:
        # New user - create with Telegram names
        upsert_payload = {
            "id": user.id,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "updated_at": now,
        }
        client.table("users").insert(upsert_payload).execute()

    # Ensure the user always has a personal referral code for web flow.
    _ensure_user_referral_code(client, user.id)
    
    db_user = client.table("users").select("*").eq("id", user.id).limit(1).execute().data
    record = db_user[0] if db_user else {"id": user.id, "first_name": user.first_name, "last_name": user.last_name}
    
    # Add is_admin flag to response
    is_admin = user.id in settings.admin_user_ids
    
    # Log admin panel access
    if is_admin:
        log_admin_action(
            client=client,
            admin_user_id=user.id,
            action_type="panel_access",
            target_type="system",
            target_id="admin_panel",
            details={
                "first_name": user.first_name,
                "last_name": user.last_name,
                "username": user.username
            }
        )
    
    return MeResponse(user=UpsertUserPayload(**record), is_admin=is_admin)


@app.get("/api/referral/validate", response_model=ReferralCodeValidateResponse)
async def validate_referral_code(code: str, user=Depends(get_jwt_authenticated_user)):
    client = get_supabase()
    return _validate_referral_code_for_user(client, code, user.id)


@app.get("/api/oyuns-plus/summary", response_model=OyunsPlusSummaryResponse)
async def oyuns_plus_summary(user=Depends(get_jwt_authenticated_user)):
    client = get_supabase()
    settings = _get_oyuns_plus_settings(client)

    referral_code = _ensure_user_referral_code(client, user.id)
    uses_res = client.table("users").select("id", count="exact").eq("referred_by_user_id", user.id).execute()
    referral_uses = uses_res.count if uses_res.count is not None else len(uses_res.data or [])
    verified_res = (
        client.table("users")
        .select("id", count="exact")
        .eq("referred_by_user_id", user.id)
        .eq("verified", True)
        .execute()
    )
    invited_verified = verified_res.count if verified_res.count is not None else len(verified_res.data or [])
    referral_max_uses = settings["oyuns_plus_referral_max_uses"]

    points_balance = _get_oyuns_plus_balance(client, user.id)

    return OyunsPlusSummaryResponse(
        enabled=bool(settings["oyuns_plus_enabled"]),
        points_balance=points_balance,
        point_value_rub=1,
        threshold_rub=settings["oyuns_plus_threshold_rub"],
        points_per_threshold=settings["oyuns_plus_points_per_threshold"],
        referral_reward_points=settings["oyuns_plus_referral_reward_points"],
        referral_max_uses=referral_max_uses,
        referral_code=referral_code,
        referral_uses=referral_uses,
        referral_uses_remaining=max(0, referral_max_uses - int(referral_uses)),
        invited_total=referral_uses,
        invited_verified=invited_verified,
    )


@app.get("/api/tournament/overview", response_model=TournamentOverviewResponse)
async def tournament_overview(
    category: str | None = None,
    venue: str | None = None,
    status: str | None = None,
):
    client = get_supabase()
    normalized_category = _normalize_tournament_category(category)
    normalized_venue = _normalize_tournament_venue(venue)
    normalized_status = _normalize_tournament_game_status(status)

    if not _is_tournament_enabled(client):
        return TournamentOverviewResponse(enabled=False, logo_url=_get_oyuns_plus_logo_url(client), teams=[], games=[], votes=[])

    try:
        teams = _list_tournament_teams(client, category=normalized_category, include_inactive=False)
        games = _list_tournament_games(
            client,
            category=normalized_category,
            venue=normalized_venue,
            status=normalized_status,
            limit=200,
        )
        return TournamentOverviewResponse(
            enabled=True,
            logo_url=_get_oyuns_plus_logo_url(client),
            teams=teams,
            games=games,
            votes=[],
        )
    except Exception as e:
        logger.error(f"Failed to build tournament overview: {e}")
        return TournamentOverviewResponse(enabled=False, logo_url=_get_oyuns_plus_logo_url(client), teams=[], games=[], votes=[])


@app.get("/api/tournament/my-votes", response_model=list[TournamentVoteStatus])
async def tournament_my_votes(user=Depends(get_jwt_authenticated_user)):
    client = get_supabase()
    if not _is_tournament_enabled(client):
        return [
            TournamentVoteStatus(category="men", team_id=None, voted=False),
            TournamentVoteStatus(category="women", team_id=None, voted=False),
        ]
    return _list_user_tournament_votes(client, user.id)


@app.post("/api/tournament/vote", response_model=TournamentVoteResponse)
async def tournament_vote(payload: TournamentVoteRequest, user=Depends(get_jwt_authenticated_user)):
    client = get_supabase()
    if not _is_tournament_enabled(client):
        raise HTTPException(status_code=403, detail="Tournament voting is disabled")

    category = _normalize_tournament_category(payload.category)
    team = _get_tournament_team_or_404(client, payload.team_id)

    if category != (team.get("category") or "").lower():
        raise HTTPException(status_code=400, detail="Team category mismatch")
    if not bool(team.get("is_active", True)):
        raise HTTPException(status_code=400, detail="Cannot vote for inactive team")

    existing_vote = (
        client
        .table("oyuns_tournament_votes")
        .select("team_id")
        .eq("user_id", user.id)
        .eq("category", category)
        .limit(1)
        .execute()
    )
    if existing_vote.data:
        current_team_id = str(existing_vote.data[0].get("team_id") or "")
        raise HTTPException(status_code=409, detail=f"Vote already submitted for {category}")

    client.table("oyuns_tournament_votes").insert({
        "user_id": user.id,
        "category": category,
        "team_id": payload.team_id,
    }).execute()

    return TournamentVoteResponse(
        ok=True,
        message="Санал бүртгэгдсэн",
        vote=TournamentVoteStatus(category=category, team_id=payload.team_id, voted=True),
    )


@app.get("/api/oyuns-sags/admin/teams", response_model=TournamentTeamsResponse)
async def oyuns_sags_admin_teams(
    category: str | None = None,
    include_inactive: bool = True,
    admin=Depends(get_oyuns_sags_admin_auth),
):
    client = get_supabase()
    normalized_category = _normalize_tournament_category(category)
    items = _list_tournament_teams(client, category=normalized_category, include_inactive=include_inactive)
    return TournamentTeamsResponse(items=items)


@app.post("/api/oyuns-sags/admin/teams", response_model=TournamentTeam)
async def oyuns_sags_admin_create_team(
    payload: TournamentTeamCreateRequest,
    admin=Depends(get_oyuns_sags_admin_auth),
):
    client = get_supabase()
    category = _normalize_tournament_category(payload.category)

    now = datetime.now(timezone.utc).isoformat()
    insert_payload = {
        "name": payload.name.strip(),
        "short_name": (payload.short_name or "").strip() or None,
        "category": category,
        "logo_url": (payload.logo_url or "").strip() or None,
        "is_active": bool(payload.is_active),
        "display_order": int(payload.display_order),
        "created_at": now,
        "updated_at": now,
    }
    created = client.table("oyuns_tournament_teams").insert(insert_payload).execute().data
    if not created:
        raise HTTPException(status_code=500, detail="Failed to create tournament team")

    team_row = created[0]
    return TournamentTeam(
        id=str(team_row.get("id")),
        name=team_row.get("name") or "",
        short_name=team_row.get("short_name"),
        category=team_row.get("category") or "",
        logo_url=team_row.get("logo_url"),
        is_active=bool(team_row.get("is_active", True)),
        display_order=_safe_int(team_row.get("display_order"), 0),
        votes_count=0,
    )


@app.put("/api/oyuns-sags/admin/teams/{team_id}", response_model=TournamentTeam)
async def oyuns_sags_admin_update_team(
    team_id: str,
    payload: TournamentTeamUpdateRequest,
    admin=Depends(get_oyuns_sags_admin_auth),
):
    client = get_supabase()
    _get_tournament_team_or_404(client, team_id)

    updates = payload.model_dump(exclude_none=True)
    if "category" in updates:
        updates["category"] = _normalize_tournament_category(updates["category"])
    if "name" in updates:
        updates["name"] = (updates["name"] or "").strip()
    if "short_name" in updates:
        updates["short_name"] = (updates["short_name"] or "").strip() or None
    if "logo_url" in updates:
        updates["logo_url"] = (updates["logo_url"] or "").strip() or None
    if "display_order" in updates:
        updates["display_order"] = int(updates["display_order"])

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    client.table("oyuns_tournament_teams").update(updates).eq("id", team_id).execute()

    team_row = _get_tournament_team_or_404(client, team_id)
    votes_count = (
        client
        .table("oyuns_tournament_votes")
        .select("id", count="exact")
        .eq("team_id", team_id)
        .execute()
        .count
        or 0
    )

    return TournamentTeam(
        id=str(team_row.get("id")),
        name=team_row.get("name") or "",
        short_name=team_row.get("short_name"),
        category=team_row.get("category") or "",
        logo_url=team_row.get("logo_url"),
        is_active=bool(team_row.get("is_active", True)),
        display_order=_safe_int(team_row.get("display_order"), 0),
        votes_count=_safe_int(votes_count, 0),
    )


@app.delete("/api/oyuns-sags/admin/teams/{team_id}")
async def oyuns_sags_admin_delete_team(
    team_id: str,
    admin=Depends(get_oyuns_sags_admin_auth),
):
    client = get_supabase()
    _get_tournament_team_or_404(client, team_id)
    client.table("oyuns_tournament_teams").update({
        "is_active": False,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", team_id).execute()
    return {"ok": True}


@app.get("/api/oyuns-sags/admin/games", response_model=TournamentGamesResponse)
async def oyuns_sags_admin_games(
    category: str | None = None,
    venue: str | None = None,
    status: str | None = None,
    admin=Depends(get_oyuns_sags_admin_auth),
):
    client = get_supabase()
    normalized_category = _normalize_tournament_category(category)
    normalized_venue = _normalize_tournament_venue(venue)
    normalized_status = _normalize_tournament_game_status(status)

    items = _list_tournament_games(
        client,
        category=normalized_category,
        venue=normalized_venue,
        status=normalized_status,
        limit=500,
    )
    return TournamentGamesResponse(items=items)


@app.post("/api/oyuns-sags/admin/games", response_model=TournamentGame)
async def oyuns_sags_admin_create_game(
    payload: TournamentGameCreateRequest,
    admin=Depends(get_oyuns_sags_admin_auth),
):
    client = get_supabase()
    category = _normalize_tournament_category(payload.category)
    venue = _normalize_tournament_venue(payload.venue)
    status = _normalize_tournament_game_status(payload.status) or "scheduled"

    if payload.home_team_id == payload.away_team_id:
        raise HTTPException(status_code=400, detail="Home and away teams must be different")

    home_team = _get_tournament_team_or_404(client, payload.home_team_id)
    away_team = _get_tournament_team_or_404(client, payload.away_team_id)
    if (home_team.get("category") or "").lower() != category or (away_team.get("category") or "").lower() != category:
        raise HTTPException(status_code=400, detail="Selected teams must match game category")

    now = datetime.now(timezone.utc).isoformat()
    insert_payload = {
        "category": category,
        "venue": venue,
        "home_team_id": payload.home_team_id,
        "away_team_id": payload.away_team_id,
        "starts_at": payload.starts_at.isoformat(),
        "status": status,
        "home_score": max(0, int(payload.home_score)),
        "away_score": max(0, int(payload.away_score)),
        "is_featured": bool(payload.is_featured),
        "created_at": now,
        "updated_at": now,
    }

    created = client.table("oyuns_tournament_games").insert(insert_payload).execute().data
    if not created:
        raise HTTPException(status_code=500, detail="Failed to create tournament game")

    game_id = str(created[0].get("id"))
    games = _list_tournament_games(client, limit=500)
    game = next((item for item in games if item.id == game_id), None)
    if not game:
        raise HTTPException(status_code=500, detail="Created game could not be loaded")
    return game


@app.put("/api/oyuns-sags/admin/games/{game_id}", response_model=TournamentGame)
async def oyuns_sags_admin_update_game(
    game_id: str,
    payload: TournamentGameUpdateRequest,
    admin=Depends(get_oyuns_sags_admin_auth),
):
    client = get_supabase()
    current = _get_tournament_game_or_404(client, game_id)

    updates = payload.model_dump(exclude_none=True)
    if "category" in updates:
        updates["category"] = _normalize_tournament_category(updates["category"])
    if "venue" in updates:
        updates["venue"] = _normalize_tournament_venue(updates["venue"])
    if "status" in updates:
        updates["status"] = _normalize_tournament_game_status(updates["status"])
    if "starts_at" in updates:
        updates["starts_at"] = updates["starts_at"].isoformat()
    if "home_score" in updates:
        updates["home_score"] = max(0, int(updates["home_score"]))
    if "away_score" in updates:
        updates["away_score"] = max(0, int(updates["away_score"]))

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    next_category = updates.get("category") or current.get("category")
    next_home = updates.get("home_team_id") or current.get("home_team_id")
    next_away = updates.get("away_team_id") or current.get("away_team_id")
    if str(next_home) == str(next_away):
        raise HTTPException(status_code=400, detail="Home and away teams must be different")

    home_team = _get_tournament_team_or_404(client, str(next_home))
    away_team = _get_tournament_team_or_404(client, str(next_away))
    if (home_team.get("category") or "").lower() != str(next_category).lower() or (away_team.get("category") or "").lower() != str(next_category).lower():
        raise HTTPException(status_code=400, detail="Selected teams must match game category")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    client.table("oyuns_tournament_games").update(updates).eq("id", game_id).execute()

    games = _list_tournament_games(client, limit=500)
    game = next((item for item in games if item.id == game_id), None)
    if not game:
        raise HTTPException(status_code=500, detail="Updated game could not be loaded")
    return game


@app.delete("/api/oyuns-sags/admin/games/{game_id}")
async def oyuns_sags_admin_delete_game(
    game_id: str,
    admin=Depends(get_oyuns_sags_admin_auth),
):
    client = get_supabase()
    _get_tournament_game_or_404(client, game_id)
    client.table("oyuns_tournament_games").delete().eq("id", game_id).execute()
    return {"ok": True}


@app.get("/api/oyuns-sags/admin/votes")
async def oyuns_sags_admin_votes(admin=Depends(get_oyuns_sags_admin_auth)):
    client = get_supabase()
    teams = _list_tournament_teams(client, include_inactive=True)
    teams_sorted = sorted(teams, key=lambda item: (item.category, -item.votes_count, item.display_order, item.name.lower()))
    total_votes = sum(item.votes_count for item in teams_sorted)
    return {
        "items": [item.model_dump() for item in teams_sorted],
        "total_votes": total_votes,
    }


@app.get("/api/oyuns-sags/admin/settings")
async def oyuns_sags_admin_get_settings(admin=Depends(get_oyuns_sags_admin_auth)):
    client = get_supabase()
    settings_dict = _get_app_settings_dict(client, ["oyuns_tournament_enabled", "oyuns_plus_logo_url"])
    enabled = _safe_int(settings_dict.get("oyuns_tournament_enabled"), 1)
    logo_url = (settings_dict.get("oyuns_plus_logo_url") or "").strip() or OYUNS_PLUS_LOGO_DEFAULT
    return {
        "oyuns_tournament_enabled": 1 if enabled > 0 else 0,
        "oyuns_plus_logo_url": logo_url,
    }


@app.put("/api/oyuns-sags/admin/settings")
async def oyuns_sags_admin_update_settings(payload: dict, admin=Depends(get_oyuns_sags_admin_auth)):
    client = get_supabase()
    updates: dict[str, str] = {}

    if "oyuns_tournament_enabled" in payload:
        enabled_raw = 1 if _safe_int(payload.get("oyuns_tournament_enabled"), 0) > 0 else 0
        updates["oyuns_tournament_enabled"] = str(enabled_raw)

    if "oyuns_plus_logo_url" in payload:
        logo_url = str(payload.get("oyuns_plus_logo_url") or "").strip() or OYUNS_PLUS_LOGO_DEFAULT
        updates["oyuns_plus_logo_url"] = logo_url

    if not updates:
        raise HTTPException(status_code=400, detail="No supported settings to update")

    for key, value in updates.items():
        client.table("app_settings").upsert({"key": key, "value": value}, on_conflict="key").execute()

    return await oyuns_sags_admin_get_settings()


@app.post("/api/agree-terms")
async def agree_terms(user=Depends(get_jwt_authenticated_user)):
    """Record that user has agreed to terms of service."""
    from zoneinfo import ZoneInfo
    
    client = get_supabase()
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz).isoformat()
    
    client.table("users").update({
        "agreed_terms": True,
        "updated_at": now,
    }).eq("id", user.id).execute()
    
    return {"ok": True, "agreed_terms": True}


@app.post("/api/register-basic")
async def register_basic(
    payload: BasicRegistrationRequest,
    user=Depends(get_jwt_authenticated_user),
):
    """Level 1 registration - minimal info, immediate account creation without admin approval."""
    import re
    from zoneinfo import ZoneInfo

    client = get_supabase()
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz).isoformat()

    # Check if user already has a higher verification level
    existing = client.table("users").select("verification_level").eq("id", user.id).limit(1).execute()
    if existing.data and existing.data[0].get("verification_level", 0) >= 1:
        raise HTTPException(status_code=400, detail="User already registered")

    existing_referred_by_user_id = None
    existing_referred_by_code = None
    try:
        referral_existing = (
            client.table("users")
            .select("referred_by_user_id,referred_by_code")
            .eq("id", user.id)
            .limit(1)
            .execute()
        )
        if referral_existing.data:
            existing_referred_by_user_id = referral_existing.data[0].get("referred_by_user_id")
            existing_referred_by_code = referral_existing.data[0].get("referred_by_code")
    except Exception:
        existing_referred_by_user_id = None
        existing_referred_by_code = None

    normalized_referral_code = "".join(ch for ch in (payload.referral_code or "").upper().strip() if ch.isalnum())
    referred_by_user_id = existing_referred_by_user_id
    referred_by_code = existing_referred_by_code

    if normalized_referral_code:
        validation = _validate_referral_code_for_user(client, normalized_referral_code, user.id)
        if not validation.valid or not validation.inviter_user_id:
            raise HTTPException(status_code=400, detail=validation.message or "Invalid referral code")

        if existing_referred_by_user_id and int(existing_referred_by_user_id) != int(validation.inviter_user_id):
            raise HTTPException(status_code=400, detail="User already has a referral inviter")

        referred_by_user_id = int(validation.inviter_user_id)
        referred_by_code = normalized_referral_code

    update_payload = {
        "first_name": payload.first_name,
        "last_name": payload.last_name,
        "phone_intl": payload.phone_intl,
        "verification_level": 1,
        "agreed_terms": True,
        "updated_at": now,
    }

    # If the number is Mongolian (+976), also store the 8-digit local part in phone_mnt
    if payload.phone_intl.startswith("+976"):
        digits_only = re.sub(r"\D", "", payload.phone_intl.replace("+976", ""))
        if len(digits_only) >= 8:
            update_payload["phone_mnt"] = digits_only[-8:]

    if payload.email:
        update_payload["email"] = payload.email

    if referred_by_user_id:
        update_payload["referred_by_user_id"] = referred_by_user_id
        update_payload["referred_by_code"] = referred_by_code

    result = client.table("users").update(update_payload).eq("id", user.id).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to submit basic registration")

    _ensure_user_referral_code(client, user.id)

    return {"ok": True, "message": "Basic registration completed", "verification_level": 1}


@app.post("/api/register")
async def register_user(
    payload: RegistrationRequest,
    user=Depends(get_jwt_authenticated_user),
):
    """Submit user registration for verification."""
    from zoneinfo import ZoneInfo
    
    client = get_supabase()
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz).isoformat()
    
    # Format bank details as comma-separated strings
    # RUB bank is optional - only format if provided
    bank_rub = ""
    if payload.rub_bank_name and payload.rub_phone_sbp:
        bank_rub = f"{payload.rub_bank_name},{payload.rub_phone_sbp},{payload.rub_card_number},{payload.rub_owner_name}"
    
    bank_mnt = f"{payload.mnt_bank_name},{payload.mnt_account_number},{payload.mnt_owner_name},{payload.mnt_phone}"
    
    # Update user record with KYC info
    # Name/email already set in Level 1 registration, only update if provided
    update_payload = {
        "bank_mnt": bank_mnt,
        "passport_storage_url": payload.passport_storage_url,
        "ready_for_verification": True,
        "agreed_terms": True,
        "verification_level": 1,  # Level 1 until admin approves to Level 2
        "updated_at": now,
    }
    
    # Only overwrite name/email if explicitly provided
    if payload.first_name:
        update_payload["first_name"] = payload.first_name
    if payload.last_name:
        update_payload["last_name"] = payload.last_name
    
    # Add email if provided
    if payload.email:
        update_payload["email"] = payload.email
    
    # Add RUB bank only if provided
    if bank_rub:
        update_payload["bank_rub"] = bank_rub
    
    result = client.table("users").update(update_payload).eq("id", user.id).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to submit registration")
    
    # Notify shift admin about new registration (only if shift is active)
    shift_res = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    if shift_res.data and shift_res.data[0].get("current_admin_id"):
        shift_admin_id = shift_res.data[0].get("current_admin_id")
        admin_text = (
            f"📋 <b>Шинэ бүртгэл баталгаажуулалт хүлээгдэж байна</b>\n\n"
            f"👤 Хэрэглэгч: {payload.last_name} {payload.first_name}\n"
            f"📧 Имэйл: {payload.email or '-'}\n"
            f"📱 Монгол утас: {payload.mnt_phone}\n"
            f"📱 Утас СБП (RU): {payload.rub_phone_sbp or '-'}\n"
            f"🆔 Telegram ID: {user.id}\n"
        )
        send_user_notification(shift_admin_id, admin_text)
        logger.info(f"Sent registration notification to shift admin {shift_admin_id}")
    else:
        logger.warning("No shift admin found, skipping registration notification")
    
    return {"ok": True, "message": "Registration submitted for verification"}


@app.post("/api/update-bank-info")
async def update_bank_info(
    payload: UpdateBankInfoRequest,
    user=Depends(get_jwt_authenticated_user),
):
    """Update user's bank info (for verified users to update their banking details).
    When bank info is changed, verified is set to FALSE but ready_for_verification stays TRUE,
    requiring admin re-verification.
    """
    from zoneinfo import ZoneInfo
    
    client = get_supabase()
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz).isoformat()
    
    # Check if only email is being updated (no bank info change at all)
    only_email_update = (
        payload.email and
        not payload.rub_bank_name and not payload.rub_phone_sbp and 
        not payload.rub_card_number and not payload.rub_owner_name and
        not payload.mnt_bank_name and not payload.mnt_account_number and 
        not payload.mnt_owner_name and not payload.mnt_phone
    )
    
    if only_email_update:
        # Only update email without resetting verification
        update_payload = {"updated_at": now, "email": payload.email}
        if payload.phone:
            update_payload["phone"] = payload.phone
        
        result = client.table("users").update(update_payload).eq("id", user.id).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to update user info")
        
        return {"ok": True, "message": "Email updated successfully."}
    
    # Check if only MNT phone is being updated (adding missing phone to bank_mnt)
    # This shouldn't reset verification since they're just adding missing required info
    only_mnt_phone_update = (
        payload.mnt_bank_name and payload.mnt_account_number and payload.mnt_owner_name and
        not payload.rub_bank_name and not payload.rub_phone_sbp and 
        not payload.rub_card_number and not payload.rub_owner_name
    )
    
    if only_mnt_phone_update:
        # Update MNT bank info (mainly to add phone) without resetting verification
        bank_mnt = f"{payload.mnt_bank_name},{payload.mnt_account_number},{payload.mnt_owner_name},{payload.mnt_phone or ''}"
        update_payload = {"updated_at": now, "bank_mnt": bank_mnt}
        if payload.email:
            update_payload["email"] = payload.email
        if payload.phone:
            update_payload["phone"] = payload.phone
        
        result = client.table("users").update(update_payload).eq("id", user.id).execute()
        
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to update MNT bank info")
        
        return {"ok": True, "message": "MNT bank info updated successfully."}
    
    # Format bank details as comma-separated strings
    bank_rub = f"{payload.rub_bank_name},{payload.rub_phone_sbp},{payload.rub_card_number},{payload.rub_owner_name}"
    bank_mnt = f"{payload.mnt_bank_name},{payload.mnt_account_number},{payload.mnt_owner_name},{payload.mnt_phone or ''}"
    
    # Update user record with bank info
    # Set verified to FALSE since bank info changed, but keep ready_for_verification TRUE for re-verification
    update_payload = {
        "phone": payload.phone,
        "bank_rub": bank_rub,
        "bank_mnt": bank_mnt,
        "verified": False,  # Reset verification when bank info changes
        "ready_for_verification": True,  # Keep ready for re-verification
        "updated_at": now,
    }
    
    # Also update email if provided
    if payload.email:
        update_payload["email"] = payload.email
    
    result = client.table("users").update(update_payload).eq("id", user.id).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update bank info")
    
    # Notify shift admin about bank info change requiring re-verification
    shift_res = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    if shift_res.data and shift_res.data[0].get("current_admin_id"):
        shift_admin_id = shift_res.data[0].get("current_admin_id")
        admin_text = (
            f"🔄 <b>Банкны мэдээлэл өөрчилсөн тул дахин баталгаажуулалт шаардлагатай</b>\n\n"
            f"🆔 Хэрэглэгчийн ID: {user.id}\n"
            f"📱 Утас: {payload.phone}\n"
            f"🏦 MNT банк: {payload.mnt_bank_name}\n"
            f"🏦 RUB банк: {payload.rub_bank_name}\n\n"
            f"⚠️ Энэ хэрэглэгчийг дахин баталгаажуулах шаардлагатай."
        )
        send_user_notification(shift_admin_id, admin_text)
        logger.info(f"Sent bank info change notification to shift admin {shift_admin_id}")
    
    return {"ok": True, "message": "Bank info updated. Please wait for admin re-verification."}


@app.post("/api/exchange/create", response_model=ExchangeCreateResponse)
async def create_exchange(
    payload: ExchangeCreateRequest,
    user=Depends(get_jwt_authenticated_user),
):
    from zoneinfo import ZoneInfo
    
    logger.info(f"=== CREATE EXCHANGE REQUEST ===")
    logger.info(f"User ID: {user.id}, Amount: {payload.amount}, Direction: {payload.direction}")
    
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    client = get_supabase()
    _require_service_open(client)

    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz)
    invoice = payload.invoice or generate_invoice(now)
    direction = payload.direction.lower()
    if direction not in {"buy", "sell"}:
        raise HTTPException(status_code=400, detail="Invalid direction")

    # Always calculate effective rate on backend to keep pricing rules authoritative.
    buy_rate, sell_rate = _load_latest_rates(client)
    base_rate = buy_rate if direction == "buy" else sell_rate
    if base_rate <= 0:
        base_rate = _to_decimal(payload.rate)
    if base_rate <= 0:
        raise HTTPException(status_code=400, detail="Rate unavailable")

    promo_discount = Decimal("0")
    applied_promo_code: str | None = None
    applied_promo_source: str | None = None

    _, preview_source, _, _ = _compute_effective_rate(
        direction=direction,
        amount=_to_decimal(payload.amount),
        base_rate=base_rate,
        promo_discount=Decimal("0"),
    )

    if payload.promo_code and preview_source != "volume":
        promo_code_upper = payload.promo_code.upper().strip()
        promo_res = (
            client.table("promo_codes")
            .select("code,discount,active,user_id,source,aliases,expires_at")
            .eq("active", True)
            .execute()
        )

        matched_promo = None
        for promo in promo_res.data or []:
            code_value = (promo.get("code") or "").upper()
            aliases = promo.get("aliases") or []
            alias_match = any(str(alias).upper() == promo_code_upper for alias in aliases)
            if code_value == promo_code_upper or alias_match:
                promo_user_id = promo.get("user_id")
                if promo_user_id and int(promo_user_id) != user.id:
                    continue

                expires_at = promo.get("expires_at")
                if expires_at:
                    try:
                        expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                        if expiry.tzinfo is None:
                            expiry = expiry.replace(tzinfo=timezone.utc)
                        if datetime.now(timezone.utc) > expiry:
                            continue
                    except Exception:
                        continue

                matched_promo = promo
                break

        if matched_promo:
            promo_discount = _to_decimal(matched_promo.get("discount"))
            applied_promo_code = matched_promo.get("code")
            applied_promo_source = matched_promo.get("source")

    effective_rate, rate_source, applied_adjustment, rub_equivalent = _compute_effective_rate(
        direction=direction,
        amount=_to_decimal(payload.amount),
        base_rate=base_rate,
        promo_discount=promo_discount,
    )

    if rate_source == "volume":
        # Volume-discounted requests should never consume promo codes.
        applied_promo_code = None
        applied_promo_source = None
        promo_discount = Decimal("0")

    logger.info(
        "Pricing resolved for %s: base=%s effective=%s source=%s adjustment=%s rub_equivalent=%s",
        invoice,
        base_rate,
        effective_rate,
        rate_source,
        applied_adjustment,
        rub_equivalent,
    )

    # ensure user row exists - but don't overwrite registered names
    existing = client.table("users").select("id,first_name").eq("id", user.id).limit(1).execute()
    if existing.data:
        # User exists - only update timestamp
        client.table("users").update({"updated_at": now.isoformat()}).eq("id", user.id).execute()
    else:
        # New user - create with Telegram names
        client.table("users").insert(
            {"id": user.id, "first_name": user.first_name, "last_name": user.last_name, "updated_at": now.isoformat()}
        ).execute()

    # Support both single receipt_path and multiple receipt_paths
    receipt_paths_list = payload.receipt_paths or []
    if payload.receipt_path and payload.receipt_path not in receipt_paths_list:
        receipt_paths_list.append(payload.receipt_path)
    
    # Store paths as JSON array for bill_url, single path for receipt_id (backward compatibility)
    import json
    bill_url_value = json.dumps(receipt_paths_list) if receipt_paths_list else None
    receipt_id_value = receipt_paths_list[0] if receipt_paths_list else None
    
    insert_payload = {
        "user_id": user.id,
        "invoice": invoice,
        "amount": str(payload.amount),
        "currency_from": payload.currency_from,
        "currency_to": payload.currency_to,
        "rate": str(effective_rate),
        "status": "pending",
        "timestamp": now.isoformat(),
        "bill_url": bill_url_value,
        "receipt_id": receipt_id_value,
        "promo_code": applied_promo_code,
        "bank_details": payload.bank_details,
        "receipt_submitted_at": now.isoformat() if receipt_paths_list else None,
    }

    # snapshot buy/sell side
    if direction == "buy":
        insert_payload["buy_rate"] = str(effective_rate)
    elif direction == "sell":
        insert_payload["sell_rate"] = str(effective_rate)

    result = client.table("transactions").insert(insert_payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create transaction")

    transaction = result.data[0]

    # Mark one-time promo codes as inactive (source != 'default')
    if applied_promo_code and applied_promo_source and applied_promo_source != "default":
        client.table("promo_codes").update({"active": False}).eq("code", applied_promo_code).execute()

    settings = get_settings()
    
    # Calculate admin transfer amount
    if direction == "buy":
        # User sends RUB, admin sends MNT (amount * rate)
        admin_sends = round(_to_decimal(payload.amount) * effective_rate)
        admin_sends_currency = "MNT"
    else:
        # User sends MNT, admin sends RUB (amount / rate)
        if effective_rate <= 0:
            raise HTTPException(status_code=400, detail="Invalid effective rate")
        admin_sends = round(_to_decimal(payload.amount) / effective_rate, 2)
        admin_sends_currency = "RUB"
    
    direction_text = "🟢 ТӨГРӨГ АВАХ" if direction == "buy" else "🟠 РУБ АВАХ"
    
    # Single notification to shift admin (removed duplicate to general admin chat)
    shift_res = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    logger.info(f"Shift admin query result: {shift_res.data}")
    
    reply_markup = None
    # Only add inline keyboard if URL is a valid public HTTPS URL (not localhost)
    if settings.admin_panel_url and "localhost" not in settings.admin_panel_url and settings.admin_panel_url.startswith("https://"):
        separator = "&" if "?" in settings.admin_panel_url else "?"
        reply_markup = {
            "inline_keyboard": [
                [
                    {
                        "text": "🔗 Админ хэсэгт харах",
                        "web_app": {"url": f"{settings.admin_panel_url}{separator}invoice={invoice}"},
                    }
                ]
            ]
        }
    
    notification_text = (
        f"🔔 <b>Шинэ хүсэлт ирлээ!</b>\n\n"
        f"📋 Invoice: <code>{invoice}</code>\n"
        f"👤 Хэрэглэгчийн ID: <code>{user.id}</code>\n"
        f"🔄 Чиглэл: {direction_text}\n\n"
        f"💰 Хэрэглэгч илгээх: <b>{payload.amount}</b> {payload.currency_from}\n"
        f"💸 Админ шилжүүлэх: <b>{admin_sends}</b> {admin_sends_currency}\n"
        f"📊 Ханш: {effective_rate}\n"
    )
    
    if shift_res.data and shift_res.data[0].get("current_admin_id"):
        shift_admin_id = shift_res.data[0].get("current_admin_id")
        logger.info(f"Sending notification to shift admin {shift_admin_id}")
        send_user_notification(shift_admin_id, notification_text, reply_markup=reply_markup)
    else:
        # No shift admin - skip notification
        logger.warning("No shift admin found, skipping transaction notification")

    # Send confirmation notification to user
    user_lang = _get_user_lang(user.id)
    user_direction_text = "Төгрөг авах (RUB → MNT)" if direction == "buy" else "Рубль авах (MNT → RUB)"
    user_notification = (
        f"{tb(user_lang, 'notif_exchange_received', invoice=invoice, amount=f'{payload.amount:,.0f}', from_=payload.currency_from, to=payload.currency_to, rate=effective_rate)}\n\n"
        f"🔄 {user_direction_text}\n"
        f"💰 {payload.amount:,.0f} {payload.currency_from} → {admin_sends:,.0f} {admin_sends_currency}"
    )
    
    try:
        send_user_notification(user.id, user_notification)
        logger.info(f"Sent confirmation notification to user {user.id}")
    except Exception as e:
        logger.warning(f"Failed to send user confirmation notification: {e}")

    return ExchangeCreateResponse(
        id=str(transaction.get("id")),
        invoice=invoice,
        status=transaction.get("status"),
        bill_url=transaction.get("bill_url"),
        created_at=now,
    )


@app.get("/api/exchange/editable", response_model=ExchangeEditableResponse)
async def get_editable_exchange(
    invoice: str,
    user=Depends(get_jwt_authenticated_user),
):
    client = get_supabase()
    res = (
        client.table("transactions")
        .select("id,invoice,user_id,amount,currency_from,currency_to,rate,bank_details,bill_url,receipt_id,status")
        .eq("invoice", invoice)
        .eq("user_id", user.id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Invoice not found")

    trx = res.data[0]
    if trx.get("status") != "waiting_edit":
        raise HTTPException(status_code=400, detail="Transaction is not editable")

    direction = "buy" if (trx.get("currency_from") or "").upper() == "RUB" else "sell"
    receipt_urls = _parse_receipt_urls(trx.get("bill_url"), trx.get("receipt_id"))

    return ExchangeEditableResponse(
        invoice=trx.get("invoice"),
        direction=direction,
        amount=_to_decimal(trx.get("amount")),
        currency_from=trx.get("currency_from"),
        currency_to=trx.get("currency_to"),
        rate=_to_decimal(trx.get("rate")),
        bank_details=trx.get("bank_details") or "",
        receipt_urls=receipt_urls,
        can_edit=True,
    )


@app.post("/api/exchange/resubmit", response_model=ExchangeCreateResponse)
async def resubmit_exchange(
    payload: ExchangeResubmitRequest,
    user=Depends(get_jwt_authenticated_user),
):
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")

    client = get_supabase()
    now = datetime.now(timezone.utc)
    trx_res = (
        client.table("transactions")
        .select("*")
        .eq("invoice", payload.invoice)
        .eq("user_id", user.id)
        .limit(1)
        .execute()
    )
    if not trx_res.data:
        raise HTTPException(status_code=404, detail="Invoice not found")

    trx = trx_res.data[0]
    if trx.get("status") != "waiting_edit":
        raise HTTPException(status_code=400, detail="Transaction cannot be resubmitted")

    direction = "buy" if (trx.get("currency_from") or "").upper() == "RUB" else "sell"
    buy_rate, sell_rate = _load_latest_rates(client)
    base_rate = buy_rate if direction == "buy" else sell_rate
    if base_rate <= 0:
        base_rate = _to_decimal(payload.rate)
    if base_rate <= 0:
        raise HTTPException(status_code=400, detail="Rate unavailable")

    existing_promo_code = trx.get("promo_code")
    promo_discount = Decimal("0")
    resolved_promo_code: str | None = None
    resolved_promo_source: str | None = None

    _, preview_source, _, _ = _compute_effective_rate(
        direction=direction,
        amount=_to_decimal(payload.amount),
        base_rate=base_rate,
        promo_discount=Decimal("0"),
    )

    if existing_promo_code and preview_source != "volume":
        promo_res = (
            client.table("promo_codes")
            .select("code,discount,active,user_id,source,expires_at")
            .eq("active", True)
            .eq("code", existing_promo_code)
            .limit(1)
            .execute()
        )
        if promo_res.data:
            promo_row = promo_res.data[0]
            promo_user_id = promo_row.get("user_id")
            valid_for_user = not promo_user_id or int(promo_user_id) == user.id
            not_expired = True
            expires_at = promo_row.get("expires_at")
            if expires_at:
                try:
                    expiry = datetime.fromisoformat(str(expires_at).replace("Z", "+00:00"))
                    if expiry.tzinfo is None:
                        expiry = expiry.replace(tzinfo=timezone.utc)
                    not_expired = datetime.now(timezone.utc) <= expiry
                except Exception:
                    not_expired = False

            if valid_for_user and not_expired:
                promo_discount = _to_decimal(promo_row.get("discount"))
                resolved_promo_code = promo_row.get("code")
                resolved_promo_source = promo_row.get("source")

    effective_rate, rate_source, _, _ = _compute_effective_rate(
        direction=direction,
        amount=_to_decimal(payload.amount),
        base_rate=base_rate,
        promo_discount=promo_discount,
    )

    if rate_source == "volume":
        resolved_promo_code = None
        resolved_promo_source = None

    receipt_paths_list = payload.receipt_paths or []
    if payload.receipt_path and payload.receipt_path not in receipt_paths_list:
        receipt_paths_list.append(payload.receipt_path)

    bill_url_value = json.dumps(receipt_paths_list) if receipt_paths_list else None
    receipt_id_value = receipt_paths_list[0] if receipt_paths_list else None

    total_paused_seconds = _to_decimal(trx.get("total_paused_seconds"), Decimal("0"))
    paused_at_raw = trx.get("timer_paused_at")
    if paused_at_raw:
        paused_at = datetime.fromisoformat(str(paused_at_raw).replace("Z", "+00:00"))
        if paused_at.tzinfo is None:
            paused_at = paused_at.replace(tzinfo=timezone.utc)
        total_paused_seconds += Decimal(str(max(0.0, (now - paused_at).total_seconds())))

    update_payload = {
        "status": "pending",
        "amount": str(payload.amount),
        "rate": str(effective_rate),
        "bank_details": payload.bank_details,
        "bill_url": bill_url_value,
        "receipt_id": receipt_id_value,
        "promo_code": resolved_promo_code,
        "timestamp": now.isoformat(),
        "receipt_submitted_at": now.isoformat() if receipt_paths_list else trx.get("receipt_submitted_at"),
        "rejection_comment": None,
        "admin_comment": None,
        "admin_bill_url": None,
        "completed_at": None,
        "completed_by_admin": None,
        "completion_duration_minutes": None,
        "waiting_started_at": None,
        "timer_paused_at": None,
        "total_paused_seconds": float(total_paused_seconds),
    }

    if direction == "buy":
        update_payload["buy_rate"] = str(effective_rate)
    else:
        update_payload["sell_rate"] = str(effective_rate)

    update_res = (
        client.table("transactions")
        .update(update_payload)
        .eq("invoice", payload.invoice)
        .eq("user_id", user.id)
        .execute()
    )
    if not update_res.data:
        raise HTTPException(status_code=500, detail="Failed to resubmit transaction")

    if resolved_promo_code and resolved_promo_source and resolved_promo_source != "default":
        client.table("promo_codes").update({"active": False}).eq("code", resolved_promo_code).execute()

    # Notify shift admin that a waiting-edit request has been resubmitted.
    settings = get_settings()
    shift_res = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    if shift_res.data and shift_res.data[0].get("current_admin_id"):
        shift_admin_id = shift_res.data[0].get("current_admin_id")
        reply_markup = None
        if settings.admin_panel_url and "localhost" not in settings.admin_panel_url and settings.admin_panel_url.startswith("https://"):
            separator = "&" if "?" in settings.admin_panel_url else "?"
            reply_markup = {
                "inline_keyboard": [
                    [
                        {
                            "text": "🔗 Админ хэсэгт харах",
                            "web_app": {"url": f"{settings.admin_panel_url}{separator}invoice={payload.invoice}"},
                        }
                    ]
                ]
            }

        send_user_notification(
            int(shift_admin_id),
            (
                f"🔁 <b>Засварласан хүсэлт дахин илгээгдлээ</b>\n\n"
                f"📋 Invoice: <code>{payload.invoice}</code>\n"
                f"👤 User: <code>{user.id}</code>\n"
                f"💰 Amount: <b>{payload.amount}</b> {trx.get('currency_from')}\n"
                f"📊 Rate: {effective_rate}"
            ),
            reply_markup=reply_markup,
        )

    return ExchangeCreateResponse(
        id=str(update_res.data[0].get("id")),
        invoice=payload.invoice,
        status="pending",
        bill_url=bill_url_value,
        created_at=now,
    )


@app.post("/api/admin/action")
async def admin_action(
    payload: AdminActionRequest,
    admin=Depends(require_admin),
    request: Request = None,
):
    import logging
    logger = logging.getLogger("uvicorn.error")
    
    # Get admin user ID from request headers if available (for logging)
    admin_user_id = None
    try:
        init_data = request.headers.get("X-Telegram-Init-Data") if request else None
        if init_data:
            settings = get_settings()
            admin_user = verify_telegram_init_data(init_data, settings.bot_token)
            admin_user_id = admin_user.id
    except Exception:
        pass  # Admin key auth doesn't provide user ID
    
    client = get_supabase()
    now = datetime.now(timezone.utc)
    
    # fetch transaction
    res = client.table("transactions").select("*").eq("invoice", payload.invoice).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Invoice not found")
    trx = res.data[0]
    
    logger.info(f"Admin action: invoice={payload.invoice}, new_status={payload.status}, current_status={trx.get('status')}")

    if payload.status == "waiting_edit":
        bank_details = (trx.get("bank_details") or "").strip()
        parts = [part.strip() for part in bank_details.split(",") if part.strip()]
        if (trx.get("currency_from", "").upper() == "MNT" and trx.get("currency_to", "").upper() == "RUB" and len(parts) == 2):
            phone_candidate = parts[0].replace(" ", "").replace("-", "")
            if phone_candidate.startswith("+"):
                phone_candidate = phone_candidate[1:]
            if phone_candidate.isdigit() and 7 <= len(phone_candidate) <= 15:
                raise HTTPException(status_code=400, detail="waiting_edit is only supported for exchange requests")

    # Build update payload - only include non-None values
    update_payload = {"status": payload.status}
    
    if payload.rejection_comment is not None:
        update_payload["rejection_comment"] = payload.rejection_comment
    if payload.admin_comment is not None:
        update_payload["admin_comment"] = payload.admin_comment
    if payload.completed_by_admin is not None:
        update_payload["completed_by_admin"] = payload.completed_by_admin

    total_paused_seconds = _to_decimal(trx.get("total_paused_seconds"), Decimal("0"))
    paused_at_raw = trx.get("timer_paused_at")
    if paused_at_raw and payload.status != "waiting_edit":
        try:
            paused_at = datetime.fromisoformat(str(paused_at_raw).replace("Z", "+00:00"))
            if paused_at.tzinfo is None:
                paused_at = paused_at.replace(tzinfo=timezone.utc)
            total_paused_seconds += Decimal(str(max(0.0, (now - paused_at).total_seconds())))
            update_payload["total_paused_seconds"] = float(total_paused_seconds)
        except Exception as e:
            logger.warning(f"Could not calculate paused seconds: {e}")

    if payload.status == "waiting_edit":
        update_payload["waiting_started_at"] = now.isoformat()
        update_payload["timer_paused_at"] = now.isoformat()
        update_payload["completed_at"] = None
        update_payload["completed_by_admin"] = None
        update_payload["completion_duration_minutes"] = None
        update_payload["admin_bill_url"] = None
        update_payload["admin_comment"] = None
    elif payload.status == "pending":
        update_payload["waiting_started_at"] = None
        update_payload["timer_paused_at"] = None
    elif payload.status in ["completed", "successful", "rejected"]:
        update_payload["timer_paused_at"] = None
    
    # Track admin bill submission time
    if payload.admin_bill_url:
        update_payload["admin_bill_url"] = payload.admin_bill_url
        update_payload["admin_bill_submitted_at"] = now.isoformat()
    
    # Handle completion - calculate duration (support both "completed" and "successful" status)
    duration_minutes = None
    if payload.status in ["completed", "successful"]:
        update_payload["completed_at"] = now.isoformat()
        
        # Calculate completion duration from receipt_submitted_at (when user submitted receipt)
        # This measures how long it took admin to process after user submitted
        receipt_submitted_str = trx.get("receipt_submitted_at")
        if receipt_submitted_str:
            try:
                from zoneinfo import ZoneInfo
                moscow_tz = ZoneInfo("Europe/Moscow")
                
                # Parse the receipt_submitted_at timestamp
                receipt_time = datetime.fromisoformat(receipt_submitted_str.replace('Z', '+00:00'))
                
                # If receipt_time is naive (no timezone), assume it's already in Moscow time
                if receipt_time.tzinfo is None:
                    receipt_time = receipt_time.replace(tzinfo=moscow_tz)
                
                # Get current time in Moscow timezone
                now_moscow = datetime.now(moscow_tz)
                
                paused_seconds = _to_decimal(update_payload.get("total_paused_seconds", trx.get("total_paused_seconds")), Decimal("0"))

                # Calculate duration in minutes and subtract paused waiting-edit time
                raw_minutes = (now_moscow - receipt_time).total_seconds() / 60
                duration_minutes = max(0.0, raw_minutes - (float(paused_seconds) / 60.0))
                update_payload["completion_duration_minutes"] = round(duration_minutes, 2)
                logger.info(f"Completion duration: {duration_minutes:.2f} minutes (from receipt_submitted_at: {receipt_submitted_str})")
            except Exception as e:
                logger.warning(f"Could not calculate completion duration: {e}")

    logger.info(f"Update payload: {update_payload}")
    
    # Execute the update
    try:
        update_result = client.table("transactions").update(update_payload).eq("invoice", payload.invoice).execute()
        logger.info(f"Update result data: {update_result.data}")
        
        # Verify the update worked
        if not update_result.data:
            logger.error("Update returned no data - possible RLS issue")
            # Try to fetch again to see current state
            verify = client.table("transactions").select("status").eq("invoice", payload.invoice).execute()
            logger.info(f"Verify after update: {verify.data}")
    except Exception as e:
        logger.error(f"Update error: {e}")
        raise HTTPException(status_code=500, detail=f"Update failed: {str(e)}")

    # notify user based on status
    user_id = trx.get("user_id")
    if user_id:
        user_lang = _get_user_lang(int(user_id))
        if payload.status == "approved":
            send_user_notification(
                user_id=int(user_id),
                text=tb(user_lang, "notif_tx_approved", invoice=payload.invoice),
            )
        elif payload.status in ["completed", "successful"]:
            # Send completion notification with admin's bill photo if available
            completion_text = tb(user_lang, "notif_tx_completed", invoice=payload.invoice)
            
            # If admin uploaded bills, send them as photos
            if payload.admin_bill_url:
                try:
                    import json as json_module
                    # Try to parse as JSON array (new format)
                    photo_urls = []
                    try:
                        parsed = json_module.loads(payload.admin_bill_url)
                        if isinstance(parsed, list):
                            photo_urls = parsed
                        else:
                            photo_urls = [payload.admin_bill_url]
                    except (json_module.JSONDecodeError, TypeError):
                        # Not JSON, treat as single URL
                        photo_urls = [payload.admin_bill_url]
                    
                    logger.info(f"Sending {len(photo_urls)} photo(s) to user {user_id}")
                    
                    # Send all photos in one message using media group
                    photo_sent = send_user_photos(
                        user_id=int(user_id),
                        photo_urls=photo_urls,
                        caption=completion_text
                    )
                    
                    # If photo sending failed, send text notification
                    if not photo_sent:
                        logger.warning(f"Photo send failed, sending text notification to {user_id}")
                        send_user_notification(user_id=int(user_id), text=completion_text)
                        
                except Exception as e:
                    logger.warning(f"Failed to send photo, falling back to text: {e}")
                    send_user_notification(user_id=int(user_id), text=completion_text)
            else:
                send_user_notification(user_id=int(user_id), text=completion_text)
            
            trx_amount = _to_decimal(trx.get("amount"))
            trx_rate = _to_decimal(trx.get("rate"))
            if (trx.get("currency_from") or "").upper() == "RUB":
                rub_equivalent = trx_amount
            else:
                rub_equivalent = (trx_amount / trx_rate) if trx_rate > 0 else Decimal("0")

            try:
                oyuns_plus_settings = _get_oyuns_plus_settings(client)
                earned_points = _calculate_oyuns_plus_points(rub_equivalent, oyuns_plus_settings)
                _award_oyuns_plus_points_once(
                    client,
                    user_id=int(user_id),
                    source_type="transaction_completed",
                    source_id=str(payload.invoice),
                    points=earned_points,
                    rub_equivalent=rub_equivalent,
                    metadata={
                        "invoice": payload.invoice,
                        "status": payload.status,
                    },
                )
            except Exception as points_err:
                logger.error(f"Failed to award Oyuns Plus points for transaction {payload.invoice}: {points_err}")

            # If completion took more than 10 minutes for requests under 30k RUB,
            # generate a compensation promo code.
            if duration_minutes and duration_minutes > 10 and rub_equivalent < COMPENSATION_PROMO_MAX_RUB:
                try:
                    import secrets
                    import string
                    # Generate random 10 character code with letters and numbers
                    chars = string.ascii_uppercase + string.digits
                    promo_code = ''.join(secrets.choice(chars) for _ in range(10))
                    
                    # Create promo code for the user (no expiration)
                    client.table("promo_codes").insert({
                        "code": promo_code,
                        "discount": 0.2,  
                        "active": True,
                        "user_id": user_id,
                        "source": "compensation",
                        "aliases": [],
                    }).execute()
                    
                    # Notify user about the promo code
                    promo_text = tb(user_lang, "notif_compensation_promo", code=promo_code, discount="0.2")
                    send_user_notification(user_id=int(user_id), text=promo_text)
                    logger.info(f"Generated compensation promo code {promo_code} for user {user_id}")
                except Exception as e:
                    logger.error(f"Failed to create compensation promo code: {e}")
        elif payload.status == "waiting_edit":
            waiting_text = tb(user_lang, "notif_tx_waiting_edit", invoice=payload.invoice)
            if payload.rejection_comment:
                waiting_text += tb(user_lang, "notif_tx_waiting_edit_reason", reason=payload.rejection_comment)

            settings = get_settings()
            user_panel_url = settings.user_panel_url or settings.webapp_url
            reply_markup = None
            if user_panel_url and user_panel_url.startswith("https://"):
                separator = "&" if "?" in user_panel_url else "?"
                edit_url = f"{user_panel_url}{separator}edit-invoice={payload.invoice}"
                reply_markup = {
                    "inline_keyboard": [
                        [
                            {
                                "text": tb(user_lang, "notif_tx_waiting_edit_button"),
                                "web_app": {"url": edit_url},
                            }
                        ]
                    ]
                }

            send_user_notification(
                user_id=int(user_id),
                text=waiting_text,
                reply_markup=reply_markup,
            )
        elif payload.status == "rejected":
            rejection_msg = tb(user_lang, "notif_tx_rejected", invoice=payload.invoice)
            if payload.rejection_comment:
                rejection_msg += tb(user_lang, "notif_tx_rejected_reason", reason=payload.rejection_comment)
            
            # If admin uploaded rejection proof photos, send them
            if payload.admin_bill_url:
                try:
                    import json as json_module
                    photo_urls = []
                    try:
                        parsed = json_module.loads(payload.admin_bill_url)
                        if isinstance(parsed, list):
                            photo_urls = parsed
                        else:
                            photo_urls = [payload.admin_bill_url]
                    except (json_module.JSONDecodeError, TypeError):
                        photo_urls = [payload.admin_bill_url]
                    
                    logger.info(f"Sending {len(photo_urls)} rejection photo(s) to user {user_id}")
                    photo_sent = send_user_photos(
                        user_id=int(user_id),
                        photo_urls=photo_urls,
                        caption=rejection_msg
                    )
                    if not photo_sent:
                        send_user_notification(user_id=int(user_id), text=rejection_msg)
                except Exception as e:
                    logger.warning(f"Failed to send rejection photo, falling back to text: {e}")
                    send_user_notification(user_id=int(user_id), text=rejection_msg)
            else:
                send_user_notification(user_id=int(user_id), text=rejection_msg)
    
    # Log admin action
    if admin_user_id:
        log_admin_action(
            client=client,
            admin_user_id=admin_user_id,
            action_type=f"transaction_{payload.status}",
            target_type="transaction",
            target_id=payload.invoice,
            details={
                "previous_status": trx.get("status"),
                "new_status": payload.status,
                "rejection_comment": payload.rejection_comment,
                "admin_comment": payload.admin_comment,
                "has_admin_bill": bool(payload.admin_bill_url),
            }
        )

    return {"ok": True}


@app.get("/api/admin/inbox", response_model=AdminInboxResponse)
async def admin_inbox(admin=Depends(require_admin)):
    def classify_service(direction: str, bank_details: str) -> tuple[str, str | None, str | None]:
        if direction != "sell" or not bank_details:
            return "exchange", None, None

        parts = [part.strip() for part in bank_details.split(",") if part.strip()]
        if len(parts) != 2:
            return "exchange", None, None

        phone_candidate, telecom = parts
        normalized_phone = phone_candidate.replace(" ", "").replace("-", "")
        if normalized_phone.startswith("+"):
            normalized_phone = normalized_phone[1:]

        if normalized_phone.isdigit() and 7 <= len(normalized_phone) <= 15:
            return "phone_topup", phone_candidate, telecom

        return "exchange", None, None

    client = get_supabase()
    res = (
        client.table("transactions")
        .select("invoice,user_id,amount,currency_from,currency_to,status,timestamp,rate,bank_details,receipt_id,bill_url,admin_bill_url,rejection_comment")
        .in_("status", ["pending", "approved"])
        .order("timestamp", desc=False)  # Oldest first by default
        .limit(100)
        .execute()
    )
    
    # Get all unique user IDs to fetch their saved bank info
    user_ids = list(set(row.get("user_id") for row in res.data or [] if row.get("user_id")))
    
    # Fetch saved bank info and labels for all users in one query
    user_bank_info = {}
    if user_ids:
        users_res = client.table("users").select("id,bank_rub,bank_mnt,admin_label,admin_label_note").in_("id", user_ids).execute()
        for user in users_res.data or []:
            user_bank_info[user.get("id")] = {
                "bank_rub": user.get("bank_rub") or "",
                "bank_mnt": user.get("bank_mnt") or "",
                "admin_label": user.get("admin_label"),
                "admin_label_note": user.get("admin_label_note"),
            }
    
    items = []
    for row in res.data or []:
        # Determine direction from currency pair (case-insensitive)
        direction = "buy" if (row.get("currency_from") or "").upper() == "RUB" else "sell"
        bank_details = row.get("bank_details") or ""
        service_kind, topup_phone, topup_telecom = classify_service(direction, bank_details)
        
        # Check for bank mismatch
        user_id = row.get("user_id")
        bank_mismatch = False
        saved_bank_info = None
        
        if service_kind == "exchange" and user_id and user_id in user_bank_info:
            user_banks = user_bank_info[user_id]
            # For buy (RUB->MNT), user receives MNT, so check bank_mnt
            # For sell (MNT->RUB), user receives RUB, so check bank_rub
            if direction == "buy":
                saved_bank = user_banks.get("bank_mnt", "")
            else:
                saved_bank = user_banks.get("bank_rub", "")
            
            saved_bank_info = saved_bank
            
            # Compare: normalize both strings for comparison
            if saved_bank and bank_details:
                # Normalize: lowercase, remove extra spaces
                saved_normalized = saved_bank.lower().strip()
                used_normalized = bank_details.lower().strip()
                
                # Check if the used bank details differ from saved
                # They match if one contains the other or they're similar
                if saved_normalized and used_normalized:
                    # If saved bank info exists and used bank details don't match
                    if saved_normalized != used_normalized:
                        # Check if key parts match (bank name, account number)
                        saved_parts = [p.strip() for p in saved_normalized.split(',')]
                        used_parts = [p.strip() for p in used_normalized.split(',')]
                        
                        # Consider mismatch if account numbers (part 1 for MNT, part 2/3 for RUB) differ
                        if len(saved_parts) >= 2 and len(used_parts) >= 2:
                            # Check account number match
                            if saved_parts[1] != used_parts[1]:
                                bank_mismatch = True
                        else:
                            bank_mismatch = True
        
        # Get user label info
        user_label = None
        user_label_note = None
        if user_id and user_id in user_bank_info:
            user_label = user_bank_info[user_id].get("admin_label")
            user_label_note = user_bank_info[user_id].get("admin_label_note")

        items.append(AdminInboxItem(
            invoice=row.get("invoice"),
            user_id=row.get("user_id"),
            amount=row.get("amount"),
            currency_from=row.get("currency_from"),
            currency_to=row.get("currency_to"),
            status=row.get("status"),
            timestamp=row.get("timestamp"),
            rate=row.get("rate"),
            bank_details=row.get("bank_details"),
            receipt_id=row.get("receipt_id"),
            bill_url=row.get("bill_url"),
            admin_bill_url=row.get("admin_bill_url"),
            rejection_comment=row.get("rejection_comment"),
            direction=direction,
            service_kind=service_kind,
            topup_phone=topup_phone,
            topup_telecom=topup_telecom,
            bank_mismatch=bank_mismatch,
            saved_bank_info=saved_bank_info,
            admin_label=user_label,
            admin_label_note=user_label_note,
        ))
    return AdminInboxResponse(items=items)


@app.put("/api/admin/user-label")
async def update_user_label(
    payload: UserLabelUpdateRequest,
    admin=Depends(require_admin),
):
    """Update admin label and note for a user."""
    client = get_supabase()
    
    # Validate label length
    if payload.admin_label and len(payload.admin_label) > 30:
        raise HTTPException(status_code=400, detail="Label must be 30 characters or less")
    
    update_data = {
        "admin_label": payload.admin_label,
        "admin_label_note": payload.admin_label_note,
    }
    
    result = client.table("users").update(update_data).eq("id", payload.user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    
    return {"ok": True}


@app.get("/api/admin/history", response_model=AdminHistoryResponse)
async def admin_history(
    status: str = None,
    limit: int = 100,
    offset: int = 0,
    admin=Depends(require_admin)
):
    """Get all transactions with filters for admin history view."""
    client = get_supabase()
    
    # Build query
    query = client.table("transactions").select(
        "invoice,user_id,amount,currency_from,currency_to,status,timestamp,rate,bank_details,receipt_id,bill_url,admin_bill_url,rejection_comment,completed_by_admin",
        count="exact"
    )
    
    # Apply status filter if provided
    if status and status != "all":
        query = query.eq("status", status)
    
    # Order by timestamp descending (newest first) and apply pagination
    res = query.order("timestamp", desc=True).range(offset, offset + limit - 1).execute()
    
    # Get user names and bank info for all user_ids
    user_ids = list(set([row.get("user_id") for row in res.data or [] if row.get("user_id")]))
    user_info = {}
    if user_ids:
        users_res = client.table("users").select("id,first_name,last_name,bank_mnt,bank_rub").in_("id", user_ids).execute()
        for u in users_res.data or []:
            name = f"{u.get('last_name', '')} {u.get('first_name', '')}".strip()
            user_info[u.get("id")] = {
                "name": name if name else None,
                "bank_mnt": u.get("bank_mnt"),
                "bank_rub": u.get("bank_rub"),
            }
    
    items = []
    for row in res.data or []:
        direction = "buy" if (row.get("currency_from") or "").upper() == "RUB" else "sell"
        user_id = row.get("user_id")
        user_data = user_info.get(user_id, {})
        
        # Determine user's saved bank based on currency_to
        currency_to = row.get("currency_to", "").upper()
        if currency_to == "MNT":
            user_saved_bank = user_data.get("bank_mnt")
        else:  # RUB
            user_saved_bank = user_data.get("bank_rub")
        
        # Check if custom bank was used
        bank_details = row.get("bank_details") or ""
        is_custom_bank = False
        if bank_details.strip() and user_saved_bank:
            is_custom_bank = bank_details.strip() != user_saved_bank.strip()
        
        items.append(AdminHistoryItem(
            invoice=row.get("invoice"),
            user_id=user_id,
            user_name=user_data.get("name"),
            amount=row.get("amount"),
            currency_from=row.get("currency_from"),
            currency_to=row.get("currency_to"),
            status=row.get("status"),
            timestamp=row.get("timestamp"),
            rate=row.get("rate"),
            bank_details=bank_details,
            user_saved_bank=user_saved_bank,
            is_custom_bank=is_custom_bank,
            receipt_id=row.get("receipt_id"),
            bill_url=row.get("bill_url"),
            admin_bill_url=row.get("admin_bill_url"),
            rejection_comment=row.get("rejection_comment"),
            direction=direction,
            completed_by_admin=row.get("completed_by_admin"),
        ))
    
    return AdminHistoryResponse(items=items, total=res.count or len(items))


@app.get("/api/admin/kyc", response_model=KycResponse)
async def admin_kyc(admin=Depends(require_admin)):
    """Get users pending verification (ready_for_verification=True, verified=False)."""
    client = get_supabase()
    res = (
        client.table("users")
        .select("id,first_name,last_name,phone,bank_rub,bank_mnt,passport_storage_url,ready_for_verification,verified,updated_at")
        .eq("ready_for_verification", True)
        .eq("verified", False)
        .order("updated_at", desc=True)
        .limit(50)
        .execute()
    )
    items = [
        KycItem(
            user_id=row.get("id"),
            first_name=row.get("first_name"),
            last_name=row.get("last_name"),
            phone=row.get("phone"),
            bank_rub=row.get("bank_rub"),
            bank_mnt=row.get("bank_mnt"),
            passport_storage_url=row.get("passport_storage_url"),
            ready_for_verification=row.get("ready_for_verification", False),
            verified=row.get("verified", False),
            updated_at=row.get("updated_at"),
        )
        for row in res.data or []
    ]
    return KycResponse(items=items)


@app.post("/api/admin/kyc/action")
async def admin_kyc_action(
    payload: KycActionRequest,
    admin=Depends(require_admin),
    request: Request = None,
):
    """Approve or reject user verification."""
    from zoneinfo import ZoneInfo
    
    # Get admin user ID for logging
    admin_user_id = None
    try:
        init_data = request.headers.get("X-Telegram-Init-Data") if request else None
        if init_data:
            settings = get_settings()
            admin_user = verify_telegram_init_data(init_data, settings.bot_token)
            admin_user_id = admin_user.id
    except Exception:
        pass
    
    client = get_supabase()
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz).isoformat()
    
    # Fetch user info first (including referral and bank fields)
    user_res = (
        client.table("users")
        .select("first_name,last_name,bank_rub,bank_mnt,referred_by_user_id")
        .eq("id", payload.user_id)
        .limit(1)
        .execute()
    )
    if not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    
    user_info = user_res.data[0]
    user_name = f"{user_info.get('last_name', '')} {user_info.get('first_name', '')}".strip()
    # Safely check if BOTH Russian and Mongolian bank info exists (handle None and empty string)
    bank_rub_value = user_info.get('bank_rub') or ''
    bank_mnt_value = user_info.get('bank_mnt') or ''
    has_russian_bank = bool(bank_rub_value.strip()) and bank_rub_value.strip() != ',,,'
    has_mongolian_bank = bool(bank_mnt_value.strip()) and bank_mnt_value.strip() != ',,,'
    has_all_bank_info = has_russian_bank and has_mongolian_bank
    user_lang = _get_user_lang(payload.user_id)
    
    if payload.action == "approve":
        # Update user to verified + Level 2
        client.table("users").update({
            "verified": True,
            "verification_level": 2,
            "updated_at": now,
        }).eq("id", payload.user_id).execute()
        
        # Generate one-time welcome promo code ONLY if user has BOTH bank_rub AND bank_mnt filled
        promo_code = None
        try:
            if has_all_bank_info:
                import secrets
                import string
                # Generate unique promo code
                promo_code = "WELCOME" + ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
                promo_payload = {
                    "code": promo_code,
                    "aliases": [],  # Required field in table
                    "discount": 0.2,  # 0.2 MNT discount
                    "active": True,
                    "user_id": payload.user_id,
                    "source": "verification",
                    "created_at": now,
                }
                client.table("promo_codes").insert(promo_payload).execute()
                logger.info(f"Generated welcome promo code {promo_code} for user {payload.user_id} (has all bank info)")
            else:
                logger.info(f"No promo code generated for user {payload.user_id} - missing bank info (RUB: {has_russian_bank}, MNT: {has_mongolian_bank})")
        except Exception as promo_err:
            logger.error(f"Promo code logic error for user {payload.user_id}: {promo_err}")
            promo_code = None
        
        # Notify user via Telegram with webapp button
        promo_text = ""
        if promo_code:
            promo_text = tb(user_lang, "notif_kyc_approved_promo", code=promo_code, discount="0.2")
        
        notification_text = tb(user_lang, "notif_kyc_approved") + promo_text
        
        # Add webapp launch button if URL is configured
        settings = get_settings()
        reply_markup = None
        if settings.user_panel_url and settings.user_panel_url.startswith("https://"):
            reply_markup = {
                "inline_keyboard": [
                    [
                        {
                            "text": tb(user_lang, "btn_open_app") if user_lang == "ru" else "🚀 Апп нээх",
                            "web_app": {"url": settings.user_panel_url}
                        }
                    ]
                ]
            }
        
        send_user_notification(user_id=payload.user_id, text=notification_text, reply_markup=reply_markup)

        referred_by_user_id = user_info.get("referred_by_user_id")
        if referred_by_user_id:
            try:
                oyuns_plus_settings = _get_oyuns_plus_settings(client)
                if oyuns_plus_settings.get("oyuns_plus_enabled", 1) > 0:
                    referral_reward_points = int(oyuns_plus_settings.get("oyuns_plus_referral_reward_points", 0))
                    _award_oyuns_plus_points_once(
                        client,
                        user_id=int(referred_by_user_id),
                        source_type="referral_kyc_approved",
                        source_id=str(payload.user_id),
                        points=referral_reward_points,
                        metadata={
                            "referred_user_id": payload.user_id,
                            "event": "kyc_approved",
                        },
                    )
            except Exception as referral_err:
                logger.error(f"Failed to award referral reward for user {payload.user_id}: {referral_err}")
        
        # Log admin action
        if admin_user_id:
            log_admin_action(
                client=client,
                admin_user_id=admin_user_id,
                action_type="kyc_approve",
                target_type="user",
                target_id=str(payload.user_id),
                details={"user_name": user_name}
            )
        
        return {"ok": True, "message": f"User {user_name} verified successfully"}
    
    elif payload.action == "reject":
        # Reset ready_for_verification so user can re-submit
        client.table("users").update({
            "ready_for_verification": False,
            "updated_at": now,
        }).eq("id", payload.user_id).execute()
        
        # Notify user via Telegram
        rejection_reason = payload.rejection_reason or "Мэдээлэл буруу эсвэл дутуу байна"
        notification_text = tb(user_lang, "notif_kyc_rejected", reason=rejection_reason)
        send_user_notification(user_id=payload.user_id, text=notification_text)
        
        # Log admin action
        if admin_user_id:
            log_admin_action(
                client=client,
                admin_user_id=admin_user_id,
                action_type="kyc_reject",
                target_type="user",
                target_id=str(payload.user_id),
                details={
                    "user_name": user_name,
                    "rejection_reason": rejection_reason
                }
            )
        
        return {"ok": True, "message": f"User {user_name} verification rejected"}
    
    else:
        raise HTTPException(status_code=400, detail="Invalid action. Use 'approve' or 'reject'")


# ============= User Search for Admin =============

@app.get("/api/admin/user-search", response_model=UserSearchResponse)
async def admin_user_search(
    q: str = "",
    admin=Depends(require_admin),
):
    """Search users by ID, name, or phone. Optimized for flexible search."""
    client = get_supabase()
    
    q = q.strip() if q else ""
    
    users_data = []
    
    if q:
        # Try to search by ID if it looks like a number
        if q.isdigit():
            # Search by exact ID
            res = client.table("users").select("id,first_name,last_name,phone,verified,created_at").eq("id", int(q)).execute()
            users_data = res.data or []
        else:
            # Search by name or phone - use multiple queries for better results
            # First try exact starts-with match for better relevance
            res = client.table("users").select("id,first_name,last_name,phone,verified,created_at").or_(
                f"first_name.ilike.{q}%,last_name.ilike.{q}%,phone.ilike.%{q}%"
            ).order("id", desc=True).limit(50).execute()
            users_data = res.data or []
            
            # If no results, try contains match
            if not users_data:
                res = client.table("users").select("id,first_name,last_name,phone,verified,created_at").or_(
                    f"first_name.ilike.%{q}%,last_name.ilike.%{q}%"
                ).order("id", desc=True).limit(50).execute()
                users_data = res.data or []
    else:
        # No query - return recent users
        res = client.table("users").select("id,first_name,last_name,phone,verified,created_at").order("id", desc=True).limit(50).execute()
        users_data = res.data or []
    
    # Build response with transaction counts
    users = []
    for row in users_data:
        user_id = row.get("id")
        # Get transaction count for this user
        tx_res = client.table("transactions").select("id", count="exact").eq("user_id", user_id).execute()
        tx_count = tx_res.count if tx_res.count else 0
        
        users.append(UserSearchItem(
            id=user_id,
            first_name=row.get("first_name"),
            last_name=row.get("last_name"),
            username=None,  # Not stored in this schema
            phone=row.get("phone"),
            verified=row.get("verified", False),
            total_transactions=tx_count,
            created_at=row.get("created_at"),
        ))
    
    return UserSearchResponse(users=users, total=len(users))


# Public endpoint for admin bank accounts (users need to see where to send money)
@app.get("/api/admin-banks", response_model=AdminBankAccountsResponse)
async def get_admin_bank_accounts(currency: str = None):
    """
    Get list of active admin bank accounts for the admin currently on shift.
    Users need to see these to know where to send their money.
    Optional currency filter: RUB or MNT
    For RUB accounts: implements priority rotation — alternates between
    the priority card and a random non-priority card.
    """
    client = get_supabase()
    
    # Normalize and validate currency filter (allowed: MNT, RUB)
    currency_filter = currency.upper() if currency else None
    if currency_filter and currency_filter not in {"MNT", "RUB"}:
        raise HTTPException(status_code=400, detail="Invalid currency. Use MNT or RUB.")
    
    # Get current active shift from single-row table
    shift_res = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    current_admin_id = None
    if shift_res.data and shift_res.data[0].get("current_admin_id"):
        current_admin_id = shift_res.data[0].get("current_admin_id")
    
    # Build query for bank accounts
    query = (
        client
        .table("admin_bank_accounts")
        .select("*")
        .eq("is_active", True)
        .order("display_order", desc=False)
        .order("created_at", desc=False)
    )
    
    # Filter by current shift admin if there's an active shift
    if current_admin_id:
        query = query.eq("admin_id", current_admin_id)
    
    # Apply currency filter if provided
    if currency_filter:
        query = query.eq("currency", currency_filter)
    
    res = query.execute()
    
    all_accounts = [
        AdminBankAccount(
            id=str(row.get("id")),
            bank_name=row.get("bank_name"),
            account_number=row.get("account_number"),
            card_number=row.get("card_number"),
            phone=row.get("phone"),
            owner_name=row.get("owner_name"),
            currency=row.get("currency"),
            is_active=row.get("is_active", True),
            admin_id=row.get("admin_id"),
            is_priority=row.get("is_priority", False),
            logo_url=row.get("logo_url"),
        )
        for row in res.data or []
    ]

    # RUB priority rotation: alternate priority card with random non-priority
    rub_accounts = [a for a in all_accounts if a.currency == "RUB"]
    non_rub_accounts = [a for a in all_accounts if a.currency != "RUB"]
    priority_rub = [a for a in rub_accounts if a.is_priority]
    non_priority_rub = [a for a in rub_accounts if not a.is_priority]

    if priority_rub and non_priority_rub:
        import random
        # Get and increment rotation counter from app_settings
        try:
            counter_res = client.table("app_settings").select("value").eq("key", "rub_bank_rotation_counter").single().execute()
            counter = int(counter_res.data["value"]) if counter_res.data else 0
        except Exception:
            counter = 0

        next_counter = counter + 1
        try:
            client.table("app_settings").upsert({"key": "rub_bank_rotation_counter", "value": str(next_counter)}).execute()
        except Exception:
            pass

        if counter % 2 == 0:
            # Even: show priority card
            selected_rub = [priority_rub[0]]
        else:
            # Odd: show random non-priority card
            selected_rub = [random.choice(non_priority_rub)]
        
        accounts = selected_rub + non_rub_accounts
    else:
        accounts = all_accounts

    return AdminBankAccountsResponse(accounts=accounts)


# ============= Admin Bank Account Management =============

@app.get("/api/admin/bank-accounts")
async def get_all_admin_bank_accounts(admin=Depends(require_admin)):
    """Get all bank accounts for admin management (including inactive)."""
    client = get_supabase()
    res = (
        client.table("admin_bank_accounts")
        .select("*")
        .order("admin_id", desc=False)
        .order("currency", desc=False)
        .order("display_order", desc=False)
        .execute()
    )
    
    accounts = [
        {
            "id": str(row.get("id")),
            "bank_name": row.get("bank_name"),
            "account_number": row.get("account_number"),
            "card_number": row.get("card_number"),
            "phone": row.get("phone"),
            "owner_name": row.get("owner_name"),
            "currency": row.get("currency"),
            "is_active": row.get("is_active", True),
            "is_priority": row.get("is_priority", False),
            "display_order": row.get("display_order", 0),
            "admin_id": row.get("admin_id"),
            "logo_url": row.get("logo_url"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        }
        for row in res.data or []
    ]
    return {"accounts": accounts}


@app.post("/api/admin/bank-accounts")
async def create_admin_bank_account(
    payload: dict,
    admin=Depends(require_admin),
):
    """Create a new admin bank account."""
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    
    # Validate required fields
    required = ["bank_name", "owner_name", "currency"]
    for field in required:
        if not payload.get(field):
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")
    
    # Validate currency
    if payload.get("currency") not in ["RUB", "MNT"]:
        raise HTTPException(status_code=400, detail="Currency must be RUB or MNT")
    
    insert_data = {
        "bank_name": payload.get("bank_name"),
        "account_number": payload.get("account_number"),
        "card_number": payload.get("card_number"),
        "phone": payload.get("phone"),
        "owner_name": payload.get("owner_name"),
        "currency": payload.get("currency"),
        "is_active": payload.get("is_active", True),
        "is_priority": payload.get("is_priority", False),
        "display_order": payload.get("display_order", 0),
        "admin_id": payload.get("admin_id"),
        "logo_url": payload.get("logo_url"),
        "created_at": now,
        "updated_at": now,
    }
    
    result = client.table("admin_bank_accounts").insert(insert_data).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create bank account")
    
    return {"ok": True, "account": result.data[0]}


@app.put("/api/admin/bank-accounts/{account_id}")
async def update_admin_bank_account(
    account_id: str,
    payload: dict,
    admin=Depends(require_admin),
):
    """Update an existing admin bank account."""
    client = get_supabase()
    now = datetime.now(timezone.utc).isoformat()
    
    # Validate currency if provided
    if payload.get("currency") and payload.get("currency") not in ["RUB", "MNT"]:
        raise HTTPException(status_code=400, detail="Currency must be RUB or MNT")
    
    update_data = {"updated_at": now}
    
    allowed_fields = ["bank_name", "account_number", "card_number", "phone", "owner_name", "currency", "is_active", "is_priority", "display_order", "admin_id", "logo_url"]
    for field in allowed_fields:
        if field in payload:
            update_data[field] = payload[field]
    
    result = client.table("admin_bank_accounts").update(update_data).eq("id", account_id).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Bank account not found")
    
    return {"ok": True, "account": result.data[0]}


@app.delete("/api/admin/bank-accounts/{account_id}")
async def delete_admin_bank_account(
    account_id: str,
    admin=Depends(require_admin),
):
    """Delete an admin bank account."""
    client = get_supabase()
    
    result = client.table("admin_bank_accounts").delete().eq("id", account_id).execute()
    
    if not result.data:
        raise HTTPException(status_code=404, detail="Bank account not found")
    
    return {"ok": True, "message": "Bank account deleted"}


# ============= Admin Shift Management =============

@app.get("/api/admin/users", response_model=AdminUsersResponse)
async def get_admin_users(admin=Depends(require_admin)):
    """Get list of admin users for shift selection."""
    client = get_supabase()
    res = client.table("admin_users").select("*").eq("is_active", True).order("name").execute()
    
    admins = [
        AdminUser(
            id=row.get("id"),
            name=row.get("name"),
            is_active=row.get("is_active", True),
        )
        for row in res.data or []
    ]
    return AdminUsersResponse(admins=admins)


@app.get("/api/admin/shift", response_model=AdminShiftResponse)
async def get_current_shift(admin=Depends(require_admin)):
    """Get current active shift status from single-row admin_shifts table."""
    client = get_supabase()
    res = client.table("admin_shifts").select("*").eq("id", 1).limit(1).execute()
    
    if not res.data or not res.data[0].get("current_admin_id"):
        return AdminShiftResponse(
            current_admin_id=None,
            current_admin_name=None,
            last_updated=None,
            is_shift_active=False
        )
    
    shift_data = res.data[0]
    
    # Get admin name from admin_users table
    admin_name = None
    if shift_data.get("current_admin_id"):
        admin_res = client.table("admin_users").select("name").eq("id", shift_data.get("current_admin_id")).limit(1).execute()
        if admin_res.data:
            admin_name = admin_res.data[0].get("name")
    
    return AdminShiftResponse(
        current_admin_id=shift_data.get("current_admin_id"),
        current_admin_name=admin_name,
        last_updated=shift_data.get("last_updated"),
        is_shift_active=shift_data.get("current_admin_id") is not None
    )

@app.post("/api/admin/shift/open")
async def open_shift(payload: ShiftOpenRequest, admin=Depends(require_admin)):
    """Open a new shift. Updates single-row admin_shifts and logs to admin_activity_logs."""
    client = get_supabase()
    now = datetime.now(timezone.utc)
    
    # Get current shift state first
    current = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    previous_admin_id = current.data[0].get("current_admin_id") if current.data else None
    
    # Update the single-row shift table
    result = client.table("admin_shifts").update({
        "current_admin_id": payload.admin_id,
        "last_updated": now.isoformat()
    }).eq("id", 1).execute()
    
    if not result.data:
        # If row doesn't exist, insert it
        client.table("admin_shifts").insert({
            "id": 1,
            "current_admin_id": payload.admin_id,
            "last_updated": now.isoformat()
        }).execute()
    
    # Log the activity
    client.table("admin_activity_logs").insert({
        "action_type": "opened",
        "performed_by_admin_id": payload.admin_id,
        "target_admin_id": payload.admin_id,
        "previous_admin_id": previous_admin_id,
        "is_automatic": False,
        "timestamp": now.isoformat()
    }).execute()
    
    return {"ok": True, "message": f"Shift opened for admin {payload.admin_id}"}


@app.post("/api/admin/shift/transfer")
async def transfer_shift(payload: ShiftTransferRequest, admin=Depends(require_admin)):
    """Transfer shift from one admin to another."""
    client = get_supabase()
    now = datetime.now(timezone.utc)
    
    # Verify current shift belongs to from_admin_id
    current = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    if not current.data or current.data[0].get("current_admin_id") != payload.from_admin_id:
        raise HTTPException(status_code=400, detail="Current shift does not belong to the specified admin")
    
    previous_admin_id = current.data[0].get("current_admin_id")
    
    # Get admin names for notification
    from_admin_res = client.table("admin_users").select("name").eq("id", payload.from_admin_id).limit(1).execute()
    to_admin_res = client.table("admin_users").select("name").eq("id", payload.to_admin_id).limit(1).execute()
    from_name = from_admin_res.data[0].get("name") if from_admin_res.data else str(payload.from_admin_id)
    to_name = to_admin_res.data[0].get("name") if to_admin_res.data else str(payload.to_admin_id)
    
    # Update shift to new admin
    client.table("admin_shifts").update({
        "current_admin_id": payload.to_admin_id,
        "last_updated": now.isoformat()
    }).eq("id", 1).execute()
    
    # Log the transfer activity
    client.table("admin_activity_logs").insert({
        "action_type": "transferred",
        "performed_by_admin_id": payload.from_admin_id,
        "target_admin_id": payload.to_admin_id,
        "previous_admin_id": previous_admin_id,
        "is_automatic": False,
        "timestamp": now.isoformat()
    }).execute()
    
    # Send notification to new admin about balance logging
    notification_text = (
        f"🔄 <b>Ээлж шилжүүлэн авлаа</b>\n\n"
        f"👤 Өмнөх админ: {from_name}\n"
        f"👤 Шинэ админ: {to_name}\n\n"
        f"⚠️ <b>Шилжүүлэхээс өмнө банкны дансны үлдэгдлийг бүртгээрэй!</b>\n\n"
        f"🔗 <a href='https://oyunsadmin.pages.dev/'>OYUNS ALL-IN-ONE ДОТООД СИСТЕМ</a>"
    )
    send_user_notification(payload.to_admin_id, notification_text)
    
    # Send notification to previous admin about shift transfer
    prev_admin_notification = (
        f"🔄 <b>Ээлж шилжүүллээ</b>\n\n"
        f"👤 Таны ээлжийг {to_name} хүлээж авлаа.\n\n"
        f"🔗 <a href='https://oyunsadmin.pages.dev/'>OYUNS ALL-IN-ONE ДОТООД СИСТЕМ</a>"
    )
    send_user_notification(payload.from_admin_id, prev_admin_notification)
    
    return {"ok": True, "message": f"Shift transferred from {payload.from_admin_id} to {payload.to_admin_id}"}


@app.post("/api/admin/shift/close")
async def close_shift(payload: ShiftCloseRequest, admin=Depends(require_admin)):
    """Close current shift."""
    client = get_supabase()
    now = datetime.now(timezone.utc)
    
    # Get current shift to log
    current = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    previous_admin_id = current.data[0].get("current_admin_id") if current.data else None
    
    # Get admin name for notification
    admin_name = str(payload.admin_id)
    if previous_admin_id:
        admin_res = client.table("admin_users").select("name").eq("id", previous_admin_id).limit(1).execute()
        if admin_res.data:
            admin_name = admin_res.data[0].get("name")
    
    # Clear the current admin
    client.table("admin_shifts").update({
        "current_admin_id": None,
        "last_updated": now.isoformat()
    }).eq("id", 1).execute()
    
    # Log the close activity
    client.table("admin_activity_logs").insert({
        "action_type": "closed",
        "performed_by_admin_id": payload.admin_id,
        "target_admin_id": None,
        "previous_admin_id": previous_admin_id,
        "is_automatic": False,
        "timestamp": now.isoformat()
    }).execute()
    
    # Send notification about balance logging
    notification_text = (
        f"🔒 <b>Ээлж хаагдлаа</b>\n\n"
        f"👤 Админ: {admin_name}\n\n"
        f"⚠️ <b>Ээлж хаасны дараа банкны дансны үлдэгдлийг бүртгээрэй!</b>\n\n"
        f"🔗 <a href='https://oyunsadmin.pages.dev/'>OYUNS ALL-IN-ONE ДОТООД СИСТЕМ</a>"
    )
    send_user_notification(payload.admin_id, notification_text)
    
    return {"ok": True, "message": "Shift closed"}


# ============= Working Hours Management =============

@app.get("/api/admin/working-hours", response_model=WorkingHoursResponse)
async def get_working_hours(admin=Depends(require_admin)):
    """Get current working hours configuration."""
    client = get_supabase()
    res = client.table("working_hours").select("*").eq("id", 1).limit(1).execute()
    
    if not res.data:
        # Return defaults if not configured
        return WorkingHoursResponse(
            start_hour_moscow=4,
            end_hour_moscow=23,
            start_time_moscow="04:00",
            end_time_moscow="23:00",
            start_time_ub="09:00",
            end_time_ub="04:00",
            is_enabled=True,
            updated_at=None
        )
    
    config = res.data[0]
    start_hour = config.get("start_hour_moscow", 4)
    end_hour = config.get("end_hour_moscow", 23)
    
    return WorkingHoursResponse(
        start_hour_moscow=start_hour,
        end_hour_moscow=end_hour,
        start_time_moscow=f"{start_hour:02d}:00",
        end_time_moscow=f"{end_hour:02d}:00",
        start_time_ub=f"{moscow_to_ub_hour(start_hour):02d}:00",
        end_time_ub=f"{moscow_to_ub_hour(end_hour):02d}:00",
        is_enabled=config.get("is_enabled", True),
        updated_at=config.get("updated_at")
    )


@app.put("/api/admin/working-hours")
async def update_working_hours(
    payload: WorkingHoursUpdateRequest, 
    admin=Depends(require_admin)
):
    """Update working hours configuration."""
    # Validate hours
    if not (0 <= payload.start_hour_moscow <= 23):
        raise HTTPException(status_code=400, detail="Start hour must be between 0 and 23")
    if not (0 <= payload.end_hour_moscow <= 23):
        raise HTTPException(status_code=400, detail="End hour must be between 0 and 23")
    
    client = get_supabase()
    now = datetime.now(timezone.utc)
    
    update_payload = {
        "id": 1,
        "start_hour_moscow": payload.start_hour_moscow,
        "end_hour_moscow": payload.end_hour_moscow,
        "is_enabled": payload.is_enabled,
        "updated_at": now.isoformat()
    }
    
    # Upsert the configuration
    result = client.table("working_hours").upsert(update_payload).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update working hours")
    
    return {
        "ok": True, 
        "message": f"Working hours updated: {payload.start_hour_moscow:02d}:00 - {payload.end_hour_moscow:02d}:00 Moscow",
        "start_time_ub": f"{moscow_to_ub_hour(payload.start_hour_moscow):02d}:00",
        "end_time_ub": f"{moscow_to_ub_hour(payload.end_hour_moscow):02d}:00"
    }


# Promo code validation
@app.post("/api/promo/validate", response_model=PromoCodeValidateResponse)
async def validate_promo_code(
    payload: PromoCodeValidateRequest,
    user=Depends(get_jwt_authenticated_user),
):
    """
    Validate a promo code.
    Returns discount amount to adjust the exchange rate.
    - For BUY (RUB→MNT): discount is ADDED to rate (e.g., 43.5 + 0.2 = 43.7)
    - For SELL (MNT→RUB): discount is SUBTRACTED from rate (e.g., 46.5 - 0.2 = 46.3)
    """
    client = get_supabase()
    code_upper = payload.code.upper()
    
    # Query promo_codes table - check both code and aliases
    res = (
        client.table("promo_codes")
        .select("*")
        .eq("active", True)
        .execute()
    )
    
    # Find matching promo by code or alias
    promo = None
    for p in res.data or []:
        if p.get("code", "").upper() == code_upper:
            promo = p
            break
        aliases = p.get("aliases") or []
        if any(alias.upper() == code_upper for alias in aliases):
            promo = p
            break
    
    if not promo:
        return PromoCodeValidateResponse(
            valid=False,
            message="Промокод олдсонгүй"
        )
    
    # Check if promo is for specific user
    promo_user_id = promo.get("user_id")
    if promo_user_id and int(promo_user_id) != user.id:
        return PromoCodeValidateResponse(
            valid=False,
            message="Буруу промокод байна"
        )
    
    # Check expiry
    expires_at = promo.get("expires_at")
    if expires_at:
        from datetime import datetime, timezone
        # Handle different timestamp formats
        if isinstance(expires_at, str):
            if "T" in expires_at:
                expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            else:
                expiry = datetime.fromisoformat(expires_at)
        else:
            expiry = expires_at
        
        if expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        
        if datetime.now(timezone.utc) > expiry:
            return PromoCodeValidateResponse(
                valid=False,
                message="Промокодын хугацаа дууссан байна"
            )
    
    discount = float(promo.get("discount", 0) or 0)
    
    # Explain how discount applies based on direction
    if payload.direction.lower() == "buy":
        msg = f"🎉 +{discount} ₮ хөнгөлөлт!"
    else:
        msg = f"🎉 -{discount} ₮ хөнгөлөлт!"
    
    return PromoCodeValidateResponse(
        valid=True,
        discount_amount=discount,
        message=msg
    )


# User's promo codes
@app.get("/api/user/promo-codes", response_model=UserPromoCodesResponse)
async def get_user_promo_codes(user=Depends(get_jwt_authenticated_user)):
    """
    Get promo codes belonging to the authenticated user.
    Returns codes from promo_codes table where user_id matches.
    """
    client = get_supabase()
    
    res = (
        client.table("promo_codes")
        .select("code,discount,active,expires_at,source")
        .eq("user_id", user.id)
        .eq("active", True)  # Only return active promo codes
        .execute()
    )
    
    promo_codes = [
        UserPromoCode(
            code=p.get("code"),
            discount=float(p.get("discount", 0) or 0),
            active=p.get("active", False),
            expires_at=p.get("expires_at"),
            source=p.get("source"),
        )
        for p in res.data or []
    ]
    
    return UserPromoCodesResponse(promo_codes=promo_codes)


# ============= Gift Feature Endpoints =============

@app.get("/api/gift/cards", response_model=GiftCardsResponse)
async def get_gift_cards():
    """Get all active gift cards"""
    client = get_supabase()
    
    res = (
        client.table("gift_cards")
        .select("*")
        .eq("is_active", True)
        .order("display_order", desc=False)
        .execute()
    )
    
    cards = [
        GiftCard(
            id=str(c.get("id")),
            name=c.get("name", ""),
            image_url=c.get("image_url", ""),
            is_active=c.get("is_active", True),
            display_order=c.get("display_order", 0),
        )
        for c in res.data or []
    ]
    
    return GiftCardsResponse(cards=cards)


@app.get("/api/gift/lookup-recipient", response_model=RecipientLookupResponse)
async def lookup_recipient_by_phone(
    phone: str,
    user=Depends(get_jwt_authenticated_user)
):
    """Look up a verified user by phone number.
    
    Searches in:
    1. phone column directly
    2. bank_rub column - format: "Банк, +79603548085, Данс, Нэр"
    3. bank_mnt column - format: "Банк, Данс, Нэр"
    """
    client = get_supabase()
    import re
    
    # === INPUT VALIDATION & SANITIZATION ===
    if not phone or not phone.strip():
        return RecipientLookupResponse(found=False)
    
    # Clean phone number - remove spaces, dashes, parentheses
    clean_phone = re.sub(r'[\s\-\(\)\.]', '', phone.strip())
    
    # Validate: must contain only digits and optionally start with +
    if not re.match(r'^\+?\d+$', clean_phone):
        return RecipientLookupResponse(found=False)
    
    # Minimum length check (at least 6 digits for any valid phone)
    digits_only = re.sub(r'\D', '', clean_phone)
    if len(digits_only) < 6:
        return RecipientLookupResponse(found=False)
    
    # Maximum length check (no phone number exceeds 15 digits)
    if len(digits_only) > 15:
        return RecipientLookupResponse(found=False)
    
    # Also create version without + for comparison
    phone_no_plus = clean_phone.lstrip("+")
    
    # Helper function to extract phone numbers from bank info string
    def extract_phone_from_bank_info(bank_info: str) -> list:
        """Extract phone numbers from comma-separated bank info.
        Examples: 
        - 'Сбер банк, +79603548085, 2202205354510650, Баасанжаргал'
        - 'ВТБ , 996 979 52 32 , 2200246009136030 , Батбаяр Эхбаяр'
        - 'Голомт банк,MN84 0015 001205195640,Тэмүүлэн,+976 9961 3100'
        Returns list of cleaned phone numbers found.
        """
        if not bank_info:
            return []
        
        phones = []
        parts = bank_info.split(",")
        for part in parts:
            # Clean the part - remove spaces, dashes, parentheses
            cleaned = re.sub(r'[\s\-\(\)\.]', '', part.strip())
            
            # Skip if too short or doesn't look like a number
            if len(cleaned) < 7:
                continue
                
            # Check if this part looks like a phone number
            # 1. Starts with + (international format)
            if cleaned.startswith("+") and 10 <= len(cleaned) <= 16:
                phones.append(cleaned)
                phones.append(cleaned.lstrip("+"))
                continue
            
            # 2. Pure digits that could be a phone number
            digits_only = re.sub(r'\D', '', cleaned)
            
            # Skip if looks like a card number (16+ digits)
            if len(digits_only) >= 16:
                continue
            
            # Skip if looks like an IBAN (starts with MN followed by digits)
            if cleaned.upper().startswith("MN") and len(digits_only) >= 12:
                continue
            
            # Russian phone numbers: 10-11 digits (with or without leading 7/8)
            # Mongolian phone numbers: 8 digits
            if 8 <= len(digits_only) <= 12:
                phones.append(digits_only)
                # Also add without leading 7 or 8 for Russian numbers
                if len(digits_only) == 11 and digits_only[0] in ('7', '8'):
                    phones.append(digits_only[1:])
                # Also add with country code variations for Mongolian
                if len(digits_only) == 8:
                    phones.append("976" + digits_only)
        
        return phones
    
    # Helper function for safe phone comparison
    def phones_match(search_phone: str, user_phone: str) -> bool:
        """Safely compare two phone numbers with various formats."""
        if not search_phone or not user_phone:
            return False
        
        # Normalize both - only digits
        search_digits = re.sub(r'\D', '', search_phone)
        user_digits = re.sub(r'\D', '', user_phone)
        
        if not search_digits or not user_digits:
            return False
        
        # Exact match
        if search_digits == user_digits:
            return True
        
        # Handle Russian numbers: compare last 10 digits
        # (handles cases like 79991234567 vs 9991234567 vs 89991234567)
        if len(search_digits) >= 10 and len(user_digits) >= 10:
            if search_digits[-10:] == user_digits[-10:]:
                return True
        
        # Handle Mongolian numbers: compare last 8 digits
        # (handles cases like 97699613100 vs 99613100)
        if len(search_digits) >= 8 and len(user_digits) >= 8:
            search_last8 = search_digits[-8:]
            user_last8 = user_digits[-8:]
            # Only match if both are likely Mongolian (last 8 digits match and neither is 10+ digits without 976 prefix)
            if search_last8 == user_last8:
                # Check if both could be Mongolian numbers
                search_is_mn = len(search_digits) == 8 or (len(search_digits) == 11 and search_digits.startswith("976"))
                user_is_mn = len(user_digits) == 8 or (len(user_digits) == 11 and user_digits.startswith("976"))
                if search_is_mn or user_is_mn:
                    return True
        
        return False
    
    try:
        # Search in users table
        res = (
            client.table("users")
            .select("id, first_name, last_name, phone, bank_rub, bank_mnt")
            .eq("verified", True)
            .execute()
        )
        
        for u in res.data or []:
            # Don't allow sending to yourself
            if u.get("id") == user.id:
                continue
            
            # 1. Check phone column directly (Russian phone)
            user_phone = u.get("phone") or ""
            if user_phone and phones_match(clean_phone, user_phone):
                return RecipientLookupResponse(
                    found=True,
                    user={
                        "id": u.get("id"),
                        "first_name": u.get("first_name"),
                        "last_name": u.get("last_name"),
                    }
                )
            
            # 2. Check bank_rub column for phone number
            bank_rub = u.get("bank_rub") or ""
            rub_phones = extract_phone_from_bank_info(bank_rub)
            for rub_phone in rub_phones:
                if phones_match(clean_phone, rub_phone):
                    return RecipientLookupResponse(
                        found=True,
                        user={
                            "id": u.get("id"),
                            "first_name": u.get("first_name"),
                            "last_name": u.get("last_name"),
                        }
                    )
            
            # 4. Check bank_mnt column (may also contain phone in some formats)
            bank_mnt = u.get("bank_mnt") or ""
            mnt_phones = extract_phone_from_bank_info(bank_mnt)
            for mnt_phone in mnt_phones:
                if phones_match(clean_phone, mnt_phone):
                    return RecipientLookupResponse(
                        found=True,
                        user={
                            "id": u.get("id"),
                            "first_name": u.get("first_name"),
                            "last_name": u.get("last_name"),
                        }
                    )
        
        return RecipientLookupResponse(found=False)
        
    except Exception as e:
        # Log error but don't expose details to client
        print(f"Error in recipient lookup: {e}")
        return RecipientLookupResponse(found=False)


@app.get("/api/gift/sent", response_model=SentGiftsResponse)
async def get_sent_gifts(
    user=Depends(get_jwt_authenticated_user)
):
    """Get all gifts sent by the current user"""
    client = get_supabase()
    
    try:
        res = (
            client.table("gifts")
            .select("id, invoice, recipient_user_id, amount, currency_from, currency_to, status, created_at")
            .eq("sender_user_id", user.id)
            .order("created_at", desc=True)
            .execute()
        )
        
        gifts = []
        for g in res.data or []:
            # Get recipient name
            recipient_name = {"first_name": None, "last_name": None}
            if g.get("recipient_user_id"):
                try:
                    recipient_res = (
                        client.table("users")
                        .select("first_name, last_name")
                        .eq("id", g.get("recipient_user_id"))
                        .single()
                        .execute()
                    )
                    if recipient_res.data:
                        recipient_name = recipient_res.data
                except:
                    pass
            
            gifts.append(SentGift(
                id=str(g.get("id")),
                invoice=g.get("invoice", ""),
                recipient_first_name=recipient_name.get("first_name"),
                recipient_last_name=recipient_name.get("last_name"),
                amount=g.get("amount", 0),
                currency_from=g.get("currency_from", ""),
                currency_to=g.get("currency_to", ""),
                status=g.get("status", ""),
                created_at=g.get("created_at"),
            ))
        
        return SentGiftsResponse(gifts=gifts)
        
    except Exception as e:
        logger.error(f"Error fetching sent gifts: {e}")
        return SentGiftsResponse(gifts=[])


@app.post("/api/gift/create", response_model=GiftCreateResponse)
async def create_gift(
    payload: GiftCreateRequest,
    user=Depends(get_jwt_authenticated_user)
):
    """Create a new gift transaction"""
    client = get_supabase()
    _require_service_open(client)

    settings = get_settings()
    
    try:
        # Get sender details
        sender_res = client.table("users").select("first_name, last_name").eq("id", user.id).single().execute()
        sender_name = f"{sender_res.data.get('first_name', '')} {sender_res.data.get('last_name', '')}".strip()
        
        # Get recipient details
        recipient_res = client.table("users").select("first_name, last_name, bank_mnt").eq("id", payload.recipient_user_id).single().execute()
        recipient_name = f"{recipient_res.data.get('first_name', '')} {recipient_res.data.get('last_name', '')}".strip()
        
        # Create gift record
        gift_data = {
            "invoice": payload.invoice,
            "sender_user_id": user.id,
            "recipient_user_id": payload.recipient_user_id,
            "recipient_phone": payload.recipient_phone,
            "recipient_name": recipient_name,
            "gift_card_url": payload.gift_card_url,
            "message": payload.message[:1000] if payload.message else "",
            "from_name": payload.from_name[:100] if payload.from_name else None,
            "direction": payload.direction,
            "amount": float(payload.amount),
            "currency_from": payload.currency_from,
            "currency_to": payload.currency_to,
            "rate": float(payload.rate),
            "admin_bank_id": payload.admin_bank_id,
            "sender_receipt_url": payload.sender_receipt_url,
            "status": "pending_recipient",
        }
        
        res = client.table("gifts").insert(gift_data).execute()
        
        if not res.data:
            raise HTTPException(status_code=500, detail="Failed to create gift")
        
        gift_id = res.data[0].get("id")
        
        # Calculate receive amount
        if payload.direction == "buy":
            receive_amount = float(payload.amount) * float(payload.rate)
        else:
            receive_amount = float(payload.amount) / float(payload.rate)
        
        # Send Telegram notification to recipient with gift card photo
        try:
            # Use from_name if provided, otherwise use sender's actual name
            display_sender = payload.from_name if payload.from_name else sender_name
            
            recipient_lang = _get_user_lang(payload.recipient_user_id)
            message_text = tb(recipient_lang, "notif_gift_incoming",
                sender=display_sender,
                amount=payload.amount,
                currency_from=payload.currency_from,
                receive_amount=f"{receive_amount:,.2f}",
                currency_to=payload.currency_to)
            message_text += "\n"
            
            if payload.message:
                message_text += tb(recipient_lang, "notif_gift_incoming_msg", message=payload.message)
                message_text += "\n"
            
            message_text += tb(recipient_lang, "notif_gift_incoming_cta")
            
            # Create inline keyboard with app link
            reply_markup = None
            webapp_url = settings.webapp_url
            logger.info(f"Gift notification - webapp_url configured: {webapp_url}")
            
            if webapp_url:
                # Use web_app button for Mini App
                reply_markup = {
                    "inline_keyboard": [
                        [{"text": tb(recipient_lang, "btn_gift_accept"), "web_app": {"url": webapp_url}}]
                    ]
                }
                logger.info(f"Gift notification - reply_markup: {reply_markup}")
            else:
                # Fallback: Use bot username link if no webapp_url configured
                logger.warning("WEBAPP_URL not configured - gift notification will not have app launch button")
            
            # Send gift card photo with caption
            result = send_user_photo(
                payload.recipient_user_id,
                payload.gift_card_url,
                message_text,
                reply_markup=reply_markup
            )
            logger.info(f"Gift notification send result: {result}")
        except Exception as e:
            logger.error(f"Failed to send gift notification: {e}")
        
        return GiftCreateResponse(
            id=str(gift_id),
            invoice=payload.invoice,
            status="pending_recipient"
        )
    
    except Exception as e:
        logger.error(f"Error creating gift: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create gift: {str(e)}")


@app.get("/api/gift/pending", response_model=PendingGiftsResponse)
async def get_pending_gifts(user=Depends(get_jwt_authenticated_user)):
    """Get gifts pending confirmation from the current user"""
    client = get_supabase()
    
    res = (
        client.table("gifts")
        .select("*, sender:users!sender_user_id(first_name, last_name)")
        .eq("recipient_user_id", user.id)
        .eq("status", "pending_recipient")
        .order("created_at", desc=True)
        .execute()
    )
    
    gifts = []
    for g in res.data or []:
        sender = g.get("sender", {}) or {}
        gifts.append(PendingGift(
            id=str(g.get("id")),
            invoice=g.get("invoice", ""),
            sender_user_id=g.get("sender_user_id"),
            sender_first_name=sender.get("first_name"),
            sender_last_name=sender.get("last_name"),
            gift_card_url=g.get("gift_card_url", ""),
            message=g.get("message", ""),
            direction=g.get("direction", ""),
            amount=g.get("amount", 0),
            currency_from=g.get("currency_from", ""),
            currency_to=g.get("currency_to", ""),
            rate=g.get("rate", 0),
            created_at=g.get("created_at"),
        ))
    
    return PendingGiftsResponse(gifts=gifts)


@app.post("/api/gift/{gift_id}/confirm")
async def confirm_gift(
    gift_id: str,
    payload: GiftConfirmRequest,
    user=Depends(get_jwt_authenticated_user)
):
    """Recipient confirms gift and provides bank details"""
    client = get_supabase()
    settings = get_settings()
    
    try:
        # Get the gift
        res = client.table("gifts").select("*").eq("id", gift_id).single().execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="Gift not found")
        
        gift = res.data
        
        # Verify recipient
        if gift.get("recipient_user_id") != user.id:
            raise HTTPException(status_code=403, detail="Not your gift")
        
        # Verify status
        if gift.get("status") != "pending_recipient":
            raise HTTPException(status_code=400, detail="Gift already confirmed")
        
        # Update gift with bank details and change status to pending_admin
        client.table("gifts").update({
            "recipient_bank_details": payload.bank_details,
            "status": "pending_admin",
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", gift_id).execute()
        
        # Get sender and recipient names
        try:
            sender_res = client.table("users").select("first_name, last_name").eq("id", gift.get("sender_user_id")).single().execute()
            sender_name = f"{sender_res.data.get('first_name', '')} {sender_res.data.get('last_name', '')}".strip() if sender_res.data else "Unknown"
        except Exception:
            sender_name = "Unknown"
        
        try:
            recipient_res = client.table("users").select("first_name, last_name").eq("id", user.id).single().execute()
            recipient_name = f"{recipient_res.data.get('first_name', '')} {recipient_res.data.get('last_name', '')}".strip() if recipient_res.data else "Unknown"
        except Exception:
            recipient_name = "Unknown"
        
        # Calculate receive amount
        direction = gift.get("direction")
        amount = gift.get("amount", 0)
        rate = gift.get("rate", 0)
        if direction == "buy":
            receive_amount = amount * rate
        else:
            receive_amount = amount / rate if rate else 0
        
        # Notify admin
        admin_message = (
            f"🎁 <b>БЭЛЭГ ШИЛЖҮҮЛЭЛТ!</b>\n\n"
            f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
            f"👤 Илгээгч: {sender_name} (ID: {gift.get('sender_user_id')})\n"
            f"🎯 Хүлээн авагч: {recipient_name} (ID: {user.id})\n"
            f"📞 Утас: {gift.get('recipient_phone')}\n\n"
            f"💰 Дүн: <b>{amount}</b> {gift.get('currency_from')}\n"
            f"📦 Шилжүүлэх: <b>{receive_amount:,.2f}</b> {gift.get('currency_to')}\n"
            f"📈 Ханш: {rate}\n\n"
            f"🏦 Хүлээн авагчийн банк:\n<code>{payload.bank_details}</code>\n"
        )
        
        if gift.get("message"):
            admin_message += f"\n💬 Мессеж: <i>\"{gift.get('message')}\"</i>\n"
        
        send_admin_notification(admin_message, gift.get("sender_receipt_url"))
        
        return {"ok": True, "status": "pending_admin"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error confirming gift {gift_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to confirm gift: {str(e)}")


@app.get("/api/admin/gifts", response_model=AdminGiftsResponse)
async def get_admin_gifts(
    status: str = None,
    user=Depends(get_jwt_authenticated_user)
):
    """Get all gifts for admin review"""
    client = get_supabase()
    settings = get_settings()
    
    # Check if user is admin
    if user.id not in settings.admin_ids:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    query = client.table("gifts").select(
        "*, sender:users!sender_user_id(first_name, last_name), recipient:users!recipient_user_id(first_name, last_name)"
    )
    
    if status:
        query = query.eq("status", status)
    
    res = query.order("created_at", desc=True).execute()
    
    gifts = []
    for g in res.data or []:
        sender = g.get("sender", {}) or {}
        recipient = g.get("recipient", {}) or {}
        gifts.append(AdminGift(
            id=str(g.get("id")),
            invoice=g.get("invoice", ""),
            sender_user_id=g.get("sender_user_id"),
            sender_first_name=sender.get("first_name"),
            sender_last_name=sender.get("last_name"),
            recipient_user_id=g.get("recipient_user_id"),
            recipient_first_name=recipient.get("first_name"),
            recipient_last_name=recipient.get("last_name"),
            recipient_phone=g.get("recipient_phone", ""),
            gift_card_url=g.get("gift_card_url", ""),
            message=g.get("message", ""),
            direction=g.get("direction", ""),
            amount=g.get("amount", 0),
            currency_from=g.get("currency_from", ""),
            currency_to=g.get("currency_to", ""),
            rate=g.get("rate", 0),
            status=g.get("status", ""),
            sender_receipt_url=g.get("sender_receipt_url"),
            recipient_bank_details=g.get("recipient_bank_details"),
            admin_bill_url=g.get("admin_bill_url"),
            rejection_comment=g.get("rejection_comment"),
            created_at=g.get("created_at"),
            confirmed_at=g.get("confirmed_at"),
            completed_at=g.get("completed_at"),
        ))
    
    return AdminGiftsResponse(gifts=gifts)


@app.post("/api/admin/gift/{gift_id}/preapprove")
async def preapprove_gift(
    gift_id: str,
    payload: GiftPreapproveRequest = None,
    user=Depends(get_jwt_authenticated_user)
):
    """Admin preapproves a gift transaction - shows bank details and allows attaching bills"""
    client = get_supabase()
    settings = get_settings()
    
    # Check if user is admin
    if user.id not in settings.admin_ids:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get gift
    res = client.table("gifts").select("*").eq("id", gift_id).single().execute()
    
    if not res.data:
        raise HTTPException(status_code=404, detail="Gift not found")
    
    gift = res.data
    
    if gift.get("status") != "pending_admin":
        raise HTTPException(status_code=400, detail="Gift cannot be preapproved")
    
    # Update gift status to preapproved
    import json
    update_data = {
        "status": "preapproved",
        "preapproved_at": datetime.now(timezone.utc).isoformat(),
        "preapproved_by_admin": user.id,
    }
    
    # Store bill URLs if provided
    if payload and payload.admin_bill_urls:
        update_data["admin_bill_url"] = json.dumps(payload.admin_bill_urls)
    
    client.table("gifts").update(update_data).eq("id", gift_id).execute()
    
    # Get sender and recipient names
    sender_res = client.table("users").select("first_name, last_name").eq("id", gift.get("sender_user_id")).single().execute()
    sender_name = f"{sender_res.data.get('first_name', '')} {sender_res.data.get('last_name', '')}".strip() if sender_res.data else "хэрэглэгч"
    
    recipient_res = client.table("users").select("first_name, last_name").eq("id", gift.get("recipient_user_id")).single().execute()
    recipient_name = f"{recipient_res.data.get('first_name', '')} {recipient_res.data.get('last_name', '')}".strip() if recipient_res.data else "хэрэглэгч"
    
    # Notify sender about preapproval
    sender_lang = _get_user_lang(gift.get("sender_user_id"))
    sender_message = (
        f"{tb(sender_lang, 'notif_gift_preapproved_sender')}\n\n"
        f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
        f"🎯 {recipient_name}\n"
        f"💰 {gift.get('amount')} {gift.get('currency_from')}"
    )
    send_user_notification(gift.get("sender_user_id"), sender_message)
    
    # Notify recipient about preapproval
    recipient_lang = _get_user_lang(gift.get("recipient_user_id"))
    recipient_message = (
        f"{tb(recipient_lang, 'notif_gift_preapproved_recipient', sender=sender_name)}\n\n"
        f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
        f"💰 {gift.get('amount')} {gift.get('currency_from')}\n"
        f"🏦 {gift.get('recipient_bank_details')}"
    )
    send_user_notification(gift.get("recipient_user_id"), recipient_message)
    
    return {"ok": True, "status": "preapproved"}


@app.post("/api/admin/gift/{gift_id}/finalize")
async def finalize_gift(
    gift_id: str,
    payload: GiftFinalizeRequest = None,
    user=Depends(get_jwt_authenticated_user)
):
    """Admin finalizes a preapproved gift transaction with bill photos"""
    client = get_supabase()
    settings = get_settings()
    
    # Check if user is admin
    if user.id not in settings.admin_ids:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get gift
    res = client.table("gifts").select("*").eq("id", gift_id).single().execute()
    
    if not res.data:
        raise HTTPException(status_code=404, detail="Gift not found")
    
    gift = res.data
    
    if gift.get("status") != "preapproved":
        raise HTTPException(status_code=400, detail="Gift must be preapproved first")
    
    # Update gift status to completed
    import json
    update_data = {
        "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "completed_by_admin": user.id,
    }
    
    # Store bill URLs if provided (merge with existing)
    existing_bills = []
    if gift.get("admin_bill_url"):
        try:
            parsed = json.loads(gift.get("admin_bill_url"))
            if isinstance(parsed, list):
                existing_bills = parsed
            else:
                existing_bills = [gift.get("admin_bill_url")]
        except:
            existing_bills = [gift.get("admin_bill_url")]
    
    if payload and payload.admin_bill_urls:
        all_bills = existing_bills + payload.admin_bill_urls
        update_data["admin_bill_url"] = json.dumps(all_bills)
    
    client.table("gifts").update(update_data).eq("id", gift_id).execute()

    try:
        gift_amount = _to_decimal(gift.get("amount"))
        gift_rate = _to_decimal(gift.get("rate"))
        if (gift.get("currency_from") or "").upper() == "RUB":
            gift_rub_equivalent = gift_amount
        else:
            gift_rub_equivalent = (gift_amount / gift_rate) if gift_rate > 0 else Decimal("0")

        oyuns_plus_settings = _get_oyuns_plus_settings(client)
        earned_points = _calculate_oyuns_plus_points(gift_rub_equivalent, oyuns_plus_settings)
        _award_oyuns_plus_points_once(
            client,
            user_id=int(gift.get("sender_user_id")),
            source_type="gift_completed",
            source_id=str(gift_id),
            points=earned_points,
            rub_equivalent=gift_rub_equivalent,
            metadata={
                "invoice": gift.get("invoice"),
                "status": "completed",
            },
        )
    except Exception as points_err:
        logger.error(f"Failed to award Oyuns Plus points for gift {gift_id}: {points_err}")
    
    # Get sender and recipient names
    sender_res = client.table("users").select("first_name, last_name").eq("id", gift.get("sender_user_id")).single().execute()
    sender_name = f"{sender_res.data.get('first_name', '')} {sender_res.data.get('last_name', '')}".strip() if sender_res.data else "хэрэглэгч"
    
    recipient_res = client.table("users").select("first_name, last_name").eq("id", gift.get("recipient_user_id")).single().execute()
    recipient_name = f"{recipient_res.data.get('first_name', '')} {recipient_res.data.get('last_name', '')}".strip() if recipient_res.data else "хэрэглэгч"
    
    # Get all bill URLs for sending
    all_bill_urls = existing_bills
    if payload and payload.admin_bill_urls:
        all_bill_urls = existing_bills + payload.admin_bill_urls
    
    # Notify sender with photos if available
    sender_lang = _get_user_lang(gift.get("sender_user_id"))
    sender_message = (
        f"{tb(sender_lang, 'notif_gift_finalized_sender', recipient=recipient_name)}\n\n"
        f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
        f"💰 {gift.get('amount')} {gift.get('currency_from')}\n\n🎉"
    )
    if all_bill_urls:
        send_user_photos(gift.get("sender_user_id"), all_bill_urls, sender_message)
    else:
        send_user_notification(gift.get("sender_user_id"), sender_message)
    
    # Notify recipient with photos if available
    recipient_lang = _get_user_lang(gift.get("recipient_user_id"))
    recipient_message = (
        f"{tb(recipient_lang, 'notif_gift_finalized_recipient', sender=sender_name)}\n\n"
        f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
        f"🏦 {gift.get('recipient_bank_details')}\n\n🎉"
    )
    if all_bill_urls:
        send_user_photos(gift.get("recipient_user_id"), all_bill_urls, recipient_message)
    else:
        send_user_notification(gift.get("recipient_user_id"), recipient_message)
    
    return {"ok": True, "status": "completed"}


@app.post("/api/admin/gift/{gift_id}/approve")
async def approve_gift(
    gift_id: str,
    payload: GiftPreapproveRequest = None,
    user=Depends(get_jwt_authenticated_user)
):
    """Admin approves a gift transaction with bill photos"""
    client = get_supabase()
    settings = get_settings()
    
    # Check if user is admin
    if user.id not in settings.admin_ids:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        # Get gift
        res = client.table("gifts").select("*").eq("id", gift_id).single().execute()
        
        if not res.data:
            raise HTTPException(status_code=404, detail="Gift not found")
        
        gift = res.data
        
        if gift.get("status") != "pending_admin":
            raise HTTPException(status_code=400, detail="Gift cannot be approved")
        
        # Store bill URLs if provided
        import json
        update_data = {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "completed_by_admin": user.id,
        }
        
        if payload and payload.admin_bill_urls:
            update_data["admin_bill_url"] = json.dumps(payload.admin_bill_urls)
        
        # Update gift status
        client.table("gifts").update(update_data).eq("id", gift_id).execute()

        try:
            gift_amount = _to_decimal(gift.get("amount"))
            gift_rate = _to_decimal(gift.get("rate"))
            if (gift.get("currency_from") or "").upper() == "RUB":
                gift_rub_equivalent = gift_amount
            else:
                gift_rub_equivalent = (gift_amount / gift_rate) if gift_rate > 0 else Decimal("0")

            oyuns_plus_settings = _get_oyuns_plus_settings(client)
            earned_points = _calculate_oyuns_plus_points(gift_rub_equivalent, oyuns_plus_settings)
            _award_oyuns_plus_points_once(
                client,
                user_id=int(gift.get("sender_user_id")),
                source_type="gift_completed",
                source_id=str(gift_id),
                points=earned_points,
                rub_equivalent=gift_rub_equivalent,
                metadata={
                    "invoice": gift.get("invoice"),
                    "status": "completed",
                },
            )
        except Exception as points_err:
            logger.error(f"Failed to award Oyuns Plus points for gift {gift_id}: {points_err}")
        
        # Get recipient name for notification
        try:
            recipient_res = client.table("users").select("first_name, last_name").eq("id", gift.get("recipient_user_id")).single().execute()
            recipient_name = f"{recipient_res.data.get('first_name', '')} {recipient_res.data.get('last_name', '')}" if recipient_res.data else "хэрэглэгч"
        except Exception:
            recipient_name = "хэрэглэгч"
        
        # Get sender name for notification
        try:
            sender_res = client.table("users").select("first_name, last_name").eq("id", gift.get("sender_user_id")).single().execute()
            sender_name = f"{sender_res.data.get('first_name', '')} {sender_res.data.get('last_name', '')}" if sender_res.data else "хэрэглэгч"
        except Exception:
            sender_name = "хэрэглэгч"
        
        # Notify sender with bill photos
        sender_lang = _get_user_lang(gift.get("sender_user_id"))
        sender_message = (
            f"{tb(sender_lang, 'notif_gift_finalized_sender', recipient=recipient_name.strip())}\n\n"
            f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
            f"💰 {gift.get('amount')} {gift.get('currency_from')}"
        )
        
        # Send with bill photos if available
        if payload and payload.admin_bill_urls and len(payload.admin_bill_urls) > 0:
            send_user_photos(gift.get("sender_user_id"), payload.admin_bill_urls, sender_message)
        else:
            send_user_notification(gift.get("sender_user_id"), sender_message)
        
        # Notify recipient with bill photos if available
        recipient_lang = _get_user_lang(gift.get("recipient_user_id"))
        recipient_message = (
            f"{tb(recipient_lang, 'notif_gift_finalized_recipient', sender=sender_name.strip())}\n\n"
            f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
            f"🏦 {gift.get('recipient_bank_details')}"
        )
        
        # Send with bill photos if available
        if payload and payload.admin_bill_urls and len(payload.admin_bill_urls) > 0:
            send_user_photos(gift.get("recipient_user_id"), payload.admin_bill_urls, recipient_message)
        else:
            send_user_notification(gift.get("recipient_user_id"), recipient_message)
        
        return {"ok": True, "status": "completed"}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error approving gift {gift_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to approve gift: {str(e)}")


@app.post("/api/admin/gift/{gift_id}/reject")
async def reject_gift(
    gift_id: str,
    payload: GiftRejectRequest,
    user=Depends(get_jwt_authenticated_user)
):
    """Admin rejects a gift transaction"""
    client = get_supabase()
    settings = get_settings()
    
    # Check if user is admin
    if user.id not in settings.admin_ids:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get gift
    res = client.table("gifts").select("*").eq("id", gift_id).single().execute()
    
    if not res.data:
        raise HTTPException(status_code=404, detail="Gift not found")
    
    gift = res.data
    
    # Update gift status
    client.table("gifts").update({
        "status": "rejected",
        "rejection_comment": payload.comment,
        "completed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", gift_id).execute()
    
    # Notify sender
    sender_lang = _get_user_lang(gift.get("sender_user_id"))
    sender_message = (
        f"{tb(sender_lang, 'notif_gift_rejected_sender')}\n\n"
        f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
        f"{tb(sender_lang, 'notif_gift_rejected_reason', reason=payload.comment)}"
    )
    send_user_notification(gift.get("sender_user_id"), sender_message)
    
    # Notify recipient if they already confirmed
    if gift.get("status") == "pending_admin":
        recipient_lang = _get_user_lang(gift.get("recipient_user_id"))
        recipient_message = (
            f"{tb(recipient_lang, 'notif_gift_rejected_recipient')}\n\n"
            f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
            f"{tb(recipient_lang, 'notif_gift_rejected_reason', reason=payload.comment)}"
        )
        send_user_notification(gift.get("recipient_user_id"), recipient_message)
    
    return {"ok": True, "status": "rejected"}


# ============================================================
# FUEL PURCHASE FEATURE ENDPOINTS
# ============================================================

def _get_fuel_stations_from_db() -> dict[str, int]:
    """Fetch active fuel stations from DB. Returns {name: discount_percent}. Falls back to hardcoded."""
    try:
        client = get_supabase()
        res = client.table("fuel_stations").select("name, discount_percent").eq("is_active", True).order("display_order").execute()
        if res.data:
            return {row["name"]: row["discount_percent"] for row in res.data}
    except Exception as e:
        logger.warning(f"Failed to fetch fuel stations from DB, using fallback: {e}")
    return dict(FUEL_STATION_DISCOUNTS)


def _fuel_calculate(station_name: str, liters: float, price_per_liter: float, payment_currency: str, exchange_rate: float | None = None):
    """Server-side fuel price calculation with discount and rounding."""
    stations = _get_fuel_stations_from_db()
    discount_percent = stations.get(station_name, FUEL_STATION_DISCOUNTS.get(station_name, 13))
    gross = liters * price_per_liter
    discount = gross * discount_percent / 100
    net = gross - discount
    rounded = round(net / 100) * 100  # Round to nearest 100 RUB (>=50 up, <50 down)

    if payment_currency == "MNT" and exchange_rate and exchange_rate > 0:
        final = round(rounded * exchange_rate, 2)
    else:
        final = rounded

    return {
        "discount_percent": discount_percent,
        "gross_amount": round(gross, 2),
        "discount_amount": round(discount, 2),
        "net_amount": round(net, 2),
        "rounded_amount": rounded,
        "exchange_rate": exchange_rate,
        "final_amount": final,
    }


def _send_fuel_admin_notification(text: str, reply_markup: dict | None = None):
    """Send notification to the on-shift fuel admin's chat ID. Falls back to all fuel admin chats if no shift.
    Also sends to the always-notify admin if configured."""
    settings = get_settings()
    
    # Check if there's an active shift with a specific admin
    chat_ids = settings.fuel_admin_chat_ids or settings.admin_chat_ids
    always_notify_chat_id = None
    try:
        client = get_supabase()
        shift_res = client.table("fuel_admin_shift").select("*").eq("id", "current").single().execute()
        if shift_res.data:
            always_notify_chat_id = shift_res.data.get("always_notify_chat_id")
            if shift_res.data.get("is_active") and shift_res.data.get("chat_id"):
                chat_ids = [shift_res.data["chat_id"]]
    except Exception:
        pass  # Fall back to default chat IDs

    # Add always-notify admin if configured and not already in the list
    if always_notify_chat_id and always_notify_chat_id not in chat_ids:
        chat_ids = list(chat_ids) + [always_notify_chat_id]

    for chat_id in chat_ids:
        payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        try:
            import requests as req
            response = req.post(
                f"https://api.telegram.org/bot{settings.bot_token}/sendMessage",
                json=payload,
                timeout=10,
            )
            if response.status_code != 200:
                logger.error(f"Fuel admin notification error for {chat_id}: {response.text}")
        except Exception as e:
            logger.error(f"Failed to send fuel admin notification to {chat_id}: {e}")


@app.get("/api/fuel/stations")
async def fuel_get_stations(user=Depends(get_authenticated_user)):
    """Get active fuel stations for user selection."""
    try:
        client = get_supabase()
        res = client.table("fuel_stations").select("*").eq("is_active", True).order("display_order").execute()
        stations = [FuelStationItem(**row) for row in (res.data or [])]
    except Exception:
        # Fallback to hardcoded
        stations = [
            FuelStationItem(id="", name=name, discount_percent=disc, is_active=True, display_order=i)
            for i, (name, disc) in enumerate(FUEL_STATION_DISCOUNTS.items())
        ]
    return FuelStationsResponse(stations=stations)


@app.post("/api/fuel/calculate")
async def fuel_calculate(payload: FuelCalculateRequest, user=Depends(get_authenticated_user)):
    """Preview fuel cost calculation."""
    stations = _get_fuel_stations_from_db()
    if payload.station_name not in stations:
        raise HTTPException(status_code=400, detail=f"Unknown station: {payload.station_name}")
    if payload.liters <= 0:
        raise HTTPException(status_code=400, detail="Liters must be positive")
    if payload.station_price_per_liter <= 0:
        raise HTTPException(status_code=400, detail="Price must be positive")
    if payload.payment_currency not in ("RUB", "MNT"):
        raise HTTPException(status_code=400, detail="Currency must be RUB or MNT")

    calc = _fuel_calculate(
        payload.station_name,
        payload.liters,
        payload.station_price_per_liter,
        payload.payment_currency,
        payload.exchange_rate,
    )

    return FuelCalculateResponse(
        station_name=payload.station_name,
        liters=payload.liters,
        station_price_per_liter=payload.station_price_per_liter,
        payment_currency=payload.payment_currency,
        **calc,
    )


@app.post("/api/fuel/create")
async def fuel_create_order(payload: FuelOrderCreateRequest, user=Depends(get_authenticated_user)):
    """Create a new fuel purchase order."""
    settings = get_settings()
    client = get_supabase()

    stations = _get_fuel_stations_from_db()
    if payload.station_name not in stations:
        raise HTTPException(status_code=400, detail=f"Unknown station: {payload.station_name}")
    if payload.liters <= 0:
        raise HTTPException(status_code=400, detail="Liters must be positive")
    if payload.station_price_per_liter <= 0:
        raise HTTPException(status_code=400, detail="Price must be positive")
    if payload.payment_currency not in ("RUB", "MNT"):
        raise HTTPException(status_code=400, detail="Currency must be RUB or MNT")
    if not payload.payment_receipt_url:
        raise HTTPException(status_code=400, detail="Payment receipt required")
    if not payload.station_latitude and not payload.location_text:
        raise HTTPException(status_code=400, detail="Location (GPS or text) required")

    # Server-side calculation
    calc = _fuel_calculate(
        payload.station_name,
        payload.liters,
        payload.station_price_per_liter,
        payload.payment_currency,
        payload.exchange_rate,
    )

    now_utc = datetime.now(timezone.utc).isoformat()

    order_data = {
        "invoice": payload.invoice,
        "user_id": user.id,
        "station_name": payload.station_name,
        "dispenser_number": payload.dispenser_number,
        "station_latitude": payload.station_latitude,
        "station_longitude": payload.station_longitude,
        "location_text": payload.location_text,
        "liters": payload.liters,
        "station_price_per_liter": payload.station_price_per_liter,
        "discount_percent": calc["discount_percent"],
        "gross_amount": calc["gross_amount"],
        "discount_amount": calc["discount_amount"],
        "net_amount": calc["net_amount"],
        "rounded_amount": calc["rounded_amount"],
        "payment_currency": payload.payment_currency,
        "exchange_rate": calc["exchange_rate"],
        "final_amount": calc["final_amount"],
        "payment_receipt_url": payload.payment_receipt_url,
        "admin_bank_id": payload.admin_bank_id,
        "status": "pending",
        "created_at": now_utc,
        "updated_at": now_utc,
    }

    # Snapshot bank account details so they're preserved even if the account is changed/deleted
    bank_emoji_id = None
    if payload.admin_bank_id:
        try:
            bank_res = client.table("fuel_admin_bank_accounts").select("bank_name, owner_name, card_number, emoji_id").eq("id", payload.admin_bank_id).single().execute()
            if bank_res.data:
                order_data["admin_bank_name"] = bank_res.data.get("bank_name")
                order_data["admin_bank_owner"] = bank_res.data.get("owner_name")
                order_data["admin_bank_card"] = bank_res.data.get("card_number")
                bank_emoji_id = bank_res.data.get("emoji_id")
        except Exception:
            pass

    res = client.table("fuel_orders").insert(order_data).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create fuel order")

    order = res.data[0]

    # Get user name for notification
    user_res = client.table("users").select("first_name, last_name").eq("id", user.id).limit(1).execute()
    user_name = "Unknown"
    if user_res.data:
        fn = user_res.data[0].get("first_name", "")
        ln = user_res.data[0].get("last_name", "")
        user_name = f"{fn} {ln}".strip() or str(user.id)

    # Location string
    loc_str = payload.location_text or ""
    if payload.station_latitude and payload.station_longitude:
        loc_str = f"📍 {payload.station_latitude:.6f}, {payload.station_longitude:.6f}"

    curr_symbol = "₽" if payload.payment_currency == "RUB" else "₮"
    dispenser_line = tb("ru", "fuel_admin_dispenser_line", number=payload.dispenser_number) if payload.dispenser_number else ""

    # Build bank name line with optional premium emoji
    bank_name_display = order_data.get("admin_bank_name", "")
    if bank_emoji_id and bank_name_display:
        bank_line = f'\n🏦 Банк: <tg-emoji emoji-id="{bank_emoji_id}">🏦</tg-emoji> <b>{bank_name_display}</b>'
    elif bank_name_display:
        bank_line = f"\n🏦 Банк: <b>{bank_name_display}</b>"
    else:
        bank_line = ""

    admin_text = tb("ru", "fuel_admin_new_order",
        invoice=payload.invoice,
        user_name=user_name,
        user_id=user.id,
        station_name=payload.station_name,
        dispenser_line=dispenser_line,
        loc_str=loc_str,
        liters=payload.liters,
        price_per_liter=payload.station_price_per_liter,
        discount_pct=calc['discount_percent'],
        final_amount=calc['final_amount'],
        curr_symbol=curr_symbol,
        payment_currency=payload.payment_currency,
    ) + bank_line

    reply_markup = None
    fuel_settings = get_settings()
    if fuel_settings.webapp_url and "localhost" not in fuel_settings.webapp_url and fuel_settings.webapp_url.startswith("https://"):
        reply_markup = {
            "inline_keyboard": [
                [{"text": tb("ru", "fuel_admin_open_panel"), "web_app": {"url": f"{fuel_settings.webapp_url}?fuel-admin"}}]
            ]
        }

    _send_fuel_admin_notification(admin_text, reply_markup=reply_markup)

    return FuelOrderCreateResponse(
        id=order["id"],
        invoice=order["invoice"],
        status=order["status"],
        gross_amount=calc["gross_amount"],
        discount_percent=calc["discount_percent"],
        discount_amount=calc["discount_amount"],
        net_amount=calc["net_amount"],
        rounded_amount=calc["rounded_amount"],
        final_amount=calc["final_amount"],
        created_at=order["created_at"],
    )


@app.get("/api/fuel/orders")
async def fuel_user_orders(user=Depends(get_authenticated_user)):
    """Get user's fuel order history."""
    client = get_supabase()
    res = client.table("fuel_orders").select("*").eq("user_id", user.id).order("created_at", desc=True).limit(50).execute()
    orders = [FuelOrderItem(**o) for o in (res.data or [])]
    return FuelOrdersResponse(orders=orders, total=len(orders))


@app.get("/api/fuel/active")
async def fuel_active_orders(user=Depends(get_authenticated_user)):
    """Get user's active (non-terminal) fuel orders."""
    client = get_supabase()
    res = client.table("fuel_orders").select("*").eq("user_id", user.id).in_(
        "status", ["pending_payment", "pending", "paid", "in_progress", "fueling_complete", "approved"]
    ).order("created_at", desc=True).execute()

    # Also include recently completed/rejected (last 24h)
    msk_tz = timezone(timedelta(hours=3))
    cutoff = (datetime.now(msk_tz) - timedelta(hours=24)).isoformat()
    recent_res = client.table("fuel_orders").select("*").eq("user_id", user.id).in_(
        "status", ["completed", "rejected"]
    ).gte("updated_at", cutoff).execute()

    all_orders = (res.data or []) + (recent_res.data or [])
    # Deduplicate by id
    seen = set()
    unique = []
    for o in all_orders:
        if o["id"] not in seen:
            seen.add(o["id"])
            unique.append(o)

    orders = [FuelOrderItem(**o) for o in unique]
    return FuelOrdersResponse(orders=orders, total=len(orders))


@app.post("/api/fuel/upload-pump-photo")
async def fuel_upload_pump_photo(payload: FuelPumpPhotoRequest, user=Depends(get_authenticated_user)):
    """Upload pump completion photo for a fuel order."""
    client = get_supabase()

    res = client.table("fuel_orders").select("*").eq("id", payload.order_id).eq("user_id", user.id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    client.table("fuel_orders").update({
        "pump_photo_url": payload.pump_photo_url,
        "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", payload.order_id).execute()

    # Notify fuel admin
    order = res.data
    pump_text = tb("ru", "fuel_admin_pump_photo",
        invoice=order.get('invoice'),
        station_name=order.get('station_name'),
        liters=order.get('liters'),
    )

    pump_reply_markup = None
    fuel_settings = get_settings()
    if fuel_settings.webapp_url and "localhost" not in fuel_settings.webapp_url and fuel_settings.webapp_url.startswith("https://"):
        pump_reply_markup = {
            "inline_keyboard": [
                [{"text": tb("ru", "fuel_admin_open_panel"), "web_app": {"url": f"{fuel_settings.webapp_url}?fuel-admin"}}]
            ]
        }

    _send_fuel_admin_notification(pump_text, reply_markup=pump_reply_markup)

    return {"ok": True}


# ---- Fuel Chat Endpoints (User side) ----

@app.get("/api/fuel/chat/{order_id}")
async def fuel_chat_get(order_id: str, user=Depends(get_authenticated_user)):
    """Get chat messages for a fuel order."""
    client = get_supabase()

    # Verify user owns this order
    order_res = client.table("fuel_orders").select("id").eq("id", order_id).eq("user_id", user.id).limit(1).execute()
    if not order_res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    res = client.table("fuel_chat_messages").select("*").eq("fuel_order_id", order_id).order("created_at").execute()
    messages = [FuelChatMessage(**m) for m in (res.data or [])]
    return FuelChatMessagesResponse(messages=messages)


@app.post("/api/fuel/chat/{order_id}")
async def fuel_chat_send(order_id: str, payload: FuelChatMessageRequest, user=Depends(get_authenticated_user)):
    """Send a chat message as user."""
    client = get_supabase()

    order_res = client.table("fuel_orders").select("id, invoice").eq("id", order_id).eq("user_id", user.id).limit(1).execute()
    if not order_res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    if not payload.message and not payload.image_url:
        raise HTTPException(status_code=400, detail="Message or image required")

    msg_data = {
        "fuel_order_id": order_id,
        "sender_type": "user",
        "sender_id": user.id,
        "message": payload.message,
        "image_url": payload.image_url,
    }
    res = client.table("fuel_chat_messages").insert(msg_data).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to send message")

    # Notify fuel admin about new user message
    invoice = order_res.data[0].get("invoice", "")
    chat_text = (
        f"{tb('ru', 'notif_fuel_user_chat')}\n\n"
        f"📋 Invoice: <code>{invoice}</code>\n"
    )
    if payload.message:
        chat_text += f"💬 {payload.message[:200]}"
    elif payload.image_url:
        chat_text += "📷 Зураг илгээсэн"

    fuel_settings = get_settings()
    chat_reply_markup = None
    if fuel_settings.webapp_url and "localhost" not in fuel_settings.webapp_url and fuel_settings.webapp_url.startswith("https://"):
        chat_reply_markup = {
            "inline_keyboard": [
                [{"text": tb("ru", "fuel_admin_open_panel"), "web_app": {"url": f"{fuel_settings.webapp_url}?fuel-admin"}}]
            ]
        }
    _send_fuel_admin_notification(chat_text, reply_markup=chat_reply_markup)

    return {"ok": True, "message": FuelChatMessage(**res.data[0])}


# ---- Fuel Admin Bank Accounts (public read for users) ----

@app.get("/api/fuel/admin-banks")
async def fuel_admin_banks(user=Depends(get_authenticated_user)):
    """Get active fuel admin bank accounts for user to send payment to.
    Filters by on-shift admin's bank accounts if a shift is active."""
    client = get_supabase()

    # Check if there's an on-shift admin → only show their bank accounts
    shift_admin_id = None
    try:
        shift_res = client.table("fuel_admin_shift").select("admin_id, is_active").eq("id", "current").single().execute()
        if shift_res.data and shift_res.data.get("is_active") and shift_res.data.get("admin_id"):
            shift_admin_id = shift_res.data["admin_id"]
    except Exception:
        pass

    query = client.table("fuel_admin_bank_accounts").select("*").eq("is_active", True)
    if shift_admin_id:
        query = query.eq("admin_id", shift_admin_id)
    res = query.order("display_order").execute()
    accounts = [FuelAdminBankAccount(**a) for a in (res.data or [])]
    return FuelAdminBankAccountsResponse(accounts=accounts)


# ============================================================
# FUEL ADMIN ENDPOINTS
# ============================================================

@app.get("/api/fuel-admin/inbox")
async def fuel_admin_inbox(user=Depends(get_fuel_admin_auth)):
    """Get pending/active fuel orders for admin."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    res = client.table("fuel_orders").select("*").in_(
        "status", ["pending_payment", "pending", "paid", "in_progress", "fueling_complete", "approved"]
    ).order("created_at").execute()

    orders = [FuelOrderItem(**o) for o in (res.data or [])]

    # Compute unread user message counts per order
    order_ids = [o.id for o in orders]
    unread_counts: dict[str, int] = {}
    if order_ids:
        # Get the last admin-read timestamp per order from app_settings or just count user messages
        # Simple approach: count user messages that are newer than the latest admin message for each order
        chat_res = client.table("fuel_chat_messages").select("fuel_order_id, sender_type, created_at").in_("fuel_order_id", order_ids).order("created_at", desc=True).execute()
        chat_msgs = chat_res.data or []
        # Group by order_id, find latest admin message time, count user messages after it
        from collections import defaultdict
        order_msgs: dict[str, list] = defaultdict(list)
        for m in chat_msgs:
            order_msgs[m["fuel_order_id"]].append(m)
        for oid, msgs in order_msgs.items():
            last_admin_time = None
            for m in msgs:
                if m["sender_type"] == "admin":
                    last_admin_time = m["created_at"]
                    break
            if last_admin_time is None:
                # No admin message yet, all user messages are unread
                unread_counts[oid] = sum(1 for m in msgs if m["sender_type"] == "user")
            else:
                unread_counts[oid] = sum(1 for m in msgs if m["sender_type"] == "user" and m["created_at"] > last_admin_time)

    return FuelOrdersResponse(orders=orders, total=len(orders), unread_counts=unread_counts)


@app.post("/api/fuel-admin/presign", response_model=PresignResponse)
async def fuel_admin_presign(payload: PresignRequest, user=Depends(get_fuel_admin_auth)):
    """Presign upload URL for fuel admin (supports API key auth)."""
    settings = get_settings()
    client = get_supabase()
    bucket = payload.bucket
    if bucket not in {settings.storage_bucket_passports, settings.storage_bucket_receipts}:
        raise HTTPException(status_code=400, detail="Invalid bucket")
    signed_url, ttl = presign_upload(client, bucket, payload.path, payload.expires_in)
    public = public_url(client, bucket, payload.path)
    return PresignResponse(upload_url=signed_url, public_url=public, expires_in=ttl, path=payload.path)


@app.post("/api/fuel-admin/action")
async def fuel_admin_action(payload: FuelAdminActionRequest, user=Depends(get_fuel_admin_auth)):
    """Admin action on a fuel order."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    valid_statuses = ["approved", "completed", "rejected", "paid", "in_progress", "fueling_complete"]
    if payload.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status: {payload.status}")

    client = get_supabase()
    res = client.table("fuel_orders").select("*").eq("id", payload.order_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Order not found")

    order = res.data
    update_data = {
        "status": payload.status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    if payload.status == "completed":
        update_data["completed_at"] = datetime.now(timezone.utc).isoformat()
        update_data["completed_by_admin"] = user.id
    if payload.status == "approved" and payload.approval_image_url:
        update_data["approval_image_url"] = payload.approval_image_url
    if payload.status == "rejected" and payload.rejection_comment:
        update_data["rejection_comment"] = payload.rejection_comment
    if payload.admin_comment:
        update_data["admin_comment"] = payload.admin_comment

    client.table("fuel_orders").update(update_data).eq("id", payload.order_id).execute()

    if payload.status == "completed" and order.get("user_id"):
        try:
            final_amount = _to_decimal(order.get("final_amount"))
            exchange_rate = _to_decimal(order.get("exchange_rate"))
            payment_currency = (order.get("payment_currency") or "").upper()

            if payment_currency == "RUB":
                rub_equivalent = final_amount
            else:
                rub_equivalent = (final_amount / exchange_rate) if exchange_rate > 0 else Decimal("0")

            oyuns_plus_settings = _get_oyuns_plus_settings(client)
            earned_points = _calculate_oyuns_plus_points(rub_equivalent, oyuns_plus_settings)
            _award_oyuns_plus_points_once(
                client,
                user_id=int(order.get("user_id")),
                source_type="fuel_order_completed",
                source_id=str(payload.order_id),
                points=earned_points,
                rub_equivalent=rub_equivalent,
                metadata={
                    "invoice": order.get("invoice"),
                    "status": "completed",
                },
            )
        except Exception as points_err:
            logger.error(f"Failed to award Oyuns Plus points for fuel order {payload.order_id}: {points_err}")

    # Notify user about status change
    order_user_id = order.get("user_id")
    invoice = order.get("invoice")
    has_dispenser = bool(order.get("dispenser_number"))
    approval_img = payload.approval_image_url or order.get("approval_image_url")
    fuel_user_lang = _get_user_lang(order_user_id) if order_user_id else "mn"

    if payload.status == "approved":
        if has_dispenser:
            approved_msg = tb(fuel_user_lang, "notif_fuel_approved_dispenser")
        else:
            approved_msg = tb(fuel_user_lang, "notif_fuel_approved_qr")
    else:
        approved_msg = None

    status_messages = {
        "paid": tb(fuel_user_lang, "notif_fuel_paid"),
        "in_progress": tb(fuel_user_lang, "notif_fuel_in_progress"),
        "fueling_complete": tb(fuel_user_lang, "notif_fuel_fueling_done"),
        "completed": tb(fuel_user_lang, "notif_fuel_completed"),
        "rejected": tb(fuel_user_lang, "notif_fuel_rejected") + f"\n📝 {payload.rejection_comment or ''}",
    }

    if order_user_id:
        # Build reply_markup with "Open Order" button for user
        fuel_reply_markup = None
        order_id = payload.order_id
        if settings.user_panel_url and settings.user_panel_url.startswith("https://"):
            fuel_reply_markup = {
                "inline_keyboard": [
                    [
                        {
                            "text": tb(fuel_user_lang, "btn_open_fuel_order"),
                            "web_app": {"url": f"{settings.user_panel_url}?fuel-order={order_id}"}
                        }
                    ]
                ]
            }

        if payload.status == "approved" and approved_msg:
            header = (
                f"{tb(fuel_user_lang, 'notif_fuel_order_updated')}\n\n"
                f"📋 Invoice: <code>{invoice}</code>\n"
                f"{approved_msg}"
            )
            # For QR/barcode stations, send the image with the message
            if not has_dispenser and approval_img:
                send_user_photo(order_user_id, approval_img, caption=header, reply_markup=fuel_reply_markup)
            else:
                send_user_notification(order_user_id, header, reply_markup=fuel_reply_markup)
        else:
            msg = status_messages.get(payload.status, "")
            if msg:
                user_text = (
                    f"{tb(fuel_user_lang, 'notif_fuel_order_updated')}\n\n"
                    f"📋 Invoice: <code>{invoice}</code>\n"
                    f"{msg}"
                )
                send_user_notification(order_user_id, user_text, reply_markup=fuel_reply_markup)

    return {"ok": True, "status": payload.status}


@app.get("/api/fuel-admin/history")
async def fuel_admin_history(
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
    user=Depends(get_fuel_admin_auth),
):
    """Get fuel order history for admin."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    query = client.table("fuel_orders").select("*", count="exact")

    if status and status != "all":
        query = query.eq("status", status)

    query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
    res = query.execute()

    orders = [FuelOrderItem(**o) for o in (res.data or [])]
    total = res.count if res.count is not None else len(orders)
    return FuelOrdersResponse(orders=orders, total=total)


# ---- Fuel Admin Bank Account CRUD ----

@app.get("/api/fuel-admin/bank-accounts")
async def fuel_admin_bank_accounts_list(user=Depends(get_fuel_admin_auth)):
    """List all fuel admin bank accounts (including inactive)."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    res = client.table("fuel_admin_bank_accounts").select("*").order("display_order").execute()
    accounts = [FuelAdminBankAccount(**a) for a in (res.data or [])]
    return FuelAdminBankAccountsResponse(accounts=accounts)


@app.post("/api/fuel-admin/bank-accounts")
async def fuel_admin_bank_account_create(payload: dict, user=Depends(get_fuel_admin_auth)):
    """Create a fuel admin bank account."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    allowed = ["bank_name", "account_number", "card_number", "phone", "owner_name", "currency", "is_active", "is_primary", "display_order", "admin_id", "logo_url", "emoji_id"]
    data = {k: v for k, v in payload.items() if k in allowed}
    res = client.table("fuel_admin_bank_accounts").insert(data).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create bank account")
    return {"ok": True, "account": res.data[0]}


@app.put("/api/fuel-admin/bank-accounts/{account_id}")
async def fuel_admin_bank_account_update(account_id: str, payload: dict, user=Depends(get_fuel_admin_auth)):
    """Update a fuel admin bank account."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    allowed = ["bank_name", "account_number", "card_number", "phone", "owner_name", "currency", "is_active", "is_primary", "display_order", "admin_id", "logo_url", "emoji_id"]
    data = {k: v for k, v in payload.items() if k in allowed}
    res = client.table("fuel_admin_bank_accounts").update(data).eq("id", account_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"ok": True, "account": res.data[0]}


@app.delete("/api/fuel-admin/bank-accounts/{account_id}")
async def fuel_admin_bank_account_delete(account_id: str, user=Depends(get_fuel_admin_auth)):
    """Delete a fuel admin bank account."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    client.table("fuel_admin_bank_accounts").delete().eq("id", account_id).execute()
    return {"ok": True}


# ---- Fuel Admin Chat ----

@app.get("/api/fuel-admin/chat/{order_id}")
async def fuel_admin_chat_get(order_id: str, user=Depends(get_fuel_admin_auth)):
    """Get chat messages for a fuel order (admin)."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    res = client.table("fuel_chat_messages").select("*").eq("fuel_order_id", order_id).order("created_at").execute()
    messages = [FuelChatMessage(**m) for m in (res.data or [])]
    return FuelChatMessagesResponse(messages=messages)


@app.post("/api/fuel-admin/chat/{order_id}")
async def fuel_admin_chat_send(order_id: str, payload: FuelChatMessageRequest, user=Depends(get_fuel_admin_auth)):
    """Send a chat message as admin."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    if not payload.message and not payload.image_url:
        raise HTTPException(status_code=400, detail="Message or image required")

    client = get_supabase()
    msg_data = {
        "fuel_order_id": order_id,
        "sender_type": "admin",
        "sender_id": user.id,
        "message": payload.message,
        "image_url": payload.image_url,
    }
    res = client.table("fuel_chat_messages").insert(msg_data).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to send message")

    # Notify user about new admin message
    order_res = client.table("fuel_orders").select("user_id, invoice").eq("id", order_id).limit(1).execute()
    if order_res.data:
        order_user_id = order_res.data[0].get("user_id")
        invoice = order_res.data[0].get("invoice")
        if order_user_id:
            chat_lang = _get_user_lang(order_user_id)
            send_user_notification(
                order_user_id,
                f"{tb(chat_lang, 'notif_fuel_new_message')}\n\n"
                f"📋 Invoice: <code>{invoice}</code>"
            )

    return {"ok": True, "message": FuelChatMessage(**res.data[0])}


# ---- Fuel Admin: Station Management ----

@app.get("/api/fuel-admin/stations")
async def fuel_admin_list_stations(user=Depends(get_fuel_admin_auth)):
    """List all stations (including inactive) for admin."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    res = client.table("fuel_stations").select("*").order("display_order").execute()
    return FuelStationsResponse(stations=[FuelStationItem(**r) for r in (res.data or [])])


@app.post("/api/fuel-admin/stations")
async def fuel_admin_create_station(payload: FuelStationCreateRequest, user=Depends(get_fuel_admin_auth)):
    """Create a new fuel station."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    data = payload.model_dump()
    res = client.table("fuel_stations").insert(data).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create station")
    return FuelStationItem(**res.data[0])


@app.put("/api/fuel-admin/stations/{station_id}")
async def fuel_admin_update_station(station_id: str, payload: FuelStationUpdateRequest, user=Depends(get_fuel_admin_auth)):
    """Update a fuel station."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    update_data = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = client.table("fuel_stations").update(update_data).eq("id", station_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Station not found")
    return FuelStationItem(**res.data[0])


@app.delete("/api/fuel-admin/stations/{station_id}")
async def fuel_admin_delete_station(station_id: str, user=Depends(get_fuel_admin_auth)):
    """Delete a fuel station."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    client = get_supabase()
    client.table("fuel_stations").delete().eq("id", station_id).execute()
    return {"ok": True}


# ---- Fuel Admin: Shift Management ----

def _get_fuel_admin_list() -> list[FuelShiftAdmin]:
    """Build the list of known fuel admins from config."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    chat_ids = settings.fuel_admin_chat_ids or settings.admin_chat_ids
    admins = []
    for i, uid in enumerate(fuel_admin_ids):
        chat_id = chat_ids[i] if i < len(chat_ids) else None
        admins.append(FuelShiftAdmin(admin_id=uid, admin_name=f"Admin {uid}", chat_id=chat_id))
    return admins


@app.get("/api/fuel/shift-status")
async def fuel_shift_status_public(user=Depends(get_authenticated_user)):
    """Check if fuel service is available (shift is active). For user-facing check."""
    client = get_supabase()
    try:
        res = client.table("fuel_admin_shift").select("*").eq("id", "current").single().execute()
        if res.data:
            return {"is_active": res.data.get("is_active", False)}
    except Exception:
        pass
    return {"is_active": True}  # Default to active if table doesn't exist yet


@app.get("/api/fuel-admin/shift")
async def fuel_admin_get_shift(user=Depends(get_fuel_admin_auth)):
    """Get current shift status."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    admins = _get_fuel_admin_list()
    client = get_supabase()

    try:
        res = client.table("fuel_admin_shift").select("*").eq("id", "current").single().execute()
        if res.data:
            is_active = res.data.get("is_active", False)
            current_admin_id = res.data.get("admin_id")
            always_notify_admin_id = res.data.get("always_notify_admin_id")
            current_admin = None
            if current_admin_id:
                current_admin = next((a for a in admins if a.admin_id == current_admin_id), None)
            return FuelShiftStatus(is_active=is_active, current_admin=current_admin, admins=admins, always_notify_admin_id=always_notify_admin_id)
    except Exception:
        pass

    return FuelShiftStatus(is_active=False, current_admin=None, admins=admins)


@app.put("/api/fuel-admin/shift")
async def fuel_admin_update_shift(payload: FuelShiftUpdateRequest, user=Depends(get_fuel_admin_auth)):
    """Update shift status (on/off) and assign admin."""
    settings = get_settings()
    fuel_admin_ids = settings.fuel_admin_user_ids or settings.admin_user_ids
    if user.id not in fuel_admin_ids:
        raise HTTPException(status_code=403, detail="Fuel admin access required")

    admins = _get_fuel_admin_list()
    client = get_supabase()

    # Find the admin's chat_id
    chat_id = None
    admin_name = None
    if payload.admin_id:
        admin = next((a for a in admins if a.admin_id == payload.admin_id), None)
        if admin:
            chat_id = admin.chat_id
            admin_name = admin.admin_name

    shift_data = {
        "id": "current",
        "is_active": payload.is_active,
        "admin_id": payload.admin_id,
        "admin_name": admin_name,
        "chat_id": chat_id,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    # Handle always-notify admin
    if payload.always_notify_admin_id is not None:
        always_admin = next((a for a in admins if a.admin_id == payload.always_notify_admin_id), None)
        shift_data["always_notify_admin_id"] = payload.always_notify_admin_id
        shift_data["always_notify_chat_id"] = always_admin.chat_id if always_admin else None

    try:
        client.table("fuel_admin_shift").upsert(shift_data).execute()
    except Exception as e:
        logger.error(f"Failed to update fuel admin shift: {e}")
        raise HTTPException(status_code=500, detail="Failed to update shift")

    return {"ok": True, "is_active": payload.is_active, "admin_id": payload.admin_id}
