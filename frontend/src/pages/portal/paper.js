import { monthKeyInTz, ymdInTz } from "@/lib/datetime";

/** Time-aware greeting for the header (local hour is fine for a personal hello). */
export function greetingForHour(hour) {
    if (hour < 12)
        return "Good morning";
    if (hour < 17)
        return "Good afternoon";
    return "Good evening";
}

/** Parse a `YYYY-MM-DD` string as a pure-UTC calendar day. */
function parseYmd(ymd) {
    return new Date(`${ymd}T00:00:00.000Z`);
}

function addUtcDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Derived visit statistics from raw attendance records (newest-first).
 * All day math happens on gym-timezone calendar days so a late-night visit
 * still counts toward the right day.
 */
export function computeVisitStats(records) {
    const rows = Array.isArray(records) ? records : [];
    const now = new Date();
    const today = ymdInTz(now);
    const thisMonthKey = monthKeyInTz(now);
    const daySet = new Set();
    let thisMonth = 0;
    for (const record of rows) {
        if (!record?.checkIn)
            continue;
        const checkIn = new Date(record.checkIn);
        daySet.add(ymdInTz(checkIn));
        if (monthKeyInTz(checkIn) === thisMonthKey)
            thisMonth += 1;
    }
    // Current streak of consecutive visit days ending today (or yesterday,
    // so the streak survives until the next workout).
    let streak = 0;
    let cursor = parseYmd(today);
    if (!daySet.has(today))
        cursor = addUtcDays(cursor, -1);
    while (daySet.has(ymdInTz(cursor))) {
        streak += 1;
        cursor = addUtcDays(cursor, -1);
    }
    return { total: rows.length, thisMonth, streak, daySet, today };
}

/**
 * Calendar grid for the month of `anchor` (any Date inside the month).
 * Returns cells for leading blanks, every day of the month, and trailing
 * blanks so the grid always ends on a full week boundary.
 */
export function monthGrid(anchor, daySet) {
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth();
    const first = new Date(Date.UTC(year, month, 1));
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const offset = first.getUTCDay();
    const cells = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
        const ymd = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        cells.push({ day, ymd, visited: daySet ? daySet.has(ymd) : false });
    }
    while (cells.length % 7 !== 0)
        cells.push(null);
    return cells;
}

/** Month label like "October 2026" without pulling in more date plumbing. */
const MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];

export function monthLabel(anchor) {
    return `${MONTH_NAMES[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`;
}

/** Visit counts for the last `weeks` calendar weeks, oldest first. */
export function weeklyVisitBuckets(records, weeks = 6) {
    const rows = Array.isArray(records) ? records : [];
    const today = parseYmd(ymdInTz(new Date()));
    const buckets = [];
    for (let index = weeks - 1; index >= 0; index -= 1) {
        const end = addUtcDays(today, -7 * index);
        const start = addUtcDays(end, -6);
        const count = rows.filter((record) => {
            if (!record?.checkIn)
                return false;
            const day = ymdInTz(new Date(record.checkIn));
            return day >= ymdInTz(start) && day <= ymdInTz(end);
        }).length;
        buckets.push({
            key: ymdInTz(start),
            label: `${start.getUTCDate()}/${start.getUTCMonth() + 1}`,
            count,
        });
    }
    return buckets;
}

/** Progress 0..1 across a membership window, clamped. */
export function membershipProgress(membership) {
    if (!membership?.startDate || !membership?.endDate)
        return null;
    const start = parseYmd(String(membership.startDate).slice(0, 10)).getTime();
    const end = parseYmd(String(membership.endDate).slice(0, 10)).getTime();
    const now = Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        return null;
    const ratio = (now - start) / (end - start);
    return Math.min(1, Math.max(0, ratio));
}
