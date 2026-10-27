/**
 * Class-quota business logic (frontend port of backend-server/src/lib/quota.js).
 *
 * The API mode receives an already-computed quota object from the server, so
 * this module is used by DEMO mode (and by shared UI helpers) to keep every
 * screen identical offline. The rules are the canonical source:
 *
 *   remaining > 2  → "N classes left" (active)
 *   remaining = 2  → "2 classes left" (warning)
 *   remaining = 1  → "1 class left"  (critical)
 *   remaining = 0  → "Expired"       (exhausted)
 *   attended > quota → record attendance and show "N classes exceeded"
 *   remaining never goes negative; over-quota attendance is still persisted.
 *
 * Gym visit check-ins and demo-class attendance NEVER count against the quota.
 */
/** Statuses for A student's class quota within the current membership period. */
export const QUOTA_STATUSES = ["none", "active", "warning", "critical", "expired", "exceeded"];
/** Severity → badge styling hints for the UI. */
export const QUOTA_SEVERITY = {
    none: "neutral",
    active: "success",
    warning: "warning",
    critical: "warning",
    expired: "destructive",
    exceeded: "destructive",
};
/**
 * @param input
 * @param input.quota Snapshot quota from the membership (null = no quota plan).
 * @param input.attended Count of quota-counting attendance rows for that membership.
 */
export function computeQuota({ quota, attended = 0 }) {
    const quotaTotal = quota == null ? null : Math.max(0, Math.trunc(Number(quota)));
    const attendedCount = Math.max(0, Math.trunc(Number(attended) || 0));
    // Duration-only / legacy plan: no quota at all.
    if (quotaTotal == null) {
        return {
            quota: null,
            attended: attendedCount,
            remaining: 0,
            exceeded: 0,
            status: "none",
            label: "No class quota",
            countsAgainstQuota: false,
        };
    }
    const remaining = Math.max(0, quotaTotal - attendedCount);
    const exceeded = Math.max(0, attendedCount - quotaTotal);
    let status;
    let label;
    if (exceeded > 0) {
        status = "exceeded";
        label = `${exceeded} ${exceeded === 1 ? "class" : "classes"} exceeded`;
    }
    else if (remaining === 0) {
        status = "expired";
        label = "Expired";
    }
    else if (remaining === 1) {
        status = "critical";
        label = "1 class left";
    }
    else if (remaining === 2) {
        status = "warning";
        label = "2 classes left";
    }
    else {
        status = "active";
        label = `${remaining} classes left`;
    }
    return {
        quota: quotaTotal,
        attended: attendedCount,
        remaining,
        exceeded,
        status,
        label,
        countsAgainstQuota: true,
    };
}
/** Snapshot the quota to stamp on a new membership for a plan. */
export function quotaForPlan(plan) {
    if (!plan || plan.classQuota == null)
        return null;
    const value = Math.trunc(Number(plan.classQuota));
    return Number.isFinite(value) && value >= 0 ? value : null;
}
/** Short human label for a plan's quota ("12 classes/month" or null). */
export function planQuotaLabel(plan) {
    const quota = quotaForPlan(plan);
    if (quota == null)
        return null;
    return `${quota} classes/month`;
}
