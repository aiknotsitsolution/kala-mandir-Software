/**
 * Check-in engine — server port of the `record_attendance` RPC.
 *
 * Rejection order (mirrors supabase/migrations/0003):
 *   invalid_qr → revoked_qr → forbidden → member_inactive → no_membership →
 *   expired (or accepted with warning when allowExpiredCheckin) →
 *   suspended → duplicate (60s) → cooldown → ok
 *
 * Runs inside a transaction; a per-member lock ($inc on the member row)
 * serialises concurrent scans so the same member cannot double-insert.
 */

import Member from "../models/Member.js";
import MemberMembership from "../models/MemberMembership.js";
import MembershipPlan from "../models/MembershipPlan.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import { withTransaction } from "../db.js";
import { ymdInTz, parseDateOnly } from "../lib/dates.js";
import { checkEligibility } from "../lib/membership.js";
import { toAttendance, ymd } from "../lib/serialize.js";
import { writeAudit } from "../lib/audit.js";

export const REJECTION_MESSAGES = {
  invalid_qr: "This QR code is not recognised.",
  revoked_qr: "This QR code has been revoked.",
  member_inactive: "This student is inactive.",
  no_membership: "This member has no current membership.",
  expired: "This membership has expired.",
  suspended: "This membership is suspended or cancelled.",
  cooldown: "Please wait a bit before checking in again.",
  duplicate: "Duplicate scan — this check-in was already recorded.",
  forbidden: "This student belongs to a different studio.",
  not_found: "No student matches this student code.",
  network: "Network error.",
  server_error: "Server error.",
};

function memberSummary(member, membership = null, planDoc = null, effective = null) {
  return {
    id: String(member._id),
    memberCode: member.memberCode,
    fullName: member.fullName,
    photoUrl: member.photoUrl ?? null,
    planName: planDoc?.name ?? null,
    membershipEnd: membership ? ymd(membership.endDate) : null,
    effectiveStatus: effective,
  };
}

async function rejected(session, reason, member = null, membership = null, extra = {}, effective = null) {
  const result = {
    status: "rejected",
    reason,
    message: REJECTION_MESSAGES[reason] ?? "Check-in rejected.",
  };
  if (member) {
    // Rejections are rare — resolve the plan name lazily so the scanner can
    // show the member's plan instead of a bare "No active plan".
    const planDoc = membership
      ? await MembershipPlan.findById(membership.planId).session(session).lean()
      : null;
    result.member = memberSummary(member, membership, planDoc, effective);
  }
  return { ...result, ...extra };
}

/**
 * @param {object} params
 * @param {string} params.gymId   caller's gym (tenancy)
 * @param {string} params.actorId authenticated user id (scanner)
 * @param {{token?: string, code?: string}} params.lookup token XOR member code
 * @param {"qr"|"manual"|"class"} params.method
 * @param {string|null} params.notes
 * @param {object} params.ctx { settings, tz, now, expiringSoonDays }
 * @returns {Promise<CheckInResult>} HTTP 200 in both ok and rejected cases.
 */
export async function runCheckIn({ gymId, actorId, lookup, method = "qr", notes = null, ctx }) {
  const { settings, tz } = ctx;
  const now = new Date();
  const today = parseDateOnly(ymdInTz(now, tz));

  return withTransaction(async (session) => {
    // 1. Resolve member by opaque token or member code.
    let member;
    if (lookup.token) {
      member = await Member.findOne({ qrToken: lookup.token }).session(session);
      if (!member) return rejected(session, "invalid_qr");
    } else {
      member = await Member.findOne({ gymId, memberCode: String(lookup.code).trim().toUpperCase() })
        .session(session);
      if (!member) return rejected(session, "not_found");
    }

    // 2. Tenancy check: caller's gym must match the member's gym.
    if (String(member.gymId) !== String(gymId)) return rejected(session, "forbidden");

    // 3. Per-member lock — serialises concurrent scans of the same member.
    await Member.updateOne({ _id: member._id }, { $inc: { scanLock: 1 } }, { session });

    // A revoked token keeps its value so scanners can tell revoked vs invalid.
    if (member.qrStatus !== "active") return rejected(session, "revoked_qr", member);

    // 4. Member active? (rejection order: inactive first)
    if (member.status !== "active") return rejected(session, "member_inactive", member);

    // 5. Governing membership: started, prefer active, then most recent end.
    const memberships = await MemberMembership.find({
      memberId: member._id,
      startDate: { $lte: today },
    })
      .session(session)
      .lean();
    memberships.sort(
      (a, b) =>
        (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0) ||
        new Date(b.endDate) - new Date(a.endDate),
    );
    const membership = memberships[0] ?? null;

    // 6-7. Expired / suspended / no membership (shared rules with the UI).
    const eligibility = checkEligibility({
      memberStatus: member.status,
      membership: membership
        ? { startDate: ymd(membership.startDate), endDate: ymd(membership.endDate), status: membership.status }
        : null,
      settings,
      now,
      timeZone: tz,
      expiringSoonDays: ctx.expiringSoonDays ?? 7,
    });
    if (!eligibility.eligible) {
      return rejected(session, eligibility.reason, member, membership, {}, eligibility.status);
    }

    // 8. Duplicate (60s) / cooldown — applies regardless of calendar day.
    const last = await AttendanceRecord.findOne({ memberId: member._id })
      .sort({ checkIn: -1 })
      .session(session)
      .lean();
    const cooldownMinutes = settings?.checkinCooldownMinutes ?? 0;
    if (last) {
      const diffMs = now.getTime() - new Date(last.checkIn).getTime();
      if (diffMs < 60_000) return rejected(session, "duplicate", member, membership);
      if (cooldownMinutes > 0 && diffMs < cooldownMinutes * 60_000) {
        return rejected(session, "cooldown", member, membership, {
          nextCheckInAt: new Date(new Date(last.checkIn).getTime() + cooldownMinutes * 60_000).toISOString(),
        });
      }
    }

    // 9. Insert.
    const [attendance] = await AttendanceRecord.create(
      [
        {
          gymId,
          memberId: member._id,
          membershipId: membership?._id ?? null,
          checkIn: now,
          status: "checked_in",
          method,
          scannerId: actorId || null,
          notes: notes || null,
          meta: {},
        },
      ],
      { session },
    );

    await writeAudit(
      {
        gymId,
        actorId,
        entity: "attendance_records",
        entityId: String(attendance._id),
        action: "create",
        newValues: { memberCode: member.memberCode, method, checkIn: now.toISOString() },
      },
      session,
    );

    const planDoc = membership
      ? await MembershipPlan.findById(membership.planId).session(session).lean()
      : null;

    const result = {
      status: "ok",
      attendance: toAttendance(attendance, member, null),
      member: memberSummary(member, membership, planDoc, eligibility.status),
    };
    if (eligibility.status === "expired") result.warning = "expired";
    return result;
  });
}
