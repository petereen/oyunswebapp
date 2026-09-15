import sys
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from exchange_group import (
    completion_caption_matches,
    format_requisites_message,
    parse_completion_caption,
    rounded_rub_payout,
    rub_payout,
)
from main import _manual_group_confirmation_error


class ExchangeGroupFormattingTests(unittest.TestCase):
    def test_formats_requisites_exactly(self):
        self.assertEqual(
            format_requisites_message(
                "Сбербанк,9644018298,2202202399332117,Цанжид Жадамбаа",
                "37238709.2",
                "370",
            ),
            (
                "Сбербанк\n\n"
                "9644018298\n\n"
                "2202202399332117\n"
                "Цанжид Жадамбаа\n\n"
                "100,645.16"
            ),
        )

    def test_rounds_fractional_payout_up_for_reply_amount(self):
        self.assertEqual(rub_payout("37238709.2", "370"), rub_payout("37238709.2", "370"))
        self.assertEqual(rounded_rub_payout("37238709.2", "370"), 100646)
        self.assertEqual(rounded_rub_payout("100645.5", "1"), 100646)

    def test_accepts_flexible_grouping_with_checkmark(self):
        self.assertEqual(parse_completion_caption("100,000✅"), 100000)
        self.assertEqual(parse_completion_caption("100 000✅"), 100000)
        self.assertEqual(parse_completion_caption("100.000✅"), 100000)
        self.assertEqual(parse_completion_caption("100.646✅"), 100646)
        self.assertEqual(parse_completion_caption("100,646 ✅"), 100646)
        self.assertEqual(parse_completion_caption("100 646✅️"), 100646)

    def test_accepts_amount_within_ten_rubles(self):
        self.assertTrue(completion_caption_matches("100.636✅", "37238709.2", "370"))
        self.assertTrue(completion_caption_matches("100.656✅", "37238709.2", "370"))
        self.assertFalse(completion_caption_matches("100.635✅", "37238709.2", "370"))
        self.assertFalse(completion_caption_matches("100.657✅", "37238709.2", "370"))

    def test_rejects_extra_text_or_invalid_amount(self):
        self.assertIsNone(parse_completion_caption("paid 100.646✅"))
        self.assertIsNone(parse_completion_caption("100.646"))
        self.assertFalse(completion_caption_matches("100.635✅", "37238709.2", "370"))
        self.assertTrue(completion_caption_matches("100.646✅", "37238709.2", "370"))


class ManualGroupConfirmationTests(unittest.TestCase):
    def test_allows_approved_group_dispatch_that_is_not_completed(self):
        self.assertIsNone(
            _manual_group_confirmation_error(
                transaction_status="approved",
                dispatch_exists=True,
                dispatch_status="awaiting_proof",
            )
        )

    def test_rejects_missing_group_dispatch(self):
        self.assertEqual(
            _manual_group_confirmation_error(
                transaction_status="approved",
                dispatch_exists=False,
                dispatch_status=None,
            ),
            "Transaction is not managed by a Telegram group dispatch",
        )

    def test_rejects_already_completed_group_dispatch(self):
        self.assertEqual(
            _manual_group_confirmation_error(
                transaction_status="approved",
                dispatch_exists=True,
                dispatch_status="completed",
            ),
            "Group transaction is already completed",
        )

    def test_allows_retry_after_transaction_update_succeeded(self):
        self.assertIsNone(
            _manual_group_confirmation_error(
                transaction_status="successful",
                dispatch_exists=True,
                dispatch_status="processing",
            )
        )


if __name__ == "__main__":
    unittest.main()
