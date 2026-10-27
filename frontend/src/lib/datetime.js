import { gymTimezone } from "@/config/env";
/**
 * Timezone-safe date helpers.
 *
 * All persistence happens in UTC (`timestamptz`); business "today" is always
 * resolved through the gym's configured IANA timezone using the built-in
 * Intl API (no extra dependency, DST correct).
 */
const cache = new Map();
function formatter(timeZone) {
    let f = cache.get(timeZone);
    if (!f) {
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
export function timeZoneOffsetMs(date, timeZone) {
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
    for (const part of parts)
        map[part.type] = part.value;
    const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour) % 24, Number(map.minute), Number(map.second));
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
/** `YYYY-MM-DD` of `date` inside `timeZone`. */
export function ymdInTz(date, timeZone = gymTimezone) {
    return formatter(timeZone).format(date);
}
/** Midnight (start of day) of `date`'s calendar day in `timeZone`, returned as a UTC instant. */
export function startOfDayInTz(date, timeZone = gymTimezone) {
    const ymd = ymdInTz(date, timeZone);
    const naive = Date.parse(`${ymd}T00:00:00.000Z`);
    const offset = timeZoneOffsetMs(new Date(naive), timeZone);
    return new Date(naive - offset);
}
/** End of the calendar day in `timeZone` (exclusive instant). */
export function endOfDayInTz(date, timeZone = gymTimezone) {
    const start = startOfDayInTz(date, timeZone);
    return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}
/** Parse a `YYYY-MM-DD` date-only string as UTC midnight (safe for date math). */
export function parseDateOnly(value) {
    return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
}
/** Format a Date/string as `YYYY-MM-DD` for date inputs. */
export function toDateOnly(value) {
    const date = typeof value === "string" ? new Date(value) : value;
    return date.toISOString().slice(0, 10);
}
export function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
/** Whole days from `from`'s day to `to`'s day in the gym timezone (positive when `to` is later). */
export function daysBetween(from, to, timeZone = gymTimezone) {
    const a = parseDateOnly(ymdInTz(from, timeZone)).getTime();
    const b = parseDateOnly(ymdInTz(to, timeZone)).getTime();
    return Math.round((b - a) / (24 * 60 * 60 * 1000));
}
/** Add calendar months keeping the day-of-month, clamped to the target month length. */
export function addMonthsClamped(date, months) {
    const d = new Date(date.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
}
/** First day of the calendar month of `date` (UTC). */
export function startOfMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
export function addMonths(date, months) {
    return addMonthsClamped(date, months);
}
export function isSameYmd(a, b, timeZone = gymTimezone) {
    return ymdInTz(a, timeZone) === ymdInTz(b, timeZone);
}
/** Month key `YYYY-MM` for grouping in gym timezone. */
export function monthKeyInTz(date, timeZone = gymTimezone) {
    return ymdInTz(date, timeZone).slice(0, 7);
}
/** Hour 0-23 of `date` in the gym timezone. */
export function hourInTz(date, timeZone = gymTimezone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        hour: "2-digit",
    });
    return Number(dtf.format(date)) % 24;
}
export { gymTimezone };
