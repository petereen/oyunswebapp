import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from timeutil import format_ub, parse_dt, to_ub, ub_day  # noqa: E402
from utils import generate_invoice  # noqa: E402


class TimeUtilTests(unittest.TestCase):
    def test_parse_naive_is_utc(self):
        self.assertEqual(parse_dt("2026-10-27 06:52:25"), datetime(2026, 10, 27, 6, 52, 25, tzinfo=timezone.utc))

    def test_to_ub_converts_offsets(self):
        self.assertEqual(to_ub("2026-10-27T06:52:25+00:00").strftime("%Y-%m-%d %H:%M"), "2026-10-27 14:52")
        self.assertEqual(to_ub("2026-10-27T09:52:25+03:00").strftime("%H:%M"), "14:52")

    def test_ub_day_rolls_over_at_ub_midnight(self):
        # 17:30 UTC is 01:30 the next day in Ulaanbaatar
        self.assertEqual(ub_day("2026-10-27T17:30:00Z"), "2026-10-28")
        self.assertEqual(ub_day("2026-10-27"), "2026-10-27")
        self.assertEqual(ub_day(""), "")

    def test_format_ub(self):
        self.assertEqual(format_ub("2026-10-27T00:00:00Z"), "2026-10-27 08:00")
        self.assertEqual(format_ub(None), "")


class InvoiceTests(unittest.TestCase):
    def test_invoice_uses_ub_time(self):
        invoice = generate_invoice(datetime(2026, 10, 27, 6, 50, 19, tzinfo=timezone.utc))
        self.assertTrue(invoice.startswith("20261027-145019-"), invoice)

    def test_invoice_naive_treated_as_utc(self):
        invoice = generate_invoice(datetime(2026, 10, 27, 23, 0, 0))
        self.assertTrue(invoice.startswith("20261028-070000-"), invoice)


if __name__ == "__main__":
    unittest.main()
