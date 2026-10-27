import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Types } from "mongoose";
import User from "../models/User.js";
import Member from "../models/Member.js";
import MemberMembership from "../models/MemberMembership.js";
import Tag from "../models/Tag.js";
import MembershipPlan from "../models/MembershipPlan.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import AppNotification from "../models/AppNotification.js";
import PaymentRecord from "../models/PaymentRecord.js";
import ClassEnrollment from "../models/ClassEnrollment.js";
import GymClass from "../models/GymClass.js";
import ClassSlot from "../models/ClassSlot.js";
import SlotEnrollment from "../models/SlotEnrollment.js";
import StaffProfile from "../models/StaffProfile.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, forbidden, notFound } from "../lib/errors.js";
import { parseBody } from "../middleware/validate.js";
import {
  toPublicUser,
  toMemberWithMembership,
  toAttendance,
  toPayment,
  toClass,
  toEnrollment,
  toSlotEnrollment,
} from "../lib/serialize.js";
import { currentMembership, membershipBalance } from "../lib/membership.js";
import { loadGymContext } from "../services/context.js";
import { ymdInTz, timeZoneOffsetMs } from "../lib/dates.js";
import { quotaForMembership, syncQuotaNotifications } from "../services/quota.js";
import { writeAudit } from "../lib/audit.js";
import {
  assertGymQrToken,
  assertSelfCheckinAllowed,
  runMemberSelfCheckIn,
} from "../services/gymSelfCheckin.js";

/**
 * Member self-service portal — every route is scoped to the caller's own
 * member record. Staff tokens get 403 here; member tokens get 403 everywhere
 * else (see the block in src/index.js).
 */
const router = Router();

router.use(requireAuth);
router.use((req, _res, next) => {
  if (req.user.role !== "member") {
    return next(forbidden("This endpoint is for student accounts", "member_only"));
  }
  if (!req.user.memberId) return next(notFound("No student profile is linked to this login"));
  next();
});

/** The caller's own member document (tenancy-checked). */
async function loadSelf(req) {
  const member = await Member.findOne({ _id: req.user.memberId, gymId: req.user.gymId }).lean();
  if (!member) throw notFound("Student profile not found");
  return member;
}

/** Their governing membership (started, prefer active, most recent end). */
async function loadSelfMembership(memberId, today) {
  const memberships = await MemberMembership.find({ memberId, startDate: { $lte: today } }).lean();
  memberships.sort(
    (a, b) =>
      (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0) ||
      new Date(b.endDate) - new Date(a.endDate),
  );
  return memberships[0] ?? null;
}

/**
 * GET /api/me → { user, member, gym }
 * `member` carries the portal profile: identity + membership + derived status.
 */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const member = await loadSelf(req);
    const today = new Date();
    const membership = await loadSelfMembership(member._id, today);
    const plan = membership ? await MembershipPlan.findById(membership.planId).lean() : null;
    const user = await User.findById(req.user.id).lean();

    // Billing snapshot for the portal — same formula as staff dues (getDuesRows).
    let billing = null;
    if (membership) {
      const payments = await PaymentRecord.find({
        gymId: req.user.gymId,
        membershipId: membership._id,
        status: { $in: ["paid", "partial"] },
      }).select("amount status").lean();
      const paid = Math.round(payments.reduce((sum, p) => sum + (p.amount ?? 0), 0) * 100) / 100;
      billing = {
        billed: Math.max(0, (membership.price ?? 0) - (membership.discount ?? 0)),
        paid,
        balance: membershipBalance(membership.price, membership.discount, payments),
      };
    }

    const memberJson = toMemberWithMembership(member, membership, plan, {
      now: ctx.now,
      tz: ctx.tz,
      expiringSoonDays: ctx.expiringSoonDays,
    });
    if (memberJson?.membership && billing) Object.assign(memberJson.membership, billing);

    // Student labels (dance styles, batches, events…) for the portal profile.
    if (memberJson) {
      const tagDocs = member.tagIds?.length
        ? await Tag.find({ gymId: req.user.gymId, _id: { $in: member.tagIds } }).lean()
        : [];
      memberJson.tags = tagDocs.map((t) => ({ name: t.name, color: t.color }));
    }

    // Class-quota snapshot + reminder sync — opening the portal re-arms the
    // "2 classes left" / "1 class left" / "Expired" notifications on login.
    let quota = null;
    if (membership) {
      quota = await quotaForMembership(membership);
      await syncQuotaNotifications({ gymId: req.user.gymId, member, membership });
      if (memberJson) memberJson.quota = quota;
    }

    res.json({
      user: toPublicUser(user),
      member: memberJson,
      gym: { name: ctx.gym.name, timezone: ctx.tz, themeMode: ctx.gym.themeMode ?? "light", themeAccent: ctx.gym.themeAccent ?? "burgundy" },
    });
  }),
);

