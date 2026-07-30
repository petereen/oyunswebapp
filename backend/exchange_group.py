from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP


def decimal_value(value: object) -> Decimal:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return Decimal("0")


def rub_payout(amount_mnt: object, rate: object) -> Decimal:
    amount = decimal_value(amount_mnt)
    exchange_rate = decimal_value(rate)
    if amount <= 0 or exchange_rate <= 0:
        raise ValueError("Amount and rate must be positive")
    return (amount / exchange_rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def rounded_rub_payout(amount_mnt: object, rate: object) -> int:
    # Operations send the whole-ruble amount rounded upward: 100,645.16 -> 100.646✅.
    return int(rub_payout(amount_mnt, rate).quantize(Decimal("1"), rounding=ROUND_CEILING))


def parse_russian_requisites(bank_details: str | None) -> tuple[str, str, str, str]:
    parts = [part.strip() for part in str(bank_details or "").split(",")]
    if len(parts) != 4 or not all(parts):
        raise ValueError("Russian requisites must contain bank, phone, card, and owner")
    return parts[0], parts[1], parts[2], parts[3]


def format_requisites_message(bank_details: str | None, amount_mnt: object, rate: object) -> str:
    bank, phone, card, owner = parse_russian_requisites(bank_details)
    payout = rub_payout(amount_mnt, rate)
    return f"{bank}\n\n{phone}\n\n{card}\n{owner}\n\n{payout:,.2f}"


def parse_completion_caption(caption: str | None) -> int | None:
    text = str(caption or "").strip()
    match = re.fullmatch(r"([0-9][0-9\s.,]*)\s*✅\ufe0f?", text)
    if not match:
        return None
    digits = re.sub(r"[\s.,]", "", match.group(1))
    if not digits:
        return None
    return int(digits)


def completion_caption_matches(caption: str | None, amount_mnt: object, rate: object) -> bool:
    parsed = parse_completion_caption(caption)
    return parsed is not None and parsed == rounded_rub_payout(amount_mnt, rate)
