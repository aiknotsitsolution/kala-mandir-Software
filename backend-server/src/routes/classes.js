import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import GymClass from "../models/GymClass.js";
import ClassEnrollment from "../models/ClassEnrollment.js";
import Member from "../models/Member.js";
import StaffProfile from "../models/StaffProfile.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler, badRequest, notFound, conflict } from "../lib/errors.js";
import { parseBody, intParam } from "../middleware/validate.js";
import { toClass, toEnrollment } from "../lib/serialize.js";
import { writeAudit, pick } from "../lib/audit.js";
import { loadGymContext } from "../services/context.js";

const router = Router();

const createClassSchema = z.object({
  name: z.string().trim().min(1, "Class name is required"),
  description: z.string().nullish(),
  trainerId: z.string().nullish(),
  /** ISO datetime */
  startsAt: z.string().min(4, "Start time is required"),
  durationMinutes: z.number().int().min(1),
  capacity: z.number().int().min(1),
  kind: z.enum(["regular", "demo"]).optional(),
});

const updateClassSchema = createClassSchema.partial();
const enrollSchema = z.object({ memberId: z.string().min(1, "Student is required") });
const enrollmentStatusSchema = z.object({
  status: z.enum(["enrolled", "cancelled", "attended", "no_show"]),
});

const CLASS_KEYS = ["name", "description", "trainerId", "startsAt", "durationMinutes", "capacity", "kind"];

async function findClassOr404(gymId, id) {
  if (!Types.ObjectId.isValid(String(id))) throw notFound("Class not found");
  const row = await GymClass.findOne({ _id: id, gymId }).lean();
  if (!row) throw notFound("Class not found");
  return row;
}

async function decorateClasses(gymId, rows) {
  if (rows.length === 0) return [];
  const trainerIds = [...new Set(rows.map((r) => r.trainerId).filter(Boolean).map(String))];
  const [trainers, counts] = await Promise.all([
    trainerIds.length ? StaffProfile.find({ _id: { $in: trainerIds } }).lean() : [],
    ClassEnrollment.aggregate([
      { $match: { gymId: rows[0].gymId, status: { $ne: "cancelled" } } },
      { $group: { _id: "$classId", count: { $sum: 1 } } },
    ]),
  ]);
  const trainerById = new Map(trainers.map((t) => [String(t._id), t]));
  const countById = new Map(counts.map((c) => [String(c._id), c.count]));
  return rows.map((row) =>
    toClass(row, row.trainerId ? trainerById.get(String(row.trainerId)) : null, countById.get(String(row._id)) ?? 0),
  );
}

/** GET /api/classes?from&to (ISO datetimes) → GymClass[] */
router.get(
  "/classes",
  requireAuth,
  requireCap("classes.view"),
  asyncHandler(async (req, res) => {
    const gymId = req.user.gymId;
    const filter = { gymId };
    if (req.query.from || req.query.to) {
      filter.startsAt = {};
      if (req.query.from) filter.startsAt.$gte = new Date(String(req.query.from));
      if (req.query.to) filter.startsAt.$lte = new Date(String(req.query.to));
    }
    const rows = await GymClass.find(filter).sort({ startsAt: 1 }).lean();
    res.json(await decorateClasses(gymId, rows));
  }),
);

/** GET /api/classes/:id → GymClass */
router.get(
  "/classes/:id",
  requireAuth,
  requireCap("classes.view"),
  asyncHandler(async (req, res) => {
    const row = await findClassOr404(req.user.gymId, req.params.id);
    const [decorated] = await decorateClasses(req.user.gymId, [row]);
    res.json(decorated);
  }),
);

/** POST /api/classes */
router.post(
  "/classes",
  requireAuth,
  requireCap("classes.manage"),
  asyncHandler(async (req, res) => {
    const input = parseBody(createClassSchema, req.body);
    const gymId = req.user.gymId;

    let trainerId = null;
    if (input.trainerId) {
      const trainer = await StaffProfile.findOne({ _id: input.trainerId, gymId }).select("_id");
      if (!trainer) throw badRequest("Trainer was not found", "invalid_trainer");
      trainerId = trainer._id;
    }

    const [row] = await GymClass.create([
      {
        gymId,
        name: input.name,
        description: input.description ?? null,
        trainerId,
        startsAt: new Date(input.startsAt),
        durationMinutes: input.durationMinutes,
        capacity: input.capacity,
        kind: input.kind ?? "regular",
        status: "scheduled",
      },
    ]);

    await writeAudit({
      gymId,
      actorId: req.user.id,
      entity: "gym_classes",
      entityId: String(row._id),
      action: "create",
      newValues: { name: row.name, startsAt: row.startsAt, capacity: row.capacity },
    });

    const [decorated] = await decorateClasses(gymId, [row.toObject()]);
    res.status(201).json(decorated);
  }),
);

/** PATCH /api/classes/:id */
router.patch(
  "/classes/:id",
  requireAuth,
  requireCap("classes.manage"),
  asyncHandler(async (req, res) => {
    const input = parseBody(updateClassSchema, req.body);
    const gymId = req.user.gymId;
    const row = await findClassOr404(gymId, req.params.id);

    const updates = {};
    for (const key of CLASS_KEYS) {
      if (input[key] !== undefined) {
        updates[key] = key === "startsAt" ? new Date(input[key]) : input[key];
      }
    }
    if (input.trainerId !== undefined) {
      if (input.trainerId) {
        const trainer = await StaffProfile.findOne({ _id: input.trainerId, gymId }).select("_id");
        if (!trainer) throw badRequest("Trainer was not found", "invalid_trainer");
        updates.trainerId = trainer._id;
      } else {
        updates.trainerId = null;
      }
    }

    const updated = await GymClass.findOneAndUpdate(
      { _id: row._id },
      { $set: updates },
      { new: true },
    ).lean();

    await writeAudit({
      gymId,
      actorId: req.user.id,
      entity: "gym_classes",
      entityId: String(row._id),
      action: "update",
      oldValues: pick(row, CLASS_KEYS),
      newValues: pick(updates, CLASS_KEYS),
    });

    const [decorated] = await decorateClasses(gymId, [updated]);
    res.json(decorated);
  }),
);

