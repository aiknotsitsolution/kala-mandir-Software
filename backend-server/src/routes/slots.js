import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import ClassSlot from "../models/ClassSlot.js";
import SlotEnrollment from "../models/SlotEnrollment.js";
import Member from "../models/Member.js";
import StaffProfile from "../models/StaffProfile.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler, badRequest, notFound, conflict, forbidden } from "../lib/errors.js";
import { parseBody } from "../middleware/validate.js";
import { toClassSlot, toSlotEnrollment } from "../lib/serialize.js";
import { writeAudit, pick } from "../lib/audit.js";
import { findInstructorConflict, toMinutes } from "../lib/schedule.js";
import { loadGymContext } from "../services/context.js";
import { CLASS_TAGS } from "../lib/constants.js";

const router = Router();

const SLOT_KEYS = ["name", "description", "weekdays", "startTime", "endTime", "capacity", "classTag", "instructorId", "isActive", "notes"];

const createSlotSchema = z.object({
  name: z.string().trim().min(1, "Slot name is required"),
  description: z.string().nullish(),
  /** Weekdays the slot runs on: 0 = Sunday … 6 = Saturday. */
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1, "Pick at least one weekday"),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm"),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm"),
  capacity: z.number().int().min(1).nullish(),
  /** Class stream this batch teaches — required on create. */
  classTag: z.enum(CLASS_TAGS, {
    errorMap: () => ({ message: "Choose a class tag (Art or Dance)" }),
  }),
  instructorId: z.string().nullish(),
  isActive: z.boolean().optional(),
  notes: z.string().nullish(),
});

const updateSlotSchema = createSlotSchema.partial();
const enrollSchema = z.object({ memberId: z.string().min(1, "Student is required") });

async function findSlotOr404(gymId, id) {
  if (!Types.ObjectId.isValid(String(id))) throw notFound("Class slot not found");
  const row = await ClassSlot.findOne({ _id: id, gymId }).lean();
  if (!row) throw notFound("Class slot not found");
  return row;
}

/**
 * A batch (ClassSlot) must run entirely inside the studio's Daily time slots
 * (Manage Institute) — e.g. no 7:00 AM batch when the studio opens at 8:00 AM.
 * Skipped when no hours are configured or slot-hours enforcement is off.
 */
