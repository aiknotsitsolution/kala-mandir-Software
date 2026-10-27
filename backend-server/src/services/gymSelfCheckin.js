/**
 * Shared "studio QR" self check-in.
 *
 * Used by BOTH:
 *  - POST /api/attendance/gym-scan — the in-portal scanner (toggles check-in/out)
 *  - POST /api/me/checkin-gym      — scan-the-wall-QR login flow (check-in only)
 *
 * The QR carries ONLY the studio's opaque token — never a password or personal
 * data. Every scan is re-validated server-side for the signed-in member.
 */

import AttendanceRecord from "../models/AttendanceRecord.js";
import ClassSlot from "../models/ClassSlot.js";
import MemberMembership from "../models/MemberMembership.js";
import SlotEnrollment from "../models/SlotEnrollment.js";
import StaffProfile from "../models/StaffProfile.js";
import { badRequest } from "../lib/errors.js";
import { minutesInTz, parseDateOnly, ymdInTz } from "../lib/dates.js";
import { toMinutes } from "../lib/schedule.js";
import { parseQrPayload } from "../lib/qr.js";
import { toAttendance } from "../lib/serialize.js";
import { writeAudit } from "../lib/audit.js";
import { withTransaction } from "../db.js";
import { currentMembership } from "../lib/membership.js";
import { runCheckIn } from "./checkin.js";
import { notifyIfOverPlanned, notifyExpiredScan } from "./overtime.js";
import { markSlotAttendance } from "./classAttendance.js";
import { quotaForMembership, syncQuotaNotifications } from "./quota.js";

/** `13:05` → `1:05 PM` — matches the Manage Institute slot labels. */
function fmt12h(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m ?? 0).padStart(2, "0")} ${suffix}`;
}

/** Great-circle distance in meters (Haversine) — GPS range check. */
function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Verify the scanned payload is THIS studio's shared QR token. Accepts the
 * bare token, the legacy "PGS1:<token>" payload, or the printed login URL.
 * Throws `invalid_gym_qr` otherwise — a member's PERSONAL QR never passes here.
 */
export function assertGymQrToken(gym, raw) {
  const token = parseQrPayload(raw) ?? String(raw ?? "").trim();
  if (!gym.gymQrToken || token !== gym.gymQrToken) {
    throw badRequest(
      "That is not this studio's QR code. Please scan the QR at the front desk.",
      "invalid_gym_qr",
    );
  }
  return token;
}

/**
 * Extra same-day visits count as their own session.
 *
 * The studio bills sessions, NOT days: a student who walks in twice (morning
 * batch + another session in the evening) consumes the quota TWICE, no matter
 * that the calendar day is the same. The first visit of the day marks every
 * batch the student is enrolled in (quota −N). Any LATER same-day visit finds
 * all of today's batch marks already present, so it lands here: one extra
 * register mark ("present" with no slot) and one quota deduction.
 *
 * @returns {{ attendance: object, visitNo: number, label: string, quota: object | null } | null}
 */
async function markExtraVisitAttendance({ gymId, member, actorId, ctx, now, dayKey }) {
  const memberId = member._id ?? member.id;
  const sessionDate = parseDateOnly(dayKey);
  try {
    return await withTransaction(async (session) => {
      // Visit number = same-day gym visit rows (records without a class slot),
      // INCLUDING the fresh visit this scan just created.
      const visitNo = await AttendanceRecord.countDocuments({
        gymId,
        memberId,
        checkIn: { $gte: sessionDate, $lt: new Date(sessionDate.getTime() + 86_400_000) },
        classSlotId: null,
      }).session(session);
      // First visit of the day can never be an "extra" — the batch marks own it.
      if (visitNo < 2) return null;

      const memberships = await MemberMembership.find({
        memberId,
        startDate: { $lte: sessionDate },
      })
        .session(session)
        .lean();
      const membership = currentMembership(memberships) ?? null;

      const dedupeKey = `extra-visit:${String(memberId)}:${dayKey}:${visitNo}`;
      const existing = await AttendanceRecord.findOne({ gymId, memberId, dedupeKey })
        .session(session)
        .lean();
      if (existing) return null;

      const label = `Extra visit #${visitNo}`;
      const [attendance] = await AttendanceRecord.create(
        [
          {
            gymId,
            memberId,
            membershipId: membership?._id ?? null,
            checkIn: now,
            checkOut: now,
            // "checked_out" — a register mark, NOT an open gym visit, so the
            // front desk "currently inside" logic is never confused.
            status: "checked_out",
            method: "qr",
            scannerId: actorId || null,
            notes: "Extra visit inside the same day — counted per visit (session-wise billing).",
            meta: { extraVisit: true, visitNo, slotName: label },
            sessionDate,
            quotaCounted: membership ? true : false,
            demo: false,
            dedupeKey,
            attendanceStatus: "present",
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
            slot: label,
            date: dayKey,
            method: "qr",
            extraVisit: true,
          },
        },
        session,
      );

      let quota = null;
      if (membership) {
        quota = await quotaForMembership(membership, session);
        await syncQuotaNotifications({ gymId, member, membership, quota, session });
      }

      return { attendance: toAttendance(attendance, member, null), visitNo, label, quota };
    });
  } catch {
    // Counting the extra visit is a bonus — never fail the check-in itself.
    return null;
  }
}