/** GET /api/me/qr → { token, status } — the member's own check-in QR. */
router.get(
  "/qr",
  asyncHandler(async (req, res) => {
    const member = await loadSelf(req);
    res.json({ token: member.qrToken, status: member.qrStatus });
  }),
);

const gymCheckinSchema = z.object({
  token: z.string().min(1, "The studio QR token is required"),
  /** Optional GPS fix (browser Geolocation API) — required when the gym enforces range. */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).optional(),
});

/**
 * POST /api/me/checkin-gym { token, lat?, lng? } → { status, message, attendance?, member? }
 *
 * Scan-the-wall-QR flow: the studio's shared QR opens the login page; once the
 * student is signed in, the app calls this to mark their attendance. Check-in
 * ONLY (never checks out) and the same eligibility / duplicate / cooldown rules
 * apply as a normal scan. The token must be the STUDIO's shared QR — a member's
 * personal QR never passes here.
 */
router.post(
  "/checkin-gym",
  asyncHandler(async (req, res) => {
    const input = parseBody(gymCheckinSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const member = await loadSelf(req);

    assertGymQrToken(ctx.gym, input.token);
    assertSelfCheckinAllowed({
      gym: ctx.gym,
      tz: ctx.tz,
      coords: {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
      },
    });

    const result = await runMemberSelfCheckIn({
      member,
      actorId: req.user.id,
      ctx,
      notes: "Self check-in from the studio QR link",
    });

    // Rejections (expired / cooldown / duplicate …) are normal outcomes, not
    // errors — return 200 with a status the login screen can show.
    if (result.status !== "ok") {
      return res.json({
        status: "rejected",
        reason: result.reason,
        message: result.message,
        member: result.member ?? null,
      });
    }
    // Notify admin/front-desk/teachers that a member arrived via the studio QR.
    // The auto-marked slots detail tells the teacher of the class the student
    // walked into exactly which batch(es) the student attends today.
    try {
      const slotsInfo = result.extraVisit
        ? ` — extra session for today (visit #${result.extraVisitNo}); the counter runs per visit.`
        : result.autoMarked
          ? ` — ${result.autoMarkedSlotLabels?.join(", ") ?? result.autoMarkedSlot ?? "attendance marked"} (${result.autoMarkedInstructors?.length ? `Instructor: ${result.autoMarkedInstructors.join(", ")}. ` : ""}${result.autoMarkedCount} ${result.autoMarkedCount === 1 ? "class" : "classes"} marked today)`
          : "";
      await AppNotification.create({
        gymId: req.user.gymId,
        userId: null,
        memberId: member._id,
        type: "checkin_success",
        title: result.extraVisit
          ? `Student arrived again — extra session (visit #${result.extraVisitNo})`
          : result.autoMarked && result.autoMarkedCount > 1
            ? `Student arrived — ${result.autoMarkedCount} classes`
            : "Student checked in",
        body: `${member.fullName} (${member.memberCode}) checked in via the studio QR.${slotsInfo}`,
        severity: "success",
        isRead: false,
        dedupeKey: null,
        link: `/members/${member._id}`,
      });
    } catch (err) {
      // Best effort — never fail the check-in because of a notification write.
    }

    res.json({
      status: "ok",
      message: result.extraVisit
        ? `Checked in — extra session counted (visit #${result.extraVisitNo} today)!`
        : result.autoMarked
          ? (result.autoMarkedCount > 1
            ? `Checked in — ${result.autoMarkedCount} classes marked!`
            : "Checked in — your attendance is marked!")
          : "Checked in — your timer has started!",
      attendance: result.attendance,
      member: result.member ?? null,
      warning: result.warning ?? null,
      ...(result.autoMarked
        ? { autoMarked: true, autoMarkedCount: result.autoMarkedCount, autoMarkedSlot: result.autoMarkedSlot }
        : {}),
    });
  }),
);

/** GET /api/me/attendance?limit=30 → own visits, newest first. */
router.get(
  "/attendance",
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const member = await loadSelf(req);
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 200);
    const rows = await AttendanceRecord.find({ gymId: req.user.gymId, memberId: member._id })
      .sort({ checkIn: -1 })
      .limit(limit)
      .lean();
    res.json(rows.map((row) => toAttendance(row, member, null)));
  }),
);

