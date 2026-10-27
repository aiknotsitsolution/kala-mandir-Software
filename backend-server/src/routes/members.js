import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import Member from "../models/Member.js";
import Tag from "../models/Tag.js";
import MemberMembership from "../models/MemberMembership.js";
import MembershipPlan from "../models/MembershipPlan.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import PaymentRecord from "../models/PaymentRecord.js";
import ClassEnrollment from "../models/ClassEnrollment.js";
import ClassSlot from "../models/ClassSlot.js";
import SlotEnrollment from "../models/SlotEnrollment.js";
import StaffProfile from "../models/StaffProfile.js";
import { withTransaction } from "../db.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler, badRequest, notFound, conflict } from "../lib/errors.js";
import { parseBody, intParam } from "../middleware/validate.js";
import { toMember, toMembership, toAttendance, toPayment, ymd } from "../lib/serialize.js";
import { generateQrToken } from "../lib/qr.js";
import { nextMemberCode } from "../lib/codes.js";
import { writeAudit, pick } from "../lib/audit.js";
import { planEndDate, renewalStartDate, currentMembership } from "../lib/membership.js";
import { quotaForPlan, computeQuota } from "../lib/quota.js";
import { parseDateOnly, ymdInTz } from "../lib/dates.js";
import { loadGymContext } from "../services/context.js";
import { decorateAllMembers, decorateMember } from "../services/members.js";
import { createPaymentRow } from "../services/payments.js";
import { ensureMemberLogin, syncMemberLoginStatus } from "../lib/memberLogins.js";
import { CLASS_TAGS } from "../lib/constants.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  Schemas                                                            */
/* ------------------------------------------------------------------ */

const genderEnum = z.enum(["male", "female", "other", "prefer_not_to_say"]);
const paymentMethodEnum = z.enum(["cash", "upi", "card", "bank_transfer", "other"]);

const optionalEmail = z
  .union([z.string().email("Enter a valid email address"), z.literal(""), z.null()])
  .optional()
  .transform((v) => v || null);

const initialPaymentSchema = z.object({
  amount: z.number().positive("Amount must be greater than zero"),
  method: paymentMethodEnum,
  paymentDate: z.string().optional(),
  transactionRef: z.string().nullish(),
  notes: z.string().nullish(),
});

const createMemberSchema = z.object({
  fullName: z.string().trim().min(1, "Full name is required"),
  // Optional: students can sign in with their printed Student ID instead.
  email: z
    .union([z.string().trim().email("Enter a valid email address"), z.literal(""), z.null()])
    .optional()
    .transform((v) => v || null),
  phone: z.string().trim().min(3, "Phone is required"),
  photoUrl: z.string().nullish(),
  dateOfBirth: z.string().nullish(),
  /** Age in years collected at registration (DOB still supported). */
  age: z.number().int().min(1, "Enter a valid age").max(120, "Enter a valid age").nullish(),
  gender: genderEnum.nullish(),
  address: z.string().nullish(),
  emergencyContactName: z.string().nullish(),
  emergencyContactPhone: z.string().nullish(),
  joinDate: z.string().min(4, "Join date is required"),
  notes: z.string().nullish(),
  /** Daily hours commitment agreed at joining (e.g. 4) — drives overtime reminders. */
  plannedHoursPerDay: z.number().min(0.5, "Enter at least 0.5 hours").max(24, "Cannot exceed 24 hours").nullish(),
  /** Chosen front-desk slot ("HH:mm-HH:mm" from gym.timeSlots) — which batch the member attends. */
  preferredSlot: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, "Pick a valid time slot")
    .nullish(),
  /**
   * Multi-slot selection at signup: every slot the student is assigned on
   * creation gets its own batch enrollment ("3 slots = 3 classes per day").
   * Same "HH:mm-HH:mm" strings as preferredSlot; preferredSlot stays the
   * primary row (first chip picked in the dialog).
   */
  slotRanges: z
    .array(
      z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, "Pick a valid time slot"),
    )
    .max(20, "Select at most 20 time slots")
    .nullish(),
  /** Selected tag ids (student labels — dance styles, batches, events…). */
  tagIds: z.array(z.string().trim()).max(20, "Pick at most 20 tags").nullish(),
  /** Assigned trainer (StaffProfile._id) — null/"" clears the assignment. */
  trainerId: z
    .union([z.string().trim().min(1), z.literal(""), z.literal(null)])
    .nullish()
    .transform((v) => v || null),
  /** Class stream the student belongs to — required on create. */
  classTag: z.enum(CLASS_TAGS, {
    errorMap: () => ({ message: "Choose a class tag (Art or Dance)" }),
  }),
  planId: z.string().min(1, "Plan is required"),
  membershipStart: z.string().min(4, "Membership start is required"),
  initialPayment: initialPaymentSchema.nullish(),
  /**
   * Individually chosen portal password for the new student (required).
   * Replaces the old shared default — each student sets their own.
   */
  loginPassword: z
    .string({ required_error: "Set a portal password for the student" })
    .min(6, "Portal password must be at least 6 characters")
    .max(72),
});

