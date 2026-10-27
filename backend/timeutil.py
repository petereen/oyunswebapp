"""Single source of truth for the app's business timezone (Ulaanbaatar).

Database columns are timestamptz, so always write timezone-aware values.
Use these helpers for "now", business-day calculations and display.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo

UB_TZ = ZoneInfo("Asia/Ulaanbaatar")
UB_TZ_NAME = "Asia/Ulaanbaatar"


def now_ub() -> datetime:
    """Current time as an aware datetime in Ulaanbaatar time."""
    return datetime.now(UB_TZ)


def now_ub_iso() -> str:
    """Current time as an ISO string with the +08:00 offset."""
    return now_ub().isoformat()


def today_ub() -> str:
    """Current Ulaanbaatar calendar date as YYYY-MM-DD."""
    return now_ub().strftime("%Y-%m-%d")


def parse_dt(value) -> datetime | None:
    """Parse a DB/API timestamp into an aware datetime.

    Naive values are treated as UTC (the database's storage zone).
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, date):
        parsed = datetime(value.year, value.month, value.day)
    else:
        try:
            parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def to_ub(value) -> datetime | None:
    """Parse a timestamp and convert it to Ulaanbaatar time."""
    parsed = parse_dt(value)
    return parsed.astimezone(UB_TZ) if parsed else None


def ub_day(value) -> str:
    """Ulaanbaatar calendar date (YYYY-MM-DD) of a timestamp, or "" if unparsable."""
    raw = str(value or "").strip()
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        return raw
    converted = to_ub(raw)
    return converted.strftime("%Y-%m-%d") if converted else ""


def format_ub(value, fmt: str = "%Y-%m-%d %H:%M") -> str:
    """Format a timestamp in Ulaanbaatar time; empty string if unparsable."""
    converted = to_ub(value)
    return converted.strftime(fmt) if converted else ""
