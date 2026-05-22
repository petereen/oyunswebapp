import hashlib
import hmac
import json
import base64
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, unquote
import logging

import requests

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
TELEGRAM_LOGIN_ISSUER = "https://oauth.telegram.org"
TELEGRAM_LOGIN_JWKS_URL = f"{TELEGRAM_LOGIN_ISSUER}/.well-known/jwks.json"
TELEGRAM_LOGIN_JWKS_CACHE_SECONDS = 3600

# JWT configuration
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

_telegram_login_jwks_cache: Optional[dict[str, Any]] = None
_telegram_login_jwks_cache_expires_at: Optional[datetime] = None


class TelegramAuthError(Exception):
    pass


class JWTAuthError(Exception):
    pass


class TelegramLoginError(Exception):
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


def create_telegram_login_challenge(nonce: str, secret: str, ttl_seconds: int) -> str:
    """Create a short-lived signed challenge bound to a browser login nonce."""
    if not JWT_AVAILABLE:
        raise TelegramLoginError("JWT library not available")

    now = datetime.now(timezone.utc)
    payload = {
        "purpose": "telegram_browser_login",
        "nonce": nonce,
        "iat": now,
        "exp": now + timedelta(seconds=ttl_seconds),
    }
    return jwt.encode(payload, secret, algorithm=JWT_ALGORITHM)