const updateMemberSchema = createMemberSchema
  .partial()
  .omit({ planId: true, membershipStart: true, initialPayment: true, loginPassword: true })
  .extend({ status: z.enum(["active", "inactive"]).optional() });

const renewSchema = z.object({
  memberId: z.string().optional(),
  planId: z.string().min(1, "Plan is required"),
  startDate: z.string().optional(),
  discount: z.number().min(0).optional(),
  notes: z.string().nullish(),
  source: z.enum(["new", "renewal", "extension", "correction"]).optional(),
  initialPayment: initialPaymentSchema.nullish(),
});

const setMemberStatusSchema = z.object({ status: z.enum(["active", "inactive"]) });

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function findMemberOr404(gymId, id)
{
  if (!Types.ObjectId.isValid(String(id))) throw notFound("Student not found");
  const member = await Member.findOne({ _id: id, gymId }).lean();
  if (!member) throw notFound("Student not found");
  return member;
}

/** Validates that every tag id belongs to the gym (returns ObjectIds; [] = clear). */
async function resolveTagIds(gymId, tagIds)
{
  const unique = [...new Set((tagIds ?? []).map(String))];
  if (unique.some((id) => !Types.ObjectId.isValid(id)))
  {
    throw badRequest("One of the selected tags is not valid.");
  }
  if (!unique.length) return [];
  const found = await Tag.find({ gymId, _id: { $in: unique } }).select("_id").lean();
  if (found.length !== unique.length)
  {
    throw badRequest("One of the selected tags no longer exists.");
  }
  return found.map((t) => t._id);
}

/** Validates an assigned trainer id belongs to the gym (null = unassigned). */
async function resolveTrainerId(gymId, trainerId)
{
  if (trainerId == null) return null;
  if (!Types.ObjectId.isValid(String(trainerId))) throw badRequest("The selected trainer is not valid.");
  const found = await StaffProfile.findOne({ gymId, _id: trainerId }).select("_id").lean();
  if (!found) throw badRequest("The selected trainer no longer exists.");
  return found._id;
}

const MEMBER_AUDIT_KEYS = [
  "fullName", "email", "phone", "photoUrl", "dateOfBirth", "age", "gender", "address",
  "emergencyContactName", "emergencyContactPhone", "joinDate", "notes", "status", "plannedHoursPerDay",
  "preferredSlot",
  "classTag",
  "tagIds",
];

/* ------------------------------------------------------------------ */
/*  Members CRUD                                                       */
/* ------------------------------------------------------------------ */

/** Attach the derived class-quota ({attended, remaining, status, label}) and the
 *  student's latest payment method to a page of member rows. */
async function attachQuotaToRows(rows)
{
  const ids = rows.map((r) => r.membership?.id).filter(Boolean);
  const memberIds = rows.map((r) => r.id).filter(Boolean);
  if (ids.length === 0 && memberIds.length === 0) return;
  const [counts, payments] = await Promise.all([
    ids.length
      ? AttendanceRecord.aggregate([
        { $match: { membershipId: { $in: ids.map((v) => new Types.ObjectId(v)) }, quotaCounted: true } },
        { $group: { _id: "$membershipId", attended: { $sum: 1 } } },
      ])
      : Promise.resolve([]),
    memberIds.length
      ? PaymentRecord.aggregate([
        { $match: { memberId: { $in: memberIds.map((v) => new Types.ObjectId(v)) } } },
        { $sort: { paymentDate: -1, _id: -1 } },
        { $group: { _id: "$memberId", method: { $first: "$method" } } },
      ])
      : Promise.resolve([]),
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c.attended]));
  const methodByMember = new Map(payments.map((p) => [String(p._id), p.method]));
  for (const row of rows)
  {
    const quota = row.membership?.classQuota ?? null;
    row.quota =
      quota == null ? null : computeQuota({ quota, attended: byId.get(String(row.membership.id)) ?? 0 });
    row.paymentMethod = methodByMember.get(String(row.id)) ?? null;
  }
}

