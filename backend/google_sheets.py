"""Read the daily "black rate" (а ханш) from a Google Sheet.

The sheet is expected to be laid out as a date column + a rate column
(for example column A = date, column B = black rate). The sheet must be
shared with a Google service account that has at least Viewer access, and the
downloaded service-account JSON key file must be configured. See
GOOGLE_SHEETS_SETUP.md for the full walkthrough.

Configuration (environment variables):
    GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE
                                                                path to the service-account JSON key file
  BLACK_RATE_SPREADSHEET_ID    the long id from the sheet URL (.../d/<ID>/edit)
  BLACK_RATE_SHEET_NAME        tab name (default "Transactions2")
  BLACK_RATE_DATE_COLUMN       column letter holding dates (default "B")
  BLACK_RATE_RATE_COLUMN       column letter holding rates (default "I")
  BLACK_RATE_HEADER_ROWS       number of header rows to skip (default 1)
  BLACK_RATE_STATUS_COLUMN     row filter column (default "E")
  BLACK_RATE_STATUS_VALUE      row filter value (default "Ханш")
"""
from __future__ import annotations

import re
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from config import get_settings

_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets"
_SCOPES = ("https://www.googleapis.com/auth/spreadsheets.readonly",)

# Date formats we attempt when normalising whatever the sheet cell contains.
_DATE_FORMATS = (
    "%Y-%m-%d", "%Y/%m/%d", "%d.%m.%Y", "%d/%m/%Y", "%m/%d/%Y",
    "%d-%m-%Y", "%Y.%m.%d", "%d.%m.%y", "%m/%d/%y", "%d/%m/%y",
)


def is_black_rate_configured() -> bool:
    s = get_settings()
    return bool(s.google_sheets_service_account_file and s.black_rate_spreadsheet_id)


def _resolve_service_account_file(raw_path: str) -> Path:
    path = Path(raw_path).expanduser()
    if path.is_absolute():
        candidates = (path,)
    else:
        backend_dir = Path(__file__).resolve().parent
        candidates = (
            Path.cwd() / path,
            backend_dir / path,
            backend_dir.parent / path,
        )

    checked: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve(strict=False)
        if resolved in checked:
            continue
        checked.add(resolved)
        if resolved.is_file():
            return resolved

    attempted = ", ".join(str(path.resolve(strict=False)) for path in checked)
    raise RuntimeError(
        "Google Sheets service-account file was not found. "
        f"Checked: {attempted}"
    )


@lru_cache(maxsize=4)
def _get_authorized_session(raw_path: str):
    # Import Google Auth only when the integration is actually used. This keeps
    # the rest of the backend importable for local tooling and unit tests that
    # mock the Sheets session.
    from google.auth.transport.requests import AuthorizedSession
    from google.oauth2 import service_account

    credentials = service_account.Credentials.from_service_account_file(
        str(_resolve_service_account_file(raw_path)),
        scopes=_SCOPES,
    )
    return AuthorizedSession(credentials)


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

    sheet = s.black_rate_sheet_name or "Transactions2"
    date_col = (s.black_rate_date_column or "B").upper()
    rate_col = (s.black_rate_rate_column or "I").upper()
    header_rows = max(0, int(s.black_rate_header_rows or 0))
    status_col = (s.black_rate_status_column or "").upper().strip() or None
    status_val = (s.black_rate_status_value or "").strip().lower()

    # Quote the tab name so the A1 ranges remain valid even if the configured
    # tab is later renamed to contain spaces or apostrophes.
    sheet_a1 = "'" + sheet.replace("'", "''") + "'"
    url = f"{_API_BASE}/{s.black_rate_spreadsheet_id}/values:batchGet"
    params = [
        ("ranges", f"{sheet_a1}!{date_col}:{date_col}"),
        ("ranges", f"{sheet_a1}!{rate_col}:{rate_col}"),
    ]
    if status_col:
        params.append(("ranges", f"{sheet_a1}!{status_col}:{status_col}"))
    params += [
        ("majorDimension", "COLUMNS"),
        ("valueRenderOption", "FORMATTED_VALUE"),
    ]
    session = _get_authorized_session(s.google_sheets_service_account_file or "")
    resp = session.get(url, params=params, timeout=15)
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
