import hashlib
import hmac
import json
import base64
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, unquote
import logging

try:
    from cryptography.hazmat.primitives.asymmetric import ed25519
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False

try:
    from jose import JWTError, jwt
    JWT_AVAILABLE = True
except ImportError:
    JWT_AVAILABLE = False

from models import AuthenticatedUser

logger = logging.getLogger("uvicorn.error")

# Telegram's Ed25519 public key for production (from docs)
TELEGRAM_PUBLIC_KEY_HEX = "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d"

# JWT configuration
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days


class TelegramAuthError(Exception):
    pass


class JWTAuthError(Exception):
    pass


def create_jwt_token(user: AuthenticatedUser, secret: str) -> str:
    """
    Create a JWT token for an authenticated user.
    
    Args:
        user: Authenticated user object
        secret: JWT secret key
        
    Returns:
        Encoded JWT token string
    """
    if not JWT_AVAILABLE:
        raise JWTAuthError("JWT library not available")
    
    # Token payload
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),  # Subject (user ID)
        "first_name": user.first_name,
        "last_name": user.last_name,
        "username": user.username,
        "iat": now,  # Issued at
        "exp": now + timedelta(hours=JWT_EXPIRATION_HOURS),  # Expiration
    }
    
    # Encode token
    token = jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)
    logger.info(f"JWT token created for user {user.id}, expires in {JWT_EXPIRATION_HOURS}h")
    return token


def verify_jwt_token(token: str, secret: str) -> AuthenticatedUser:
    """
    Verify and decode a JWT token.
    
    Args:
        token: JWT token string
        secret: JWT secret key
        
    Returns:
        AuthenticatedUser object
        
    Raises:
        JWTAuthError: If token is invalid or expired
    """
    if not JWT_AVAILABLE:
        raise JWTAuthError("JWT library not available")
    
    try:
        # Decode and verify token
        payload = jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
        
        # Extract user data
        user_id = int(payload.get("sub"))
        first_name = payload.get("first_name")
        last_name = payload.get("last_name")
        username = payload.get("username")
        
        # logger.info(f"JWT token verified for user {user_id}")
        
        return AuthenticatedUser(
            id=user_id,
            first_name=first_name,
            last_name=last_name,
            username=username,
        )
    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise JWTAuthError(f"Invalid or expired token: {e}")
    except (KeyError, ValueError) as e:
        logger.warning(f"JWT payload parsing failed: {e}")
        raise JWTAuthError(f"Invalid token payload: {e}")


def verify_telegram_init_data(init_data: str, bot_token: str) -> AuthenticatedUser:
    """
    Verify Telegram Mini App init data.
    Supports both new format (Ed25519 signature) and legacy format (HMAC-SHA256 hash).
    """
    if not init_data:
        raise TelegramAuthError("Init data is empty")

    # Parse init_data using standard library to get DECODED values
    try:
        # keep_blank_values=True ensures empty strings are preserved
        parsed_data = dict(parse_qsl(init_data, keep_blank_values=True))
    except Exception as e:
        logger.error(f"Failed to parse init_data: {e}")
        raise TelegramAuthError(f"Failed to parse init_data: {e}")

    if not parsed_data:
         # Fallback for when data might be already decoded or in a weird format
         # But usually parse_qsl handles strings gracefully.
         logger.warning("parse_qsl returned empty dict, attempting manual split")
         try:
             parsed_data = {}
             for pair in init_data.split('&'):
                 if '=' in pair:
                     k, v = pair.split('=', 1)
                     parsed_data[k] = unquote(v)
         except Exception as e:
             raise TelegramAuthError(f"Manual parsing failed: {e}")

    received_hash = parsed_data.get("hash")
    received_signature = parsed_data.get("signature")

    # Determine verification method
    if received_signature and CRYPTO_AVAILABLE:
        # New format: Ed25519 signature verification
        # For signature verification, we might need the original encoded string components?
        # Telegram docs say "WebAppData" + data_check_string.
        # But data_check_string is usually constructed from decoded values in Telegram's spec?
        # Actually for Ed25519, the spec is less clear in some public docs vs legacy.
        # However, typically consistency is key.
        # Let's stick to the safer legacy hash validation if hash is present, 
        # as the user is likely using a standard bot token.
        # If ONLY signature is present (unlikely for standard bots), we use signature.
        if received_hash:
             return _verify_with_hash(parsed_data, bot_token)
        else:
             return _verify_with_signature(parsed_data, bot_token)
            
    elif received_hash:
        # Legacy format: HMAC-SHA256 verification
        return _verify_with_hash(parsed_data, bot_token)
    else:
        raise TelegramAuthError("Missing hash or signature in initData")