/** GET /api/me/payments → own payment history, newest first. */
router.get(
  "/payments",
  asyncHandler(async (req, res) => {
    const member = await loadSelf(req);
    const rows = await PaymentRecord.find({ gymId: req.user.gymId, memberId: member._id })
      .sort({ paymentDate: -1, createdAt: -1 })
      .limit(200)
      .lean();

    // Join membership/plan for the payment summary line.
    const memberships = await MemberMembership.find({ memberId: member._id }).lean();
    const byId = new Map(memberships.map((m) => [String(m._id), m]));
    const planIds = [...new Set(memberships.map((m) => String(m.planId)))];
    const plans = await MembershipPlan.find({ _id: { $in: planIds } }).lean();
    const planById = new Map(plans.map((p) => [String(p._id), p]));

    res.json(
      rows.map((row) => {
        const membership = row.membershipId ? byId.get(String(row.membershipId)) : null;
        const plan = membership ? planById.get(String(membership.planId)) : null;
        return toPayment(row, member, membership, plan);
      }),
    );
  }),
);

/** GET /api/me/classes → own enrollments joined with the class schedule. */
router.get(
  "/classes",
  asyncHandler(async (req, res) => {
    const member = await loadSelf(req);
    const ctx = await loadGymContext(req.user.gymId);
    const tz = ctx.tz ?? "Asia/Kolkata";

    const enrollments = await ClassEnrollment.find({
      gymId: req.user.gymId,
      memberId: member._id,
      status: { $ne: "cancelled" },
    }).lean();

    const classes = await GymClass.find({ _id: { $in: enrollments.map((e) => e.classId) } }).lean();
    const classById = new Map(classes.map((c) => [String(c._id), c]));

    /* ---------------- recurring slots (the institute's core schedule) ------------- */
    const slotEnrollments = await SlotEnrollment.find({
      gymId: req.user.gymId,
      memberId: member._id,
      status: "enrolled",
    }).lean();
    const slots = slotEnrollments.length
      ? await ClassSlot.find({ _id: { $in: slotEnrollments.map((e) => e.slotId) }, isActive: true }).lean()
      : [];
    const slotById = new Map(slots.map((s) => [String(s._id), s]));

    // Roster size per slot — so the ticket's "x/y booked" bar reads correctly.
    // NB: aggregate() does not auto-cast strings to ObjectId (find() does), so
    // both ids are cast explicitly here.
    const rosterCounts = slots.length
      ? await SlotEnrollment.aggregate([
          {
            $match: {
              gymId: new Types.ObjectId(String(req.user.gymId)),
              slotId: { $in: slots.map((s) => s._id) },
              status: "enrolled",
            },
          },
          { $group: { _id: "$slotId", count: { $sum: 1 } } },
        ])
      : [];
    const rosterBySlot = new Map(rosterCounts.map((c) => [String(c._id), c.count]));

    const instructorIds = [...new Set(slots.map((s) => s.instructorId).filter(Boolean).map(String))];
    const trainerIds = [
      ...new Set(classes.map((c) => c.trainerId).filter(Boolean).map(String)),
      ...instructorIds,
    ];
    const trainers = trainerIds.length
      ? await StaffProfile.find({ _id: { $in: trainerIds } }).lean()
      : [];
    const trainerById = new Map(trainers.map((t) => [String(t._id), t]));

    const oneOff = enrollments
      .map((enrollment) => {
        const cls = classById.get(String(enrollment.classId));
        if (!cls) return null;
        return {
          enrollment: toEnrollment(enrollment, member),
          class: toClass(
            cls,
            cls.trainerId ? trainerById.get(String(cls.trainerId)) : null,
            null,
          ),
        };
      })
      .filter(Boolean);

    const recurring = slotEnrollments
      .map((enrollment) => {
        const slot = slotById.get(String(enrollment.slotId));
        if (!slot) return null;
        const next = nextOccurrence(slot, tz);
        const instructor = slot.instructorId
          ? trainerById.get(String(slot.instructorId))
          : null;
        return {
          enrollment: {
            ...toSlotEnrollment(enrollment, member),
            // Reused by the portal badge — mirrors ClassEnrollment's statuses.
            status: "enrolled",
          },
          class: {
            id: slot._id.toString(),
            gymId: String(slot.gymId),
            name: slot.name,
            description: slot.description ?? null,
            trainerId: slot.instructorId ? String(slot.instructorId) : null,
            // Next run of this recurring batch, so it sorts/filters as upcoming.
            startsAt: next ? next.toISOString() : null,
            durationMinutes: slotDurationMinutes(slot),
            capacity: slot.capacity ?? null,
            status: "scheduled",
            kind: "recurring",
            weekdays: slot.weekdays ?? [],
            startTime: slot.startTime,
            endTime: slot.endTime,
            createdAt: slot.createdAt?.toISOString?.() ?? null,
            updatedAt: slot.updatedAt?.toISOString?.() ?? null,
            trainerName: instructor?.fullName ?? null,
            enrolledCount: rosterBySlot.get(String(slot._id)) ?? 0,
          },
        };
      })
      .filter(Boolean);

    res.json(
      [...oneOff, ...recurring].sort(
        (a, b) => new Date(a.class.startsAt ?? 0) - new Date(b.class.startsAt ?? 0),
      ),
    );
  }),
);

