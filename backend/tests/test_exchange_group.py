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
        self.assertEqual(parse_completion_caption("100.646✅"), 100646)
        self.assertEqual(parse_completion_caption("100,646 ✅"), 100646)
        self.assertEqual(parse_completion_caption("100 646✅️"), 100646)

    def test_rejects_extra_text_or_wrong_amount(self):
        self.assertIsNone(parse_completion_caption("paid 100.646✅"))
        self.assertIsNone(parse_completion_caption("100.646"))
        self.assertFalse(completion_caption_matches("100.645✅", "37238709.2", "370"))
        self.assertTrue(completion_caption_matches("100.646✅", "37238709.2", "370"))


if __name__ == "__main__":
    unittest.main()
