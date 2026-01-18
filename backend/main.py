from datetime import datetime, timezone, timedelta
from typing import Annotated
from contextlib import asynccontextmanager
import asyncio
import logging

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from db import get_supabase
from models import (
    AdminActionRequest,
    AdminBankAccount,
    AdminBankAccountsResponse,
    AdminInboxItem,
    AdminInboxResponse,
    AdminShift,
    AdminShiftResponse,
    AdminUser,
    AdminUsersResponse,
    AuthRequest,
    AuthResponse,
    ExchangeCreateRequest,
    ExchangeCreateResponse,
    HealthResponse,
    HistoryItem,
    HistoryResponse,
    KycActionRequest,
    KycItem,
    KycResponse,
    MeResponse,
    PresignRequest,
    PresignResponse,
    PromoCodeValidateRequest,
    PromoCodeValidateResponse,
    RateResponse,
    RegistrationRequest,
    ServiceStatusResponse,
    ShiftCloseRequest,
    UpdateBankInfoRequest,
    ShiftOpenRequest,
    ShiftTransferRequest,
    UpsertUserPayload,
    UserPromoCode,
    UserPromoCodesResponse,
    UserSearchItem,
    UserSearchResponse,
    WorkingHoursConfig,
    WorkingHoursResponse,
    WorkingHoursUpdateRequest,
)
from storage import presign_upload, public_url
from telegram import send_admin_notification, send_user_notification, send_user_photo
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
                                    "url": f"{settings.admin_panel_url}{separator}invoice={invoice}",
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


async def get_authenticated_user(x_telegram_init_data: Annotated[str | None, Header(alias="X-Telegram-Init-Data")]):
    settings = get_settings()
    if not x_telegram_init_data:
        logger.warning("Auth failed: missing X-Telegram-Init-Data header")
        raise HTTPException(status_code=401, detail="Missing X-Telegram-Init-Data header")
    
    # Dev mode bypass
    if settings.dev_mode and x_telegram_init_data.startswith("dev_mode_bypass"):
        try:
            import json
            from models import AuthenticatedUser
            # Extract user json if present: "dev_mode_bypass:{"id":123,...}"
            parts = x_telegram_init_data.split(":", 1)
            if len(parts) > 1 and parts[1].strip():
                user_data = json.loads(parts[1])
                return AuthenticatedUser(
                    id=user_data.get("id", 123456789),
                    first_name=user_data.get("first_name", "Dev"),
                    last_name=user_data.get("last_name", "User"),
                    username=user_data.get("username", "dev_user"),
                )
        except Exception as e:
            logger.warning(f"Dev mode auth parsing failed: {e}")
        
        # Default dev user
        from models import AuthenticatedUser
        return AuthenticatedUser(
            id=123456789,
            first_name="Dev",
            last_name="User",
            username="dev_user",
        )

    try:
        return verify_telegram_init_data(x_telegram_init_data, settings.bot_token)
    except TelegramAuthError as exc:
        # Log truncated preview to avoid leaking the full token
        preview = x_telegram_init_data[:120].replace("\n", "") if x_telegram_init_data else ""
        hash_len = 0
        try:
            from urllib.parse import parse_qsl
            parsed = dict(parse_qsl(x_telegram_init_data, keep_blank_values=True))
            hash_len = len(parsed.get("hash", ""))
        except Exception:
            pass
        logger.warning(f"Auth failed: invalid init data. preview='{preview}' len={len(x_telegram_init_data)} hash_len={hash_len} error={exc}")
        raise HTTPException(status_code=401, detail=str(exc)) from exc


async def get_jwt_authenticated_user(authorization: Annotated[str | None, Header(alias="Authorization")] = None):
    """
    Verify JWT token from Authorization header.
    This is the preferred authentication method for subsequent requests after /api/auth.
    """
    settings = get_settings()
    
    # DEV MODE: Skip auth entirely and return mock admin user
    if settings.dev_mode:
        from models import AuthenticatedUser
        logger.info("DEV MODE: Bypassing JWT auth, returning mock admin user")
        return AuthenticatedUser(
            id=1932946217,  # Real admin user ID for testing
            first_name="Test",
            last_name="Admin",
            username="test_admin",
        )
    
    if not authorization:
        logger.warning("Auth failed: missing Authorization header")
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    
    # Extract token from "Bearer <token>" format
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        logger.warning(f"Auth failed: invalid Authorization header format")
        raise HTTPException(status_code=401, detail="Invalid Authorization header format. Use: Bearer <token>")
    
    token = parts[1]
    
    try:
        return verify_jwt_token(token, settings.jwt_secret)
    except JWTAuthError as exc:
        logger.warning(f"JWT auth failed: {exc}")
        raise HTTPException(status_code=401, detail=str(exc)) from exc


