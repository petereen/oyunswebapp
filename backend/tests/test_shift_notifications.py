import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import main as backend_main


class ShiftNotificationTests(unittest.TestCase):
    def test_notify_pending_transaction_users_filters_to_pending(self):
        class FakeClient:
            def __init__(self, rows):
                self.rows = rows

            def table(self, name):
                self.name = name
                return self

            def select(self, *_args, **_kwargs):
                return self

            def eq(self, *_args, **_kwargs):
                return self

            def execute(self):
                return SimpleNamespace(data=self.rows)

        rows = [{"user_id": 101}, {"user_id": "202"}, {"user_id": None}, {"user_id": 101}]
        client = FakeClient(rows)
        sent = []

        def fake_send(user_id, text):
            sent.append((user_id, text))

        with patch.object(backend_main, "send_user_notification", side_effect=fake_send):
            count = backend_main._notify_pending_transaction_users_about_shift_change(
                client,
                "Уучлаарай, ээлж солигдож буй тул та түр хүлээнэ үү. Таны гүйлгээг удахгүй хийх болно.",
            )

        self.assertEqual(count, 2)
        self.assertEqual(sent, [(101, "Уучлаарай, ээлж солигдож буй тул та түр хүлээнэ үү. Таны гүйлгээг удахгүй хийх болно."), (202, "Уучлаарай, ээлж солигдож буй тул та түр хүлээнэ үү. Таны гүйлгээг удахгүй хийх болно.")])


if __name__ == "__main__":
    unittest.main()
