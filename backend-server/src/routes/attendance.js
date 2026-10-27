import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import AttendanceRecord from "../models/AttendanceRecord.js";
import AppNotification from "../models/AppNotification.js";
import Member from "../models/Member.js";
import MemberMembership from "../models/MemberMembership.js";
import MembershipPlan from "../models/MembershipPlan.js";
import User from "../models/User.js";
import ClassSlot from "../models/ClassSlot.js";
import SlotEnrollment from "../models/SlotEnrollment.js";
import StaffProfile from "../models/StaffProfile.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler, badRequest, notFound, forbidden } from "../lib/errors.js";
import { parseBody, intParam } from "../middleware/validate.js";
import { toAttendance, toClassSlot } from "../lib/serialize.js";
import { computeQuota } from "../lib/quota.js";
import { currentMembership, daysRemaining } from "../lib/membership.js";
import PaymentRecord from "../models/PaymentRecord.js";
import { parseQrPayload } from "../lib/qr.js";
import { writeAudit } from "../lib/audit.js";
import {
  startOfDayInTz,
  addDays,
  hourInTz,
  hourLabel,
  parseDateOnly,
  ymdInTz,
} from "../lib/dates.js";
import { loadGymContext } from "../services/context.js";
import { runCheckIn } from "../services/checkin.js";
import { markSlotAttendance, markDemoAttendance, markRosterAttendance } from "../services/classAttendance.js";
import { notifyIfOverPlanned } from "../services/overtime.js";
import {
  assertGymQrToken,
  assertSelfCheckinAllowed,
  runMemberSelfCheckIn,
  closeOpenVisit,
} from "../services/gymSelfCheckin.js";


const router = Router();

const scanMethod = z.enum(["qr", "manual", "class"]);

const checkinTokenSchema = z.object({
  token: z.string().min(1, "QR token is required"),
  method: scanMethod.optional(),
  notes: z.string().nullish(),
});

const checkinCodeSchema = z.object({
  code: z.string().min(1, "Student code is required"),
  method: scanMethod.optional(),
  notes: z.string().nullish(),
});

const correctionSchema = z.object({
  checkIn: z.string().optional(),
  checkOut: z.string().nullish(),
  notes: z.string().nullish(),
});

const checkoutSchema = z.object({}).optional();

/* ------------------------------------------------------------------ */
/*  Check-in (always HTTP 200; body carries ok/rejected)               */
/* ------------------------------------------------------------------ */