async function assertWithinOperatingHours(gymId, startTime, endTime) {
  const { gym } = await loadGymContext(gymId);
  if (gym.enforceSlotHours === false) return;
  const timeSlots = gym.timeSlots ?? [];
  if (timeSlots.length === 0) return;
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;

  // Merge the open ranges (wrapping slots like 22:00–02:59 split at midnight),
  // then require [start, end] to be fully covered by them.
  const ranges = [];
  for (const s of timeSlots) {
    const a = toMinutes(s.start);
    const b = toMinutes(s.end);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (a <= b) ranges.push([a, b]);
    else {
      ranges.push([a, 24 * 60]);
      ranges.push([0, b]);
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  let cursor = start;
  for (const [a, b] of ranges) {
    if (b <= cursor) continue;
    if (a > cursor) break;
    cursor = Math.max(cursor, b);
    if (cursor >= end) return;
  }
  const hours = timeSlots.map((s) => `${s.start} – ${s.end}`).join(", ");
  throw badRequest(
    `${startTime} – ${endTime} falls outside the studio's daily time slots (${hours}). Change the batch time, or update the daily slots in Manage Institute.`,
    "outside_operating_hours",
  );
}

/** Resolve the instructor's StaffProfile for a trainer-scoped request. */
async function staffProfileForUser(gymId, userId) {
  return StaffProfile.findOne({ gymId, profileId: userId }).lean();
}

async function decorateSlots(gymId, rows) {
  if (rows.length === 0) return [];
  const instructorIds = [...new Set(rows.map((r) => r.instructorId).filter(Boolean).map(String))];
  const [instructors, counts] = await Promise.all([
    instructorIds.length ? StaffProfile.find({ _id: { $in: instructorIds } }).lean() : [],
    SlotEnrollment.aggregate([
      { $match: { gymId: rows[0].gymId, status: "enrolled" } },
      // Distinct member ids (a student enroled twice still counts once) plus
      // the raw record count — the UI needs both: per-slot headcount uses the
      // record count, group totals ("Morning (5)") sum DISTINCT students.
      { $group: { _id: "$slotId", count: { $sum: 1 }, memberIds: { $addToSet: "$memberId" } } },
    ]),
  ]);
  const byId = new Map(instructors.map((s) => [String(s._id), s]));
  return rows.map((row) => {
    const agg = counts.find((c) => String(c._id) === String(row._id)) ?? null;
    return toClassSlot(
      row,
      byId.get(String(row.instructorId)) ?? null,
      agg?.count ?? 0,
      agg?.memberIds?.map(String) ?? [],
    );
  });
}

/**
 * GET /api/class-slots → ClassSlot[]
 *
 * Trainers only ever see slots they instruct (server-side scoping); everyone
 * else with slots.view sees all slots in their gym.
 */
router.get(
  "/class-slots",
  requireAuth,
  requireCap("slots.view"),
  asyncHandler(async (req, res) => {
    const filter = { gymId: req.user.gymId };
    if (req.user.role === "trainer") {
      const profile = await staffProfileForUser(req.user.gymId, req.user.id);
      // No linked staff profile → no assigned slots (never everyone else's.
      filter.instructorId = profile?._id ?? new Types.ObjectId();
    }
    const rows = await ClassSlot.find(filter).sort({ startTime: 1, name: 1 }).lean();
    res.json(await decorateSlots(req.user.gymId, rows));
  }),
);

/** GET /api/class-slots/:id → ClassSlot */
router.get(
  "/class-slots/:id",
  requireAuth,
  requireCap("slots.view"),
  asyncHandler(async (req, res) => {
    const row = await findSlotOr404(req.user.gymId, req.params.id);
    if (req.user.role === "trainer") {
      const profile = await staffProfileForUser(req.user.gymId, req.user.id);
      if (String(row.instructorId ?? "") !== String(profile?._id ?? "")) {
        throw forbidden("You are not the instructor for this slot");
      }
    }
    const [decorated] = await decorateSlots(req.user.gymId, [row]);
    res.json(decorated);
  }),
);

/** POST /api/class-slots — create a recurring slot (classes.manage). */
router.post(
  "/class-slots",
  requireAuth,
  requireCap("slots.manage"),
  asyncHandler(async (req, res) => {
    const input = parseBody(createSlotSchema, req.body);
    const start = toMinutes(input.startTime);
    const end = toMinutes(input.endTime);
    if (end <= start) throw badRequest("endTime must be after startTime", "invalid_time_range");
    await assertWithinOperatingHours(req.user.gymId, input.startTime, input.endTime);

    // Tenancy: the instructor must belong to this gym when provided.
    let instructorId = null;
    if (input.instructorId) {
      if (!Types.ObjectId.isValid(String(input.instructorId))) throw badRequest("Invalid instructor", "invalid_id");
      const instructor = await StaffProfile.findOne({ _id: input.instructorId, gymId: req.user.gymId }).lean();
      if (!instructor) throw notFound("Instructor not found");
      instructorId = instructor._id;
    }

    // Instructor double-booking guard (same weekday + overlapping time).
    if (instructorId) {
      const existing = await ClassSlot.find({ gymId: req.user.gymId, isActive: true }).lean();
      const clash = findInstructorConflict(existing, {
        instructorId,
        weekdays: input.weekdays,
        startTime: input.startTime,
        endTime: input.endTime,
      });
      if (clash) {
        throw conflict(
          `Instructor is already booked in "${clash.name}" at ${clash.startTime}–${clash.endTime} on a shared weekday`,
          "instructor_conflict",
        );
      }
    }

    const [row] = await ClassSlot.create([
      {
        gymId: req.user.gymId,
        name: input.name,
        description: input.description ?? null,
        weekdays: [...new Set(input.weekdays.map(Number))].sort(),
        startTime: input.startTime,
        endTime: input.endTime,
        capacity: input.capacity ?? null,
        classTag: input.classTag,
        instructorId,
        isActive: input.isActive ?? true,
        notes: input.notes ?? null,
        createdBy: req.user.id,
      },
    ]);

    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "class_slots",
      entityId: String(row._id),
      action: "create",
      newValues: pick(row, SLOT_KEYS),
    });

    const [decorated] = await decorateSlots(req.user.gymId, [row.toObject()]);
    res.status(201).json(decorated);
  }),
);

