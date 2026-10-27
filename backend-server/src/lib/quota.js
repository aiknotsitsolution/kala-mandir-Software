/**
 * Class-quota business logic (server port used by API + tests).
 *
 * A plan may bake in a monthly dance-class quota (12 / 20 / 24 …). The quota
 * is snapshotted onto each MemberMembership at enrollment so later plan edits
 * never change an already-sold allowance. Attendance against the paid quota is
 * DERIVED from authoritative AttendanceRecord rows (quotaCounted === true,
 * linked to that membership) — never from a cached counter that can drift.
 *
 * Rules (see the product spec):
 *   remaining > 2  → "N classes left" (or simply "Active")
 *   remaining = 2  → "2 classes left"
 *   remaining = 1  → "1 class left"
 *   remaining = 0  → "Expired"
 *   attended > quota → record attendance and show "N classes exceeded"
 *   remaining never goes negative; over-quota attendance is still persisted.
 *
 * Gym visit check-ins and demo-class attendance NEVER count against the quota.
 */

/** Statuses for a member's class quota within the current membership period. */
export const QUOTA_STATUSES = ["none", "active", "warning", "critical", "expired", "exceeded"];

/**
 * @param {object} input
 * @param {number|null} input.quota      Snapshot quota from the membership (null = no quota plan).
 * @param {number} [input.attended]      Count of quota-counting attendance rows for that membership.
 * @returns {{
 *   quota: number|null, attended: number, remaining: number, exceeded: number,
 *   status: "none"|"active"|"warning"|"critical"|"expired"|"exceeded",
 *   label: string, countsAgainstQuota: boolean
 * }}
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
  } else if (remaining === 0) {
    status = "expired";
    label = "Expired";
  } else if (remaining === 1) {
    status = "critical";
    label = "1 class left";
  } else if (remaining === 2) {
    status = "warning";
    label = "2 classes left";
  } else {
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

/**
 * Snapshot the quota to stamp on a new MemberMembership for a plan.
 * Keeps existing duration-only plans working (null → no quota).
 */
export function quotaForPlan(plan) {
  if (!plan || plan.classQuota == null) return null;
  const value = Math.trunc(Number(plan.classQuota));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Short human label for a plan's quota ("12 classes/month" or "—"). */
export function planQuotaLabel(plan) {
  const quota = quotaForPlan(plan);
  if (quota == null) return null;
  return `${quota} classes/month`;
}