def verify_telegram_login_challenge(token: str, secret: str) -> str:
    """Verify a short-lived signed challenge and return the expected nonce."""
    if not token:
        raise TelegramLoginError("Missing Telegram login challenge")

    try:
        payload = jwt.decode(token, secret, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise TelegramLoginError(f"Invalid or expired Telegram login challenge: {exc}") from exc

    if payload.get("purpose") != "telegram_browser_login":
        raise TelegramLoginError("Invalid Telegram login challenge purpose")

    nonce = payload.get("nonce")
    if not nonce or not isinstance(nonce, str):
        raise TelegramLoginError("Telegram login challenge is missing a nonce")

    return nonce


def verify_telegram_login_id_token(id_token: str, client_id: str) -> tuple[AuthenticatedUser, Optional[str]]:
    """Validate Telegram Login/OIDC id_token using Telegram's JWKS endpoint."""
    if not JWT_AVAILABLE:
        raise TelegramLoginError("JWT library not available")
    if not id_token:
        raise TelegramLoginError("Telegram id_token is required")
    if not client_id:
        raise TelegramLoginError("Telegram browser login is not configured")

    try:
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise TelegramLoginError(f"Invalid Telegram id_token header: {exc}") from exc

    key_id = header.get("kid")
    algorithm = header.get("alg")
    if not key_id or not algorithm:
        raise TelegramLoginError("Telegram id_token is missing kid or alg")

    jwk_key = _find_telegram_login_jwk(key_id)

    try:
        claims = jwt.decode(
            id_token,
            jwk_key,
            algorithms=[algorithm],
            audience=client_id,
            issuer=TELEGRAM_LOGIN_ISSUER,
            options={
                "require_aud": True,
                "require_exp": True,
                "require_iat": True,
                "require_iss": True,
                "leeway": 30,
            },
        )
    except JWTError as exc:
        raise TelegramLoginError(f"Invalid Telegram id_token: {exc}") from exc

    raw_user_id = claims.get("id")
    if raw_user_id is None:
        raise TelegramLoginError("Telegram id_token is missing the user id")

    try:
        user_id = int(raw_user_id)
    except (TypeError, ValueError) as exc:
        raise TelegramLoginError("Telegram id_token contains an invalid user id") from exc

    display_name = claims.get("given_name") or claims.get("name")
    username = claims.get("preferred_username") or claims.get("username")

    return (
        AuthenticatedUser(
            id=user_id,
            first_name=display_name,
            last_name=claims.get("family_name"),
            username=username,
        ),
        claims.get("nonce"),
    )


def _find_telegram_login_jwk(key_id: str) -> dict[str, Any]:
    jwks = _get_telegram_login_jwks()
    key = _find_jwk_in_set(jwks, key_id)
    if key:
        return key

    jwks = _get_telegram_login_jwks(force_refresh=True)
    key = _find_jwk_in_set(jwks, key_id)
    if key:
        return key

    raise TelegramLoginError("Telegram login signing key was not found")


def _find_jwk_in_set(jwks: dict[str, Any], key_id: str) -> Optional[dict[str, Any]]:
    keys = jwks.get("keys")
    if not isinstance(keys, list):
        return None

    for key in keys:
        if isinstance(key, dict) and key.get("kid") == key_id:
            return key
    return None


def _get_telegram_login_jwks(force_refresh: bool = False) -> dict[str, Any]:
    global _telegram_login_jwks_cache
    global _telegram_login_jwks_cache_expires_at

    now = datetime.now(timezone.utc)
    if (
        not force_refresh
        and _telegram_login_jwks_cache is not None
        and _telegram_login_jwks_cache_expires_at is not None
        and now < _telegram_login_jwks_cache_expires_at
    ):
        return _telegram_login_jwks_cache

    try:
        response = requests.get(TELEGRAM_LOGIN_JWKS_URL, timeout=5)
        response.raise_for_status()
        jwks = response.json()
    except requests.RequestException as exc:
        raise TelegramLoginError(f"Unable to fetch Telegram login keys: {exc}") from exc
    except ValueError as exc:
        raise TelegramLoginError(f"Telegram login keys response is not valid JSON: {exc}") from exc

    if not isinstance(jwks, dict) or not isinstance(jwks.get("keys"), list):
        raise TelegramLoginError("Telegram login keys response is invalid")

    _telegram_login_jwks_cache = jwks
    _telegram_login_jwks_cache_expires_at = now + timedelta(seconds=TELEGRAM_LOGIN_JWKS_CACHE_SECONDS)
    return jwks


def verify_telegram_init_data(init_data: str, bot_token: str) -> AuthenticatedUser:
    """
    Verify Telegram Mini App init data.
    Supports both legacy format (HMAC-SHA256 hash) and new format (Ed25519 signature).
    
    Per Telegram docs, data-check-string uses the RAW query string values (URL-encoded).
    """
    if not init_data:
        raise TelegramAuthError("Init data is empty")

    # Parse using raw splitting to preserve URL-encoded values
    raw_pairs = []
    received_hash = None
    received_signature = None
    
    for pair in init_data.split('&'):
        if '=' not in pair:
            continue
        key, value = pair.split('=', 1)
        if key == 'hash':
            received_hash = value
        elif key == 'signature':
            received_signature = value
            # For HASH verification, signature IS included in data_check_string
            # For SIGNATURE verification, signature is excluded
            raw_pairs.append((key, value))
        else:
            raw_pairs.append((key, value))
    
    if not raw_pairs:
        raise TelegramAuthError("No valid key-value pairs in initData")

    logger.info(f"initData has hash={bool(received_hash)}, signature={bool(received_signature)}, pairs={len(raw_pairs)}")

    # PREFER HASH over signature (more reliable, widely tested)
    if received_hash:
        try:
            # For hash verification, include ALL fields except 'hash' (including 'signature' if present)
            return _verify_with_hash_raw(raw_pairs, received_hash, bot_token)
        except TelegramAuthError as e:
            logger.warning(f"Hash verification failed: {e}")
            # If we have signature, try that as fallback
            if received_signature and CRYPTO_AVAILABLE:
                logger.info("Falling back to signature verification...")
                # For signature verification, exclude 'signature' from pairs
                pairs_without_sig = [(k, v) for k, v in raw_pairs if k != 'signature']
                return _verify_with_signature_raw(pairs_without_sig, received_signature, bot_token)
            raise
    elif received_signature and CRYPTO_AVAILABLE:
        # For signature verification, exclude 'signature' from pairs
        pairs_without_sig = [(k, v) for k, v in raw_pairs if k != 'signature']
        return _verify_with_signature_raw(pairs_without_sig, received_signature, bot_token)
    else:
        raise TelegramAuthError("Missing hash or signature in initData")


def _verify_with_hash_raw(raw_pairs: list, received_hash: str, bot_token: str) -> AuthenticatedUser:
    """
    Verify using HMAC-SHA256 with bot token.
    Uses RAW (URL-encoded) values as per Telegram documentation.
    """
    # 1. Sort pairs alphabetically by key and create data_check_string
    sorted_pairs = sorted(raw_pairs, key=lambda x: x[0])
    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted_pairs)
    
    logger.info(f"Hash verification - keys: {[p[0] for p in sorted_pairs]}")
    logger.debug(f"Data check string (first 300 chars): {data_check_string[:300]}")
    
    # 2. Calculate Secret Key: HMAC-SHA256 with "WebAppData" as key and bot_token as message
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()

    # 3. Calculate Hash: HMAC-SHA256 with secret_key and data_check_string
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode('utf-8'), hashlib.sha256
    ).hexdigest()
    
    logger.info(f"Calculated: {calculated_hash[:20]}... | Received: {received_hash[:20]}...")
    
    # 4. Compare
    if calculated_hash == received_hash:
        logger.info("✅ Hash verified with raw values")
    else:
        # Try with URL-decoded values as fallback
        logger.info("Trying decoded values...")
        decoded_pairs = [(k, unquote(v)) for k, v in sorted_pairs]
        decoded_check_string = "\n".join(f"{k}={v}" for k, v in decoded_pairs)
        
        decoded_hash = hmac.new(
            secret_key, decoded_check_string.encode('utf-8'), hashlib.sha256
        ).hexdigest()
        
        logger.info(f"Decoded calc: {decoded_hash[:20]}...")
        
        if decoded_hash == received_hash:
            logger.info("✅ Hash verified with decoded values")
            sorted_pairs = decoded_pairs
        else:
            logger.error(f"❌ Hash mismatch! Raw: {calculated_hash}, Decoded: {decoded_hash}, Received: {received_hash}")
            raise TelegramAuthError("Invalid initData hash")
    
    # 5. Extract User
    user_raw = None
    for k, v in sorted_pairs:
        if k == "user":
            user_raw = unquote(v) if '%' in v else v
            break
    
    if not user_raw:
        raise TelegramAuthError("Missing user payload in initData")
    
    try:
        user_payload = json.loads(user_raw)
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse user JSON: {e}, raw: {user_raw[:100]}")
        raise TelegramAuthError("Invalid user payload JSON")
        
    return AuthenticatedUser(
        id=user_payload.get("id"),
        first_name=user_payload.get("first_name"),
        last_name=user_payload.get("last_name"),
        username=user_payload.get("username"),
    )


