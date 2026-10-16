from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import partner_promos as promos

BRAND = "2fc19319-848f-450e-9f2c-a92ae11dca0d"
CODE = "GAL-ABCDE-FGHJK"


class Lookup:
    def __init__(self, rows):
        self.rows = rows
        self.filters = {}

    def table(self, name):
        assert name == "loyalty_promo_codes"
        return self

    def select(self, columns):
        assert "user_id" not in columns
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, count):
        return self

    def execute(self):
        return SimpleNamespace(data=[r for r in self.rows if all(r[k] == v for k, v in self.filters.items())])


@pytest.fixture
def api(monkeypatch):
    settings = SimpleNamespace(partner_api_key="a-test-partner-secret", partner_brand_id=BRAND)
    monkeypatch.setattr(promos, "get_settings", lambda: settings)
    db = Lookup([])
    monkeypatch.setattr(promos, "get_supabase", lambda: db)
    app = FastAPI()
    app.include_router(promos.router)
    return TestClient(app), db, settings


def row(**updates):
    return {"code": CODE, "brand_id": BRAND, "sku_tier": "vpn_premium_3m", "status": "ACTIVE",
            "issued_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(), **updates}


def get(client, code=CODE, token="Bearer a-test-partner-secret"):
    return client.get(f"/api/v1/partner/promo-codes/{code}", headers={"Authorization": token})


@pytest.mark.parametrize("token", ["", "Bearer wrong", "Basic a-test-partner-secret", "Bearer", "Bearer a b", "Bearer кирилл"])
def test_authentication_before_lookup(api, token):
    client, db, _ = api
    # HTTP headers are Latin-1; Unicode rejection is checked directly below.
    if "кирилл" in token:
        with pytest.raises(HTTPException) as exc:
            promos.require_partner(token)
        assert exc.value.status_code == 401
        return
    response = get(client, token=token)
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    assert not db.filters


def test_configuration_fails_closed(api):
    client, db, settings = api
    for field, value in (("partner_api_key", ""), ("partner_brand_id", "not-a-uuid")):
        old = getattr(settings, field)
        setattr(settings, field, value)
        assert get(client).status_code == 503
        assert not db.filters
        setattr(settings, field, old)


def test_valid_code_returns_only_partner_contract(api):
    client, db, _ = api
    db.rows = [row()]
    response = get(client, token="bearer a-test-partner-secret")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {"is_valid": True, **{k: db.rows[0][k] for k in ("code", "sku_tier", "issued_at", "expires_at")}}
    assert db.filters == {"brand_id": BRAND, "code": CODE}


@pytest.mark.parametrize("changes", [{}, {"brand_id": "another-brand"}])
def test_missing_or_other_brand_returns_404(api, changes):
    client, db, _ = api
    db.rows = [row(**changes)] if changes else []
    response = get(client)
    assert response.status_code == 404
    assert response.json() == {"is_valid": False, "error": "NOT_FOUND"}


def test_malformed_code_skips_database(api):
    client, db, _ = api
    assert get(client, "invalid").status_code == 404
    assert not db.filters


@pytest.mark.parametrize("changes", [
    {"status": "REVOKED"}, {"expires_at": datetime.now(timezone.utc).isoformat()},
    {"expires_at": "invalid"}, {"expires_at": None}, {"expires_at": "2026-01-01T00:00:00"},
])
def test_expired_revoked_and_bad_expiry_fail_closed(api, changes):
    client, db, _ = api
    db.rows = [row(**changes)]
    response = get(client)
    assert response.status_code == 200
    assert response.json() == {"is_valid": False, "error": "EXPIRED_OR_REVOKED", "expires_at": db.rows[0]["expires_at"]}


def test_generator_format_uniqueness_and_crypto_source(monkeypatch):
    codes = {promos.generate_promo_code() for _ in range(2000)}
    assert len(codes) == 2000
    assert all(promos.CODE_PATTERN.fullmatch(code) for code in codes)
    calls = []
    monkeypatch.setattr(promos.secrets, "choice", lambda alphabet: calls.append(alphabet) or "A")
    assert promos.generate_promo_code() == "GAL-AAAAA-AAAAA"
    assert calls == [promos.ALPHABET] * 10
    assert not set("0O1I") & set(promos.ALPHABET)


def test_automatic_coupon_is_partner_scoped_and_requires_tier(api):
    _, _, _ = api
    valid = {"issuance_mode": "automatic", "brand_id": BRAND, "sku_tier": "vpn_3m", "validity_days": 30}
    promos.validate_automatic_coupon(valid)
    promos.validate_automatic_coupon({"issuance_mode": "manual"})
    for changes in ({"brand_id": "other"}, {"sku_tier": None}, {"validity_days": None}, {"validity_days": 0}, {"validity_days": 3651}):
        with pytest.raises(HTTPException):
            promos.validate_automatic_coupon({**valid, **changes})


def test_issuance_retries_only_code_collision(api):
    class Collision(Exception):
        code = "23505"

    calls = []
    class Client:
        def rpc(self, name, payload):
            assert name == "issue_partner_promo_code"
            calls.append(payload)
            return self
        def execute(self):
            if len(calls) == 1:
                raise Collision("loyalty_promo_codes_code_key")
            return SimpleNamespace(data={"id": "request-1", "code": calls[-1]["p_code"]})
    card = {"id": "card-1", "issuance_mode": "automatic", "brand_id": BRAND, "sku_tier": "vpn_3m", "points_price": 100, "validity_days": 30}
    result = promos.issue_promo_code(Client(), user_id=42, card=card, receiver_name="Name", receiver_phone="+97699112233")
    assert len(calls) == 2
    assert calls[0]["p_code"] != calls[1]["p_code"]
    assert calls[1]["p_points_spent"] == 100
    assert result["code"] == calls[1]["p_code"]


def test_insufficient_points_is_not_retried(api):
    class Client:
        def rpc(self, *args):
            return self
        def execute(self):
            raise RuntimeError("INSUFFICIENT_POINTS")
    card = {"id": "card-1", "issuance_mode": "automatic", "brand_id": BRAND, "sku_tier": "vpn_3m", "points_price": 100, "validity_days": 30}
    with pytest.raises(RuntimeError, match="INSUFFICIENT_POINTS"):
        promos.issue_promo_code(Client(), user_id=42, card=card, receiver_name="Name", receiver_phone="+97699112233")


def test_partner_router_is_mounted_in_actual_application(api):
    import main
    _, db, _ = api
    db.rows = [row()]
    response = get(TestClient(main.app))
    assert response.status_code == 200
    assert response.json()["is_valid"] is True


@pytest.mark.parametrize("mode", ["manual", "automatic"])
def test_existing_purchase_route_dispatches_by_coupon_mode(monkeypatch, mode):
    import main
    from models import OyunsPlusVoucherRequestCreate
    import asyncio

    card = {"id": "fae44da3-1e5f-4d59-9fde-044120ba3210", "country_code": "mn", "brand_id": BRAND,
            "issuance_mode": mode, "sku_tier": "vpn_3m", "validity_days": 30, "points_price": 100}
    created = {"id": "req-1", "card_id": card["id"], "card_name": "VPN", "points_spent": 100, "balance_after": 200,
               "status": "fulfilled" if mode == "automatic" else "pending"}
    if mode == "automatic":
        created.update(code=CODE, expires_at="2027-01-01T00:00:00Z", confirmation_note=CODE)
    calls = []
    class Client:
        def table(self, name):
            assert name == "oyuns_plus_cards"
            return self
        def select(self, columns):
            return self
        def eq(self, *args):
            return self
        def limit(self, n):
            return self
        def execute(self):
            return SimpleNamespace(data=[card])
        def rpc(self, name, payload):
            calls.append(name)
            return SimpleNamespace(execute=lambda: SimpleNamespace(data=created))
    db = Client()
    monkeypatch.setattr(main, "get_supabase", lambda: db)
    monkeypatch.setattr(main, "_get_current_shift_admin_id", lambda _: None)
    monkeypatch.setattr(main, "_get_user_lang", lambda _: "mn")
    monkeypatch.setattr(main, "send_user_notification", lambda *args, **kwargs: None)
    def automatic(client, **kwargs):
        assert client is db
        assert kwargs["card"] == card
        assert kwargs["user_id"] == 42
        calls.append("automatic")
        return created
    monkeypatch.setattr(main, "issue_promo_code", automatic)
    result = asyncio.run(main.create_oyuns_plus_request(
        OyunsPlusVoucherRequestCreate(card_id=card["id"], receiver_name="Test", receiver_phone="99112233"),
        user=SimpleNamespace(id=42),
    ))
    assert result.status == created["status"]
    assert result.balance_after == 200
    assert result.code == (CODE if mode == "automatic" else None)
    assert calls == (["automatic"] if mode == "automatic" else ["create_oyuns_plus_voucher_request"])
