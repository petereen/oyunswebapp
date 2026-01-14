import hashlib
import hmac
import json
import base64
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, unquote
import logging

try:
    from cryptography.hazmat.primitives.asymmetric import ed25519
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

from models import AuthenticatedUser

logger = logging.getLogger("uvicorn.error")

# Telegram's Ed25519 public key for production (from docs)
TELEGRAM_PUBLIC_KEY_HEX = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d"


class TelegramAuthError(Exception):
    pass


def verify_telegram_init_data(init_data: str, bot_token: str) -> AuthenticatedUser:
    """
    Verify Telegram Mini App init data.
    Supports both new format (Ed25519 signature) and legacy format (HMAC-SHA256 hash).
    """
    # Parse query string manually by splitting on '&'
    # Keep BOTH encoded (for verification) and decoded (for user extraction) values
    pairs = init_data.split('&')
    data_dict_encoded = {}  # For signature/hash verification (URL-encoded values)
    data_dict_decoded = {}  # For extracting user data (decoded values)
    received_hash = ""
    received_signature = ""
    
    for pair in pairs:
        if '=' not in pair:
            continue
        key, val = pair.split('=', 1)
        if key == 'hash':
            received_hash = val
        elif key == 'signature':
            received_signature = val
        else:
            data_dict_encoded[key] = val  # Keep original encoded value
            data_dict_decoded[key] = unquote(val)  # Decode for user extraction
    
    logger.info(f"Telegram init data parsed: has_signature={bool(received_signature)}, crypto_available={CRYPTO_AVAILABLE}, data_keys={list(data_dict_decoded.keys())}")
    
    # Determine which verification method to use
    if received_signature and CRYPTO_AVAILABLE:
        # New format: Ed25519 signature verification
        logger.info("Using Ed25519 signature verification")
        return _verify_with_signature(data_dict_encoded, data_dict_decoded, bot_token, received_signature)
    elif received_hash:
        # Legacy format: HMAC-SHA256 verification
        logger.info("Using HMAC-SHA256 hash verification")
        return _verify_with_hash(data_dict_encoded, data_dict_decoded, bot_token, received_hash)
    else:
        raise TelegramAuthError("Missing both hash and signature in initData")


def _verify_with_signature(data_dict_encoded: Dict[str, str], data_dict_decoded: Dict[str, str], bot_token: str, received_signature: str) -> AuthenticatedUser:
    """Verify using Ed25519 signature (new Telegram format)."""
    if not CRYPTO_AVAILABLE:
        raise TelegramAuthError("Cryptography library not available for Ed25519 verification")
    
    # Extract bot ID from token
    bot_id = bot_token.split(":")[0]
    
    # Build data check string from ENCODED values (sorted, newline-separated, excluding signature and hash)
    data_dict_copy = dict(data_dict_encoded)  # Use encoded values for verification
    data_dict_copy.pop('signature', None)
    data_dict_copy.pop('hash', None)
    
    logger.info(f"Building data_check_string from keys: {sorted(data_dict_copy.keys())}")
    
    data_check_string = "\n".join(
        f"{k}={data_dict_copy[k]}" for k in sorted(data_dict_copy.keys())
    )
    
    # Construct full message for Ed25519: "bot_id:WebAppData\n" + data_check_string
    full_message = f"{bot_id}:WebAppData\n{data_check_string}"
    
    logger.info(f"Ed25519 verification: bot_id={bot_id}, message_len={len(full_message)}, sig_len={len(received_signature)}")
    logger.debug(f"Full message for verification: {full_message[:200]}...")
    
    # Decode signature (add padding if needed)
    try:
        missing_padding = len(received_signature) % 4
        if missing_padding:
            received_signature += "=" * (4 - missing_padding)
        signature_bytes = base64.b64decode(received_signature)
        logger.info(f"Signature decoded successfully: {len(signature_bytes)} bytes")
    except Exception as e:
        logger.error(f"Failed to decode Ed25519 signature: {e}", exc_info=True)
        raise TelegramAuthError("Invalid signature format")
    
    # Verify Ed25519 signature
    try:
        public_key_bytes = bytes.fromhex(TELEGRAM_PUBLIC_KEY_HEX)
        public_key = ed25519.Ed25519PublicKey.from_public_bytes(public_key_bytes)
        public_key.verify(signature_bytes, full_message.encode())
        logger.info("Ed25519 signature verified successfully!")
    except Exception as e:
        logger.error(f"Ed25519 verification failed: {type(e).__name__}: {e}", exc_info=True)
        raise TelegramAuthError("Invalid initData signature")
    
    # Signature verified! Extract and return user from DECODED values
    user_raw = data_dict_decoded.get("user")
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


def _verify_with_hash(data_dict_encoded: Dict[str, str], data_dict_decoded: Dict[str, str], bot_token: str, received_hash: str) -> AuthenticatedUser:
    """Verify using HMAC-SHA256 with bot token (legacy Telegram format)."""
    # Build data check string from ENCODED values (sorted, newline-separated)
    data_dict_copy = dict(data_dict_encoded)
    data_dict_copy.pop('signature', None)
    data_dict_copy.pop('hash', None)
    
    data_check_string = "\n".join(
        f"{k}={data_dict_copy[k]}" for k in sorted(data_dict_copy.keys())
    )
    
    # Derive secret key: HMAC-SHA256(key="WebAppData", message=bot_token)
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    
    # Calculate hash: HMAC-SHA256(key=secret_key, message=data_check_string)
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    
    # Compare hashes
    if calculated_hash != received_hash:
        logger.warning(
            f"Telegram initData hash mismatch: "
            f"calculated={calculated_hash[:16]}... "
            f"received={received_hash[:16]}... "
            f"data_len={len(data_check_string)}"
        )
        raise TelegramAuthError("Invalid initData hash")
    
    # Hash verified! Extract and return user from DECODED values
    user_raw = data_dict_decoded.get("user")
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
