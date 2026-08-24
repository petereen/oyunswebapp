import asyncio
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import main as backend_main
from fastapi import HTTPException
from models import ManualTransactionCreateRequest


class FakeQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.operation = "select"
        self.payload = None

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def eq(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        self.client.calls.append((self.table_name, self.operation, self.payload))
        if self.operation == "insert":
            if self.table_name == "transactions":
                return SimpleNamespace(data=[{"id": "tx-1"}])
            return SimpleNamespace(data=[self.payload])
        if self.table_name == "admin_bank_accounts":
            return SimpleNamespace(data=[{"id": "bank-1", "currency": "RUB"}])
        if self.table_name == "users":
            return SimpleNamespace(data=[])
        if self.table_name == "admin_shifts":
            return SimpleNamespace(data=[{"current_admin_id": 88}])
        return SimpleNamespace(data=[])


class FakeClient:
    def __init__(self):
        self.calls = []

    def table(self, table_name):
        return FakeQuery(self, table_name)


class ManualTransactionTests(unittest.TestCase):
    def test_receiver_details_are_serialized_for_each_direction(self):
        buy = ManualTransactionCreateRequest(
            telegram_id=1,
            direction="buy",
            amount=100,
            exchange_rate=12,
            admin_bank_id="bank-1",
            receiver_bank_name="Khaan",
            receiver_account_number="123",
            receiver_owner_name="User",
            receipt_paths=["https://receipt"],
        )
        sell = buy.model_copy(update={
            "direction": "sell",
            "receiver_account_number": None,
            "receiver_phone": "+79990000000",
            "receiver_card_number": "4444",
        })
        self.assertEqual(backend_main._manual_receiver_bank_details(buy), "Khaan,123,User")
        self.assertEqual(backend_main._manual_receiver_bank_details(sell), "Khaan,+79990000000,4444,User")

    def test_manual_create_uses_exact_rate_and_writes_audit_before_notifications(self):
        client = FakeClient()
        payload = ManualTransactionCreateRequest(
            telegram_id=12345,
            direction="buy",
            amount="100.00",
            exchange_rate="12.3456",
            admin_bank_id="bank-1",
            receiver_bank_name="Khaan",
            receiver_account_number="123",
            receiver_owner_name="User",
            receipt_paths=["https://receipt/1"],
            transaction_at=datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc),
        )
        sent = []
        settings = SimpleNamespace(admin_panel_url="https://admin.example/app")

        with patch.object(backend_main, "get_supabase", return_value=client), \
             patch.object(backend_main, "get_settings", return_value=settings), \
             patch.object(backend_main, "generate_invoice", return_value="INV-1"), \
             patch.object(backend_main, "_get_user_lang", return_value="mn"), \
             patch.object(backend_main, "send_user_notification", side_effect=lambda *args, **kwargs: sent.append(args[0])):
            response = asyncio.run(backend_main.create_manual_transaction(payload, SimpleNamespace(id=77)))

        self.assertEqual(response.invoice, "INV-1")
        self.assertEqual(response.rate, payload.exchange_rate)
        self.assertEqual(response.converted_amount, payload.amount * payload.exchange_rate)
        transaction_inserts = [call for call in client.calls if call[0] == "transactions" and call[1] == "insert"]
        self.assertEqual(len(transaction_inserts), 1)
        transaction = transaction_inserts[0][2]
        self.assertTrue(transaction["is_manual"])
        self.assertEqual(transaction["manual_created_by_admin_id"], 77)
        audit_index = next(index for index, call in enumerate(client.calls) if call[0] == "admin_actions")
        transaction_index = next(index for index, call in enumerate(client.calls) if call[0] == "transactions" and call[1] == "insert")
        self.assertGreater(audit_index, transaction_index)
        self.assertEqual(sent, [88, 12345])

    def test_non_admin_is_rejected(self):
        with patch.object(backend_main, "get_settings", return_value=SimpleNamespace(admin_user_ids=[77])):
            with self.assertRaises(HTTPException) as context:
                asyncio.run(backend_main.require_admin(SimpleNamespace(id=88)))
        self.assertEqual(context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
