import hashlib
import hmac
import json
import base64
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, unquote_plus, unquote
import logging

try:
    from cryptography.hazmat.primitives.asymmetric import ed25519
    from cryptography.exceptions import InvalidSignature
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

from models import AuthenticatedUser

logger = logging.getLogger("uvicorn.error")


class TelegramAuthError(Exception):
    pass

# Telegram's Ed25519 public key for production
TELEGRAM_PUBLIC_KEY_HEX = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d"


def verify_telegram_init_data(init_data: str, bot_token: str) -> AuthenticatedUser:
    """
    Verify Telegram Mini App init data using the appropriate algorithm.
    Supports both legacy hash (HMAC-SHA256) and new signature (Ed25519).
    """
    # Parse init data as query parameters
    params = dict(parse_qsl(init_data, keep_blank_values=True))

    if "hash" not in params:
        raise TelegramAuthError("Missing hash in initData")

    # Check if using new Ed25519 signature format or legacy HMAC hash
    if "signature" in params:
        # New format: Ed25519 signature validation
        if not CRYPTO_AVAILABLE:
            raise TelegramAuthError("Cryptography library not available for signature verification")
        
        return _verify_with_ed25519(params, bot_token)
    else:
        # Legacy format: HMAC-SHA256 with bot token
        return _verify_with_hmac(params, bot_token)


def _verify_with_ed25519(params: Dict[str, str], bot_token: str) -> AuthenticatedUser:
    """Verify using Ed25519 signature (new Telegram format)."""
    signature_b64 = params.pop("signature")
    received_hash = params.pop("hash")
    params.pop("signature", None)  # Already removed
    
    # Build data-check string (exclude hash and signature)
    data_check_string = "\n".join(f"{k}={unquote(v)}" for k, v in sorted(params.items()))
    
    # Extract bot ID from token
    bot_id = bot_token.split(":")[0]
    
    # Construct the full message: "bot_id:WebAppData\n" + data_check_string
    full_message = f"{bot_id}:WebAppData\n{data_check_string}"
    
    # Decode the signature (add padding if needed)
    try:
        # Add padding if necessary
        missing_padding = len(signature_b64) % 4
        if missing_padding:
            signature_b64 += "=" * (4 - missing_padding)
        signature_bytes = base64.b64decode(signature_b64)
    except Exception as e:
        logger.warning(f"Failed to decode Ed25519 signature: {e}")
        raise TelegramAuthError("Invalid signature format")
    
    # Verify the Ed25519 signature
    try:
        public_key_bytes = bytes.fromhex(TELEGRAM_PUBLIC_KEY_HEX)
        public_key = ed25519.Ed25519PublicKey.from_public_bytes(public_key_bytes)
        public_key.verify(signature_bytes, full_message.encode())
    except InvalidSignature:
        logger.warning("Ed25519 signature verification failed")
        raise TelegramAuthError("Invalid initData signature")
    except Exception as e:
        logger.warning(f"Ed25519 verification error: {e}")
        raise TelegramAuthError("Signature verification error")
    
    # Extract user payload
    user_raw = params.get("user")
    if not user_raw:
        raise TelegramAuthError("Missing user payload")
    
    user_payload = json.loads(unquote(user_raw))
    return AuthenticatedUser(
        id=user_payload.get("id"),
        first_name=user_payload.get("first_name"),
        last_name=user_payload.get("last_name"),
        username=user_payload.get("username"),
    )


def _verify_with_hmac(params: Dict[str, str], bot_token: str) -> AuthenticatedUser:
    """Verify using HMAC-SHA256 with bot token (legacy Telegram format)."""
    received_hash = params.pop("hash")
    params.pop("signature", None)
    
    # Build data-check string from sorted key-value pairs
    data_check_string = "\n".join(f"{k}={unquote(v)}" for k, v in sorted(params.items()))
    
    # Create secret key: HMAC-SHA256(key="WebAppData", msg=bot_token)
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    
    # Calculate hash: HMAC-SHA256(key=secret_key, msg=data_check_string)
    calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    
    if calculated_hash != received_hash:
        logger.warning(
            f"HMAC hash mismatch: calc={calculated_hash} recv={received_hash}"
        )
        raise TelegramAuthError("Invalid initData hash")
    
    # Extract user payload
    user_raw = params.get("user")
    if not user_raw:
        raise TelegramAuthError("Missing user payload")
    
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
