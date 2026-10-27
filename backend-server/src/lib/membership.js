/**
 * Membership business rules — server port of src/lib/membership.ts.
 * Single source of truth for eligibility, expiry math and renewal windows.
 */

import {
  addDays,
  addMonthsClamped,
  parseDateOnly,
  ymdInTz,
  DEFAULT_GYM_TIMEZONE,
} from "./dates.js";

/** End date for a plan starting on `start` (UTC date-only semantics). */
export function computeEndDate(start, durationValue, durationUnit) {
  const value = Math.max(1, Math.trunc(Number(durationValue) || 1));
  switch (durationUnit) {
    case "day":
      return addDays(start, value);
    case "week":
      return addDays(start, value * 7);
    case "month":
      return addMonthsClamped(start, value);
    case "year":
      return addMonthsClamped(start, value * 12);
    default:
      return addDays(start, value);
  }
}

/** `YYYY-MM-DD` end date for a plan starting on `startDate` (string or Date). */
export function planEndDate(startDate, plan) {
  const start = typeof startDate === "string" ? parseDateOnly(startDate) : startDate;
  return computeEndDate(start, plan.durationValue, plan.durationUnit).toISOString().slice(0, 10);
}

/**
 * Effective status combining stored status with calendar dates in the gym tz.
 * `membership` needs {startDate, endDate, status} with date-only strings.
 */
export function effectiveStatus(membership, memberStatus, now = new Date(), expiringSoonDays = 7, timeZone = DEFAULT_GYM_TIMEZONE) {
  if (memberStatus === "inactive") return "inactive";
  if (!membership) return "none";

  const today = parseDateOnly(ymdInTz(now, timeZone));
  const start = parseDateOnly(membership.startDate);
  const end = parseDateOnly(membership.endDate);

  if (membership.status === "suspended") return "suspended";
  if (membership.status === "cancelled") return "cancelled";
  if (membership.status === "inactive") return "inactive";
  if (today < start) return "none";
  if (today > end) return "expired";

  const daysLeft = Math.round((end.getTime() - today.getTime()) / 86_400_000);
  if (daysLeft <= expiringSoonDays) return "expiring_soon";
  return "active";
}

export function daysRemaining(membership, now = new Date(), timeZone = DEFAULT_GYM_TIMEZONE) {
  if (!membership?.endDate) return null;
  const today = parseDateOnly(ymdInTz(now, timeZone));
  const end = parseDateOnly(membership.endDate);
  return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}

/** Whether an attendance scan should be accepted for this membership. */
export function checkEligibility({ memberStatus, membership, settings, now = new Date(), timeZone = DEFAULT_GYM_TIMEZONE, expiringSoonDays = 7 }) {
  const status = effectiveStatus(membership, memberStatus, now, expiringSoonDays, timeZone);

  if (status === "inactive") return { eligible: false, status, reason: "member_inactive" };
  if (status === "none") return { eligible: false, status, reason: "no_membership" };
  if (status === "expired") {
    if (settings.allowExpiredCheckin) return { eligible: true, status };
    return { eligible: false, status, reason: "expired" };
  }
  if (status === "suspended" || status === "cancelled") {
    return { eligible: false, status, reason: "suspended" };
  }
  return { eligible: true, status };
}

/** Latest membership (by end date) among a member's memberships. */
export function currentMembership(memberships) {
  if (!memberships || memberships.length === 0) return null;
  return [...memberships].sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0] ?? null;
}

/**
 * Start date for a renewal: today, or the day after the current membership
 * ends (so a member can never pay for overlapping days by accident).
 */
export function renewalStartDate(now, current, timeZone = DEFAULT_GYM_TIMEZONE) {
  const todayYmd = ymdInTz(now, timeZone);
  if (!current?.endDate || current.endDate < todayYmd) return todayYmd;
  return addDays(parseDateOnly(current.endDate), 1).toISOString().slice(0, 10);
}

/** Balance still owed for a membership given its payments. */
export function membershipBalance(price, discount, payments) {
  const due = Math.max(0, price - Math.max(0, discount));
  const paid = payments
    .filter((p) => p.status === "paid" || p.status === "partial")
    .reduce((sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0), 0);
  return Math.max(0, Math.round((due - paid) * 100) / 100);
}

export function membershipSummary(membership) {
  if (!membership) return "No membership";
  return `${membership.planName ?? "Plan"} · until ${membership.endDate}`;
}
