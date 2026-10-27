/**
 * Class-attendance marking engine.
 *
 * Records a student's attendance for a recurring ClassSlot on a given date
 * (or a dated demo GymClass). Mirrors the gym check-in engine's discipline:
 * per-member scanLock, transactional writes, server-side duplicate guards
 * backed by a unique partial index, and an audit row per mark.
 *
 * Quota accounting rules (see src/lib/quota.js):
 *   • Regular class attendance → quotaCounted = true (deducts 1 from the
 *     membership's snapshotted classQuota).
 *   • Demo-class attendance   → quotaCounted = false (never deducted).
 *   • Legacy gym visits        → quotaCounted = null  (never counted).
 *   • An exhausted/expired quota does NOT block marking — the attendance is
 *     recorded and the returned quota shows "N classes exceeded"/"Expired".
 *
 * Every successful mark derives the new quota from AttendanceRecords (no
 * cached counter) and upserts in-app notifications (2 left / 1 left / Expired /
 * N exceeded) keyed to the membership period.
 */

import { withTransaction } from "../db.js";
import Member from "../models/Member.js";
import MemberMembership from "../models/MemberMembership.js";
import MembershipPlan from "../models/MembershipPlan.js";
import ClassSlot from "../models/ClassSlot.js";
import GymClass from "../models/GymClass.js";
import SlotEnrollment from "../models/SlotEnrollment.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import StaffProfile from "../models/StaffProfile.js";
import { writeAudit } from "../lib/audit.js";
import { currentMembership, checkEligibility } from "../lib/membership.js";
import { toAttendance, ymd } from "../lib/serialize.js";
import { minutesInTz, parseDateOnly, ymdInTz, instantInTz } from "../lib/dates.js";
import { quotaForMembership, syncQuotaNotifications } from "./quota.js";

/** Reasons a mark can be rejected. Messages are written for the front desk. */
export const CLASS_REJECTIONS = {
  invalid_qr: "This QR code is not recognised.",
  not_found: "No student matches this Student ID.",
  forbidden: "This student belongs to a different studio.",
  member_inactive: "This student is inactive.",
  slot_not_found: "That class slot no longer exists.",
  slot_inactive: "That class slot is not active.",
  not_a_slot_day: "That date is not one of this slot's scheduled days.",
  wrong_slot: "You are not the instructor for this slot.",
  no_membership: "This student has no active membership to bill classes against.",
  duplicate: "Already marked for this slot on that date.",
  invalid_date: "Pick a valid date for the class.",
};

const BASE_REASONS = Object.keys(CLASS_REJECTIONS);

function memberSummary(member, membership, planDoc, quota)
{
  return {
    id: String(member._id),
    memberCode: member.memberCode,
    fullName: member.fullName,
    photoUrl: member.photoUrl ?? null,
    status: member.status,
    planName: planDoc?.name ?? null,
    membershipEnd: membership ? ymd(membership.endDate) : null,
    quota: quota ?? null,
  };
}

async function rejected(reason, extra = {}, member = null, membership = null, quota = null, session = null)
{
  const out = {
    status: "rejected",
    reason,
    message: CLASS_REJECTIONS[reason] ?? "Attendance could not be marked.",
  };
  if (member)
  {
    const planDoc = membership
      ? await MembershipPlan.findById(membership.planId).session(session).lean()
      : null;
    out.member = memberSummary(member, membership, planDoc, quota);
  }
  return { ...out, ...extra };
}

/** Calendar date key (YYYY-MM-DD) for a slot session in the gym's timezone. */
function sessionDayKey(date, tz)
{
  return ymdInTz(date, tz);
}