def _verify_with_signature_raw(raw_pairs: list, received_signature: str, bot_token: str) -> AuthenticatedUser:
    """
    Verify using Ed25519 signature with raw pairs.
    Tries raw (URL-encoded) values first, then URL-decoded as fallback
    (mirrors the hash verification behavior for mobile compatibility).
    """
    if not CRYPTO_AVAILABLE:
        raise TelegramAuthError("Cryptography library not available for Ed25519 verification")
    
    # Extract bot ID from token (token format: 123456:ABC-...)
    bot_id = bot_token.split(":")[0]
    
    # Decode signature (base64url)
    try:
        # Handle base64url encoding (replace - with + and _ with /)
        sig_b64 = received_signature.replace('-', '+').replace('_', '/')
        # Fix padding if necessary
        missing_padding = len(sig_b64) % 4
        if missing_padding:
            sig_b64 += "=" * (4 - missing_padding)
        signature_bytes = base64.b64decode(sig_b64)
    except Exception as e:
        raise TelegramAuthError(f"Invalid signature encoding: {e}")
    
    public_key_bytes = bytes.fromhex(TELEGRAM_PUBLIC_KEY_HEX)
    public_key = ed25519.Ed25519PublicKey.from_public_bytes(public_key_bytes)

    # Try with raw (URL-encoded) values first, then decoded — same fallback as hash path
    attempts = [
        ("raw", sorted(raw_pairs, key=lambda x: x[0])),
        ("decoded", sorted([(k, unquote(v)) for k, v in raw_pairs], key=lambda x: x[0])),
    ]
    
    last_error = None
    for label, pairs in attempts:
        data_check_string = "\n".join(f"{k}={v}" for k, v in pairs)
        full_message = f"{bot_id}:WebAppData\n{data_check_string}"
        
        try:
            public_key.verify(signature_bytes, full_message.encode())
            logger.info(f"✅ Ed25519 verified with {label} values")
            
            # Extract User
            user_raw = None
            for k, v in pairs:
                if k == "user":
                    user_raw = unquote(v) if '%' in v else v
                    break
            
            if not user_raw:
                raise TelegramAuthError("Missing user payload")
            
            user_payload = json.loads(user_raw)
            return AuthenticatedUser(
                id=user_payload.get("id"),
                first_name=user_payload.get("first_name"),
                last_name=user_payload.get("last_name"),
                username=user_payload.get("username"),
            )
        except TelegramAuthError:
            raise
        except Exception as e:
            logger.info(f"Ed25519 {label} attempt failed: {e}")
            last_error = e
            continue
    
    logger.error(f"Ed25519 verification failed (both raw and decoded): {last_error}")
    raise TelegramAuthError("Invalid initData signature")