/** GET /api/members?search&status&planId&sort&dir&page&pageSize → Paginated<MemberWithMembership> */
router.get(
  "/members",
  requireAuth,
  requireCap("members.view"),
  asyncHandler(async (req, res) =>
  {
    const ctx = await loadGymContext(req.user.gymId);
    let rows = await decorateAllMembers(ctx.gym._id, ctx);

    const search = String(req.query.search ?? "").trim().toLowerCase();
    if (search)
    {
      const compactSearch = search.replace(/\s/g, "");
      rows = rows.filter(
        (m) =>
          m.fullName.toLowerCase().includes(search) ||
          m.memberCode.toLowerCase().includes(search) ||
          m.phone.replace(/\s/g, "").includes(compactSearch) ||
          (m.email?.toLowerCase().includes(search) ?? false),
      );
    }

    switch (req.query.status)
    {
      case "active":
        rows = rows.filter((m) => m.effectiveStatus === "active");
        break;
      case "expiring_soon":
        rows = rows.filter((m) => m.effectiveStatus === "expiring_soon");
        break;
      case "expired":
        rows = rows.filter((m) => m.effectiveStatus === "expired");
        break;
      case "suspended":
        rows = rows.filter((m) => m.effectiveStatus === "suspended");
        break;
      case "inactive":
        rows = rows.filter((m) => m.effectiveStatus === "inactive" || m.status === "inactive");
        break;
      default:
        break;
    }

    if (req.query.planId)
    {
      const planId = String(req.query.planId);
      rows = rows.filter((m) => m.membership?.planId === planId);
    }

    if (req.query.tagId)
    {
      const tagId = String(req.query.tagId);
      rows = rows.filter((m) => (m.tagIds ?? []).some((id) => String(id) === tagId));
    }

    const dir = req.query.dir === "asc" ? 1 : -1;
    const sort = req.query.sort ?? "created";
    rows.sort((a, b) =>
    {
      switch (sort)
      {
        case "name":
          return a.fullName.localeCompare(b.fullName) * dir;
        case "joined":
          return (a.joinDate < b.joinDate ? -1 : 1) * dir;
        case "expiry":
          return ((a.membership?.endDate ?? "") < (b.membership?.endDate ?? "") ? -1 : 1) * dir;
        default:
          return (a.createdAt < b.createdAt ? -1 : 1) * dir;
      }
    });

    const page = intParam(req.query.page, 1);
    const pageSize = intParam(req.query.pageSize, 10, { min: 5, max: 100 });
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize);
    await attachQuotaToRows(items);
    res.json({ items, total: rows.length, page, pageSize });
  }),
);

/** GET /api/members/:id → MemberWithMembership */
router.get(
  "/members/:id",
  requireAuth,
  requireCap("members.view"),
  asyncHandler(async (req, res) =>
  {
    const ctx = await loadGymContext(req.user.gymId);
    const member = await Member.findOne({ _id: req.params.id, gymId: ctx.gym._id }).lean();
    if (!member) throw notFound("Student not found");
    const enrollments = await SlotEnrollment.find({
      gymId: ctx.gym._id,
      memberId: member._id,
      status: "enrolled",
    })
      .select("slotId")
      .lean();
    const slots = enrollments.length
      ? await ClassSlot.find({
          _id: { $in: enrollments.map((enrollment) => enrollment.slotId) },
          gymId: ctx.gym._id,
          isActive: true,
        })
          .select("startTime endTime")
          .lean()
      : [];
    res.json({
      ...(await decorateMember(member, ctx)),
      slotRanges: slots.map((slot) => `${slot.startTime}-${slot.endTime}`),
    });
  }),
);