async def require_admin(request: Request):
    """Validate admin API key (for admin panel access)"""
    settings = get_settings()
    provided = request.headers.get("X-Admin-Key")
    if not settings.admin_api_key or provided != settings.admin_api_key:
        raise HTTPException(status_code=401, detail="Admin key required")
    return True


async def require_admin_user(user=Depends(get_jwt_authenticated_user)):
    """Validate that authenticated user is an admin (by Telegram user ID)"""
    settings = get_settings()
    if user.id not in settings.admin_user_ids:
        logger.warning(f"Non-admin user {user.id} attempted to access admin endpoint")
        raise HTTPException(status_code=403, detail="Admin access required")
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


def moscow_to_ub_hour(moscow_hour: int) -> int:
    """Convert Moscow time hour to Ulaanbaatar time (Moscow + 5 hours)."""
    return (moscow_hour + 5) % 24


def format_working_hours_ub(start_moscow: int, end_moscow: int) -> str:
    """Format working hours in UB time."""
    start_ub = moscow_to_ub_hour(start_moscow)
    end_ub = moscow_to_ub_hour(end_moscow)
    return f"{start_ub:02d}:00 - {end_ub:02d}:00 (УБ)"


@app.get("/api/service-status", response_model=ServiceStatusResponse)
async def get_service_status():
    """Public endpoint - check if service is open (within working hours AND shift is active).
    Working hours are configured dynamically via admin panel.
    """
    from zoneinfo import ZoneInfo
    
    client = get_supabase()
    
    # Get working hours config from database
    hours_res = client.table("working_hours").select("*").eq("id", 1).limit(1).execute()
    if hours_res.data:
        hours_config = hours_res.data[0]
        start_hour = hours_config.get("start_hour_moscow", 4)
        end_hour = hours_config.get("end_hour_moscow", 23)
        is_enabled = hours_config.get("is_enabled", True)
    else:
        # Default working hours
        start_hour = 4
        end_hour = 23
        is_enabled = True
    
    # Check working hours (Moscow time)
    moscow_tz = ZoneInfo("Europe/Moscow")
    now_moscow = datetime.now(moscow_tz)
    hour_moscow = now_moscow.hour
    
    # Handle working hours that might span midnight
    if start_hour < end_hour:
        is_within_hours = start_hour <= hour_moscow < end_hour
    else:
        # Spans midnight (e.g., 22:00 - 06:00)
        is_within_hours = hour_moscow >= start_hour or hour_moscow < end_hour
    
    # If working hours are disabled, always treat as outside hours
    if not is_enabled:
        is_within_hours = False
    
    # Check if shift is active
    shift_res = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    is_shift_active = bool(shift_res.data and shift_res.data[0].get("current_admin_id"))
    
    is_open = is_within_hours and is_shift_active
    
    # Format working hours display
    working_hours_str = format_working_hours_ub(start_hour, end_hour)
    
    # Determine message
    if not is_enabled:
        message = "Үйлчилгээ түр хаалттай байна"
    elif not is_within_hours:
        message = f"Ажлын цаг: {working_hours_str} / {start_hour:02d}:00 - {end_hour:02d}:00 (Москва)"
    elif not is_shift_active:
        message = "Одоогоор админ ээлжинд алга байна"
    else:
        message = None
    
    return ServiceStatusResponse(
        is_open=is_open,
        is_within_hours=is_within_hours,
        is_shift_active=is_shift_active,
        working_hours=working_hours_str,
        message=message,
    )


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


