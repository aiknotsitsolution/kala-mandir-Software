/**
 * Class-quota accounting service.
 *
 * Derives a member's attended-class count from authoritative AttendanceRecord
 * rows (quotaCounted === true, linked to a specific MemberMembership) and keeps
 * in-app notifications in sync. There is NO cached counter — every read is a
 * fresh COUNT so corrections reconcile automatically.
 *
 * Notification policy (in-app AppNotification only — no push/SMS/email):
 *   remaining === 2  → quota_low    "2 classes left"
 *   remaining === 1  → quota_low    "1 class left"
 *   remaining === 0  → quota_exhausted "Expired"
 *   exceeded   > 0   → quota_exceeded  "N classes exceeded"
 * Each is upserted once per membership-period via a dedupeKey that embeds the
 * membership id, so renewals re-arm the reminders naturally.
 */

import AttendanceRecord from "../models/AttendanceRecord.js";
import AppNotification from "../models/AppNotification.js";
import { computeQuota } from "../lib/quota.js";
import { ymd } from "../lib/serialize.js";

/** Count of quota-counting attendance rows for a membership. */
export async function countQuotaAttendance(membershipId, session = null) {
  if (!membershipId) return 0;
  return AttendanceRecord.countDocuments({ membershipId, quotaCounted: true })
    .session(session);
}

/** Derived quota snapshot for a membership document (lean or hydrated). */
export async function quotaForMembership(membership, session = null) {
  if (!membership) return computeQuota({ quota: null, attended: 0 });
  const attended = await countQuotaAttendance(membership._id, session);
  return computeQuota({ quota: membership.classQuota ?? null, attended });
}

function quotaNotificationSpec(member, membership, quotaState) {
  const who = `${member.fullName} (${member.memberCode})`;
  const link = `/members/${member._id}`;
  const period = String(membership._id);
  const specs = [];

  if (quotaState.status === "exceeded") {
    specs.push({
      type: "quota_exceeded",
      dedupeKey: `${member._id}:${period}:quota_exceeded:${quotaState.exceeded}`,
      title: "Class quota exceeded",
      body: `${who} — ${quotaState.exceeded} ${quotaState.exceeded === 1 ? "class" : "classes"} beyond the paid quota of ${quotaState.quota}.`,
      severity: "warning",
      link,
    });
    return specs;
  }
  if (quotaState.status === "expired") {
    specs.push({
      type: "quota_exhausted",
      dedupeKey: `${member._id}:${period}:quota_exhausted`,
      title: "Class quota exhausted",
      body: `${who} — all ${quotaState.quota} paid classes are used. Renew to book more.`,
      severity: "warning",
      link,
    });
    return specs;
  }
  if (quotaState.status === "critical") {
    specs.push({
      type: "quota_low",
      dedupeKey: `${member._id}:${period}:quota_low:1`,
      title: "1 class left",
      body: `${who} — only 1 class left in the current plan.`,
      severity: "warning",
      link,
    });
  } else if (quotaState.status === "warning") {
    specs.push({
      type: "quota_low",
      dedupeKey: `${member._id}:${period}:quota_low:2`,
      title: "2 classes left",
      body: `${who} — only 2 classes left in the current plan.`,
      severity: "info",
      link,
    });
  }
  return specs;
}

/**
 * Upsert quota notifications for a member's current membership.
 * Called after every quota-counting attendance write and after corrections.
 * Safe to call repeatedly (dedupeKey makes it idempotent per threshold).
 * Returns the number of NEW notifications created.
 */
export async function syncQuotaNotifications({ gymId, member, membership, session = null }) {
  if (!member || !membership) return 0;
  const quotaState = await quotaForMembership(membership, session);
  const specs = quotaNotificationSpec(member, membership, quotaState);
  if (specs.length === 0) return 0;

  let created = 0;
  for (const spec of specs) {
    const existing = await AppNotification.findOne({
      gymId,
      type: spec.type,
      dedupeKey: spec.dedupeKey,
    })
      .select("_id")
      .session(session)
      .lean();
    if (existing) continue;
    await AppNotification.updateOne(
      { gymId, type: spec.type, dedupeKey: spec.dedupeKey },
      {
        $set: {
          gymId,
          userId: null,
          memberId: member._id,
          type: spec.type,
          title: spec.title,
          body: spec.body,
          severity: spec.severity,
          isRead: false,
          dedupeKey: spec.dedupeKey,
          link: spec.link,
        },
      },
      { upsert: true, session },
    );
    created += 1;
  }
  return created;
}

/**
 * Dashboard / admin-report projection for one member's quota.
 * Returns the same shape as computeQuota plus the period window.
 */
export async function quotaSummaryForMember(membership, member) {
  const state = await quotaForMembership(membership);
  return {
    ...state,
    memberId: member ? String(member._id) : null,
    membershipId: membership ? String(membership._id) : null,
    periodStart: membership ? ymd(membership.startDate) : null,
    periodEnd: membership ? ymd(membership.endDate) : null,
  };
}
