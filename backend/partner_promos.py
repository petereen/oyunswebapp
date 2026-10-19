"""Partner-only verification and atomic issuance through the OYUNS+ ledger."""
import re
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, constr

from config import get_settings
from db import get_supabase

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_PATTERN = re.compile(r"^GAL-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$")
router = APIRouter()


class PartnerPromoCodeUseRequest(BaseModel):
    code: constr(pattern=r"^GAL-[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$")


def generate_promo_code() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(10))
    return f"GAL-{raw[:5]}-{raw[5:]}"


def partner_brand_id() -> str | None:
    value = get_settings().partner_brand_id
    try:
        return str(uuid.UUID(value)) if value else None
    except ValueError:
        return None


def validate_automatic_coupon(config: dict) -> None:
    if config.get("issuance_mode", "manual") == "manual":
        return
    if not partner_brand_id() or str(config.get("brand_id")) != partner_brand_id():
        raise HTTPException(422, "Automatic issuance is only available for the configured partner brand")
    if not get_settings().partner_api_key:
        raise HTTPException(503, "Partner integration is not configured")
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", config.get("sku_tier") or ""):
        raise HTTPException(422, "A valid partner SKU tier is required")
    days = config.get("validity_days")
    if not isinstance(days, int) or not 1 <= days <= 3650:
        raise HTTPException(422, "validity_days must be between 1 and 3650")


def issue_promo_code(client, *, user_id: int, card: dict, receiver_name: str | None, receiver_phone: str | None) -> dict:
    # Price, SKU and validity come from the server-loaded coupon, never the purchaser.
    validate_automatic_coupon(card)
    for attempt in range(5):
        try:
            result = client.rpc("issue_partner_promo_code", {
                "p_user_id": user_id, "p_card_id": card["id"],
                "p_partner_brand_id": partner_brand_id(), "p_sku_tier": card["sku_tier"],
                "p_points_spent": card["points_price"], "p_validity_days": card["validity_days"],
                "p_code": generate_promo_code(), "p_receiver_name": receiver_name,
                "p_receiver_phone": receiver_phone,
            }).execute().data
            return result[0] if isinstance(result, list) and result else result
        except Exception as exc:
            # A failed SQL statement rolls back request, points and code together.
            if getattr(exc, "code", None) == "23505" and "loyalty_promo_codes_code_key" in str(exc) and attempt < 4:
                continue
            raise
    raise RuntimeError("Promo code generation exhausted")


def require_partner(authorization: str | None = Header(default=None)) -> str:
    settings = get_settings()
    brand_id = partner_brand_id()
    if not settings.partner_api_key or not brand_id:
        raise HTTPException(503, "Partner integration is not configured", headers={"Cache-Control": "no-store"})
    parts = (authorization or "").split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or not secrets.compare_digest(parts[1].encode(), settings.partner_api_key.encode()):
        raise HTTPException(401, "Unauthorized", headers={"WWW-Authenticate": "Bearer", "Cache-Control": "no-store"})
    return brand_id


@router.get("/api/v1/partner/promo-codes/{code}")
def verify_partner_promo_code(code: str, brand_id: str = Depends(require_partner)):
    headers = {"Cache-Control": "no-store"}
    rows = []
    if CODE_PATTERN.fullmatch(code):
        rows = (get_supabase().table("loyalty_promo_codes")
                .select("code,sku_tier,status,issued_at,expires_at,used_at")
                .eq("brand_id", brand_id).eq("code", code).limit(1).execute().data or [])
    if not rows:
        return JSONResponse({"is_valid": False, "error": "NOT_FOUND"}, status_code=404, headers=headers)
    row = rows[0]
    try:
        expiry = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00"))
        expired = expiry <= datetime.now(timezone.utc)
    except (ValueError, TypeError, KeyError, AttributeError):
        expired = True
    if row["status"] == "USED":
        return JSONResponse({"is_valid": False, "error": "USED", "expires_at": row.get("expires_at"), "used_at": row.get("used_at")}, headers=headers)
    if row["status"] != "ACTIVE" or expired:
        return JSONResponse({"is_valid": False, "error": "EXPIRED_OR_REVOKED", "expires_at": row.get("expires_at")}, headers=headers)
    return JSONResponse({"is_valid": True, **{key: row[key] for key in ("code", "sku_tier", "issued_at", "expires_at")}}, headers=headers)


@router.post("/api/v1/partner/promo-codes")
def mark_partner_promo_code_used(payload: PartnerPromoCodeUseRequest, brand_id: str = Depends(require_partner)):
    """Record partner redemption; duplicate callbacks for a used code are safe to retry."""
    headers = {"Cache-Control": "no-store"}
    now = datetime.now(timezone.utc).isoformat()
    client = get_supabase()
    updated = (client.table("loyalty_promo_codes")
               .update({"status": "USED", "used_at": now})
               .eq("brand_id", brand_id).eq("code", payload.code).eq("status", "ACTIVE")
               .gt("expires_at", now).select("code,status,used_at")
               .execute().data or [])
    if updated:
        return JSONResponse({"used": True, **updated[0]}, headers=headers)

    rows = (client.table("loyalty_promo_codes")
            .select("code,status,expires_at,used_at")
            .eq("brand_id", brand_id).eq("code", payload.code).limit(1).execute().data or [])
    if not rows:
        return JSONResponse({"used": False, "error": "NOT_FOUND"}, status_code=404, headers=headers)
    row = rows[0]
    if row["status"] == "USED":
        return JSONResponse({"used": True, "code": row["code"], "status": "USED", "used_at": row.get("used_at")}, headers=headers)
    try:
        expired = datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) <= datetime.now(timezone.utc)
    except (ValueError, TypeError, KeyError, AttributeError):
        expired = True
    error = "EXPIRED" if expired else "REVOKED"
    return JSONResponse({"used": False, "error": error}, status_code=409, headers=headers)


@router.get("/api/v1/partner/promo-codes")
def list_partner_promo_codes(brand_id: str = Depends(require_partner)):
    """List every code issued for this partner, without exposing purchaser data."""
    page_size = 1000
    rows = []
    start = 0
    while True:
        page = (get_supabase().table("loyalty_promo_codes")
                .select("code,sku_tier,status,issued_at,expires_at,used_at")
                .eq("brand_id", brand_id)
                .range(start, start + page_size - 1).execute().data or [])
        rows.extend(page)
        if len(page) < page_size:
            break
        start += page_size
    return JSONResponse({"promo_codes": rows}, headers={"Cache-Control": "no-store"})
