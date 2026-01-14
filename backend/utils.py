import hashlib
import hmac
import json
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, unquote_plus
import logging

from models import AuthenticatedUser

logger = logging.getLogger("uvicorn.error")


class TelegramAuthError(Exception):
    pass


def parse_init_data(init_data: str) -> Dict[str, str]:
    """Parse initData preserving original URL-decoded values for hash verification."""
    from urllib.parse import unquote
    result = {}
    for pair in init_data.split('&'):
        if '=' in pair:
            key, value = pair.split('=', 1)
            # URL-decode the value (this is what Telegram expects for hash calculation)
            result[key] = unquote(value)
    return result


def verify_telegram_init_data(init_data: str, bot_token: str) -> AuthenticatedUser:
    data = parse_init_data(init_data)
    
    if "hash" not in data:
        raise TelegramAuthError("Missing hash in initData")

    received_hash = data.pop("hash")
    # Remove signature field if present (new Telegram format) - it's not included in hash calculation
    data.pop("signature", None)
    
    # Build data check string with sorted keys (Telegram's algorithm)
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(data.items()))
    
    # Correct algorithm per Telegram docs: HMAC-SHA256 with "WebAppData" as key
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    calculated = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if calculated != received_hash:
        # Debug log to inspect hash mismatches without exposing the token
        preview = data_check_string[:500].replace("\n", "\\n")
        logger.warning(
            "Hash mismatch for initData: calc=%s recv=%s len=%s preview=%s",
            calculated,
            received_hash,
            len(data_check_string),
            preview,
        )
        raise TelegramAuthError("Invalid initData hash")

    user_raw = data.get("user")
    if not user_raw:
        raise TelegramAuthError("Missing user payload")

    user_payload = json.loads(user_raw)
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