/** Minutes from startTime to endTime (handles an end past midnight). */
function slotDurationMinutes(slot) {
  const parse = (v) => {
    const [h, m] = String(v ?? "").split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
  };
  const start = parse(slot.startTime);
  let end = parse(slot.endTime);
  if (end <= start) end += 24 * 60;
  return end - start;
}

/**
 * The next time this recurring slot actually runs — today if it is still to
 * come, otherwise the next matching weekday. Returns null if it never runs
 * again (no weekdays).
 */
function nextOccurrence(slot, tz) {
  const weekdays = (slot.weekdays ?? []).map(Number);
  if (weekdays.length === 0) return null;
  const [sh, sm] = String(slot.startTime ?? "00:00").split(":").map(Number);
  const now = new Date();
  for (let offset = 0; offset <= 7; offset += 1) {
    const probe = new Date(now.getTime() + offset * 86_400_000);
    const ymd = ymdInTz(probe, tz);
    // Weekday of that calendar day (read off the UTC date-only value).
    const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    if (!weekdays.includes(weekday)) continue;
    // Instant of `ymd` at HH:mm in the gym timezone.
    const naive = Date.parse(`${ymd}T${String(sh).padStart(2, "0")}:${String(sm).padStart(2, "0")}:00.000Z`);
    const instant = new Date(naive - timeZoneOffsetMs(new Date(naive), tz));
    if (instant.getTime() > now.getTime()) return instant;
  }
  // Fall back to the first matching day within the next 7 days.
  return null;
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
});

/** POST /api/me/password { currentPassword, newPassword } → 204 */
router.post(
  "/password",
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parseBody(passwordSchema, req.body);
    const user = await User.findById(req.user.id);
    if (!user) throw notFound("Account not found");

    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) throw forbidden("Current password is incorrect", "wrong_password");

    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await user.save();
    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "users",
      entityId: String(user._id),
      action: "update",
      newValues: { passwordChanged: true },
    });
    res.status(204).end();
  }),
);

/* ------------------------------------------------------------------ */
/*  Reminders (planned-hours nudges addressed to this member)          */
/* ------------------------------------------------------------------ */

/** GET /api/me/reminders → [{ id, title, body, severity, createdAt }] (unread) */
router.get(
  "/reminders",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).lean();
    if (!user?.memberId) return res.json([]);
    const rows = await AppNotification.find({
      gymId: req.user.gymId,
      memberId: user.memberId,
      isRead: false,
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    res.json(
      rows.map((n) => ({
        id: String(n._id),
        title: n.title,
        body: n.body,
        severity: n.severity,
        createdAt: n.createdAt,
      })),
    );
  }),
);

/** POST /api/me/reminders/read → { ok: true } (clears this member's reminders) */
router.post(
  "/reminders/read",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).lean();
    if (user?.memberId) {
      await AppNotification.updateMany(
        { gymId: req.user.gymId, memberId: user.memberId, isRead: false },
        { $set: { isRead: true } },
      );
    }
    res.json({ ok: true });
  }),
);

/** POST /api/me/reminders/:id/read → { ok: true } (marks one reminder read) */
router.post(
  "/reminders/:id/read",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).lean();
    if (!user?.memberId) throw notFound("Reminder not found");
    const row = await AppNotification.findOneAndUpdate(
      { _id: req.params.id, gymId: req.user.gymId, memberId: user.memberId, isRead: false },
      { $set: { isRead: true } },
      { new: true },
    ).lean();
    if (!row) throw notFound("Reminder not found");
    res.json({ ok: true });
  }),
);

export default router;
