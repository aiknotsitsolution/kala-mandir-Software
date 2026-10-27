import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import StaffProfile from "../models/StaffProfile.js";
import ClassSlot from "../models/ClassSlot.js";
import Member from "../models/Member.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler, forbidden, notFound } from "../lib/errors.js";
import { parseBody } from "../middleware/validate.js";
import { toStaff, toClassSlot, toMember } from "../lib/serialize.js";
import { writeAudit, pick } from "../lib/audit.js";
import { parseDateOnly } from "../lib/dates.js";
import { ensureStaffLogin, setStaffLoginActive } from "../lib/staffLogins.js";

const router = Router();

const optionalEmail = z
  .union([z.string().email("Enter a valid email address"), z.literal(""), z.null()])
  .optional()
  .transform((v) => v || null);

const createStaffSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  email: optionalEmail,
  phone: z.string().trim().min(3, "Phone is required"),
  role: z.enum(["admin", "front_desk", "trainer"]),
  specialization: z.string().nullish(),
  employmentStatus: z.enum(["active", "on_leave", "resigned"]),
  joiningDate: z.string().min(4, "Joining date is required"),
  photoUrl: z.string().nullish(),
  notes: z.string().nullish(),
  /**
   * Optional login password. When provided (with an email), a portal login is
   * created for this staff member so they can sign in as their role. Omitted →
   * no login is created (the profile is directory-only).
   */
  loginPassword: z.string().min(6, "Login password must be at least 6 characters").max(72).nullish(),
});

const updateStaffSchema = createStaffSchema
  .partial()
  .extend({
    role: z.enum(["owner", "admin", "front_desk", "trainer"]).optional(),
  });

const STAFF_KEYS = [
  "fullName", "email", "phone", "role", "specialization",
  "employmentStatus", "joiningDate", "photoUrl", "notes",
];

async function findStaffOr404(gymId, id)
{
  if (!Types.ObjectId.isValid(String(id))) throw notFound("Staff Student not found");
  const row = await StaffProfile.findOne({ _id: id, gymId }).lean();
  if (!row) throw notFound("Staff Student not found");
  return row;
}

/** GET /api/staff?includeInactive=1 → StaffProfile[] */
router.get(
  "/staff",
  requireAuth,
  requireCap("staff.view"),
  asyncHandler(async (req, res) =>
  {
    const includeInactive =
      req.query.includeInactive === "1" ||
      req.query.includeInactive === "true" ||
      req.query.includeInactive === undefined;
    const filter = { gymId: req.user.gymId };
    if (!includeInactive) filter.employmentStatus = "active";
    const rows = await StaffProfile.find(filter).sort({ fullName: 1 }).lean();
    res.json(rows.map(toStaff));
  }),
);

/** GET /api/staff/:id → StaffProfile + assigned slots + assigned students */
router.get(
  "/staff/:id",
  requireAuth,
  requireCap("staff.view"),
  asyncHandler(async (req, res) =>
  {
    const row = await findStaffOr404(req.user.gymId, req.params.id);
    const [slots, students] = await Promise.all([
      ClassSlot.find({ gymId: req.user.gymId, instructorId: row._id })
        .sort({ startTime: 1 })
        .lean(),
      Member.find({ gymId: req.user.gymId, trainerId: row._id })
        .sort({ fullName: 1 })
        .lean(),
    ]);
    res.json({
      ...toStaff(row),
      slots: slots.map((slot) => toClassSlot(slot)),
      students: students.map((member) => toMember(member)),
    });
  }),
);

/** POST /api/staff */
router.post(
  "/staff",
  requireAuth,
  requireCap("staff.manage"),
  asyncHandler(async (req, res) =>
  {
    const input = parseBody(createStaffSchema, req.body);
    const [row] = await StaffProfile.create([
      {
        gymId: req.user.gymId,
        profileId: null,
        fullName: input.fullName,
        email: input.email ?? null,
        phone: input.phone,
        role: input.role,
        specialization: input.specialization ?? null,
        employmentStatus: input.employmentStatus,
        joiningDate: parseDateOnly(input.joiningDate),
        photoUrl: input.photoUrl ?? null,
        notes: input.notes ?? null,
      },
    ]);

    // Optionally create a portal login so this staff member can sign in.
    let loginCreated = false;
    if (input.loginPassword && input.email)
    {
      const { userId, created } = await ensureStaffLogin({
        gymId: req.user.gymId,
        profileId: row._id,
        fullName: row.fullName,
        email: input.email,
        phone: input.phone,
        password: input.loginPassword,
        role: input.role,
      });
      loginCreated = created;
      row.profileId = userId;
      await row.save();
    }

    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "staff_profiles",
      entityId: String(row._id),
      action: "create",
      newValues: { name: row.fullName, role: row.role, loginCreated },
    });

    res.status(201).json(toStaff(row));
  }),
);