def debug_telegram_validation(init_data: str, bot_token: str) -> Dict[str, Any]:
    """
    Perform validation and return detailed debug info.
    """
    result = {
        "valid": False,
        "method": "unknown",
        "bot_token_prefix": bot_token[:10] + "..." if bot_token else "missing",
        "steps": []
    }
    
    # Step 1: Decode
    try:
        parsed_data = dict(parse_qsl(init_data, keep_blank_values=True))
        result["steps"].append({"step": "parse_qsl", "status": "success", "keys": list(parsed_data.keys())})
    except Exception as e:
        result["steps"].append({"step": "parse_qsl", "status": "failed", "error": str(e)})
        return result

    received_hash = parsed_data.get("hash")
    if not received_hash:
        result["error"] = "Missing hash"
        return result
    
    # Step 2: Standard Validation
    data_check_dict = {
        k: v for k, v in parsed_data.items() 
        if k != "hash" and k != "signature"
    }
    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(data_check_dict.items())
    )
    result["standard_check_string"] = data_check_string
    
    try:
        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        result["standard_calculated_hash"] = calculated_hash
        result["received_hash"] = received_hash
        
        if calculated_hash == received_hash:
            result["valid"] = True
            result["method"] = "standard"
            return result
        else:
            result["steps"].append({"step": "standard_validation", "status": "failed", "mismatch": True})
    except Exception as e:
        result["steps"].append({"step": "standard_validation", "status": "failed", "error": str(e)})

    # Step 3: Raw Validation
    try:
        pairs = init_data.split('&')
        data_check_items = []
        for pair in pairs:
            if '=' not in pair: continue
            key, value = pair.split('=', 1)
            if key == 'hash' or key == 'signature': continue
            data_check_items.append((key, value))
        
        data_check_items.sort(key=lambda x: x[0])
        raw_check_string = "\n".join(f"{k}={v}" for k, v in data_check_items)
        result["raw_check_string"] = raw_check_string
        
        calculated_hash_raw = hmac.new(secret_key, raw_check_string.encode(), hashlib.sha256).hexdigest()
        result["raw_calculated_hash"] = calculated_hash_raw
        
        if calculated_hash_raw == received_hash:
            result["valid"] = True
            result["method"] = "raw"
            return result
        else:
            result["steps"].append({"step": "raw_validation", "status": "failed", "mismatch": True})
    except Exception as e:
        result["steps"].append({"step": "raw_validation", "status": "failed", "error": str(e)})
        
    return result


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
