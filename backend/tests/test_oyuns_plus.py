from fastapi import HTTPException
from types import SimpleNamespace

from main import _get_current_shift_admin_id, _normalize_oyuns_plus_phone, _oyuns_plus_rpc_error
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
