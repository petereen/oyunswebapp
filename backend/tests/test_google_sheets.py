import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from google_sheets import fetch_black_rates


class FakeResponse:
    def raise_for_status(self):
        return None

    def json(self):
        return {
            "valueRanges": [
                {"values": [["Date", "2026-08-22", "2026-08-23", "2026-08-24", "2026-08-25"]]},
                {"values": [["Rate", "11", "12", "13", "999"]]},
                {"values": [["Status", "Ханш", "Гүйлгээ", " ХАНШ ", "Ханш"]]},
            ]
        }


class FakeSession:
    def __init__(self):
        self.url = None
        self.params = None

    def get(self, url, params, timeout):
        self.url = url
        self.params = params
        self.timeout = timeout
        return FakeResponse()


class GoogleSheetsBlackRateTests(unittest.TestCase):
    def test_reads_date_and_rate_from_same_transactions2_hansh_row(self):
        settings = SimpleNamespace(
            google_sheets_service_account_file="service-account.json",
            black_rate_spreadsheet_id="spreadsheet-id",
            black_rate_sheet_name="Transactions2",
            black_rate_date_column="B",
            black_rate_rate_column="I",
            black_rate_header_rows=1,
            black_rate_status_column="E",
            black_rate_status_value="Ханш",
        )
        session = FakeSession()

        with patch("google_sheets.get_settings", return_value=settings), \
             patch("google_sheets._get_authorized_session", return_value=session):
            rates = fetch_black_rates()

        self.assertEqual(rates, {
            "2026-08-22": 11.0,
            "2026-08-24": 13.0,
            "2026-08-25": 999.0,
        })
        self.assertEqual(
            [value for key, value in session.params if key == "ranges"],
            ["'Transactions2'!B:B", "'Transactions2'!I:I", "'Transactions2'!E:E"],
        )


if __name__ == "__main__":
    unittest.main()