/** POST /api/attendance/checkin { token, method?, notes? } → CheckInResult */
router.post(
  "/attendance/checkin",
  requireAuth,
  requireCap("qr.scan"),
  asyncHandler(async (req, res) => {
    const input = parseBody(checkinTokenSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    // Tolerate both the bare token and the "PGS1:<token>" payload.
    const token = parseQrPayload(input.token) ?? String(input.token).trim();
    const result = await runCheckIn({
      gymId: ctx.gym._id,
      actorId: req.user.id,
      lookup: { token },
      method: input.method ?? "qr",
      notes: input.notes ?? null,
      ctx,
    });
    res.json(result);
  }),
);

/** POST /api/attendance/checkin-code { code, method?, notes? } → CheckInResult */
router.post(
  "/attendance/checkin-code",
  requireAuth,
  requireCap("qr.scan"),
  asyncHandler(async (req, res) => {
    const input = parseBody(checkinCodeSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const result = await runCheckIn({
      gymId: ctx.gym._id,
      actorId: req.user.id,
      lookup: { code: input.code },
      method: input.method ?? "qr",
      notes: input.notes ?? null,
      ctx,
    });
    res.json(result);
  }),
);


/* ------------------------------------------------------------------ */
/*  Class-slot attendance (instructor / front-desk marking)            */
/* ------------------------------------------------------------------ */

const classMarkSchema = z.object({
  slotId: z.string().min(1, "Pick a class slot"),
  /** Session date "YYYY-MM-DD"; defaults to today in the studio timezone. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullish(),
  /** Mark by Student record id (roster tap) XOR by Student ID code (manual). */
  memberId: z.string().nullish(),
  code: z.string().nullish(),
  method: scanMethod.optional(),
  notes: z.string().nullish(),
});

/**
 * GET /api/attendance/class-roster?slotId&date → the instructor's
 * mark-attendance sheet: enrolled students + who is already marked today.
 */
router.get(
  "/attendance/class-roster",
  requireAuth,
  requireCap("attendance.view"),
  asyncHandler(async (req, res) => {
    const { slotId, date } = parseBody(classMarkSchema.pick({ slotId: true, date: true }), {
      slotId: req.query.slotId,
      date: req.query.date,
    });
    const ctx = await loadGymContext(req.user.gymId);
    const slot = await ClassSlot.findOne({ _id: slotId, gymId: req.user.gymId }).lean();
    if (!slot) throw notFound("That class slot no longer exists.");

    // Instructors may only open their own slots.
    if (req.user.role === "trainer") {
      const profile = await StaffProfile.findOne({ gymId: req.user.gymId, profileId: req.user.id }).lean();
      if (String(slot.instructorId ?? "") !== String(profile?._id ?? "")) {
        throw forbidden("You are not the instructor for this slot");
      }
    }

    const sessionDate = parseDateOnly(date || ymdInTz(new Date(), ctx.tz));
    const dayKey = ymdInTz(sessionDate, ctx.tz);
    const weekday = new Date(`${dayKey}T00:00:00Z`).getUTCDay();

    // The roster sheet lists EVERY student in the studio (not just the ones
    // enrolled in this slot) so the front desk can mark a walk-in without
    // leaving the page. `enrolled` flags who belongs to this batch.
    const enrollments = await SlotEnrollment.find({ slotId: slot._id, status: "enrolled" })
      .sort({ enrolledAt: 1 })
      .lean();
    const enrolledIds = new Set(enrollments.map((e) => String(e.memberId)));
    const [allMembers, marked, assignedTrainers] = await Promise.all([
      Member.find({ gymId: req.user.gymId, status: "active" })
        .sort({ fullName: 1 })
        .lean(),
      AttendanceRecord.find({ gymId: req.user.gymId, classSlotId: slot._id, sessionDate })
        .select("memberId attendanceStatus")
        .lean(),
      // Assigned trainer per student (staff those students belong to).
      StaffProfile.find({ gymId: req.user.gymId }).select("fullName").lean(),
    ]);
    const trainerNameById = new Map(assignedTrainers.map((t) => [String(t._id), t.fullName ?? null]));
    // Enrolled first (roster order), then everyone else alphabetically.
    const members = [
      ...allMembers.filter((m) => enrolledIds.has(String(m._id))),
      ...allMembers.filter((m) => !enrolledIds.has(String(m._id))),
    ];
    const memberIds = members.map((m) => m._id);
    // statusByMember: current attendanceStatus for this slot+date (if already marked).
    const statusByMember = new Map(
      marked.map((a) => [String(a.memberId), a.attendanceStatus ?? "present"]),
    );
    const isSlotDay = Array.isArray(slot.weekdays) && slot.weekdays.some((d) => Number(d) === weekday);

    // Quota + last payment method per student (marking-sheet columns), plus the
    // batches each student actually belongs to — the sheet lists EVERY studio
    // member, so a row need not belong to the slot being marked.
    const [memberships, slotEnrollments] = await Promise.all([
      memberIds.length
        ? MemberMembership.find({ memberId: { $in: memberIds }, startDate: { $lte: sessionDate } })
            .sort({ startDate: -1 })
            .lean()
        : [],
      memberIds.length
        ? SlotEnrollment.find({ gymId: req.user.gymId, memberId: { $in: memberIds }, status: "enrolled" })
            .select("memberId slotId")
            .lean()
        : [],
    ]);
    const enrolledSlotIdsByMember = new Map();
    for (const e of slotEnrollments) {
      const key = String(e.memberId);
      const list = enrolledSlotIdsByMember.get(key) ?? [];
      const id = String(e.slotId);
      if (!list.includes(id)) list.push(id);
      enrolledSlotIdsByMember.set(key, list);
    }
    /** A student's batch ids, with the slot being marked listed first. */
    const slotIdsFor = (memberId) => {
      const ids = enrolledSlotIdsByMember.get(String(memberId)) ?? [];
      const current = String(slot._id);
      return ids.includes(current) ? [current, ...ids.filter((v) => v !== current)] : ids;
    };
    /* Backfill — students created before auto-enrolment whose preferred slot
       matches this batch get enrolled on read, so they show up immediately. */
    const prefEnrollments = members
      .filter((m) => !enrolledIds.has(String(m._id)) && m.preferredSlot === `${slot.startTime}-${slot.endTime}`)
      .map((m) => ({ gymId: req.user.gymId, slotId: slot._id, memberId: m._id, status: "enrolled" }));
    if (prefEnrollments.length > 0) {
      await SlotEnrollment.insertMany(prefEnrollments, { ordered: false }).catch(() => undefined);
      for (const e of prefEnrollments) {
        enrolledIds.add(String(e.memberId));
        const key = String(e.memberId);
        const list = enrolledSlotIdsByMember.get(key) ?? [];
        if (!list.includes(String(slot._id))) list.push(String(slot._id));
        enrolledSlotIdsByMember.set(key, list);
      }
    }
    const membershipsByMember = new Map();
    for (const m of memberships) {
      const key = String(m.memberId);
      if (!membershipsByMember.has(key)) membershipsByMember.set(key, []);
      membershipsByMember.get(key).push(m);
    }
    const currentByMember = new Map();
    for (const [key, list] of membershipsByMember) currentByMember.set(key, currentMembership(list) ?? null);
    const currentIds = [...currentByMember.values()].filter(Boolean).map((m) => m._id);
    const [attendedCounts, lastPayments] = await Promise.all([
      currentIds.length
        ? AttendanceRecord.aggregate([
            { $match: { membershipId: { $in: currentIds }, quotaCounted: true } },
            { $group: { _id: "$membershipId", attended: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
      memberIds.length
        ? PaymentRecord.aggregate([
            { $match: { memberId: { $in: memberIds } } },
            { $sort: { paymentDate: -1, _id: -1 } },
            { $group: { _id: "$memberId", method: { $first: "$method" } } },
          ])
        : Promise.resolve([]),
    ]);
    const attendedByMembership = new Map(attendedCounts.map((c) => [String(c._id), c.attended]));
    const methodByMember = new Map(lastPayments.map((p) => [String(p._id), p.method]));
    const quotaForMember = (memberId) => {
      const membership = currentByMember.get(String(memberId));
      if (!membership || membership.classQuota == null) return null;
      const attended = attendedByMembership.get(String(membership._id)) ?? 0;
      const q = computeQuota({ quota: membership.classQuota, attended });
      return {
        quota: q.quota,
        attended: q.attended,
        remaining: q.remaining,
        exceeded: q.exceeded,
        status: q.status,
      };
    };

    res.json({
      // Distinct member ids so the caller can also count unique students.
      slot: toClassSlot(slot, null, enrollments.length, [...new Set(enrollments.map((e) => String(e.memberId)))]),
      date: dayKey,
      isSlotDay,
      students: members.map((m) => ({
        memberId: String(m._id),
        memberCode: m.memberCode ?? null,
        fullName: m.fullName ?? "Student",
        photoUrl: m.photoUrl ?? null,
        status: m.status,
        trainerId: m.trainerId ? String(m.trainerId) : null,
        trainerName: m.trainerId ? (trainerNameById.get(String(m.trainerId)) ?? null) : null,
        enrolled: enrolledIds.has(String(m._id)),
        enrolledSlotIds: slotIdsFor(m._id),
        preferredSlot: m.preferredSlot ?? null,
        marked: statusByMember.has(String(m._id)),
        attendanceStatus: statusByMember.get(String(m._id)) ?? null,
        quota: quotaForMember(m._id),
        paymentMethod: methodByMember.get(String(m._id)) ?? null,
      })),
    });
  }),
);

/** POST /api/attendance/class-mark — mark one student's attendance for a slot session. */
router.post(
  "/attendance/class-mark",
  requireAuth,
  requireCap("attendance.mark"),
  asyncHandler(async (req, res) => {
    const input = parseBody(classMarkSchema, req.body);
    if (!input.memberId && !String(input.code ?? "").trim()) {
      throw badRequest("Enter a Student ID or pick a student to mark attendance", "student_required");
    }
    const ctx = await loadGymContext(req.user.gymId);
    const result = await markSlotAttendance({
      gymId: req.user.gymId,
      actorId: req.user.id,
      actorRole: req.user.role,
      slotId: input.slotId,
      date: input.date ?? null,
      lookup: input.memberId ? { memberId: input.memberId } : { code: input.code },
      method: input.method ?? "class",
      notes: input.notes ?? null,
      ctx,
    });
    res.json(result);
  }),
);

/** POST /api/attendance/demo-mark — mark a demo-class attendance (never counts against quota). */
router.post(
  "/attendance/demo-mark",
  requireAuth,
  requireCap("attendance.mark"),
  asyncHandler(async (req, res) => {
    const input = parseBody(classMarkSchema, req.body);
    if (!input.memberId && !String(input.code ?? "").trim()) {
      throw badRequest("Enter a Student ID or pick a student to mark attendance", "student_required");
    }
    const ctx = await loadGymContext(req.user.gymId);
    const result = await markDemoAttendance({
      gymId: req.user.gymId,
      actorId: req.user.id,
      actorRole: req.user.role,
      classId: input.slotId,
      lookup: input.memberId ? { memberId: input.memberId } : { code: input.code },
      method: input.method ?? "class",
      notes: input.notes ?? null,
      ctx,
    });
    res.json(result);
  }),
);

const rosterMarkSchema = z.object({
  slotId: z.string().min(1, "Pick a class slot"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullish(),
  marks: z
    .array(
      z.object({
        memberId: z.string().min(1),
        status: z.enum(["present", "late", "absent", "leave", "holiday"]),
      }),
    )
    .min(1, "Mark at least one student"),
});

/** POST /api/attendance/class-roster-mark — set each roster student's status for a slot session. */
router.post(
  "/attendance/class-roster-mark",
  requireAuth,
  requireCap("attendance.mark"),
  asyncHandler(async (req, res) => {
    const input = parseBody(rosterMarkSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const result = await markRosterAttendance({
      gymId: req.user.gymId,
      actorId: req.user.id,
      actorRole: req.user.role,
      slotId: input.slotId,
      date: input.date ?? null,
      marks: input.marks,
      ctx,
    });
    res.json(result);
  }),
);

const gymScanSchema = z.object({
  token: z.string().min(8, "That does not look like the studio's QR code"),
  /** Optional GPS fix (browser Geolocation API) — required when the gym enforces range. */
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  accuracy: z.number().min(0).optional(),
});

/**
 * POST /api/attendance/gym-scan { token } → { action, message, attendance }
 *
 * The member scans the ONE shared front-desk gym QR from their portal:
 * first scan checks them in (timer starts), the next checks them out.
 */
router.post(
  "/attendance/gym-scan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(gymScanSchema, req.body);
    const user = await User.findById(req.user.id).lean();
    if (!user?.memberId) {
      throw forbidden("Only student accounts can scan the front-desk QR code");
    }
    const ctx = await loadGymContext(req.user.gymId);
    const member = await Member.findOne({ _id: user.memberId, gymId: req.user.gymId }).lean();
    if (!member) throw notFound("Student not found");

    // Must be the GYM's shared token — never another member's personal QR.
    assertGymQrToken(ctx.gym, input.token);

    // Already inside → this same scan checks them out.
    const closed = await closeOpenVisit({ member, actorId: req.user.id });
    if (closed) {
      return res.json({
        action: "check_out",
        message: "Checked out — see you next time!",
        attendance: closed,
      });
    }

    // Member-initiated check-in → opening hours + GPS guard rails apply.
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
      notes: "Scanned the front-desk QR from the student portal",
    });
    if (result.status !== "ok") throw badRequest(result.message, result.reason);
    res.json({
      action: "check_in",
      message: result.extraVisit
        ? `Checked in — extra session counted (visit #${result.extraVisitNo} today)!`
        : result.autoMarked
          ? (result.autoMarkedCount > 1
            ? `Checked in — ${result.autoMarkedCount} classes marked!`
            : "Checked in — your attendance is marked!")
          : "Checked in — your timer has started!",
      attendance: result.attendance,
      warning: result.warning ?? null,
      ...(result.autoMarked
        ? { autoMarked: true, autoMarkedCount: result.autoMarkedCount, autoMarkedSlot: result.autoMarkedSlot }
        : {}),
    });
  }),
);

/** POST /api/attendance/:id/checkout → AttendanceRecord */
router.post(
  "/attendance/:id/checkout",
  requireAuth,
  requireCap("attendance.correct"),
  asyncHandler(async (req, res) => {
    parseBody(checkoutSchema, req.body);
    const record = await AttendanceRecord.findOne({
      _id: req.params.id,
      gymId: req.user.gymId,
    }).lean();
    if (!record) throw notFound("Attendance record not found");
    if (record.status === "checked_out") {
      throw badRequest("This student has already checked out", "already_checked_out");
    }

    const updated = await AttendanceRecord.findOneAndUpdate(
      { _id: record._id },
      { $set: { checkOut: new Date(), status: "checked_out" } },
      { new: true },
    ).lean();

    const member = await Member.findById(updated.memberId).lean();
    const scanner = updated.scannerId ? await User.findById(updated.scannerId).lean() : null;

    await writeAudit({
      gymId: record.gymId,
      actorId: req.user.id,
      entity: "attendance_records",
      entityId: String(record._id),
      action: "checkout",
      oldValues: { status: record.status, checkOut: null },
      newValues: { status: "checked_out" },
    });

    // Planned-hours overage: remind the member in-app, at most once per day.
    await notifyIfOverPlanned({ gymId: record.gymId, member, at: updated.checkOut ?? new Date() });

    res.json(toAttendance(updated, member, scanner));
  }),
);

/* ------------------------------------------------------------------ */
/*  Listing + reports                                                  */
/* ------------------------------------------------------------------ */

/** GET /api/attendance?from&to&memberId&status&page&pageSize → Paginated<AttendanceRecord> */
router.get(
  "/attendance",
  requireAuth,
  requireCap("attendance.view"),
  asyncHandler(async (req, res) => {
    const gymId = req.user.gymId;
    const filter = { gymId };
    // Date-only bounds need explicit handling: new Date("2026-10-22") is UTC
    // midnight, which silently drops the whole "to" day (22 Oct visits land
    // after 00:00 UTC). Date-only `to` spans the full day instead.
    const fromRaw = req.query.from ? String(req.query.from) : null;
    const toRaw = req.query.to ? String(req.query.to) : null;
    if (fromRaw || toRaw) {
      filter.checkIn = {};
      if (fromRaw) {
        filter.checkIn.$gte = /^\d{4}-\d{2}-\d{2}$/.test(fromRaw)
          ? new Date(`${fromRaw}T00:00:00.000Z`)
          : new Date(fromRaw);
      }
      if (toRaw) {
        filter.checkIn.$lte = /^\d{4}-\d{2}-\d{2}$/.test(toRaw)
          ? new Date(`${toRaw}T23:59:59.999Z`)
          : new Date(toRaw);
      }
    }
    if (req.query.memberId && Types.ObjectId.isValid(String(req.query.memberId))) {
      filter.memberId = req.query.memberId;
    }
    if (req.query.status === "checked_in" || req.query.status === "checked_out") {
      filter.status = req.query.status;
    }

    const page = intParam(req.query.page, 1);
    const pageSize = intParam(req.query.pageSize, 15, { min: 5, max: 100 });
    const [total, rows] = await Promise.all([
      AttendanceRecord.countDocuments(filter),
      AttendanceRecord.find(filter)
        .sort({ checkIn: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const ctx = await loadGymContext(gymId);
    const memberIds = [...new Set(rows.map((r) => String(r.memberId)))];
    const scannerIds = [...new Set(rows.map((r) => r.scannerId).filter(Boolean).map(String))];
    const membershipIds = [...new Set(rows.map((r) => String(r.membershipId)).filter((v) => v && v !== "null" && v !== "undefined"))];
    /* Class-slot ids carried by these rows — including the `meta.slotId` fallback,
       so records written before `classSlotId` existed still resolve their time. */
    const slotIds = [
      ...new Set(
        rows
          .flatMap((r) => [r.classSlotId, r.meta?.slotId])
          .filter((v) => v && v !== "null" && v !== "undefined")
          .filter((v) => Types.ObjectId.isValid(v))
          .map((v) => new Types.ObjectId(v)),
      ),
    ];
    const [members, scanners, memberships, plans, classSlots] = await Promise.all([
      memberIds.length ? Member.find({ _id: { $in: memberIds } }).lean() : [],
      scannerIds.length ? User.find({ _id: { $in: scannerIds } }).select("fullName").lean() : [],
      membershipIds.length
        ? MemberMembership.find({ _id: { $in: membershipIds } }).select("planId classQuota startDate endDate status memberId").lean()
        : [],
      MembershipPlan.find({ gymId }).select("name").lean(),
      slotIds.length ? ClassSlot.find({ _id: { $in: slotIds } }).select("name startTime endTime").lean() : [],
    ]);
    const memberById = new Map(members.map((m) => [String(m._id), m]));
    const scannerById = new Map(scanners.map((s) => [String(s._id), s]));
    const planById = new Map(plans.map((p) => [String(p._id), p.name]));
    const membershipById = new Map(memberships.map((m) => [String(m._id), m]));
    const slotById = new Map(classSlots.map((s) => [String(s._id), s]));
    const planNameByMembership = new Map(memberships.map((m) => [String(m._id), planById.get(String(m.planId)) ?? null]));

    // Paid-class quota + latest payment method per row (view-register columns).
    const validMembershipIds = membershipIds.filter((v) => Types.ObjectId.isValid(v)).map((v) => new Types.ObjectId(v));
    const validMemberIds = memberIds.filter((v) => Types.ObjectId.isValid(v)).map((v) => new Types.ObjectId(v));
    /** Row → its ClassSlot (matched on `classSlotId`, then the legacy `meta.slotId`). */
    const slotFor = (row) =>
      slotById.get(String(row.classSlotId ?? "")) ?? slotById.get(String(row.meta?.slotId ?? "")) ?? null;
    const [attendedCounts, lastPayments] = await Promise.all([
      validMembershipIds.length
        ? AttendanceRecord.aggregate([
            { $match: { membershipId: { $in: validMembershipIds }, quotaCounted: true } },
            { $group: { _id: "$membershipId", attended: { $sum: 1 } } },
          ])
        : Promise.resolve([]),
      validMemberIds.length
        ? PaymentRecord.aggregate([
            { $match: { memberId: { $in: validMemberIds } } },
            { $sort: { paymentDate: -1, _id: -1 } },
            { $group: { _id: "$memberId", method: { $first: "$method" } } },
          ])
        : Promise.resolve([]),
    ]);
    const attendedByMembership = new Map(attendedCounts.map((c) => [String(c._id), c.attended]));
    const methodByMember = new Map(lastPayments.map((p) => [String(p._id), p.method]));

    res.json({
      items: rows.map((row) => {
        const membership = membershipById.get(String(row.membershipId)) ?? null;
        const quota =
          membership?.classQuota != null
            ? computeQuota({
                quota: membership.classQuota,
                attended: attendedByMembership.get(String(row.membershipId)) ?? 0,
              })
            : null;
        return {
          ...toAttendance(
            row,
            memberById.get(String(row.memberId)),
            row.scannerId ? scannerById.get(String(row.scannerId)) : null,
          ),
          planName: planNameByMembership.get(String(row.membershipId)) ?? null,
          paymentMethod: methodByMember.get(String(row.memberId)) ?? null,
          slotName: slotFor(row)?.name ?? row.meta?.slotName ?? null,
          slotStartTime: slotFor(row)?.startTime ?? null,
          slotEndTime: slotFor(row)?.endTime ?? null,
          quota: quota
            ? {
                quota: quota.quota,
                attended: quota.attended,
                remaining: quota.remaining,
                exceeded: quota.exceeded,
                status: quota.status,
              }
            : null,
          daysLeft: membership ? daysRemaining(membership, ctx.now, ctx.tz) : null,
        };
      }),
      total,
      page,
      pageSize,
    });
  }),
);

/** PATCH /api/attendance/:id { checkIn?, checkOut?, notes? } (role: attendance.correct) */
router.patch(
  "/attendance/:id",
  requireAuth,
  requireCap("attendance.correct"),
  asyncHandler(async (req, res) => {
    const input = parseBody(correctionSchema, req.body);
    const record = await AttendanceRecord.findOne({
      _id: req.params.id,
      gymId: req.user.gymId,
    }).lean();
    if (!record) throw notFound("Attendance record not found");

    const updates = {};
    if (input.checkIn) updates.checkIn = new Date(input.checkIn);
    if (input.checkOut !== undefined) {
      updates.checkOut = input.checkOut ? new Date(input.checkOut) : null;
    }
    if (input.notes !== undefined) updates.notes = input.notes ?? null;

    const checkIn = updates.checkIn ?? record.checkIn;
    const checkOut = updates.checkOut !== undefined ? updates.checkOut : record.checkOut;
    updates.status = checkOut ? "checked_out" : "checked_in";
    if (checkOut && new Date(checkOut) < new Date(checkIn)) {
      throw badRequest("Check-out must not be before check-in", "invalid_range");
    }

    const updated = await AttendanceRecord.findOneAndUpdate(
      { _id: record._id },
      { $set: updates },
      { new: true },
    ).lean();

    const member = await Member.findById(updated.memberId).lean();
    const scanner = updated.scannerId ? await User.findById(updated.scannerId).lean() : null;

    await writeAudit({
      gymId: record.gymId,
      actorId: req.user.id,
      entity: "attendance_records",
      entityId: String(record._id),
      action: "correct_attendance",
      oldValues: { checkIn: record.checkIn, checkOut: record.checkOut, notes: record.notes, status: record.status },
      newValues: { checkIn: updated.checkIn, checkOut: updated.checkOut, notes: updated.notes, status: updated.status },
    });

    res.json(toAttendance(updated, member, scanner));
  }),
);

/* ------------------------------------------------------------------ */
/*  Reports                                                            */
/* ------------------------------------------------------------------ */

function parseRange(req, ctx) {
  const now = ctx.now;
  // Date-only bounds are UTC-midnight parsed by new Date() — a date-only `to`
  // would otherwise drop its own day. Span such bounds across the full day.
  const boundDate = (raw, end) => (/^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}${end ? "T23:59:59.999Z" : "T00:00:00.000Z"}`)
    : new Date(raw));
  let from = req.query.from ? boundDate(String(req.query.from), false) : startOfDayInTz(addDays(now, -6), ctx.tz);
  let to = req.query.to ? boundDate(String(req.query.to), true) : new Date(now.getTime() + 1);
  if (Number.isNaN(from.getTime())) from = startOfDayInTz(addDays(now, -6), ctx.tz);
  if (Number.isNaN(to.getTime())) to = new Date(now.getTime() + 1);
  return { from, to };
}

/**
 * GET /api/attendance/class-day-summary?date=YYYY-MM-DD
 * → { totalStudents, presentToday, absentToday, lateToday, attendanceRate }
 * Powers the stat cards on the unified Attendance page for one calendar day.
 */
router.get(
  "/attendance/class-day-summary",
  requireAuth,
  requireCap("attendance.view"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const sessionDate = parseDateOnly(String(req.query.date || ymdInTz(new Date(), ctx.tz)));
    const dayKey = ymdInTz(sessionDate, ctx.tz);

    // DISTINCT students, not record rows: a multi-slot student produces one
    // register row per assigned batch (N slots → N marks). "Present Today"
    // must answer "kitne students aaye" — 5 students → 5, never 5×N = 10.
    const rows = await AttendanceRecord.find({
      gymId: ctx.gym._id,
      sessionDate: parseDateOnly(dayKey),
      attendanceStatus: { $in: ["present", "late", "absent", "leave", "holiday"] },
    })
      .select("memberId attendanceStatus")
      .lean();

    const present = new Set();
    const late = new Set();
    const absent = new Set();
    for (const row of rows) {
      const key = String(row.memberId);
      if (row.attendanceStatus === "present") present.add(key);
      else if (row.attendanceStatus === "late") late.add(key);
      else if (row.attendanceStatus === "absent") absent.add(key);
    }
    // Attended = distinct students with present or late marks (union — a
    // student marked late once and present elsewhere still counts once).
    const attendedMembers = new Set([...present, ...late]);
    const attended = attendedMembers.size;
    const lateToday = late.size;
    // Absent: only those explicitly absent who are NOT already counted as
    // present/late — prevents double-counting when a student has multiple
    // records (e.g. auto-present in one slot, manual-absent in another).
    const trulyAbsent = new Set([...absent].filter((key) => !attendedMembers.has(key)));
    const absentToday = trulyAbsent.size;
    const totalMarked = attended + absentToday;
    const attendanceRate = totalMarked === 0 ? 0 : Math.round((attended / totalMarked) * 100);

    const totalStudents = await Member.countDocuments({ gymId: ctx.gym._id, status: "active" });

    res.json({
      date: dayKey,
      totalStudents,
      // Distinct students present (present+late united) — not record count.
      presentToday: attended,
      lateToday,
      absentToday,
      attendanceRate,
    });
  }),
);

/** GET /api/attendance/summary?from&to → AttendanceReportSummary */
router.get(
  "/attendance/summary",
  requireAuth,
  requireCap("reports.view"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const { from, to } = parseRange(req, ctx);

    const rows = await AttendanceRecord.find({
      gymId: ctx.gym._id,
      checkIn: { $gte: from, $lte: to },
    })
      .select("memberId status checkIn checkOut")
      .lean();

    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000));
    const hourCounts = new Array(24).fill(0);
    for (const row of rows) hourCounts[hourInTz(new Date(row.checkIn), ctx.tz)] += 1;

    let busiestHour = null;
    let best = 0;
    for (let hour = 0; hour < 24; hour += 1) {
      if (hourCounts[hour] > best) {
        best = hourCounts[hour];
        busiestHour = hour;
      }
    }

    // Time spent per visit, capped at 12h so a forgotten check-out cannot skew totals.
    const MAX_VISIT_MS = 43_200_000;
    const nowMs = Math.min(ctx.now.getTime(), to.getTime());
    let totalMs = 0;
    for (const row of rows) {
      const end = row.checkOut ? new Date(row.checkOut).getTime() : nowMs;
      totalMs += Math.min(Math.max(0, end - new Date(row.checkIn).getTime()), MAX_VISIT_MS);
    }

    res.json({
      totalVisits: rows.length,
      uniqueMembers: new Set(rows.map((r) => String(r.memberId))).size,
      averagePerDay: Math.round((rows.length / days) * 10) / 10,
      busiestHour,
      checkIns: rows.filter((r) => r.status === "checked_in").length,
      totalHours: Math.round((totalMs / 3_600_000) * 10) / 10,
    });
  }),
);

/** GET /api/attendance/overtime?from&to → OvertimeRow[] (members over their planned daily hours) */
router.get(
  "/attendance/overtime",
  requireAuth,
  requireCap("attendance.view"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const { from, to } = parseRange(req, ctx);
    const nowMs = Math.min(ctx.now.getTime(), to.getTime());
    const MAX_VISIT_MS = 43_200_000; // same 12h cap the summary uses
    const rows = await AttendanceRecord.find({
      gymId: ctx.gym._id,
      checkIn: { $gte: from, $lte: to },
    })
      .select("memberId checkIn checkOut")
      .lean();
    const byMember = new Map();
    const openIds = new Set();
    for (const row of rows) {
      const key = String(row.memberId);
      const end = row.checkOut ? new Date(row.checkOut).getTime() : nowMs;
      const ms = Math.min(Math.max(0, end - new Date(row.checkIn).getTime()), MAX_VISIT_MS);
      byMember.set(key, (byMember.get(key) ?? 0) + ms);
      if (!row.checkOut) openIds.add(key);
    }
    if (byMember.size === 0) return res.json([]);
    const members = await Member.find({
      _id: { $in: [...byMember.keys()] },
      plannedHoursPerDay: { $gt: 0 },
    })
      .select("fullName memberCode photoUrl plannedHoursPerDay")
      .lean();
    res.json(
      members
        .map((m) => ({
          memberId: String(m._id),
          memberName: m.fullName,
          memberCode: m.memberCode,
          memberPhoto: m.photoUrl ?? null,
          plannedHours: m.plannedHoursPerDay,
          hours: Math.round((byMember.get(String(m._id)) / 3_600_000) * 10) / 10,
          stillInside: openIds.has(String(m._id)),
        }))
        .filter((row) => row.hours > row.plannedHours)
        .sort((a, b) => b.hours - a.hours),
    );
  }),
);

const remindCheckoutSchema = z.object({ memberId: z.string().min(1, "Student is required") });

/** POST /api/attendance/remind-checkout { memberId } → { ok, alreadySent } */
router.post(
  "/attendance/remind-checkout",
  requireAuth,
  requireCap("attendance.correct"),
  asyncHandler(async (req, res) => {
    const input = parseBody(remindCheckoutSchema, req.body);
    if (!Types.ObjectId.isValid(String(input.memberId))) throw notFound("Student not found");
    const member = await Member.findOne({ _id: input.memberId, gymId: req.user.gymId }).lean();
    if (!member) throw notFound("Student not found");
    if (!member.plannedHoursPerDay) {
      throw badRequest("This student has no planned hours set", "no_planned_hours");
    }
    const ctx = await loadGymContext(req.user.gymId);
    const today = ymdInTz(ctx.now, ctx.tz);
    const dedupeKey = `checkout_reminder:${member._id}:${today}`;
    const existing = await AppNotification.findOne({ gymId: ctx.gym._id, dedupeKey }).lean();
    await AppNotification.updateOne(
      { gymId: ctx.gym._id, dedupeKey },
      {
        $set: {
          gymId: ctx.gym._id,
          userId: null,
          memberId: member._id,
          type: "general",
          title: "Your studio time is over — please check out",
          body: `Front desk reminder: your planned time for today (${member.plannedHoursPerDay}h) has ended. Please check out.`,
          severity: "warning",
          isRead: false,
          dedupeKey,
        },
      },
      { upsert: true },
    );
    res.json({ ok: true, alreadySent: Boolean(existing) });
  }),
);

/** GET /api/attendance/peak-hours?from&to → PeakHour[] (24 buckets, gym tz) */
router.get(
  "/attendance/peak-hours",
  requireAuth,
  requireCap("reports.view"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const { from, to } = parseRange(req, ctx);

    const rows = await AttendanceRecord.find({
      gymId: ctx.gym._id,
      checkIn: { $gte: from, $lte: to },
    })
      .select("checkIn")
      .lean();

    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: hourLabel(hour),
      count: 0,
    }));
    for (const row of rows) {
      const hour = hourInTz(new Date(row.checkIn), ctx.tz);
      if (buckets[hour]) buckets[hour].count += 1;
    }
    res.json(buckets);
  }),
);

/** GET /api/attendance/frequencies?from&to&limit=10 → MemberFrequency[] */
router.get(
  "/attendance/frequencies",
  requireAuth,
  requireCap("reports.view"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const { from, to } = parseRange(req, ctx);
    const limit = intParam(req.query.limit, 10, { min: 1, max: 50 });

    const rows = await AttendanceRecord.aggregate([
      { $match: { gymId: ctx.gym._id, checkIn: { $gte: from, $lte: to } } },
      { $group: { _id: "$memberId", visits: { $sum: 1 } } },
      { $sort: { visits: -1 } },
      { $limit: limit },
    ]);

    const members = await Member.find({ _id: { $in: rows.map((r) => r._id) } })
      .select("memberCode fullName")
      .lean();
    const memberById = new Map(members.map((m) => [String(m._id), m]));

    res.json(
      rows.map((row) => {
        const member = memberById.get(String(row._id));
        return {
          memberId: String(row._id),
          memberCode: member?.memberCode ?? "",
          memberName: member?.fullName ?? "Student",
          visits: row.visits,
        };
      }),
    );
  }),
);

export default router;