/** PATCH /api/class-slots/:id — update a slot (classes.manage). */
router.patch(
  "/class-slots/:id",
  requireAuth,
  requireCap("slots.manage"),
  asyncHandler(async (req, res) => {
    const existing = await findSlotOr404(req.user.gymId, req.params.id);
    const input = parseBody(updateSlotSchema, req.body);

    const next = {
      name: input.name ?? existing.name,
      description: input.description !== undefined ? input.description ?? null : existing.description,
      weekdays: input.weekdays ? [...new Set(input.weekdays.map(Number))].sort() : existing.weekdays,
      startTime: input.startTime ?? existing.startTime,
      endTime: input.endTime ?? existing.endTime,
      capacity: input.capacity !== undefined ? input.capacity ?? null : existing.capacity,
      classTag: input.classTag ?? existing.classTag ?? null,
      isActive: input.isActive ?? existing.isActive,
      notes: input.notes !== undefined ? input.notes ?? null : existing.notes,
    };

    const start = toMinutes(next.startTime);
    const end = toMinutes(next.endTime);
    if (end <= start) throw badRequest("endTime must be after startTime", "invalid_time_range");
    if (next.startTime !== existing.startTime || next.endTime !== existing.endTime) {
      await assertWithinOperatingHours(req.user.gymId, next.startTime, next.endTime);
    }

    let instructorId = existing.instructorId ?? null;
    if (input.instructorId !== undefined) {
      if (!input.instructorId) {
        instructorId = null;
      } else {
        if (!Types.ObjectId.isValid(String(input.instructorId))) throw badRequest("Invalid instructor", "invalid_id");
        const instructor = await StaffProfile.findOne({ _id: input.instructorId, gymId: req.user.gymId }).lean();
        if (!instructor) throw notFound("Instructor not found");
        instructorId = instructor._id;
      }
    }

    if (instructorId) {
      const others = await ClassSlot.find({ gymId: req.user.gymId, isActive: true }).lean();
      const clash = findInstructorConflict(others, {
        id: existing._id,
        instructorId,
        weekdays: next.weekdays,
        startTime: next.startTime,
        endTime: next.endTime,
      });
      if (clash) {
        throw conflict(
          `Instructor is already booked in "${clash.name}" at ${clash.startTime}–${clash.endTime} on a shared weekday`,
          "instructor_conflict",
        );
      }
    }

    const row = await ClassSlot.findOneAndUpdate(
      { _id: existing._id },
      { $set: { ...next, instructorId } },
      { new: true },
    ).lean();

    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "class_slots",
      entityId: String(row._id),
      action: "update",
      oldValues: pick(existing, SLOT_KEYS),
      newValues: pick(row, SLOT_KEYS),
    });

    const [decorated] = await decorateSlots(req.user.gymId, [row]);
    res.json(decorated);
  }),
);

/** PATCH /api/class-slots/:id/archive — soft-deactivate (keeps history). */
router.patch(
  "/class-slots/:id/archive",
  requireAuth,
  requireCap("slots.manage"),
  asyncHandler(async (req, res) => {
    const existing = await findSlotOr404(req.user.gymId, req.params.id);
    const row = await ClassSlot.findOneAndUpdate(
      { _id: existing._id },
      { $set: { isActive: false } },
      { new: true },
    ).lean();
    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "class_slots",
      entityId: String(row._id),
      action: "archive",
      oldValues: { isActive: existing.isActive },
      newValues: { isActive: false },
    });
    const [decorated] = await decorateSlots(req.user.gymId, [row]);
    res.json(decorated);
  }),
);

