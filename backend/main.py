from datetime import datetime, timezone, timedelta
from typing import Annotated
from contextlib import asynccontextmanager
import asyncio
import logging

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
)
from storage import presign_upload, public_url
from telegram import send_admin_notification, send_user_notification, send_user_photo, send_user_photos
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


@app.get("/api/active-transactions")
async def get_active_transactions(user=Depends(get_jwt_authenticated_user)):
    """Get user's active (pending/approved) and recently completed/rejected transactions."""
    client = get_supabase()
    # Get pending and approved transactions (include 'successful' for legacy data)
    res = (
        client.table("transactions")
        .select("invoice,amount,currency_from,currency_to,status,timestamp,admin_comment")
        .eq("user_id", user.id)
        .in_("status", ["pending", "approved", "completed", "successful", "rejected"])
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
        if status in ["pending", "approved"]:
            items.append(row)
        elif status in ["completed", "successful", "rejected"]:
            # Include if completed/successful/rejected within last 24 hours
            timestamp_str = row.get("timestamp", "")
            if timestamp_str:
                try:
                    timestamp = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
                    if (now.astimezone() - timestamp).total_seconds() < 86400:  # 24 hours
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
    # RUB bank is optional - only format if provided
    bank_rub = ""
    if payload.rub_bank_name and payload.rub_phone_sbp:
        bank_rub = f"{payload.rub_bank_name},{payload.rub_phone_sbp},{payload.rub_card_number},{payload.rub_owner_name}"
    
    bank_mnt = f"{payload.mnt_bank_name},{payload.mnt_account_number},{payload.mnt_owner_name},{payload.mnt_phone}"
    
    # Update user record with registration info
    # Note: We use the user's provided first_name and last_name from the form,
    # not overwriting with Telegram profile names
    update_payload = {
        "first_name": payload.first_name,
        "last_name": payload.last_name,
        "bank_mnt": bank_mnt,
        "passport_storage_url": payload.passport_storage_url,
        "ready_for_verification": True,
        "updated_at": now,
    }
    
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
            f"📱 Утас (MN): {payload.mnt_phone}\n"
            f"📱 Утас СБП (RU): {payload.rub_phone_sbp}\n"
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
    bank_mnt = f"{payload.mnt_bank_name},{payload.mnt_account_number},{payload.mnt_owner_name},{payload.mnt_phone or ''}"
    
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
        "rate": str(payload.rate),
        "status": "pending",
        "timestamp": now.isoformat(),
        "bill_url": bill_url_value,
        "receipt_id": receipt_id_value,
        "promo_code": payload.promo_code,
        "bank_details": payload.bank_details,
        "receipt_submitted_at": now.isoformat() if receipt_paths_list else None,
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

    # Send confirmation notification to user
    user_direction_text = "Төгрөг авах (RUB → MNT)" if payload.direction.lower() == "buy" else "Рубль авах (MNT → RUB)"
    user_notification = (
        f"✅ <b>Таны гүйлгээний хүсэлтийг хүлээн авлаа!</b>\n\n"
        f"📋 <b>Гүйлгээний дэлгэрэнгүй мэдээлэл:</b>\n"
        f"🧾 Invoice: <code>{invoice}</code>\n"
        f"🔄 Чиглэл: {user_direction_text}\n"
        f"💰 Та илгээх дүн: <b>{payload.amount:,.0f}</b> {payload.currency_from}\n"
        f"💸 Та хүлээн авах: <b>{admin_sends:,.0f}</b> {admin_sends_currency}\n"
        f"📊 Ханш: <b>{payload.rate}</b>\n\n"
        f"⏳ Таны хүсэлтийг админ удахгүй баталгаажуулах болно. Та түр хүлээнэ үү."
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
                text=f"✅ Таны <b>{payload.invoice}</b> дугаартай гүйлгээ баталгаажлаа!\nАдмин таны гүйлгээг хийх хүртэл түр хүлээнэ үү.",
            )
        elif payload.status == "completed":
            # Send completion notification with admin's bill photo if available
            completion_text = f"✅ Таны <b>{payload.invoice}</b> дугаартай гүйлгээ амжилттай хийгдлээ!\n\nТа шилжүүлсэн баримтыг хүлээн авна уу.\n\nМанайхыг сонгон үйлчлүүлдэгт баярлалаа!🤗\nӨдрийг сайхан өнгөрүүлээрэй."
            
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
    
    # Get user names for all user_ids
    user_ids = list(set([row.get("user_id") for row in res.data or [] if row.get("user_id")]))
    user_names = {}
    if user_ids:
        users_res = client.table("users").select("id,first_name,last_name").in_("id", user_ids).execute()
        for u in users_res.data or []:
            name = f"{u.get('last_name', '')} {u.get('first_name', '')}".strip()
            user_names[u.get("id")] = name if name else None
    
    items = []
    for row in res.data or []:
        direction = "buy" if row.get("currency_from") == "RUB" else "sell"
        user_id = row.get("user_id")
        items.append(AdminHistoryItem(
            invoice=row.get("invoice"),
            user_id=user_id,
            user_name=user_names.get(user_id),
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
        
        # Notify user via Telegram with webapp button
        notification_text = (
            f"✅ <b>Таны бүртгэл амжилттай баталгаажлаа!</b>\n\n"
            f"Та OYUNS FINANCE үйлчилгээг ашиглах боломжтой боллоо.\n"
            f"Доорх товчийг дараад валютаа солиорой!"
        )
        
        # Add webapp launch button if URL is configured
        settings = get_settings()
        reply_markup = None
        if settings.user_panel_url and settings.user_panel_url.startswith("https://"):
            reply_markup = {
                "inline_keyboard": [
                    [
                        {
                            "text": "🚀 Апп нээх",
                            "web_app": {"url": settings.user_panel_url}
                        }
                    ]
                ]
            }
        
        send_user_notification(user_id=payload.user_id, text=notification_text, reply_markup=reply_markup)
        
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
            "display_order": row.get("display_order", 0),
            "admin_id": row.get("admin_id"),
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
        "display_order": payload.get("display_order", 0),
        "admin_id": payload.get("admin_id"),
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
    
    allowed_fields = ["bank_name", "account_number", "card_number", "phone", "owner_name", "currency", "is_active", "display_order", "admin_id"]
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
        f"🔗 <a href='https://oyunsadmin.pages.dev/'>OYUNS FINANCE ДОТООД СИСТЕМ</a>"
    )
    send_user_notification(payload.to_admin_id, notification_text)
    
    # Send notification to previous admin about shift transfer
    prev_admin_notification = (
        f"🔄 <b>Ээлж шилжүүллээ</b>\n\n"
        f"👤 Таны ээлжийг {to_name} хүлээж авлаа.\n\n"
        f"🔗 <a href='https://oyunsadmin.pages.dev/'>OYUNS FINANCE ДОТООД СИСТЕМ</a>"
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
        f"🔗 <a href='https://oyunsadmin.pages.dev/'>OYUNS FINANCE ДОТООД СИСТЕМ</a>"
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
        Example: 'Сбер банк, +79603548085, 2202205354510650, Баасанжаргал'
        Returns list of cleaned phone numbers found.
        """
        if not bank_info:
            return []
        
        phones = []
        parts = bank_info.split(",")
        for part in parts:
            part = re.sub(r'[\s\-\(\)\.]', '', part.strip())
            # Check if this part looks like a phone number (starts with + or has 8-12 digits)
            if part.startswith("+") and 10 <= len(part) <= 16:
                phones.append(part)
                phones.append(part.lstrip("+"))
            # Also check for numbers that could be phones (Russian: 10-11 digits, MN: 8 digits)
            elif re.match(r"^\d{8,12}$", part):
                # Likely a phone if it's not too long (card numbers are 16+ digits)
                phones.append(part)
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
        
        # Minimum match length to avoid false positives
        min_match_length = 8
        
        # Exact match
        if search_digits == user_digits:
            return True
        
        # Check if one ends with the other (handles country code variations)
        # e.g., "79991234567" matches "9991234567"
        if len(search_digits) >= min_match_length and len(user_digits) >= min_match_length:
            if search_digits.endswith(user_digits[-min_match_length:]) or user_digits.endswith(search_digits[-min_match_length:]):
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
            
            # 1. Check phone column directly
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
            
            # 3. Check bank_mnt column (may also contain phone in some formats)
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
            
            message_text = (
                f"🎁 <b>Танд бэлэг ирлээ!</b>\n\n"
                f"👤 Хэнээс: <b>{display_sender}</b>\n"
                f"💰 Дүн: <b>{payload.amount}</b> {payload.currency_from}\n"
                f"📦 Хүлээн авах: <b>{receive_amount:,.2f}</b> {payload.currency_to}\n"
            )
            
            if payload.message:
                message_text += f"\n💬 Мессеж:\n<i>\"{payload.message}\"</i>\n"
            
            message_text += (
                f"\n✨ Бэлгээ хүлээн авахын тулд апп-д орж, банкны мэдээллээ оруулна уу!"
            )
            
            # Create inline keyboard with app link
            reply_markup = None
            if settings.webapp_url:
                reply_markup = {
                    "inline_keyboard": [
                        [{"text": "🎁 Бэлэг хүлээн авах", "web_app": {"url": settings.webapp_url}}]
                    ]
                }
            
            # Send gift card photo with caption
            send_user_photo(
                payload.recipient_user_id,
                payload.gift_card_url,
                message_text,
                reply_markup=reply_markup
            )
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
    sender_res = client.table("users").select("first_name, last_name").eq("id", gift.get("sender_user_id")).single().execute()
    sender_name = f"{sender_res.data.get('first_name', '')} {sender_res.data.get('last_name', '')}".strip() if sender_res.data else "Unknown"
    
    recipient_res = client.table("users").select("first_name, last_name").eq("id", user.id).single().execute()
    recipient_name = f"{recipient_res.data.get('first_name', '')} {recipient_res.data.get('last_name', '')}".strip() if recipient_res.data else "Unknown"
    
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


@app.post("/api/admin/gift/{gift_id}/approve")
async def approve_gift(
    gift_id: str,
    user=Depends(get_jwt_authenticated_user)
):
    """Admin approves a gift transaction"""
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
        raise HTTPException(status_code=400, detail="Gift cannot be approved")
    
    # Update gift status
    client.table("gifts").update({
        "status": "completed",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "completed_by_admin": user.id,
    }).eq("id", gift_id).execute()
    
    # Notify sender
    sender_message = (
        f"✅ <b>Таны илгээсэн бэлэг амжилттай хүргэгдлээ!</b>\n\n"
        f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
        f"💰 Дүн: {gift.get('amount')} {gift.get('currency_from')}"
    )
    send_user_notification(gift.get("sender_user_id"), sender_message)
    
    # Notify recipient
    recipient_message = (
        f"✅ <b>Бэлгийн мөнгө таны дансанд шилжүүлэгдлээ!</b>\n\n"
        f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
        f"🏦 Шилжүүлсэн данс: {gift.get('recipient_bank_details')}"
    )
    send_user_notification(gift.get("recipient_user_id"), recipient_message)
    
    return {"ok": True, "status": "completed"}


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
    sender_message = (
        f"❌ <b>Таны бэлэг цуцлагдлаа</b>\n\n"
        f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
        f"📝 Шалтгаан: {payload.comment}\n\n"
        f"Асуудал байвал админтай холбогдоно уу."
    )
    send_user_notification(gift.get("sender_user_id"), sender_message)
    
    # Notify recipient if they already confirmed
    if gift.get("status") == "pending_admin":
        recipient_message = (
            f"❌ <b>Таны хүлээж буй бэлэг цуцлагдлаа</b>\n\n"
            f"📋 Invoice: <code>{gift.get('invoice')}</code>\n"
            f"📝 Шалтгаан: {payload.comment}"
        )
        send_user_notification(gift.get("recipient_user_id"), recipient_message)
    
    return {"ok": True, "status": "rejected"}
