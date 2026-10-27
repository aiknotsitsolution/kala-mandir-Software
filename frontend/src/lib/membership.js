import { addMonthsClamped, addDays, parseDateOnly, ymdInTz, gymTimezone } from "@/lib/datetime";
/** End date for a plan starting on `start` (UTC date-only semantics). */
export function computeEndDate(start, durationValue, durationUnit) {
    const value = Math.max(1, Math.trunc(durationValue));
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
export function planEndDate(startDate, plan) {
    const start = typeof startDate === "string" ? parseDateOnly(startDate) : startDate;
    return computeEndDate(start, plan.durationValue, plan.durationUnit).toISOString().slice(0, 10);
}
/** Effective status combining the stored status with calendar dates in the gym timezone. */
export function effectiveStatus(membership, memberStatus, now = new Date(), expiringSoonDays = 7, timeZone = gymTimezone) {
    if (memberStatus === "inactive")
        return "inactive";
    if (!membership)
        return "none";
    const today = parseDateOnly(ymdInTz(now, timeZone));
    const start = parseDateOnly(membership.startDate);
    const end = parseDateOnly(membership.endDate);
    if (membership.status === "suspended")
        return "suspended";
    if (membership.status === "cancelled")
        return "cancelled";
    if (membership.status === "inactive")
        return "inactive";
    if (today < start)
        return "none";
    if (today > end)
        return "expired";
    const daysLeft = Math.round((end.getTime() - today.getTime()) / 86_400_000);
    if (daysLeft <= expiringSoonDays)
        return "expiring_soon";
    return "active";
}
export function daysRemaining(membership, now = new Date(), timeZone = gymTimezone) {
    if (!membership?.endDate)
        return null;
    const today = parseDateOnly(ymdInTz(now, timeZone));
    const end = parseDateOnly(membership.endDate);
    return Math.round((end.getTime() - today.getTime()) / 86_400_000);
}
export function checkEligibility(ctx) {
    const now = ctx.now ?? new Date();
    const timeZone = ctx.timeZone ?? gymTimezone;
    const status = effectiveStatus(ctx.membership, ctx.memberStatus, now, ctx.expiringSoonDays ?? 7, timeZone);
    if (status === "inactive")
        return { eligible: false, status, reason: "member_inactive" };
    if (status === "none")
        return { eligible: false, status, reason: "no_membership" };
    if (status === "expired") {
        if (ctx.settings.allowExpiredCheckin)
            return { eligible: true, status };
        return { eligible: false, status, reason: "expired" };
    }
    if (status === "suspended" || status === "cancelled") {
        return { eligible: false, status, reason: "suspended" };
    }
    return { eligible: true, status };
}
/** Latest membership (by end date) among A student's memberships. */
export function currentMembership(memberships) {
    if (memberships.length === 0)
        return null;
    return [...memberships].sort((a, b) => (a.endDate < b.endDate ? 1 : -1))[0] ?? null;
}
/**
 * Start date for a renewal: today, or the day after the current membership
 * ends (so A student can never pay for overlapping days by accident).
 */
export function renewalStartDate(now, current, timeZone = gymTimezone) {
    const todayYmd = ymdInTz(now, timeZone);
    if (!current?.endDate || current.endDate < todayYmd)
        return todayYmd;
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
    if (!membership)
        return "No membership";
    return `${membership.planName ?? "Plan"} · until ${membership.endDate}`;
}