/** POST /api/members (MemberCreateInput) */
router.post(
  "/members",
  requireAuth,
  requireCap("members.create"),
  asyncHandler(async (req, res) =>
  {
    const input = parseBody(createMemberSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const gymId = ctx.gym._id;

    const plan = await MembershipPlan.findOne({ _id: input.planId, gymId }).lean();
    if (!plan) throw badRequest("Selected membership plan was not found", "invalid_plan");

    let created;
    try
    {
      created = await withTransaction(async (session) =>
      {
        const dupPhone = await Member.findOne({ gymId, phone: input.phone })
          .select("_id")
          .session(session);
        if (dupPhone) throw conflict("A student with this phone number already exists", "duplicate_phone");
        if (input.email)
        {
          const dupEmail = await Member.findOne({ gymId, email: input.email })
            .select("_id")
            .session(session);
          if (dupEmail) throw conflict("A student with this email already exists", "duplicate_email");
        }

        const memberCode = await nextMemberCode(gymId, session);
        const [member] = await Member.create(
          [
            {
              gymId,
              memberCode,
              fullName: input.fullName,
              email: input.email ?? null,
              phone: input.phone,
              photoUrl: input.photoUrl ?? null,
              dateOfBirth: input.dateOfBirth ? parseDateOnly(input.dateOfBirth) : null,
              age: input.age ?? null,
              gender: input.gender ?? null,
              address: input.address ?? null,
              emergencyContactName: input.emergencyContactName ?? null,
              emergencyContactPhone: input.emergencyContactPhone ?? null,
              joinDate: parseDateOnly(input.joinDate),
              qrToken: generateQrToken(),
              qrStatus: "active",
              status: "active",
              notes: input.notes ?? null,
              plannedHoursPerDay: input.plannedHoursPerDay ?? null,
              preferredSlot: input.preferredSlot ?? (input.slotRanges?.[0] ?? null),
              classTag: input.classTag,
              tagIds: await resolveTagIds(gymId, input.tagIds ?? []),
              trainerId: await resolveTrainerId(gymId, input.trainerId ?? null),
              createdBy: req.user.id,
            },
          ],
          { session },
        );

        // Enroll the student in the batch matching their chosen slots, so they
        // show up as enrolled in Mark Attendance without a separate step.
        // MULTI-SLOT: the add-student dialog can now pick several time slots —
        // every one gets its own batch enrollment ("3 slots = 3 classes a day").
        // The batch is auto-created from daily time slots if it doesn't exist
        // yet. preferredSlot (first chip) stays the primary/front-desk row.
        const ranges = [
          ...new Set(
            [...(input.slotRanges ?? []), ...(input.preferredSlot ? [input.preferredSlot] : [])].filter(Boolean),
          ),
        ];
        for (const range of ranges)
        {
          const slotMatch = String(range ?? "").match(
            /^(([01]\d|2[0-3]):[0-5]\d)-(([01]\d|2[0-3]):[0-5]\d)$/,
          );
          if (!slotMatch) continue;
          const start = slotMatch[1];
          const end = slotMatch[3];
          let slot = await ClassSlot.findOne({
            gymId,
            startTime: start,
            endTime: end,
            isActive: true,
          })
            .session(session)
            .lean();
          if (!slot)
          {
            const [created] = await ClassSlot.create(
              [
                {
                  gymId,
                  name: `${start} – ${end}`,
                  weekdays: [0, 1, 2, 3, 4, 5, 6],
                  startTime: start,
                  endTime: end,
                  capacity: null,
                  instructorId: null,
                  isActive: true,
                  notes: "Auto-created from student's preferred slot",
                  createdBy: req.user.id,
                },
              ],
              { session },
            );
            slot = created.toObject ? created.toObject() : created;
          }
          const existingEnrollment = await SlotEnrollment.findOne({
            gymId,
            slotId: slot._id,
            memberId: member._id,
          })
            .session(session)
            .lean();
          if (!existingEnrollment)
          {
            await SlotEnrollment.create(
              [{ gymId, slotId: slot._id, memberId: member._id, status: "enrolled" }],
              { session },
            );
          } else if (existingEnrollment.status !== "enrolled")
          {
            await SlotEnrollment.updateOne(
              { _id: existingEnrollment._id },
              { $set: { status: "enrolled" } },
              { session },
            );
          }
        }

        // Portal login: the member can sign in with their member code.
        await ensureMemberLogin(
          {
            gymId,
            memberId: member._id,
            memberCode,
            fullName: input.fullName,
            phone: input.phone,
            password: input.loginPassword,
          },
          session,
        );
        const start = input.membershipStart
          ? parseDateOnly(input.membershipStart)
          : parseDateOnly(ymdInTz(ctx.now, ctx.tz));
        const end = parseDateOnly(planEndDate(start, plan));
        const [membership] = await MemberMembership.create(
          [
            {
              gymId,
              memberId: member._id,
              planId: plan._id,
              startDate: start,
              endDate: end,
              status: "active",
              price: plan.price,
              discount: 0,
              classQuota: quotaForPlan(plan),
              source: "new",
              notes: null,
              createdBy: req.user.id,
            },
          ],
          { session },
        );

        if (input.initialPayment)
        {
          await createPaymentRow(
            {
              gymId,
              actorId: req.user.id,
              memberId: member._id,
              membershipId: membership._id,
              amount: input.initialPayment.amount,
              method: input.initialPayment.method,
              paymentDate: input.initialPayment.paymentDate ?? ymd(start),
              transactionRef: input.initialPayment.transactionRef ?? null,
              notes: input.initialPayment.notes ?? null,
            },
            session,
          );
        }

        await writeAudit(
          {
            gymId,
            actorId: req.user.id,
            entity: "members",
            entityId: String(member._id),
            action: "create",
            newValues: { memberCode, fullName: member.fullName, planName: plan.name },
          },
          session,
        );

        return member;
      });
    } catch (err)
    {
      if (err?.code === 11000) throw conflict("A student with this phone or email already exists");
      throw err;
    }

    res.status(201).json(await decorateMember(created, ctx));
  }),
);

/** PATCH /api/members/:id (MemberUpdateInput) */
router.patch(
  "/members/:id",
  requireAuth,
  requireCap("members.edit"),
  asyncHandler(async (req, res) =>
  {
    const input = parseBody(updateMemberSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const member = await findMemberOr404(ctx.gym._id, req.params.id);

    const updates = {};
    if (input.tagIds !== undefined)
    {
      updates.tagIds = await resolveTagIds(member.gymId, input.tagIds ?? []);
    }
    if (input.trainerId !== undefined)
    {
      updates.trainerId = await resolveTrainerId(member.gymId, input.trainerId ?? null);
    }
    const dateFields = new Set(["dateOfBirth", "joinDate"]);
    for (const key of MEMBER_AUDIT_KEYS)
    {
      if (input[key] !== undefined)
      {
        updates[key] = dateFields.has(key) ? (input[key] ? parseDateOnly(input[key]) : null) : input[key];
      }
    }
    if (input.email !== undefined) updates.email = input.email || null;
    if (input.status !== undefined) updates.status = input.status;

    if (updates.email)
    {
      const dupEmail = await Member.findOne({
        gymId: ctx.gym._id,
        email: updates.email,
        _id: { $ne: member._id },
      }).select("_id");
      if (dupEmail) throw conflict("A student with this email already exists", "duplicate_email");
    }
    if (updates.phone)
    {
      const dupPhone = await Member.findOne({
        gymId: ctx.gym._id,
        phone: updates.phone,
        _id: { $ne: member._id },
      }).select("_id");
      if (dupPhone) throw conflict("A student with this phone number already exists", "duplicate_phone");
    }

    const updated = await withTransaction(async (session) =>
    {
      const current = await Member.findOne({ _id: member._id, gymId: ctx.gym._id }).session(session).lean();
      if (!current) throw notFound("Student not found");

      const saved = await Member.findOneAndUpdate(
        { _id: current._id, gymId: ctx.gym._id },
        { $set: updates },
        { new: true, runValidators: true, session },
      ).lean();

      if (input.slotRanges !== undefined)
      {
        const ranges = [...new Set(input.slotRanges ?? [])];
        const activeEnrollments = await SlotEnrollment.find({
          gymId: ctx.gym._id,
          memberId: current._id,
          status: "enrolled",
        })
          .session(session)
          .lean();
        const keepSlotIds = new Set();

        for (const range of ranges)
        {
          const [startTime, endTime] = range.split("-");
          let slot = await ClassSlot.findOne({
            gymId: ctx.gym._id,
            startTime,
            endTime,
            isActive: true,
          })
            .session(session)
            .lean();

          if (!slot)
          {
            const inactiveMatch = await ClassSlot.findOne({
              gymId: ctx.gym._id,
              startTime,
              endTime,
              isActive: false,
            })
              .session(session)
              .lean();
            if (inactiveMatch)
            {
              throw conflict(
                `The ${startTime} – ${endTime} slot is inactive. Activate it in Manage Institute before assigning it.`,
                "slot_inactive",
              );
            }

            const [createdSlot] = await ClassSlot.create(
              [
                {
                  gymId: ctx.gym._id,
                  name: `${startTime} – ${endTime}`,
                  weekdays: [0, 1, 2, 3, 4, 5, 6],
                  startTime,
                  endTime,
                  capacity: null,
                  classTag: updates.classTag ?? current.classTag ?? null,
                  instructorId: null,
                  isActive: true,
                  notes: "Auto-created from student's preferred slot",
                  createdBy: req.user.id,
                },
              ],
              { session },
            );
            slot = createdSlot.toObject();
          }

          keepSlotIds.add(String(slot._id));
          const existing = await SlotEnrollment.findOne({
            gymId: ctx.gym._id,
            slotId: slot._id,
            memberId: current._id,
          })
            .session(session)
            .lean();
          if (existing?.status === "enrolled") continue;

          if (existing?.status !== "enrolled" && slot.capacity != null)
          {
            const enrolledCount = await SlotEnrollment.countDocuments({
              gymId: ctx.gym._id,
              slotId: slot._id,
              status: "enrolled",
            }).session(session);
            if (enrolledCount >= slot.capacity)
            {
              throw conflict(`The ${startTime} – ${endTime} slot is at capacity.`, "slot_full");
            }
          }

          let enrollment;
          if (existing)
          {
            enrollment = await SlotEnrollment.findOneAndUpdate(
              { _id: existing._id },
              { $set: { status: "enrolled", enrolledAt: new Date() } },
              { new: true, session },
            ).lean();
          } else
          {
            [enrollment] = await SlotEnrollment.create(
              [{ gymId: ctx.gym._id, slotId: slot._id, memberId: current._id, status: "enrolled" }],
              { session },
            );
            enrollment = enrollment.toObject();
          }

          await writeAudit(
            {
              gymId: ctx.gym._id,
              actorId: req.user.id,
              entity: "slot_enrollments",
              entityId: String(enrollment._id),
              action: "enroll",
              newValues: { slot: slot.name, memberCode: current.memberCode },
            },
            session,
          );
        }

        for (const enrollment of activeEnrollments)
        {
          if (keepSlotIds.has(String(enrollment.slotId))) continue;
          await SlotEnrollment.updateOne(
            { _id: enrollment._id },
            { $set: { status: "cancelled" } },
            { session },
          );
          await writeAudit(
            {
              gymId: ctx.gym._id,
              actorId: req.user.id,
              entity: "slot_enrollments",
              entityId: String(enrollment._id),
              action: "unenroll",
              oldValues: { status: "enrolled" },
              newValues: { status: "cancelled", memberCode: current.memberCode },
            },
            session,
          );
        }
      }

      await writeAudit(
        {
          gymId: ctx.gym._id,
          actorId: req.user.id,
          entity: "members",
          entityId: String(current._id),
          action: "update",
          oldValues: pick(current, MEMBER_AUDIT_KEYS),
          newValues: pick(updates, MEMBER_AUDIT_KEYS),
        },
        session,
      );
      return saved;
    });

    // Keep the portal login in lockstep with the member's status.
    if (input.status !== undefined && input.status !== member.status)
    {
      await syncMemberLoginStatus(member._id, input.status === "active");
    }

    res.json(await decorateMember(updated, ctx));
  }),
);

/** DELETE /api/members/:id — blocked when payment history exists (deactivate instead). */
router.delete(
  "/members/:id",
  requireAuth,
  requireCap("members.delete"),
  asyncHandler(async (req, res) =>
  {
    const ctx = await loadGymContext(req.user.gymId);
    const member = await findMemberOr404(ctx.gym._id, req.params.id);

    const payments = await PaymentRecord.countDocuments({ memberId: member._id });
    if (payments > 0)
    {
      throw badRequest(
        "This student has payment history and cannot be deleted. Deactivate the student instead.",
        "has_payments",
      );
    }

    await withTransaction(async (session) =>
    {
      await Member.deleteOne({ _id: member._id }, { session });
      await MemberMembership.deleteMany({ memberId: member._id }, { session });
      await AttendanceRecord.deleteMany({ memberId: member._id }, { session });
      await ClassEnrollment.deleteMany({ memberId: member._id }, { session });
      // Batch (slot) enrollments too — otherwise the deleted student lingers
      // as a "ghost" in every batch they were enroled in, inflating the
      // per-slot and group student counts on the attendance screen.
      await SlotEnrollment.deleteMany({ memberId: member._id }, { session });
      await writeAudit(
        {
          gymId: ctx.gym._id,
          actorId: req.user.id,
          entity: "members",
          entityId: String(member._id),
          action: "delete",
          oldValues: { memberCode: member.memberCode, fullName: member.fullName },
        },
        session,
      );
    });

    res.status(204).end();
  }),
);

/** PATCH /api/members/:id/status { status } */
router.patch(
  "/members/:id/status",
  requireAuth,
  requireCap("members.edit"),
  asyncHandler(async (req, res) =>
  {
    const { status } = parseBody(setMemberStatusSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const member = await findMemberOr404(ctx.gym._id, req.params.id);

    const updated = await Member.findOneAndUpdate(
      { _id: member._id },
      { $set: { status } },
      { new: true },
    ).lean();

    // Deactivation must also block the student's portal login (and reactivation
    // restores it). Handles members with no login row gracefully (no-op).
    const loginsUpdated = await syncMemberLoginStatus(member._id, status === "active");

    await writeAudit({
      gymId: ctx.gym._id,
      actorId: req.user.id,
      entity: "members",
      entityId: String(member._id),
      action: "set_status",
      oldValues: { status: member.status },
      newValues: { status, loginsSynced: loginsUpdated },
    });

    res.json(await decorateMember(updated, ctx));
  }),
);

/* ------------------------------------------------------------------ */
/*  Memberships / QR / history                                         */
/* ------------------------------------------------------------------ */

/** GET /api/members/:id/memberships → MemberMembership[] (newest first) */
router.get(
  "/members/:id/memberships",
  requireAuth,
  requireCap("members.view"),
  asyncHandler(async (req, res) =>
  {
    const ctx = await loadGymContext(req.user.gymId);
    const member = await findMemberOr404(ctx.gym._id, req.params.id);
    const rows = await MemberMembership.find({ memberId: member._id })
      .sort({ startDate: -1 })
      .lean();
    const plans = await MembershipPlan.find({ gymId: ctx.gym._id }).lean();
    const planById = new Map(plans.map((p) => [String(p._id), p]));
    res.json(rows.map((row) => toMembership(row, planById.get(String(row.planId)))));
  }),
);

/** POST /api/members/:id/renew (RenewMembershipInput) → MemberMembership */
router.post(
  "/members/:id/renew",
  requireAuth,
  requireCap("members.edit"),
  asyncHandler(async (req, res) =>
  {
    const input = parseBody(renewSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const member = await findMemberOr404(ctx.gym._id, req.params.id);

    const plan = await MembershipPlan.findOne({
      _id: input.planId,
      gymId: ctx.gym._id,
      isActive: true,
    }).lean();
    if (!plan) throw badRequest("Selected plan was not found or is inactive", "invalid_plan");

    const discount = input.discount ?? 0;
    if (discount < 0 || discount > plan.price)
    {
      throw badRequest("Discount must be between 0 and the plan price", "invalid_discount");
    }

    const membership = await withTransaction(async (session) =>
    {
      // Per-member lock so two renewals/scans cannot interleave.
      await Member.updateOne({ _id: member._id }, { $inc: { scanLock: 1 } }, { session });

      const existing = await MemberMembership.find({
        memberId: member._id,
        status: { $ne: "cancelled" },
      })
        .session(session)
        .lean();
      const current = currentMembership(existing);
      // renewalStartDate expects date-only strings; lean docs hold BSON Dates.
      const currentForStart = current ? { endDate: ymd(current.endDate) } : null;

      const start = input.startDate
        ? parseDateOnly(input.startDate)
        : parseDateOnly(renewalStartDate(ctx.now, currentForStart, ctx.tz));
      const end = parseDateOnly(planEndDate(start, plan));

      // Supersede any still-active memberships so only the new renewal is active.
      await MemberMembership.updateMany(
        { memberId: member._id, status: "active" },
        { $set: { status: "inactive" } },
        { session },
      );
      const [row] = await MemberMembership.create(
        [
          {
            gymId: ctx.gym._id,
            memberId: member._id,
            planId: plan._id,
            startDate: start,
            endDate: end,
            status: "active",
            price: plan.price,
            discount,
            classQuota: quotaForPlan(plan),
            source: input.source ?? "renewal",
            notes: input.notes ?? null,
            createdBy: req.user.id,
          },
        ],
        { session },
      );

      if (input.initialPayment)
      {
        await createPaymentRow(
          {
            gymId: ctx.gym._id,
            actorId: req.user.id,
            memberId: member._id,
            membershipId: row._id,
            amount: input.initialPayment.amount,
            method: input.initialPayment.method,
            transactionRef: input.initialPayment.transactionRef ?? null,
            notes: input.initialPayment.notes ?? null,
          },
          session,
        );
      }

      await writeAudit(
        {
          gymId: ctx.gym._id,
          actorId: req.user.id,
          entity: "member_memberships",
          entityId: String(row._id),
          action: "create",
          newValues: {
            memberCode: member.memberCode,
            planName: plan.name,
            startDate: ymd(start),
            endDate: ymd(end),
            price: plan.price,
            discount,
            source: row.source,
          },
        },
        session,
      );

      return row;
    });

    res.status(201).json(toMembership(membership, plan));
  }),
);

/** POST /api/members/:id/rotate-qr → Member (fresh token, never echoed to logs) */
router.post(
  "/members/:id/rotate-qr",
  requireAuth,
  requireCap("qr.regenerate"),
  asyncHandler(async (req, res) =>
  {
    const ctx = await loadGymContext(req.user.gymId);
    const member = await findMemberOr404(ctx.gym._id, req.params.id);

    const updated = await Member.findOneAndUpdate(
      { _id: member._id },
      { $set: { qrToken: generateQrToken(), qrRotatedAt: new Date(), qrStatus: "active" } },
      { new: true },
    ).lean();

    await writeAudit({
      gymId: ctx.gym._id,
      actorId: req.user.id,
      entity: "members",
      entityId: String(member._id),
      action: "rotate_qr",
      newValues: { qrRotatedAt: updated.qrRotatedAt },
    });

    res.json(toMember(updated));
  }),
);

/** GET /api/members/:id/attendance?limit=20 → AttendanceRecord[] (newest first) */
router.get(
  "/members/:id/attendance",
  requireAuth,
  requireCap("attendance.view"),
  asyncHandler(async (req, res) =>
  {
    const ctx = await loadGymContext(req.user.gymId);
    const member = await findMemberOr404(ctx.gym._id, req.params.id);
    const limit = intParam(req.query.limit, 20, { min: 1, max: 200 });
    const rows = await AttendanceRecord.find({ memberId: member._id })
      .sort({ checkIn: -1 })
      .limit(limit)
      .lean();
    res.json(rows.map((row) => toAttendance(row, member, null)));
  }),
);

/** GET /api/members/:id/payments?pageSize=20 → PaymentRecord[] (newest first) */
router.get(
  "/members/:id/payments",
  requireAuth,
  requireCap("payments.view"),
  asyncHandler(async (req, res) =>
  {
    const ctx = await loadGymContext(req.user.gymId);
    const member = await findMemberOr404(ctx.gym._id, req.params.id);
    const pageSize = intParam(req.query.pageSize, 20, { min: 1, max: 200 });
    const rows = await PaymentRecord.find({ memberId: member._id })
      .sort({ paymentDate: -1 })
      .limit(pageSize)
      .lean();

    const membershipIds = [...new Set(rows.map((r) => r.membershipId).filter(Boolean).map(String))];
    const memberships = membershipIds.length
      ? await MemberMembership.find({ _id: { $in: membershipIds } }).lean()
      : [];
    const membershipById = new Map(memberships.map((m) => [String(m._id), m]));
    const planIds = [...new Set(memberships.map((m) => String(m.planId)))];
    const plans = planIds.length ? await MembershipPlan.find({ _id: { $in: planIds } }).lean() : [];
    const planById = new Map(plans.map((p) => [String(p._id), p]));

    res.json(
      rows.map((row) =>
      {
        const membership = row.membershipId ? membershipById.get(String(row.membershipId)) : null;
        const plan = membership ? planById.get(String(membership.planId)) : null;
        return toPayment(row, member, membership, plan);
      }),
    );
  }),
);

export default router;
