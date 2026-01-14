import hashlib
import hmac
import json
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, unquote
import logging

from models import AuthenticatedUser

logger = logging.getLogger("uvicorn.error")


class TelegramAuthError(Exception):
    pass


def verify_telegram_init_data(init_data: str, bot_token: str) -> AuthenticatedUser:
    """
    Verify Telegram Mini App init data using HMAC-SHA256 (official standard).
    
    Security: The bot token is used to derive a secret key, which then signs
    the init data. This ensures the data came from Telegram and wasn't tampered with.
    """
    # Parse init data as query parameters
    params = dict(parse_qsl(init_data, keep_blank_values=True))
    
    if "hash" not in params:
        raise TelegramAuthError("Missing hash in initData")
    
    received_hash = params.pop("hash")
    # Remove signature field if present (new Telegram format) - not used in HMAC validation
    params.pop("signature", None)
    
    # Build data check string: sort all key-value pairs alphabetically, join with newlines
    # This is deterministic and matches what Telegram signs
    data_check_string = "\n".join(f"{k}={unquote(v)}" for k, v in sorted(params.items()))
    
    # Step 1: Create secret key by signing "WebAppData" with bot token (HMAC-SHA256)
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    
    # Step 2: Sign the data check string with the secret key
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    # Step 3: Compare with received hash
    if expected_hash != received_hash:
        logger.warning(
            f"Telegram initData validation failed: expected={expected_hash[:16]}... received={received_hash[:16]}..."
        )
        raise TelegramAuthError("Invalid initData hash")
    
    # Hash verified! Extract and return user info
    user_raw = params.get("user")
    if not user_raw:
        raise TelegramAuthError("Missing user payload in initData")
    
    user_payload = json.loads(unquote(user_raw))
    return AuthenticatedUser(
        id=user_payload.get("id"),
        first_name=user_payload.get("first_name"),
        last_name=user_payload.get("last_name"),
        username=user_payload.get("username"),
    )


def generate_invoice(now: datetime = None) -> str:
    """Generate invoice ID using Moscow timezone."""
    import random
    from zoneinfo import ZoneInfo
    
    moscow_tz = ZoneInfo("Europe/Moscow")
    if now is None:
        now = datetime.now(moscow_tz)
    else:
        # Convert to Moscow time if timezone-aware
        if now.tzinfo is not None:
            now = now.astimezone(moscow_tz)
        else:
            # Assume UTC if no timezone
            from datetime import timezone
            now = now.replace(tzinfo=timezone.utc).astimezone(moscow_tz)
    
    # Format: YYYYMMDD-HHMMSS-XX (XX = 2 random digits)
    random_digits = f"{random.randint(0, 99):02d}"
    return now.strftime("%Y%m%d-%H%M%S") + "-" + random_digits


def log_admin_action(
    client,
    admin_user_id: int,
    action_type: str,
    target_type: Optional[str] = None,
    target_id: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None
) -> None:
    """
    Log admin actions for audit trail and monitoring.
    
    Args:
        client: Supabase client
        admin_user_id: Telegram user ID of the admin
        action_type: Type of action (kyc_approve, kyc_reject, transaction_approve, etc.)
        target_type: Type of target (user, transaction, etc.)
        target_id: ID of the affected resource
        details: Additional context (rejection reason, comments, etc.)
    """
    from zoneinfo import ZoneInfo
    
    moscow_tz = ZoneInfo("Europe/Moscow")
    now = datetime.now(moscow_tz).isoformat()
    
    try:
        client.table("admin_actions").insert({
            "admin_user_id": admin_user_id,
            "action_type": action_type,
            "target_type": target_type,
            "target_id": target_id,
            "details": details or {},
            "created_at": now,
        }).execute()
        
        logger.info(f"Admin action logged: {action_type} by admin {admin_user_id} on {target_type}:{target_id}")
    except Exception as e:
        logger.error(f"Failed to log admin action: {e}")
        # Don't fail the main operation if logging fails
