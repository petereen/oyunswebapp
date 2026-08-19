import sys
from pathlib import Path
from types import SimpleNamespace
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from main import (
    _load_recent_rub_bank_usage,
    _rank_rub_bank_accounts_by_usage,
)
from models import AdminBankAccount


def bank(account_id: str, priority: bool = False) -> AdminBankAccount:
    return AdminBankAccount(
        id=account_id,
        bank_name=f"Bank {account_id}",
        account_number=account_id,
        owner_name="Owner",
        currency="RUB",
        is_active=True,
        is_priority=priority,
    )


class RubBankRankingTests(unittest.TestCase):
    def test_zero_use_accounts_rank_first_and_all_accounts_are_retained(self):
        accounts = [bank("used"), bank("unused")]
        rows = [
            {
                "admin_bank_id": "used",
                "amount": "100",
                "rate": "12",
                "currency_from": "RUB",
                "currency_to": "MNT",
                "status": "completed",
            }
        ]

        ranked = _rank_rub_bank_accounts_by_usage(accounts, rows)

        self.assertEqual([account.id for account in ranked], ["unused", "used"])

    def test_score_uses_equal_normalized_count_and_mnt_volume(self):
        accounts = [bank("many_small"), bank("few_large"), bank("unused")]
        rows = [
            *[
                {
                    "admin_bank_id": "many_small",
                    "amount": "10",
                    "rate": "10",
                    "currency_from": "RUB",
                    "currency_to": "MNT",
                    "status": "successful",
                }
                for _ in range(2)
            ],
            {
                "admin_bank_id": "few_large",
                "amount": "100",
                "rate": "10",
                "currency_from": "RUB",
                "currency_to": "MNT",
                "status": "completed",
            },
        ]

        ranked = _rank_rub_bank_accounts_by_usage(accounts, rows)

        # Count and volume are both reflected: many_small has the lower score.
        self.assertEqual([account.id for account in ranked], ["unused", "many_small", "few_large"])

    def test_priority_accounts_are_first_and_ties_are_stable(self):
        accounts = [bank("non_priority"), bank("priority_a", True), bank("priority_b", True)]

        ranked = _rank_rub_bank_accounts_by_usage(accounts, [])

        self.assertEqual([account.id for account in ranked], ["priority_a", "priority_b", "non_priority"])

    def test_only_successful_rub_to_mnt_rows_contribute(self):
        accounts = [bank("target"), bank("other")]
        rows = [
            {
                "admin_bank_id": "target",
                "amount": "100000",
                "rate": "10",
                "currency_from": "MNT",
                "currency_to": "RUB",
                "status": "completed",
            },
            {
                "admin_bank_id": "target",
                "amount": "100000",
                "rate": "10",
                "currency_from": "RUB",
                "currency_to": "MNT",
                "status": "pending",
            },
            {
                "admin_bank_id": "target",
                "amount": "100000",
                "rate": "10",
                "currency_from": "RUB",
                "currency_to": "MNT",
                "status": "rejected",
            },
        ]

        ranked = _rank_rub_bank_accounts_by_usage(accounts, rows)

        self.assertEqual([account.id for account in ranked], ["target", "other"])


class RecentUsageQueryTests(unittest.TestCase):
    def test_query_failure_returns_fallback_signal(self):
        class FailingClient:
            def table(self, _name):
                raise RuntimeError("transactions.admin_bank_id does not exist")

        self.assertIsNone(_load_recent_rub_bank_usage(FailingClient(), ["1", "2"]))

    def test_query_is_filtered_and_paginated(self):
        class FakeQuery:
            def __init__(self):
                self.calls = []
                self.ranges = [(0, 999), (1000, 1999)]

            def select(self, value):
                self.calls.append(("select", value))
                return self

            def in_(self, field, value):
                self.calls.append(("in", field, value))
                return self

            def eq(self, field, value):
                self.calls.append(("eq", field, value))
                return self

            def gte(self, field, value):
                self.calls.append(("gte", field, value))
                return self

            def order(self, field, desc=False):
                self.calls.append(("order", field, desc))
                return self

            def range(self, start, end):
                self.calls.append(("range", start, end))
                self.current_range = (start, end)
                return self

            def execute(self):
                if self.current_range == self.ranges[0]:
                    return SimpleNamespace(data=[{"admin_bank_id": "1"}] * 1000)
                return SimpleNamespace(data=[{"admin_bank_id": "2"}])

        class FakeClient:
            def __init__(self):
                self.query = FakeQuery()

            def table(self, name):
                self.name = name
                return self.query

        client = FakeClient()
        rows = _load_recent_rub_bank_usage(client, ["1", "2"])

        self.assertEqual(len(rows), 1001)
        self.assertIn(("in", "admin_bank_id", ["1", "2"]), client.query.calls)
        self.assertIn(("eq", "currency_from", "RUB"), client.query.calls)
        self.assertIn(("eq", "currency_to", "MNT"), client.query.calls)
        self.assertIn(("in", "status", ["completed", "successful"]), client.query.calls)
        self.assertIn(("range", 0, 999), client.query.calls)
        self.assertIn(("range", 1000, 1999), client.query.calls)


if __name__ == "__main__":
    unittest.main()