/** PATCH /api/classes/:id/cancel */
router.patch(
  "/classes/:id/cancel",
  requireAuth,
  requireCap("classes.manage"),
  asyncHandler(async (req, res) => {
    const gymId = req.user.gymId;
    const row = await findClassOr404(gymId, req.params.id);
    const updated = await GymClass.findOneAndUpdate(
      { _id: row._id },
      { $set: { status: "cancelled" } },
      { new: true },
    ).lean();

    await writeAudit({
      gymId,
      actorId: req.user.id,
      entity: "gym_classes",
      entityId: String(row._id),
      action: "cancel",
      oldValues: { status: row.status },
      newValues: { status: "cancelled" },
    });

    const [decorated] = await decorateClasses(gymId, [updated]);
    res.json(decorated);
  }),
);

/** GET /api/classes/:id/enrollments → ClassEnrollment[] (memberName/memberCode populated) */
router.get(
  "/classes/:id/enrollments",
  requireAuth,
  requireCap("classes.view"),
  asyncHandler(async (req, res) => {
    const gymId = req.user.gymId;
    const cls = await findClassOr404(gymId, req.params.id);
    const rows = await ClassEnrollment.find({ classId: cls._id }).sort({ enrolledAt: 1 }).lean();
    const members = rows.length
      ? await Member.find({ _id: { $in: rows.map((r) => r.memberId) } }).lean()
      : [];
    const memberById = new Map(members.map((m) => [String(m._id), m]));
    res.json(rows.map((row) => toEnrollment(row, memberById.get(String(row.memberId)))));
  }),
);

/** POST /api/classes/:id/enroll { memberId } */
router.post(
  "/classes/:id/enroll",
  requireAuth,
  requireCap("classes.manage"),
  asyncHandler(async (req, res) => {
    const { memberId } = parseBody(enrollSchema, req.body);
    const gymId = req.user.gymId;
    const cls = await findClassOr404(gymId, req.params.id);
    if (cls.status === "cancelled") throw badRequest("Cannot enroll into a cancelled class", "class_cancelled");

    const member = await Member.findOne({ _id: memberId, gymId }).lean();
    if (!member) throw notFound("Student not found");
    if (member.status !== "active") {
      throw badRequest("This student is inactive", "member_inactive");
    }

    const enrolledCount = await ClassEnrollment.countDocuments({
      classId: cls._id,
      status: { $ne: "cancelled" },
    });
    if (enrolledCount >= cls.capacity) {
      throw conflict("This class is already at full capacity", "class_full");
    }

    const existing = await ClassEnrollment.findOne({ classId: cls._id, memberId: member._id }).lean();
    if (existing && existing.status !== "cancelled") {
      throw conflict("This student is already enrolled", "already_enrolled");
    }

    let row;
    if (existing) {
      row = await ClassEnrollment.findOneAndUpdate(
        { _id: existing._id },
        { $set: { status: "enrolled", enrolledAt: new Date() } },
        { new: true },
      ).lean();
    } else {
      [row] = await ClassEnrollment.create([
        { gymId, classId: cls._id, memberId: member._id, status: "enrolled", enrolledAt: new Date() },
      ]);
      row = row.toObject();
    }

    await writeAudit({
      gymId,
      actorId: req.user.id,
      entity: "class_enrollments",
      entityId: String(row._id),
      action: "create",
      newValues: { class: cls.name, memberCode: member.memberCode },
    });

    res.status(201).json(toEnrollment(row, member));
  }),
);

/** DELETE /api/enrollments/:id — removes the enrollment (voids the sign-up). */
router.delete(
  "/enrollments/:id",
  requireAuth,
  requireCap("classes.manage"),
  asyncHandler(async (req, res) => {
    const gymId = req.user.gymId;
    if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound("Enrollment not found");
    const row = await ClassEnrollment.findOneAndDelete({
      _id: req.params.id,
      gymId,
    }).lean();
    if (!row) throw notFound("Enrollment not found");

    await writeAudit({
      gymId,
      actorId: req.user.id,
      entity: "class_enrollments",
      entityId: String(req.params.id),
      action: "delete",
      oldValues: { classId: String(row.classId), memberId: String(row.memberId), status: row.status },
    });

    res.status(204).end();
  }),
);

/** PATCH /api/enrollments/:id/status { status } */
router.patch(
  "/enrollments/:id/status",
  requireAuth,
  requireCap("classes.manage"),
  asyncHandler(async (req, res) => {
    const { status } = parseBody(enrollmentStatusSchema, req.body);
    const gymId = req.user.gymId;
    if (!Types.ObjectId.isValid(String(req.params.id))) throw notFound("Enrollment not found");
    const row = await ClassEnrollment.findOneAndUpdate(
      { _id: req.params.id, gymId },
      { $set: { status } },
      { new: true },
    ).lean();
    if (!row) throw notFound("Enrollment not found");

    const member = await Member.findById(row.memberId).lean();

    await writeAudit({
      gymId,
      actorId: req.user.id,
      entity: "class_enrollments",
      entityId: String(row._id),
      action: "set_status",
      newValues: { status },
    });

    res.json(toEnrollment(row, member));
  }),
);

export default router;
