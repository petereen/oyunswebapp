// The app's business timezone. All dates shown to users and admins use it,
// regardless of the device's own timezone.
export const UB_TIME_ZONE = "Asia/Ulaanbaatar";
export const UB_UTC_OFFSET = "+08:00";

const HAS_OFFSET = /(Z|[+-]\d{2}(:?\d{2})?)$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

type NaiveZone = "utc" | "ub";

/**
 * Parse a server timestamp. Values without an offset are treated as UTC
 * (pass "ub" for sources that store Ulaanbaatar wall-clock time, e.g. bot_rates).
 */
export function parseServerDate(value: string | number | Date | null | undefined, naiveAs: NaiveZone = "utc"): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return new Date(value);
  let raw = value.trim();
  if (DATE_ONLY.test(raw)) raw = `${raw}T00:00:00${UB_UTC_OFFSET}`;
  else if (!HAS_OFFSET.test(raw)) raw = `${raw.replace(" ", "T")}${naiveAs === "ub" ? UB_UTC_OFFSET : "Z"}`;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a timestamp in Ulaanbaatar time. Returns "" when the value is not a date. */
export function formatUb(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" },
  locale = "mn-MN",
  naiveAs: NaiveZone = "utc",
): string {
  const date = parseServerDate(value, naiveAs);
  if (!date) return "";
  return date.toLocaleString(locale, { ...options, timeZone: UB_TIME_ZONE });
}

/** Calendar parts of a date in Ulaanbaatar time. */
export function ubDateParts(date: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: UB_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Ulaanbaatar calendar date as YYYY-MM-DD. */
export function ubDateIso(date: Date = new Date()): string {
  const p = ubDateParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Convert a `datetime-local` input value (entered as UB time) to a UTC ISO string. */
export function ubLocalInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  const date = new Date(`${withSeconds}${UB_UTC_OFFSET}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Invoice ID in Ulaanbaatar time: YYYYMMDD-HHMMSS-XX (XX = random 00-99). */
export function generateInvoiceId(now: Date = new Date()): string {
  const p = ubDateParts(now);
  const random = String(Math.floor(Math.random() * 100)).padStart(2, "0");
  return `${p.year}${p.month}${p.day}-${p.hour}${p.minute}${p.second}-${random}`;
}