/* ------------------------------------------------------------------ */
/*  Slot rosters (student ↔ recurring slot assignments)                */
/* ------------------------------------------------------------------ */

/** GET /api/class-slots/:id/students → SlotEnrollment[] (the roster). */
router.get(
  "/class-slots/:id/students",
  requireAuth,
  requireCap("slots.view"),
  asyncHandler(async (req, res) => {
    const slot = await findSlotOr404(req.user.gymId, req.params.id);
    if (req.user.role === "trainer") {
      const profile = await staffProfileForUser(req.user.gymId, req.user.id);
      if (String(slot.instructorId ?? "") !== String(profile?._id ?? "")) {
        throw forbidden("You are not the instructor for this slot");
      }
    }
    const rows = await SlotEnrollment.find({ slotId: slot._id, status: "enrolled" })
      .sort({ enrolledAt: 1 })
      .lean();
    const memberIds = rows.map((r) => r.memberId);
    const members = memberIds.length
      ? await Member.find({ _id: { $in: memberIds } }).lean()
      : [];
    const byId = new Map(members.map((m) => [String(m._id), m]));
    res.json(rows.map((row) => toSlotEnrollment(row, byId.get(String(row.memberId)) ?? null)));
  }),
);

/** POST /api/class-slots/:id/students — enroll a student (classes.manage). */
router.post(
  "/class-slots/:id/students",
  requireAuth,
  requireCap("slots.manage"),
  asyncHandler(async (req, res) => {
    const slot = await findSlotOr404(req.user.gymId, req.params.id);
    if (!slot.isActive) throw conflict("This slot is not active", "slot_inactive");
    const input = parseBody(enrollSchema, req.body);

    if (!Types.ObjectId.isValid(String(input.memberId))) throw badRequest("Invalid student", "invalid_id");
    const member = await Member.findOne({ _id: input.memberId, gymId: req.user.gymId }).lean();
    if (!member) throw notFound("Student not found");
    if (member.status !== "active") throw conflict("This student is inactive", "member_inactive");

    // Capacity guard (unlimited when capacity is null).
    if (slot.capacity != null) {
      const enrolled = await SlotEnrollment.countDocuments({ slotId: slot._id, status: "enrolled" });
      if (enrolled >= slot.capacity) throw conflict("This slot is at capacity", "slot_full");
    }

    // Idempotent: reactivate a cancelled row instead of inserting a duplicate.
    const existing = await SlotEnrollment.findOne({ slotId: slot._id, memberId: member._id });
    if (existing && existing.status === "enrolled") {
      throw conflict("This student is already enrolled in this slot", "already_enrolled");
    }
    let row;
    if (existing) {
      row = await SlotEnrollment.findOneAndUpdate(
        { _id: existing._id },
        { $set: { status: "enrolled", enrolledAt: new Date(), notes: input.notes ?? null } },
        { new: true },
      ).lean();
    } else {
      [row] = await SlotEnrollment.create([
        {
          gymId: req.user.gymId,
          slotId: slot._id,
          memberId: member._id,
          status: "enrolled",
          notes: input.notes ?? null,
        },
      ]);
      row = row.toObject();
    }

    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "slot_enrollments",
      entityId: String(row._id),
      action: "enroll",
      newValues: { slot: slot.name, memberCode: member.memberCode },
    });

    res.status(201).json(toSlotEnrollment(row, member));
  }),
);

/** DELETE /api/slot-enrollments/:id — remove a student from a slot. */
router.delete(
  "/slot-enrollments/:id",
  requireAuth,
  requireCap("slots.manage"),
  asyncHandler(async (req, res) => {
    if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound("Enrollment not found");
    const row = await SlotEnrollment.findOne({ _id: req.params.id, gymId: req.user.gymId });
    if (!row) throw notFound("Enrollment not found");

    row.status = "cancelled";
    await row.save();

    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "slot_enrollments",
      entityId: String(row._id),
      action: "unenroll",
      oldValues: { status: "enrolled" },
      newValues: { status: "cancelled" },
    });

    res.json({ ok: true });
  }),
);

export default router;
