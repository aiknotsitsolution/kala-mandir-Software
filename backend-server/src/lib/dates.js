/**
 * Timezone-safe date helpers (ported from src/lib/datetime.ts).
 *
 * Persistence happens in UTC (BSON Date); the gym's "today" is always
 * resolved through the gym's configured IANA timezone using the built-in
 * Intl API (no extra dependency, DST correct).
 */

export const DEFAULT_GYM_TIMEZONE = "Asia/Kolkata";

const cache = new Map();

function formatter(timeZone)
{
  let f = cache.get(timeZone);
  if (!f)
  {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    cache.set(timeZone, f);
  }
  return f;
}

/** Millisecond offset of `timeZone` at the instant `date`. */
export function timeZoneOffsetMs(date, timeZone)
{
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** `YYYY-MM-DD` of `date` inside `timeZone`. */
export function ymdInTz(date, timeZone = DEFAULT_GYM_TIMEZONE)
{
  return formatter(timeZone).format(date);
}

/** Midnight (start of day) of `date`'s calendar day in `timeZone` (UTC instant). */
export function startOfDayInTz(date, timeZone = DEFAULT_GYM_TIMEZONE)
{
  const ymd = ymdInTz(date, timeZone);
  const naive = Date.parse(`${ymd}T00:00:00.000Z`);
  const offset = timeZoneOffsetMs(new Date(naive), timeZone);
  return new Date(naive - offset);
}

/** End of the calendar day in `timeZone` (inclusive instant). */
export function endOfDayInTz(date, timeZone = DEFAULT_GYM_TIMEZONE)
{
  const start = startOfDayInTz(date, timeZone);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/** Parse a `YYYY-MM-DD` date-only string (or Date) as UTC midnight (safe for date math). */
export function parseDateOnly(value)
{
  if (value instanceof Date)
  {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  return new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
}

/** Format a Date/string as `YYYY-MM-DD` for date-only inputs. */
export function toDateOnly(value)
{
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}

export function addDays(date, days)
{
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Add calendar months keeping the day-of-month, clamped to the target month length. */
export function addMonthsClamped(date, months)
{
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** First day of the calendar month of `date` (UTC). */
export function startOfMonth(date)
{
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

/** Month key `YYYY-MM` for grouping in the gym timezone. */
export function monthKeyInTz(date, timeZone = DEFAULT_GYM_TIMEZONE)
{
  return ymdInTz(date, timeZone).slice(0, 7);
}

/** Hour 0-23 of `date` in the gym timezone. */
export function hourInTz(date, timeZone = DEFAULT_GYM_TIMEZONE)
{
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
  });
  return Number(dtf.format(date)) % 24;
}

/** Minutes since local midnight (0-1439) of `date` in the gym timezone. */
export function minutesInTz(date, timeZone = DEFAULT_GYM_TIMEZONE)
{
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const [h, m] = dtf.format(date).split(":").map(Number);
  return (h % 24) * 60 + m;
}

/** `en-IN` short month label ("Jan") for a `YYYY-MM` key. */
export function monthShortLabel(monthKey)
{
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 15)).toLocaleDateString("en-IN", { month: "short" });
}

/** `en-IN` short label with 2-digit year ("Jan 26") for a `YYYY-MM` key. */
export function monthShortYearLabel(monthKey)
{
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 15)).toLocaleDateString("en-IN", {
    month: "short",
    year: "2-digit",
  });
}

/** Hour label used by peak-hour charts ("6a", "7p"). */
export function hourLabel(hour)
{
  return `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? "a" : "p"}`;
}



/**
 * Instant for `YYYY-MM-DD` + `HH:MM` (or `HH:MM:SS`) in `timeZone`.
 * Falls back to start-of-day in that timezone if time is missing/invalid.
 */
export function instantInTz(ymd, hm, timeZone = DEFAULT_GYM_TIMEZONE)
{
  const day = String(ymd).slice(0, 10);
  const parts = String(hm ?? "00:00").split(":").map(Number);
  const h = Number.isFinite(parts[0]) ? parts[0] : 0;
  const m = Number.isFinite(parts[1]) ? parts[1] : 0;
  const s = Number.isFinite(parts[2]) ? parts[2] : 0;
  // Approximate: treat local wall time as UTC, then subtract zone offset.
  const naive = Date.parse(
    `${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`,
  );
  if (Number.isNaN(naive)) return startOfDayInTz(parseDateOnly(day), timeZone);
  const offset = timeZoneOffsetMs(new Date(naive), timeZone);
  return new Date(naive - offset);
}