/** The weekday (0=Sun…6=Sat) of a Date in the gym's timezone. */
function weekdayInTz(date, tz)
{
  const dayKey = ymdInTz(date, tz); // YYYY-MM-DD
  const [y, m, d] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Resolve the staff profile for a trainer-scoped actor (null for other roles).
 */
async function trainerProfile(gymId, actorRole, actorId)
{
  if (actorRole !== "trainer") return null;
  return StaffProfile.findOne({ gymId, profileId: actorId }).lean();
}

/**
 * Mark attendance for a recurring ClassSlot.
 *
 * @param {object} params
 * @param {string} params.gymId      caller's gym (tenancy)
 * @param {string} params.actorId    authenticated user id
 * @param {string} params.actorRole  "owner"|"admin"|"front_desk"|"trainer"
 * @param {string} params.slotId     ClassSlot id
 * @param {string} params.date       "YYYY-MM-DD" (defaults to today in tz)
 * @param {{token?: string, code?: string}} params.lookup token XOR member code
 * @param {"qr"|"manual"|"class"} params.method
 * @param {string|null} params.notes
 * @param {object} params.ctx        { tz, settings, now, expiringSoonDays }
 * @returns {Promise<object>} CheckInResult-shaped (status ok|rejected).
 */
export async function markSlotAttendance({
  gymId,
  actorId,
  actorRole,
  slotId,
  date,
  lookup,
  method = "class",
  /** Optional register status (present/late/absent). Auto-marks pass "present"
   *  so the student appears marked in the Mark/View register immediately. */
  attendanceStatus = null,
  notes = null,
  ctx,
})
{
  const statusValue = attendanceStatus && ["present", "late", "absent"].includes(attendanceStatus)
    ? attendanceStatus
    : null;
  const { tz } = ctx;
  const now = new Date();

  // Resolve the session date (defaults to today in the gym's timezone).
  let sessionDate;
  if (date)
  {
    sessionDate = parseDateOnly(date);
    if (Number.isNaN(sessionDate?.getTime?.() ?? NaN))
    {
      return rejected("invalid_date");
    }
  } else
  {
    sessionDate = parseDateOnly(ymdInTz(now, tz));
  }

  return withTransaction(async (session) =>
  {
    // 1. Slot must exist, be active, and belong to this gym.
    const slot = await ClassSlot.findOne({ _id: slotId, gymId }).session(session).lean();
    if (!slot) return rejected("slot_not_found", {}, null, null, null, session);
    if (!slot.isActive) return rejected("slot_inactive", {}, null, null, null, session);

    // 2. Trainer scoping — instructors may only mark their own slots.
    if (actorRole === "trainer")
    {
      const profile = await trainerProfile(gymId, actorRole, actorId);
      if (!profile || String(slot.instructorId ?? "") !== String(profile._id))
      {
        return rejected("wrong_slot", {}, null, null, null, session);
      }
    }

    // 3. The date must fall on one of the slot's scheduled weekdays.
    const weekday = weekdayInTz(sessionDate, tz);
    if (!Array.isArray(slot.weekdays) || !slot.weekdays.some((d) => Number(d) === weekday))
    {
      return rejected("not_a_slot_day", { weekday, slotWeekdays: slot.weekdays }, null, null, null, session);
    }

    // 4. Resolve member by opaque token, id, or member code.
    let member;
    if (lookup?.token)
    {
      member = await Member.findOne({ qrToken: lookup.token }).session(session);
      if (!member) return rejected("invalid_qr", {}, null, null, null, session);
    } else if (lookup?.memberId)
    {
      member = await Member.findOne({ _id: lookup.memberId, gymId }).session(session);
      if (!member) return rejected("not_found", {}, null, null, null, session);
    } else
    {
      member = await Member.findOne({ gymId, memberCode: String(lookup?.code ?? "").trim().toUpperCase() })
        .session(session);
      if (!member) return rejected("not_found", {}, null, null, null, session);
    }

    // 5. Tenancy.
    if (String(member.gymId) !== String(gymId)) return rejected("forbidden", {}, null, null, null, session);

    // 6. Per-member lock — serialises concurrent marks for the same student.
    await Member.updateOne({ _id: member._id }, { $inc: { scanLock: 1 } }, { session });

    // 7. Member must be active to attend.
    if (member.status !== "active")
    {
      return rejected("member_inactive", {}, member, null, null, session);
    }

    // 8. Governing membership (started, prefer active, then latest end).
    const memberships = await MemberMembership.find({
      memberId: member._id,
      startDate: { $lte: sessionDate },
    })
      .session(session)
      .lean();
    const membership = currentMembership(memberships) ?? null;

    // present/late ke liye membership zaroori — absent allow
    
    // Expired/suspended memberships are still allowed to record attendance
    // (quota exhaustion/expiry must never lose the attendance); only a student
    // with NO membership at all is rejected, since there is nothing to bill.
    let eligibilityStatus = "active";
    if (membership)
    {
      const eligibility = checkEligibility({
        memberStatus: member.status,
        membership: {
          startDate: ymd(membership.startDate),
          endDate: ymd(membership.endDate),
          status: membership.status,
        },
        settings: ctx.settings,
        now,
        timeZone: tz,
        expiringSoonDays: ctx.expiringSoonDays ?? 7,
      });
      eligibilityStatus = eligibility.status ?? "active";
    } else
    {
      return rejected("no_membership", {}, member, null, null, session);
    }

    // 9. Duplicate guard — one mark per member per slot per date.
    const dayKey = sessionDayKey(sessionDate, tz);
    const dedupeKey = `slot:${slot._id}:${dayKey}`;
    const existing = await AttendanceRecord.findOne({
      gymId,
      memberId: member._id,
      dedupeKey,
    })
      .session(session)
      .lean();
    if (existing)
    {
      return rejected("duplicate", { attendanceId: String(existing._id) }, member, membership, null, session);
    }

    // 10. Insert (quotaCounted = true → deducts 1 from the membership quota).
    const [attendance] = await AttendanceRecord.create(
      [
        {
          gymId,
          memberId: member._id,
          membershipId: membership._id,
          // checkIn: now,
          checkIn: instantInTz(dayKey, slot.startTime, tz),
          // sessionDate: parseDateOnly(dayKey),
          status: "checked_in",
          method,
          scannerId: actorId || null,
          notes: notes || null,
          meta: { slotName: slot.name, slotId: String(slot._id) },
          classSlotId: slot._id,
          sessionDate: parseDateOnly(dayKey),
          ...(statusValue ? { attendanceStatus: statusValue } : {}),
          quotaCounted: true,
          demo: false,
          dedupeKey,
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
        action: "create_class_attendance",
        newValues: {
          memberCode: member.memberCode,
          slot: slot.name,
          date: dayKey,
          method,
        },
      },
      session,
    );

    // 11. Derive the fresh quota and sync notifications.
    const quota = await quotaForMembership(membership, session);
    await syncQuotaNotifications({ gymId, member, membership, quota, session });

    const planDoc = await MembershipPlan.findById(membership.planId).session(session).lean();

    return {
      status: "ok",
      attendance: toAttendance(attendance, member, null),
      member: memberSummary(member, membership, planDoc, quota),
      quota,
      ...(eligibilityStatus === "expired" ? { warning: "expired" } : {}),
      ...(quota.status === "exceeded" ? { warning: "quota_exceeded" } : {}),
    };
  });
}

/**
 * Mark attendance for a dated demo class (GymClass with kind "demo").
 * Never counts against the quota; one mark per member per class session.
 */
export async function markDemoAttendance({
  gymId,
  actorId,
  actorRole,
  classId,
  lookup,
  method = "class",
  notes = null,
  ctx,
})
{
  const { tz } = ctx;
  const now = new Date();

  return withTransaction(async (session) =>
  {
    const klass = await GymClass.findOne({ _id: classId, gymId }).session(session).lean();
    if (!klass) return rejected("slot_not_found", {}, null, null, null, session);

    // Instructor scoping for trainers (trainerId is a StaffProfile id).
    if (actorRole === "trainer")
    {
      const profile = await trainerProfile(gymId, actorRole, actorId);
      if (!profile || String(klass.trainerId ?? "") !== String(profile._id))
      {
        return rejected("wrong_slot", {}, null, null, null, session);
      }
    }

    let member;
    if (lookup?.token)
    {
      member = await Member.findOne({ qrToken: lookup.token }).session(session);
      if (!member) return rejected("invalid_qr", {}, null, null, null, session);
    } else if (lookup?.memberId)
    {
      member = await Member.findOne({ _id: lookup.memberId, gymId }).session(session);
      if (!member) return rejected("not_found", {}, null, null, null, session);
    } else
    {
      member = await Member.findOne({ gymId, memberCode: String(lookup?.code ?? "").trim().toUpperCase() })
        .session(session);
      if (!member) return rejected("not_found", {}, null, null, null, session);
    }
    if (String(member.gymId) !== String(gymId)) return rejected("forbidden", {}, null, null, null, session);

    await Member.updateOne({ _id: member._id }, { $inc: { scanLock: 1 } }, { session });
    if (member.status !== "active")
    {
      return rejected("member_inactive", {}, member, null, null, session);
    }

    // Demo classes need no membership — attendance is recorded without billing.
    const memberships = await MemberMembership.find({
      memberId: member._id,
      startDate: { $lte: now },
    })
      .session(session)
      .lean();
    const membership = currentMembership(memberships) ?? null;

    const startsAt = klass.startsAt ? new Date(klass.startsAt) : now;
    const dayKey = sessionDayKey(startsAt, tz);
    const dedupeKey = `class:${klass._id}`;
    const existing = await AttendanceRecord.findOne({ gymId, memberId: member._id, dedupeKey })
      .session(session)
      .lean();
    if (existing)
    {
      return rejected("duplicate", { attendanceId: String(existing._id) }, member, membership, null, session);
    }

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
          meta: { className: klass.name, classId: String(klass._id) },
          classId: klass._id,
          sessionDate: parseDateOnly(dayKey),
          quotaCounted: false,
          demo: false,
          dedupeKey,
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
        action: "create_demo_attendance",
        newValues: { memberCode: member.memberCode, className: klass.name, date: dayKey },
      },
      session,
    );

    const quota = membership ? await quotaForMembership(membership, session) : null;
    const planDoc = membership
      ? await MembershipPlan.findById(membership.planId).session(session).lean()
      : null;

    return {
      status: "ok",
      attendance: toAttendance(attendance, member, null),
      member: memberSummary(member, membership, planDoc, quota),
      quota,
      demo: false,
    };
  });
}