@app.get("/api/history", response_model=HistoryResponse)
async def history(user=Depends(get_jwt_authenticated_user)):
    client = get_supabase()
    res = (
        client.table("transactions")
        .select(
            "invoice,amount,currency_from,currency_to,status,timestamp,rate,bill_url,receipt_id,admin_comment"
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
            admin_comment=row.get("admin_comment"),
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
        
        # Get all completed transactions for this user
        res = (
            client.table("transactions")
            .select("amount,currency_from,currency_to,direction,timestamp,status")
            .eq("user_id", user.id)
            .eq("status", "completed")
            .order("timestamp", desc=False)  # oldest first for chronological data
            .execute()
        )
    
        if not res.data:
            return {
                "monthly_buy": [],
                "monthly_sell": [],
                "total_buy_rub": 0,
                "total_sell_rub": 0,
                "total_transactions": 0,
            }
        
        # Group by month and direction
        monthly_buy = defaultdict(float)
        monthly_sell = defaultdict(float)
        total_buy_rub = 0
        total_sell_rub = 0
        
        for trx in res.data:
            try:
                timestamp = datetime.fromisoformat(trx.get("timestamp", "").replace('Z', '+00:00'))
                month_key = timestamp.strftime("%Y-%m")  # Format: "2026-01"
                
                direction = trx.get("direction", "")
                amount = float(trx.get("amount", 0))
                currency_from = trx.get("currency_from", "")
                
                # Calculate RUB equivalent
                if direction == "buy":
                    # User buying MNT with RUB (RUB -> MNT)
                    if currency_from == "RUB":
                        rub_amount = amount
                    else:
                        continue  # Skip if not standard flow
                    monthly_buy[month_key] += rub_amount
                    total_buy_rub += rub_amount
                    
                elif direction == "sell":
                    # User selling MNT for RUB (MNT -> RUB)
                    if currency_from == "MNT":
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
    upsert_payload = {
        "id": user.id,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "updated_at": now,
    }
    client.table("users").upsert(upsert_payload, returning="minimal").execute()
    db_user = client.table("users").select("*").eq("id", user.id).limit(1).execute().data
    record = db_user[0] if db_user else upsert_payload
    
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
    bank_rub = f"{payload.rub_bank_name},{payload.rub_phone_sbp},{payload.rub_card_number},{payload.rub_owner_name}"
    bank_mnt = f"{payload.mnt_bank_name},{payload.mnt_account_number},{payload.mnt_owner_name}"
    
    # Update user record with registration info
    update_payload = {
        "first_name": payload.first_name,
        "last_name": payload.last_name,
        "phone": payload.phone,
        "bank_rub": bank_rub,
        "bank_mnt": bank_mnt,
        "passport_storage_url": payload.passport_storage_url,
        "ready_for_verification": True,
        "updated_at": now,
    }
    
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
            f"📱 Утас: {payload.phone}\n"
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
    """Update user's bank info (for verified users to update their banking details)."""
    from zoneinfo import ZoneInfo
    
    client = get_supabase()
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz).isoformat()
    
    # Format bank details as comma-separated strings
    bank_rub = f"{payload.rub_bank_name},{payload.rub_phone_sbp},{payload.rub_card_number},{payload.rub_owner_name}"
    bank_mnt = f"{payload.mnt_bank_name},{payload.mnt_account_number},{payload.mnt_owner_name}"
    
    # Update user record with bank info only
    update_payload = {
        "phone": payload.phone,
        "bank_rub": bank_rub,
        "bank_mnt": bank_mnt,
        "updated_at": now,
    }
    
    result = client.table("users").update(update_payload).eq("id", user.id).execute()
    
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update bank info")
    
    return {"ok": True, "message": "Bank info updated successfully"}


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
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz)
    invoice = payload.invoice or generate_invoice(now)

    # ensure user row exists
    client.table("users").upsert(
        {"id": user.id, "first_name": user.first_name, "last_name": user.last_name, "updated_at": now.isoformat()},
        returning="minimal",
    ).execute()

    insert_payload = {
        "user_id": user.id,
        "invoice": invoice,
        "amount": str(payload.amount),
        "currency_from": payload.currency_from,
        "currency_to": payload.currency_to,
        "rate": str(payload.rate),
        "status": "pending",
        "timestamp": now.isoformat(),
        "bill_url": payload.receipt_path,
        "receipt_id": payload.receipt_path,
        "promo_code": payload.promo_code,
        "bank_details": payload.bank_details,
        "receipt_submitted_at": now.isoformat() if payload.receipt_path else None,
    }

    # snapshot buy/sell side
    if payload.direction.lower() == "buy":
        insert_payload["buy_rate"] = str(payload.rate)
    elif payload.direction.lower() == "sell":
        insert_payload["sell_rate"] = str(payload.rate)

    result = client.table("transactions").insert(insert_payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create transaction")

    transaction = result.data[0]

    # Mark one-time promo codes as inactive (source != 'default')
    if payload.promo_code:
        promo_code_upper = payload.promo_code.upper()
        # Find the promo code and check its source
        promo_res = client.table("promo_codes").select("code,source").eq("active", True).execute()
        for p in promo_res.data or []:
            if p.get("code", "").upper() == promo_code_upper:
                # If source is not 'default', mark as inactive (one-time use)
                if p.get("source") and p.get("source") != "default":
                    client.table("promo_codes").update({"active": False}).eq("code", p.get("code")).execute()
                break

    settings = get_settings()
    
    # Calculate admin transfer amount
    if payload.direction.lower() == "buy":
        # User sends RUB, admin sends MNT (amount * rate)
        admin_sends = round(payload.amount * payload.rate)
        admin_sends_currency = "MNT"
    else:
        # User sends MNT, admin sends RUB (amount / rate)
        admin_sends = round(payload.amount / payload.rate, 2)
        admin_sends_currency = "RUB"
    
    direction_text = "🟢 ТӨГРӨГ АВАХ" if payload.direction.lower() == "buy" else "🟠 РУБ АВАХ"
    
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
                        "url": f"{settings.admin_panel_url}{separator}invoice={invoice}",
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
        f"📊 Ханш: {payload.rate}\n"
    )
    
    if shift_res.data and shift_res.data[0].get("current_admin_id"):
        shift_admin_id = shift_res.data[0].get("current_admin_id")
        logger.info(f"Sending notification to shift admin {shift_admin_id}")
        send_user_notification(shift_admin_id, notification_text, reply_markup=reply_markup)
    else:
        # No shift admin - skip notification
        logger.warning("No shift admin found, skipping transaction notification")

    return ExchangeCreateResponse(
        id=str(transaction.get("id")),
        invoice=invoice,
        status=transaction.get("status"),
        bill_url=transaction.get("bill_url"),
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

    # Build update payload - only include non-None values
    update_payload = {"status": payload.status}
    
    if payload.rejection_comment is not None:
        update_payload["rejection_comment"] = payload.rejection_comment
    if payload.admin_comment is not None:
        update_payload["admin_comment"] = payload.admin_comment
    if payload.completed_by_admin is not None:
        update_payload["completed_by_admin"] = payload.completed_by_admin
    
    # Track admin bill submission time
    if payload.admin_bill_url:
        update_payload["admin_bill_url"] = payload.admin_bill_url
        update_payload["admin_bill_submitted_at"] = now.isoformat()
    
    # Handle completion - calculate duration
    duration_minutes = None
    if payload.status == "completed":
        update_payload["completed_at"] = now.isoformat()
        
        # Calculate completion duration from timestamp (when request was created)
        # Fallback to receipt_submitted_at if timestamp not available
        request_time_str = trx.get("timestamp") or trx.get("receipt_submitted_at")
        if request_time_str:
            try:
                request_time = datetime.fromisoformat(request_time_str.replace('Z', '+00:00'))
                duration_minutes = (now - request_time).total_seconds() / 60
                update_payload["completion_duration_minutes"] = round(duration_minutes, 2)
                logger.info(f"Completion duration: {duration_minutes:.2f} minutes (from timestamp: {request_time_str})")
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
        if payload.status == "approved":
            send_user_notification(
                user_id=int(user_id),
                text=f"✅ Таны <b>{payload.invoice}</b> дугаартай гүйлгээ баталгаажлаа!\nАдмин таны гүйлгээг хйих хүртэл түр хүлээнэ үү.",
            )
        elif payload.status == "completed":
            # Send completion notification with admin's bill photo if available
            completion_text = f"✅ Таны <b>{payload.invoice}</b> дугаартай гүйлгээ амжилттай хийгдлээ!\n\nТа шилжүүлсэн баримтыг хүлээн авна уу.\n\nМанайхыг сонгон үйлчлүүлдэгт баярлалаа!🤗\nӨдрийг сайхан өнгөрүүлээрэй."
            
            # If admin uploaded a bill, send it as a photo
            if payload.admin_bill_url:
                try:
                    send_user_photo(
                        user_id=int(user_id),
                        photo_url=payload.admin_bill_url,
                        caption=completion_text
                    )
                except Exception as e:
                    logger.warning(f"Failed to send photo, falling back to text: {e}")
                    send_user_notification(user_id=int(user_id), text=completion_text)
            else:
                send_user_notification(user_id=int(user_id), text=completion_text)
            
            # If completion took more than 10 minutes, generate a compensation promo code
            if duration_minutes and duration_minutes > 10:
                try:
                    import secrets
                    promo_code = f"SORRY{secrets.token_hex(3).upper()}"
                    expires_at = (now + timedelta(days=30)).isoformat()
                    
                    # Create promo code for the user
                    client.table("promo_codes").insert({
                        "code": promo_code,
                        "discount": 0.2,  
                        "active": True,
                        "user_id": user_id,
                        "source": "compensation",
                        "expires_at": expires_at,
                    }).execute()
                    
                    # Notify user about the promo code
                    promo_text = (
                        f"⏰ Уучлаарай, таны гүйлгээг гүйцэтгэхэд {round(duration_minutes)}+ минутын хугацаа зарцуулагдлаа.\n\n"
                        f"🎟️ Танд промокод бэлэглэж байна: <code>{promo_code}</code>\n\n"
                        f"Энэхүү промокодыг дараагийн нэг удаагийн гүйлгээндээ ашиглаарай. Бид үйлчилгээний хурд, чанартаа цаашид илүү анхаарах болно. 🙌"
                    )
                    send_user_notification(user_id=int(user_id), text=promo_text)
                    logger.info(f"Generated compensation promo code {promo_code} for user {user_id}")
                except Exception as e:
                    logger.error(f"Failed to create compensation promo code: {e}")
        elif payload.status == "rejected":
            rejection_msg = f"❌ Таны <b>{payload.invoice}</b> дугаартай гүйлгээг татгалзлаа. Та алдаа гарсан гэж үзвэл @Oyuns_support хаягаар холбогдоно уу."
            if payload.rejection_comment:
                rejection_msg += f"\n\nШалтгаан: {payload.rejection_comment}"
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
    client = get_supabase()
    res = (
        client.table("transactions")
        .select("invoice,user_id,amount,currency_from,currency_to,status,timestamp,rate,bank_details,receipt_id,bill_url,admin_bill_url,rejection_comment")
        .in_("status", ["pending", "approved"])
        .order("timestamp", desc=False)  # Oldest first by default
        .limit(100)
        .execute()
    )
    items = []
    for row in res.data or []:
        # Determine direction from currency pair
        direction = "buy" if row.get("currency_from") == "RUB" else "sell"
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
        ))
    return AdminInboxResponse(items=items)


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
    
    # Fetch user info first
    user_res = client.table("users").select("first_name,last_name").eq("id", payload.user_id).limit(1).execute()
    if not user_res.data:
        raise HTTPException(status_code=404, detail="User not found")
    
    user_info = user_res.data[0]
    user_name = f"{user_info.get('last_name', '')} {user_info.get('first_name', '')}".strip()
    
    if payload.action == "approve":
        # Update user to verified
        client.table("users").update({
            "verified": True,
            "updated_at": now,
        }).eq("id", payload.user_id).execute()
        
        # Notify user via Telegram
        notification_text = (
            f"✅ <b>Таны бүртгэл баталгаажлаа!</b>\n\n"
            f"Та одоо OYUNS FINANCE үйлчилгээг ашиглах боломжтой боллоо.\n"
            f"Баярлалаа! 🎉"
        )
        send_user_notification(user_id=payload.user_id, text=notification_text)
        
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
        notification_text = (
            f"❌ <b>Таны бүртгүүлэх хүсэлтийг татгалзлаа</b>\n\n"
            f"Шалтгаан: {rejection_reason}\n\n"
            f"Та мэдээллээ засаад дахин илгээнэ үү."
        )
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
    """Search users by ID, name, or phone."""
    client = get_supabase()
    
    # Get all users with their transaction counts (username column doesn't exist in this schema)
    query = client.table("users").select("id,first_name,last_name,phone,verified,created_at")
    
    # If search query provided, filter
    if q:
        q = q.strip()
        # Try to search by ID if it's a number
        if q.isdigit():
            query = query.eq("id", int(q))
        else:
            # Search by name or phone (case insensitive)
            query = query.or_(
                f"first_name.ilike.%{q}%,last_name.ilike.%{q}%,phone.ilike.%{q}%"
            )
    
    res = query.order("id", desc=True).limit(50).execute()
    
    users = []
    for row in res.data or []:
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
    
    accounts = [
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
        )
        for row in res.data or []
    ]
    return AdminBankAccountsResponse(accounts=accounts)


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
    
    return {"ok": True, "message": f"Shift transferred from {payload.from_admin_id} to {payload.to_admin_id}"}


@app.post("/api/admin/shift/close")
async def close_shift(payload: ShiftCloseRequest, admin=Depends(require_admin)):
    """Close current shift."""
    client = get_supabase()
    now = datetime.now(timezone.utc)
    
    # Get current shift to log
    current = client.table("admin_shifts").select("current_admin_id").eq("id", 1).limit(1).execute()
    previous_admin_id = current.data[0].get("current_admin_id") if current.data else None
    
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
        .select("code,discount,active,expires_at")
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
        )
        for p in res.data or []
    ]
    
    return UserPromoCodesResponse(promo_codes=promo_codes)
