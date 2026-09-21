from fastapi import HTTPException
from types import SimpleNamespace

from decimal import Decimal

from main import (
    _get_current_shift_admin_id,
    _normalize_oyuns_plus_phone,
    _oyuns_plus_coupon_response,
    _oyuns_plus_coupon_is_public,
    _oyuns_plus_expired,
    _oyuns_plus_rpc_error,
    _validate_oyuns_plus_coupon_value,
)
from models import OyunsPlusHistoryEntry


def test_oyuns_plus_phone_normalizes_local_and_international_formats():
    assert _normalize_oyuns_plus_phone("9911 2233") == "+97699112233"
    assert _normalize_oyuns_plus_phone("+976-9911-2233") == "+97699112233"
    assert _normalize_oyuns_plus_phone("+7 999 123 45 67") == "+79991234567"
    assert _normalize_oyuns_plus_phone("8 (999) 123-45-67") == "+79991234567"
    assert _normalize_oyuns_plus_phone("999 123 45 67") == "+79991234567"


def test_oyuns_plus_phone_rejects_non_mobile_numbers():
    try:
        _normalize_oyuns_plus_phone("55112233")
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("expected invalid Mongolian mobile to be rejected")


def test_oyuns_plus_phone_respects_card_country():
    assert _normalize_oyuns_plus_phone("99112233", "mn") == "+97699112233"
    assert _normalize_oyuns_plus_phone("9991234567", "ru") == "+79991234567"
    for value, country in (("9991234567", "mn"), ("99112233", "ru")):
        try:
            _normalize_oyuns_plus_phone(value, country)
        except HTTPException as exc:
            assert exc.status_code == 422
        else:
            raise AssertionError(f"expected {country} phone validation to reject {value}")


def test_history_entry_keeps_uuid_ids_and_resulting_balance():
    entry = OyunsPlusHistoryEntry(
        id="8c3c2e8d-2f57-4b09-947e-bf6d30e9d4fb",
        source_type="voucher_redeem",
        points=-100,
        transaction_type="redeemed",
        balance_after=250,
    )
    assert isinstance(entry.id, str)
    assert entry.balance_after == 250


def test_rpc_error_maps_conflicting_redemption_to_409():
    error = _oyuns_plus_rpc_error(RuntimeError("REQUEST_NOT_PENDING"))
    assert error.status_code == 409


def test_rpc_error_maps_sold_out_and_expired_coupons_to_conflict():
    assert _oyuns_plus_rpc_error(RuntimeError("CARD_SOLD_OUT")).status_code == 409
    assert _oyuns_plus_rpc_error(RuntimeError("CARD_EXPIRED")).status_code == 409


def test_coupon_value_validation_accepts_amount_and_percentage_ranges():
    _validate_oyuns_plus_coupon_value("amount", Decimal("1000"))
    _validate_oyuns_plus_coupon_value("percentage", Decimal("25.5"))
    for value_type, value in (("percentage", 100.01), ("amount", 0), ("unknown", 10)):
        try:
            _validate_oyuns_plus_coupon_value(value_type, value)
        except Exception:
            pass
        else:
            raise AssertionError("expected invalid coupon value to be rejected")


def test_public_coupon_visibility_accepts_valid_legacy_false_or_null_review_flags():
    base = {
        "is_active": True,
        "archived_at": None,
        "value_type": "amount",
        "discount_value": "1500",
    }
    assert _oyuns_plus_coupon_is_public({**base, "needs_review": False}) is True
    assert _oyuns_plus_coupon_is_public({**base, "needs_review": None}) is True
    assert _oyuns_plus_coupon_is_public({**base, "needs_review": True}) is False
    assert _oyuns_plus_coupon_is_public({**base, "needs_review": False, "value_type": None}) is False


def test_coupon_response_derives_currency_and_remaining_inventory():
    coupon = _oyuns_plus_coupon_response({
        "id": "coupon-1",
        "brand_id": "brand-1",
        "name": "Coffee",
        "value_type": "amount",
        "discount_value": "1500",
        "points_price": 50,
        "country_code": "mn",
        "total_purchase_limit": 3,
        "is_active": True,
    }, purchase_count=2)
    assert coupon.currency_code == "MNT"
    assert coupon.remaining_purchase_count == 1
    assert coupon.is_sold_out is False


def test_coupon_expiry_parser_handles_expired_and_open_values():
    assert _oyuns_plus_expired("2020-01-01T00:00:00+00:00") is True
    assert _oyuns_plus_expired(None) is False


def test_current_shift_admin_id_returns_active_admin_only():
    class FakeQuery:
        def select(self, *_args):
            return self

        def eq(self, *_args):
            return self

        def limit(self, *_args):
            return self

        def execute(self):
            return SimpleNamespace(data=[{"current_admin_id": "12345"}])

    class FakeClient:
        def table(self, _name):
            return FakeQuery()

    assert _get_current_shift_admin_id(FakeClient()) == 12345


def test_current_shift_admin_id_is_none_when_shift_is_closed():
    class FakeQuery:
        def select(self, *_args):
            return self

        def eq(self, *_args):
            return self

        def limit(self, *_args):
            return self

        def execute(self):
            return SimpleNamespace(data=[{"current_admin_id": None}])

    class FakeClient:
        def table(self, _name):
            return FakeQuery()

    assert _get_current_shift_admin_id(FakeClient()) is None