def _verify_with_hash(parsed_data: Dict[str, str], bot_token: str) -> AuthenticatedUser:
    """
    Verify using HMAC-SHA256 with bot token.
    parsed_data must contain DECODED keys and values.
    """
    received_hash = parsed_data.get("hash")
    if not received_hash:
        raise TelegramAuthError("Missing hash in initData")

    # 1. Create data_check_string
    # Filter out hash (and signature if present, though legacy usually doesn't have it mixed)
    data_check_dict = {
        k: v for k, v in parsed_data.items() 
        if k != "hash" and k != "signature"
    }
    
    # Sort keys alphabetically and join with newline
    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(data_check_dict.items())
    )
    
    # 2. Calculate Secret Key
    # secret_key = HMAC_SHA256("WebAppData", bot_token)
    try:
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    except Exception as e:
        logger.error(f"Error creating secret key: {e}")
        raise TelegramAuthError("Internal error during validation")

    # 3. Calculate Hash
    # hash = HMAC_SHA256(secret_key, data_check_string)
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()
    
    # 4. Compare
    if calculated_hash != received_hash:
        logger.warning(
            f"Hash mismatch (decoded). Calculated: {calculated_hash}, Received: {received_hash}"
        )
        logger.debug(f"Data check string (decoded) used: {data_check_string!r}")
        
        # FALLBACK: Try validating with RAW (encoded) values
        # This handles cases where intermediate proxies might have messed with encoding
        # or if the client is sending data in a non-standard way.
        logger.info("Attempting fallback validation with raw values...")
        try:
            return _verify_with_hash_raw(init_data, bot_token, received_hash, parsed_data)
        except TelegramAuthError:
            # If fallback also fails, raise the original error (or generic)
            logger.warning("Fallback validation also failed.")
            raise TelegramAuthError("Invalid initData hash")
    
    # 5. Extract User
    user_raw = parsed_data.get("user")
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


def _verify_with_signature(parsed_data: Dict[str, str], bot_token: str) -> AuthenticatedUser:
    """
    Verify using Ed25519 signature.
    """
    if not CRYPTO_AVAILABLE:
        raise TelegramAuthError("Cryptography library not available for Ed25519 verification")
    
    received_signature = parsed_data.get("signature")
    if not received_signature:
        raise TelegramAuthError("Missing signature")
        
    # Extract bot ID from token (token format: 123456:ABC-...)
    bot_id = bot_token.split(":")[0]
    
    # Prepare data check string
    data_check_dict = {
        k: v for k, v in parsed_data.items() 
        if k != "hash" and k != "signature"
    }
    
    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(data_check_dict.items())
    )
    
    # Construct full message
    full_message = f"{bot_id}:WebAppData\n{data_check_string}"
    
    # Decode signature
    try:
        # Fix padding if necessary (though usually standard Base64)
        missing_padding = len(received_signature) % 4
        if missing_padding:
            received_signature += "=" * (4 - missing_padding)
        signature_bytes = base64.b64decode(received_signature)
    except Exception as e:
        raise TelegramAuthError(f"Invalid signature encoding: {e}")
        
    # Verify
    try:
        public_key_bytes = bytes.fromhex(TELEGRAM_PUBLIC_KEY_HEX)
        public_key = ed25519.Ed25519PublicKey.from_public_bytes(public_key_bytes)
        public_key.verify(signature_bytes, full_message.encode())
    except Exception as e:
        logger.error(f"Ed25519 verification failed: {e}")
        raise TelegramAuthError("Invalid initData signature")
        
    # Extract User
    user_raw = parsed_data.get("user")
    if not user_raw:
        raise TelegramAuthError("Missing user payload")
        
    try:
        user_payload = json.loads(user_raw)
    except json.JSONDecodeError:
        raise TelegramAuthError("Invalid user payload JSON")
        
    return AuthenticatedUser(
        id=user_payload.get("id"),
        first_name=user_payload.get("first_name"),
        last_name=user_payload.get("last_name"),
        username=user_payload.get("username"),
    )


def _verify_with_hash_raw(init_data: str, bot_token: str, received_hash: str, parsed_data_decoded: Dict[str, str]) -> AuthenticatedUser:
    """
    Fallback: Verify using encoded values (manual parsing).
    """
    # Manual parsing preserving encoding
    pairs = init_data.split('&')
    data_check_items = []
    
    for pair in pairs:
        if '=' not in pair:
            continue
        key, value = pair.split('=', 1)
        if key == 'hash' or key == 'signature':
            continue
        data_check_items.append((key, value))
        
    # Sort by key to match Telegram spec (key=value string sort is risky if keys overlap)
    data_check_items.sort(key=lambda x: x[0])
    
    data_check_string = "\n".join(f"{k}={v}" for k, v in data_check_items)
    
    # Calculate hash
    try:
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
    except Exception:
        raise TelegramAuthError("Internal error during raw validation")
        
    if calculated_hash != received_hash:
        logger.warning(f"Hash mismatch (raw). Calculated: {calculated_hash}")
        logger.debug(f"Data check string (raw) used: {data_check_string!r}")
        raise TelegramAuthError("Invalid initData hash (raw)")
        
    # If successful, return the user from the DECODED data (which we trust if hash matches)
    user_raw = parsed_data_decoded.get("user")
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