/** Scan-time batch window — "running window" rule:
 *  • A batch is auto-marked only while it is on air.
 *  • +15 min before start (student reached a bit early).
 *  • +60 min after end (late scan still counts that batch).
 *  Nothing else gets pre-marked — the 2 PM batch stays unmarked until the
 *  student actually walks into it (or the trainer marks it). */
const SLOT_WINDOW_BEFORE_MIN = 15;
const SLOT_WINDOW_AFTER_MIN = 60;

/** `HH:MM` from ClassSlot.startTime/endTime → minutes since midnight. */
function slotMinutes(hhmm) {
  const parts = String(hhmm ?? "").split(":").map(Number);
  if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return NaN;
  return parts[0] * 60 + parts[1];
}

/**
 * Best-effort automatic register marks for a studio QR check-in.
 *
 * RUNNING-WINDOW RULE: the scan marks ONLY the student's enrolled batches
 * that are on air right now (± the small pre/post grace above). A student
 * with a 10–11 and a 2–3 batch scanning at 10:15 gets exactly ONE mark
 * (10–11, quota −1); the 2 PM batch stays unmarked until they walk into it,
 * so the admin filtering the afternoon slot at 10:30 does NOT see a phantom
 * "Present". Each later visit marks the batch running then ("came twice →
 * 2 marks, counter −2").
 *
 * When the scan lands in NO batch window but some of today's batches were
 * already consumed by earlier visits (repeat walk-in), the visit itself
 * counts as an extra session (see markExtraVisitAttendance).
 *
 * Same marking engine as the roster save, so quota deduction, duplicate
 * guards and audit trails behave identically. Rejections (duplicates, no
 * membership) are swallowed — the visit is still recorded; the register
 * just stays as-is.
 *
 * @returns {{ attendance: object, count: number, slotNames: string[] } | null}
 */
