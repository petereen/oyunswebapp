"""Read the daily "black rate" (а ханш) from a public Google Sheet.

The sheet is expected to be laid out as a date column + a rate column
(for example column A = date, column B = black rate). The sheet must be
shared as "Anyone with the link can view" and a Google Sheets API key must
be configured. See GOOGLE_SHEETS_SETUP.md for the full walkthrough.

Configuration (environment variables):
  GOOGLE_SHEETS_API_KEY        Google API key restricted to the Sheets API
  BLACK_RATE_SPREADSHEET_ID    the long id from the sheet URL (.../d/<ID>/edit)
  BLACK_RATE_SHEET_NAME        tab name (default "Sheet1")
  BLACK_RATE_DATE_COLUMN       column letter holding dates (default "A")
  BLACK_RATE_RATE_COLUMN       column letter holding rates (default "B")
  BLACK_RATE_HEADER_ROWS       number of header rows to skip (default 1)
"""
from __future__ import annotations

import re
from datetime import datetime

import requests

from config import get_settings

_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"

# Date formats we attempt when normalising whatever the sheet cell contains.
_DATE_FORMATS = (
    "%Y-%m-%d", "%Y/%m/%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y",
    "%d-%m-%Y", "%Y.%m.%d", "%d.%m.%y", "%m/%d/%y", "%d/%m/%y",
)


def is_black_rate_configured() -> bool:
    s = get_settings()
    return bool(s.google_sheets_api_key and s.black_rate_spreadsheet_id)


def _normalize_date(raw: str) -> str | None:
    """Return an ISO YYYY-MM-DD string for a sheet date cell, or None."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    # Google "serial" date numbers (days since 1899-12-30) if the cell is numeric.
    if re.fullmatch(r"\d{4,6}", text):
        try:
            from datetime import timedelta
            base = datetime(1899, 12, 30)
            return (base + timedelta(days=int(text))).strftime("%Y-%m-%d")
        except (ValueError, OverflowError):
            pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _normalize_rate(raw: str) -> float | None:
    """Parse a rate cell that may use spaces / commas as separators."""
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    # Drop currency symbols and thin/normal spaces (thousand separators).
    text = re.sub(r"[^\d.,\-]", "", text.replace(" ", "").replace(" ", ""))
    if not text:
        return None
    if "." in text and "," in text:
        # Both present: assume "," is the thousands separator.
        text = text.replace(",", "")
    elif "," in text:
        # Only comma: treat it as the decimal separator.
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def fetch_black_rates() -> dict[str, float]:
    """Return a {YYYY-MM-DD: rate} map read from the configured sheet.

    Raises RuntimeError if the integration is not configured. Network/API
    errors are surfaced to the caller so the endpoint can report them.
    """
    s = get_settings()
    if not is_black_rate_configured():
        raise RuntimeError("Google Sheets black-rate integration is not configured")

    sheet = s.black_rate_sheet_name or "Sheet1"
    date_col = (s.black_rate_date_column or "A").upper()
    rate_col = (s.black_rate_rate_column or "B").upper()
    header_rows = max(0, int(s.black_rate_header_rows or 0))
    status_col = (s.black_rate_status_column or "").upper().strip() or None
    status_val = (s.black_rate_status_value or "").strip().lower()

    url = f"{_API_BASE}/{s.black_rate_spreadsheet_id}/values:batchGet"
    params = [
        ("ranges", f"{sheet}!{date_col}:{date_col}"),
        ("ranges", f"{sheet}!{rate_col}:{rate_col}"),
    ]
    if status_col:
        params.append(("ranges", f"{sheet}!{status_col}:{status_col}"))
    params += [
        ("majorDimension", "COLUMNS"),
        ("valueRenderOption", "FORMATTED_VALUE"),
        ("key", s.google_sheets_api_key),
    ]
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    payload = resp.json()
    ranges = payload.get("valueRanges", [])
    dates = (ranges[0].get("values") or [[]])[0] if len(ranges) > 0 else []
    rates = (ranges[1].get("values") or [[]])[0] if len(ranges) > 1 else []
    statuses = (ranges[2].get("values") or [[]])[0] if (status_col and len(ranges) > 2) else []

    out: dict[str, float] = {}
    n = max(len(dates), len(rates), len(statuses))
    for i in range(header_rows, n):
        # When a status column is configured, only accept matching rows.
        if status_col and status_val:
            cell = str(statuses[i]).strip().lower() if i < len(statuses) else ""
            if cell != status_val:
                continue
        raw_date = dates[i] if i < len(dates) else None
        raw_rate = rates[i] if i < len(rates) else None
        iso = _normalize_date(raw_date)
        val = _normalize_rate(raw_rate)
        if iso and val is not None:
            out[iso] = val  # later rows (newer) win for the same date
    return out