/** PATCH /api/staff/:id */
router.patch(
  "/staff/:id",
  requireAuth,
  requireCap("staff.manage"),
  asyncHandler(async (req, res) =>
  {
    const input = parseBody(updateStaffSchema, req.body);
    const row = await findStaffOr404(req.user.gymId, req.params.id);

    const updates = {};
    for (const key of STAFF_KEYS)
    {
      if (input[key] !== undefined)
      {
        updates[key] = key === "joiningDate" ? parseDateOnly(input[key]) : input[key];
      }
    }
    if (input.email !== undefined) updates.email = input.email || null;

    let updated = await StaffProfile.findOneAndUpdate(
      { _id: row._id },
      { $set: updates },
      { new: true },
    ).lean();

    // Optionally create/refresh a portal login (password only changes when a
    // NEW login is created; existing logins keep their credentials).
    // Optionally create / reset portal login.
    // profileId must be the linked User._id (row.profileId), NOT StaffProfile._id.
    let loginUpdated = false;
    if (input.loginPassword && (updates.email ?? row.email))
    {
      const { userId, created } = await ensureStaffLogin({
        gymId: req.user.gymId,
        profileId: row.profileId || null,   // ✅ sahi — User._id
        fullName: updates.fullName ?? row.fullName,
        email: updates.email ?? row.email,
        phone: updates.phone ?? row.phone,
        password: input.loginPassword,
        role: updates.role ?? row.role,
      });

      // Naya login bana ho to StaffProfile pe link karo
      if (created || !row.profileId)
      {
        updated = await StaffProfile.findOneAndUpdate(
          { _id: row._id },
          { $set: { profileId: userId } },
          { new: true },
        ).lean();
      }
      loginUpdated = true;
    }

    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "staff_profiles",
      entityId: String(row._id),
      action: "update",
      oldValues: pick(row, STAFF_KEYS),
      newValues: { ...pick(updates, STAFF_KEYS), ...(loginUpdated ? { loginUpdated: true } : {}) },
    });

    res.json(toStaff(updated));
  }),
);

/** PATCH /api/staff/:id/archive — marks the staff member resigned. */
router.patch(
  "/staff/:id/archive",
  requireAuth,
  requireCap("staff.manage"),
  asyncHandler(async (req, res) =>
  {
    const row = await findStaffOr404(req.user.gymId, req.params.id);
    // Prevent an admin from archiving/disabling their own account.
    if (row.profileId && String(row.profileId) === String(req.user.id))
    {
      throw forbidden("You cannot archive your own account.");
    }
    const updated = await StaffProfile.findOneAndUpdate(
      { _id: row._id },
      { $set: { employmentStatus: "resigned" } },
      { new: true },
    ).lean();

    // Resigning also disables their portal login (no-op for legacy staff
    // who never had one).
    const loginsDisabled = await setStaffLoginActive(row.profileId, false);

    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "staff_profiles",
      entityId: String(row._id),
      action: "archive",
      oldValues: { employmentStatus: row.employmentStatus },
      newValues: { employmentStatus: "resigned", loginsDisabled },
    });

    res.json(toStaff(updated));
  }),
);

/** DELETE /api/staff/:id — permanently removes the staff profile. */
router.delete(
  "/staff/:id",
  requireAuth,
  requireCap("staff.manage"),
  asyncHandler(async (req, res) =>
  {
    const row = await findStaffOr404(req.user.gymId, req.params.id);
    // Prevent an admin from deleting/disabling their own account.
    if (row.profileId && String(row.profileId) === String(req.user.id))
    {
      throw forbidden("You cannot delete your own account.");
    }
    await StaffProfile.deleteOne({ _id: row._id });
    await setStaffLoginActive(row.profileId, false);

    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "staff_profiles",
      entityId: String(row._id),
      action: "delete",
      oldValues: { fullName: row.fullName, role: row.role, employmentStatus: row.employmentStatus },
    });

    res.status(204).send();
  }),
);

/** POST /api/staff/:id/assign-slots — assign class slots to a trainer. */
router.post(
  "/staff/:id/assign-slots",
  requireAuth,
  requireCap("slots.manage"),
  asyncHandler(async (req, res) =>
  {
    const row = await findStaffOr404(req.user.gymId, req.params.id);
    const slotIds = Array.isArray(req.body?.slotIds) ? req.body.slotIds : [];
    // Remove this trainer from all previously assigned slots.
    await ClassSlot.updateMany(
      { gymId: req.user.gymId, instructorId: row._id },
      { $set: { instructorId: null } },
    );
    // Assign selected slots to this trainer.
    if (slotIds.length > 0)
    {
      await ClassSlot.updateMany(
        { gymId: req.user.gymId, _id: { $in: slotIds.map((id) => new Types.ObjectId(id)) } },
        { $set: { instructorId: row._id } },
      );
    }
    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "staff_profiles",
      entityId: String(row._id),
      action: "assign_slots",
      newValues: { slotIds },
    });
    res.json({ ok: true });
  }),
);

/** POST /api/staff/:id/assign-students — assign students to a trainer. */
router.post(
  "/staff/:id/assign-students",
  requireAuth,
  requireCap("staff.manage"),
  asyncHandler(async (req, res) =>
  {
    const row = await findStaffOr404(req.user.gymId, req.params.id);
    const memberIds = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
    // Remove this trainer from all previously assigned students.
    await Member.updateMany(
      { gymId: req.user.gymId, trainerId: row._id },
      { $set: { trainerId: null } },
    );
    // Assign selected students to this trainer.
    if (memberIds.length > 0)
    {
      await Member.updateMany(
        { gymId: req.user.gymId, _id: { $in: memberIds.map((id) => new Types.ObjectId(id)) } },
        { $set: { trainerId: row._id } },
      );
    }
    await writeAudit({
      gymId: req.user.gymId,
      actorId: req.user.id,
      entity: "staff_profiles",
      entityId: String(row._id),
      action: "assign_students",
      newValues: { memberIds },
    });
    res.json({ ok: true });
  }),
);

export default router;