export async function autoMarkSlotAttendance({ gymId, member, actorId, ctx, now = new Date() }) {
  try {
    const tz = ctx.tz ?? "Asia/Kolkata";
    // Weekday (0=Sun…6=Sat) of "now" in the studio timezone.
    const dayKey = ymdInTz(now, tz);
    const [y, m, d] = dayKey.split("-").map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const memberId = member._id ?? member.id ?? member;

    // The student's batches only — no enrollment, no class marks.
    const enrollments = await SlotEnrollment.find({ gymId, memberId, status: "enrolled" }).lean();
    if (enrollments.length === 0) return null;
    const slots = await ClassSlot.find({
      _id: { $in: enrollments.map((e) => e.slotId) },
      gymId,
      isActive: true,
      weekdays: weekday,
    })
      .sort({ startTime: 1 })
      .lean();
    if (slots.length === 0) return null;

    // RUNNING-WINDOW filter — only batches on air (± grace) are candidates.
    const nowMinutes = minutesInTz(now, tz);
    const inWindow = (slot) => {
      const start = slotMinutes(slot.startTime);
      const end = slotMinutes(slot.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      // Linear wrap assumption — dance batches don't run past midnight.
      return nowMinutes >= start - SLOT_WINDOW_BEFORE_MIN && nowMinutes <= end + SLOT_WINDOW_AFTER_MIN;
    };
    const batchSlots = slots.filter(inWindow);

    // The student's preferred slot is marked first so it becomes the
    // "primary" row the front desk sees.
    if (member.preferredSlot) {
      const index = batchSlots.findIndex((slot) => `${slot.startTime}-${slot.endTime}` === member.preferredSlot);
      if (index > 0) batchSlots.unshift(...batchSlots.splice(index, 1));
    }

    const marked = [];
    const slotLabels = [];
    for (const slot of batchSlots) {
      const result = await markSlotAttendance({
        gymId,
        actorId,
        actorRole: "member",
        slotId: slot._id,
        date: dayKey,
        lookup: { memberId: String(memberId) },
        method: "qr",
        attendanceStatus: "present",
        notes: "Auto-marked from the studio QR check-in",
        ctx,
      });
      if (result.status !== "ok") continue; // duplicate / no membership → keep the visit, skip the mark
      marked.push(result);
      slotLabels.push(`${slot.name ?? `${fmt12h(slot.startTime)} – ${fmt12h(slot.endTime)}`}`);
    }

    // Instructors of the marked slots — staff notifications name the teacher
    // handling the class the student just walked into.
    const instructorIds = [...new Set(batchSlots.map((s) => s.instructorId).filter(Boolean).map(String))];
    const instructors = instructorIds.length
      ? await StaffProfile.find({ _id: { $in: instructorIds } }).select("fullName").lean()
      : [];
    const instructorNames = instructors.map((t) => t.fullName).filter(Boolean);

    if (marked.length === 0) {
      // Nothing new got marked — today's batches were already consumed by an
      // earlier visit. This walk-in is an EXTRA session: count it per visit
      // ("student came twice → 2 attendance marks, counter −2 overall").
      const extra = await markExtraVisitAttendance({ gymId, member, actorId, ctx, now, dayKey });
      return extra
        ? {
            attendance: extra.attendance,
            count: 0,
            extraVisit: true,
            visitNo: extra.visitNo,
            slotLabels: [extra.label],
            instructorNames: [],
            quota: extra.quota,
          }
        : null;
    }

    return marked.length > 0
      ? { attendance: marked[0].attendance, count: marked.length, slotLabels, instructorNames }
      : null;
  } catch {
    // Register marking is a bonus — never fail the check-in.
    return null;
  }
}

/**
 * Self check-in guard rails (member-initiated only): the studio must be open,
 * and — when the gym requires it — the phone must be near the front desk.
 * Front-desk check-outs stay free: nobody gets stuck inside.
 */
export function assertSelfCheckinAllowed({ gym, tz, coords = {}, now = new Date() }) {
  // 1) Opening hours — check-ins only while a daily slot is running.
  if (gym.enforceSlotHours !== false && (gym.timeSlots ?? []).length > 0) {
    const nowMinutes = minutesInTz(now, tz);
    const inSlot = gym.timeSlots.some((slot) => {
      const start = toMinutes(slot.start);
      const end = toMinutes(slot.end);
      if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
      // A slot may wrap midnight (e.g. 22:00–02:59).
      return start <= end
        ? nowMinutes >= start && nowMinutes <= end
        : nowMinutes >= start || nowMinutes <= end;
    });
    if (!inSlot) {
      const hours = gym.timeSlots
        .map((slot) => `${fmt12h(slot.start)} – ${fmt12h(slot.end)}`)
        .join(", ");
      throw badRequest(
        `The institute is closed right now. Check-in is allowed during class hours: ${hours}.`,
        "gym_closed",
      );
    }
  }

  // 2) GPS range — on once the gym's location is saved in Manage Institute.
  const gymLat = gym.locationLat;
  const gymLng = gym.locationLng;
  if (gym.enforceLocation && gymLat != null && gymLng != null) {
    const { latitude, longitude, accuracy } = coords;
    if (latitude == null || longitude == null) {
      throw badRequest(
        "Location access is required to check in here — allow location for this site, then scan again.",
        "location_required",
      );
    }
    const radius = gym.locationRadiusM ?? 200;
    const distance = haversineMeters(gymLat, gymLng, latitude, longitude);
    // Small GPS-noise allowance (accuracy capped so a bad fix can't help).
    if (distance > radius + Math.min(accuracy ?? 0, 100)) {
      throw badRequest(
        `You are about ${Math.round(distance)} m from the studio — check-in works within ${radius} m of the front desk.`,
        "too_far",
      );
    }
  }
}

/**
 * Run the standard eligibility / duplicate / cooldown engine for the signed-in
 * member. Returns the raw CheckInResult: `{ status: "ok", attendance, member }`
 * or `{ status: "rejected", reason, message, member? }`.
 */
export async function runMemberSelfCheckIn({ member, actorId, ctx, notes = null }) {
  const now = new Date();
  const result = await runCheckIn({
    gymId: member.gymId,
    actorId,
    lookup: { code: member.memberCode },
    method: "qr",
    notes,
    ctx,
  });
  if (result.status !== "ok") {
    if (result.reason === "expired" || result.reason === "no_membership") {
      await notifyExpiredScan({ gymId: member.gymId, member, at: now });
    }
    return result;
  }
  if (result.warning === "expired") {
    // Accepted because the gym allows expired check-ins — still warn the staff.
    await notifyExpiredScan({ gymId: member.gymId, member, at: now });
  }
  // Best-effort: a studio QR check-in that lands inside one of the student's
  // running slots ALSO marks them present in the class register (Mark/View
  // attendance + shows in history). Never blocks or fails the check-in itself.
  try {
    const auto = await autoMarkSlotAttendance({ gymId: member.gymId, member, actorId, ctx, now });
    if (auto) {
      result.autoMarked = true;
      // N assigned classes today → N register marks, quota −N.
      result.autoMarkedCount = auto.count;
      result.autoMarkedSlot = auto.attendance?.meta?.slotName ?? auto.slotLabels?.[0] ?? null;
      // Full detail for the staff notification (slot + instructor names).
      result.autoMarkedSlotLabels = auto.slotLabels ?? [];
      result.autoMarkedInstructors = auto.instructorNames ?? [];
      // Second+ same-day walk-in → the visit itself is the session.
      if (auto.extraVisit) {
        result.extraVisit = true;
        result.extraVisitNo = auto.visitNo;
        result.extraVisitQuota = auto.quota ?? null;
      }
    }
  } catch {
    // Quota/eligibility issues must never break the check-in the student just made.
  }
  return result;
}

/**
 * Close the member's open visit (the shared QR toggles check-in/out).
 * Returns the closed AttendanceRecord, or null when nothing was open.
 */
export async function closeOpenVisit({ member, actorId, now = new Date() }) {
  const open = await AttendanceRecord.findOne({
    gymId: member.gymId,
    memberId: member._id,
    status: "checked_in",
  })
    .sort({ checkIn: -1 })
    .lean();
  if (!open) return null;

  // Close every open row defensively — stale opens would otherwise make the
  // next scan check out again instead of checking in.
  await AttendanceRecord.updateMany(
    { gymId: member.gymId, memberId: member._id, status: "checked_in" },
    { $set: { checkOut: now, status: "checked_out" } },
  );
  const updated = { ...open, checkOut: now, status: "checked_out" };
  await writeAudit({
    gymId: member.gymId,
    actorId,
    entity: "attendance_records",
    entityId: String(updated._id),
    action: "checkout",
    oldValues: { status: "checked_in", checkOut: null },
    newValues: { status: "checked_out" },
  });
  await notifyIfOverPlanned({ gymId: member.gymId, member, at: now });
  return toAttendance(updated, member, null);
}