/**
 * Mark a whole roster's attendance for one slot session in a single call.
 *
 * The mark-attendance sheet loads the enrolled students and the front desk
 * assigns each a status (present / late / absent / leave / holiday). This upserts one
 * AttendanceRecord per student for the slot+date so statuses can be corrected
 * freely (present → absent → present) without tripping the duplicate guard.
 *
 * Quota rules: present, late, and leave each deduct 1 from the paid quota;
 * absent and holiday record the row but never count. Exhausted/expired quotas still record.
 *
 * @param {object} params
 * @param {string} params.gymId
 * @param {string} params.actorId
 * @param {string} params.actorRole
 * @param {string} params.slotId
 * @param {string} [params.date] "YYYY-MM-DD" (defaults to today in tz)
 * @param {Array<{memberId: string, status: "present"|"late"|"absent"|"leave"|"holiday"}>} params.marks
 * @param {object} params.ctx { tz, settings, now, expiringSoonDays }
 * @returns {Promise<object>} { date, marked: number, results: [...] }
 */
export async function markRosterAttendance({
  gymId,
  actorId,
  actorRole,
  slotId,
  date,
  marks,
  ctx,
})
{
  const { tz } = ctx;
  const now = new Date();

  let sessionDate;
  if (date)
  {
    sessionDate = parseDateOnly(date);
    if (Number.isNaN(sessionDate?.getTime?.() ?? NaN))
    {
      return { status: "rejected", reason: "invalid_date", message: CLASS_REJECTIONS.invalid_date, results: [] };
    }
  } else
  {
    sessionDate = parseDateOnly(ymdInTz(now, tz));
  }
  const dayKey = sessionDayKey(sessionDate, tz);

  // Slot must exist, be active and belong to this gym.
  const slot = await ClassSlot.findOne({ _id: slotId, gymId }).lean();
  if (!slot) return { status: "rejected", reason: "slot_not_found", message: CLASS_REJECTIONS.slot_not_found, results: [] };
  if (!slot.isActive) return { status: "rejected", reason: "slot_inactive", message: CLASS_REJECTIONS.slot_inactive, results: [] };

  // Instructors may only mark their own slots.
  if (actorRole === "trainer")
  {
    const profile = await trainerProfile(gymId, actorRole, actorId);
    if (!profile || String(slot.instructorId ?? "") !== String(profile._id))
    {
      return { status: "rejected", reason: "wrong_slot", message: CLASS_REJECTIONS.wrong_slot, results: [] };
    }
  }

  const results = [];
  let marked = 0;

  // Weekday (0=Sun…6=Sat) of the session date — drives the multi-slot
  // propagation below ("student has 3 batches → Present marks all 3").
  const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();

  for (const mark of marks)
  {
    const status = ["present", "late", "absent", "leave", "holiday"].includes(mark.status)
      ? mark.status
      : "present";
    const outcome = await withTransaction(async (session) =>
    {
      const member = await Member.findOne({ _id: mark.memberId, gymId }).session(session);
      if (!member) return { memberId: mark.memberId, status: "rejected", reason: "not_found", message: CLASS_REJECTIONS.not_found };
      if (member.status !== "active")
      {
        return { memberId: mark.memberId, status: "rejected", reason: "member_inactive", message: CLASS_REJECTIONS.member_inactive };
      }

      const memberships = await MemberMembership.find({ memberId: member._id, startDate: { $lte: sessionDate } })
        .session(session)
        .lean();
      const membership = currentMembership(memberships) ?? null;

      if (!membership && status !== "absent" && status !== "holiday")
      {
        return {
          memberId: String(member._id),
          memberCode: member.memberCode,
          fullName: member.fullName,
          status: "rejected",
          reason: "no_membership",
          message: CLASS_REJECTIONS.no_membership,
        };
      }

      // Present, late, and leave count against quota; absent and holiday do not.
      const quotaCounted = status !== "absent" && status !== "holiday";

      /** Upsert this member's mark for one slot session (dedupe-safe).
       *  Used for the picked slot AND every other enrolled slot of the day. */
      const upsertForSlot = async (slotDoc) =>
      {
        const dedupeKey = `slot:${slotDoc._id}:${dayKey}`;
        // Upsert so a status can be corrected after the first mark.
        const existing = await AttendanceRecord.findOne({ gymId, memberId: member._id, dedupeKey }).session(session).lean();
        const update = {
          attendanceStatus: status,
          quotaCounted,
          method: "class",
          scannerId: actorId || null,
          notes: mark.notes ?? null,
        };
        if (existing && membership && !existing.membershipId)
        {
          update.membershipId = membership._id;
        }
        let attendance;
        if (existing)
        {
          attendance = await AttendanceRecord.findOneAndUpdate(
            { _id: existing._id },
            { $set: update },
            { new: true, session },
          ).lean();
        } else
        {
          [attendance] = await AttendanceRecord.create(
            [
              {
                gymId,
                memberId: member._id,
                membershipId: membership?._id ?? null,
                // checkIn: now,
                checkIn: instantInTz(dayKey, slotDoc.startTime, tz),
                // sessionDate: parseDateOnly(dayKey),
                status: "checked_in",
                method: "class",
                scannerId: actorId || null,
                notes: mark.notes ?? null,
                meta: { slotName: slotDoc.name, slotId: String(slotDoc._id) },
                classSlotId: slotDoc._id,
                sessionDate: parseDateOnly(dayKey),
                quotaCounted,
                demo: false,
                dedupeKey,
                attendanceStatus: status,
              },
            ],
            { session },
          );
        }
        // Only bill quota against a real membership; demo/absent rows carry none.
        let quota = null;
        if (membership)
        {
          quota = await quotaForMembership(membership, session);
          await syncQuotaNotifications({ gymId, member, membership, quota, session });
        }
        return { attendance, quota };
      };

      const primary = await upsertForSlot(slot);

      // Multi-slot counting — the student belongs to N batches: replicate
      // the day's status across every OTHER active slot they are enrolled
      // in that runs on this weekday — but ONLY for batches that have
      // already STARTED (running or past) by now. A batch starting later
      // today (e.g. the 2 PM batch) is NOT pre-marked when the morning
      // trainer saves at 10:30 — the register must stay honest about
      // classes that haven't happened. The quota counter updates once per
      // batch that actually marked.
      let extraMarked = 0;
      const enrollments = await SlotEnrollment.find({ gymId, memberId: member._id, status: "enrolled" }).session(session).lean();
      if (enrollments.length > 0)
      {
        const nowMinutes = minutesInTz(now, tz);
        const hasStarted = (s) =>
        {
          const parts = String(s?.startTime ?? "").split(":").map(Number);
          if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return false;
          return nowMinutes >= parts[0] * 60 + parts[1]; // (running or ended)
        };
        const rawOthers = await ClassSlot.find({
          _id: { $in: enrollments.map((e) => e.slotId), $ne: slot._id },
          gymId,
          isActive: true,
          weekdays: weekday,
        })
          .sort({ startTime: 1 })
          .session(session)
          .lean();
        const otherSlots = rawOthers.filter(hasStarted);
        for (const other of otherSlots)
        {
          await upsertForSlot(other);
          extraMarked += 1;
        }
      }

      return {
        memberId: String(member._id),
        memberCode: member.memberCode,
        fullName: member.fullName,
        status: "ok",
        attendanceStatus: status,
        extraSlotMarked: extraMarked,
        quota: primary.quota,
      };
    });
    results.push(outcome);
    if (outcome.status === "ok") marked += 1;
  }

  return { status: "ok", date: dayKey, marked, results };
}

export { BASE_REASONS };
