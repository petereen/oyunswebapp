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
    Verify Telegram Mini App init data using HMAC-SHA256 with deterministic parsing.
    
    This implementation follows Telegram's exact specification:
    1. Parse query string manually to avoid encoding inconsistencies
    2. Sort keys alphabetically
    3. Build data check string with newline separators
    4. Derive secret key from "WebAppData" + bot token
    5. Compare calculated hash with received hash
    """
    # 1. Parse query string manually by splitting on '&'
    # This avoids parse_qsl quirks with URL encoding
    pairs = init_data.split('&')
    data_dict = {}
    received_hash = ""
    
    for pair in pairs:
        if '=' not in pair:
            continue
        key, val = pair.split('=', 1)
        if key == 'hash':
            # Don't unquote hash; it's already hex-encoded
            received_hash = val
        else:
            # Unquote the value (decode %XX sequences)
            data_dict[key] = unquote(val)
    
    if not received_hash:
        raise TelegramAuthError("Missing hash in initData")
    
    if not data_dict:
        raise TelegramAuthError("No data parameters in initData")
    
    # 2. Build data check string: sort keys alphabetically, join with newlines
    # Critical: Remove 'signature' field if present (new Telegram format)
    data_dict.pop('signature', None)
    
    data_check_string = "\n".join(
        f"{k}={data_dict[k]}" for k in sorted(data_dict.keys())
    )
    
    # 3. Derive secret key: HMAC-SHA256(key="WebAppData", message=bot_token)
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    
    # 4. Calculate hash: HMAC-SHA256(key=secret_key, message=data_check_string)
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    
    # 5. Compare hashes
    if calculated_hash != received_hash:
        # Debug: Log truncated values to avoid exposing full token
        logger.warning(
            f"Telegram initData hash mismatch: "
            f"calculated={calculated_hash[:16]}... "
            f"received={received_hash[:16]}... "
            f"data_len={len(data_check_string)}"
        )
        raise TelegramAuthError("Invalid initData hash")
    
    # Hash verified! Extract and return user information
    user_raw = data_dict.get("user")
    if not user_raw:
        raise TelegramAuthError("Missing user payload in initData")
    
    try:
        user_payload = json.loads(user_raw)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse user JSON: {e}")
        raise TelegramAuthError("Invalid user payload JSON")
    
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
