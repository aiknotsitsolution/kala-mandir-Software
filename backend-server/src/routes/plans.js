import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import MembershipPlan from "../models/MembershipPlan.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler, badRequest, notFound, conflict } from "../lib/errors.js";
import { parseBody } from "../middleware/validate.js";
import { toPlan } from "../lib/serialize.js";
import { writeAudit, pick } from "../lib/audit.js";
import { loadGymContext } from "../services/context.js";

const router = Router();

const createPlanSchema = z.object({
  name: z.string().trim().min(1, "Plan name is required"),
  description: z.string().nullish(),
  price: z.number().min(0),
  durationValue: z.number().int().min(1),
  durationUnit: z.enum(["day", "week", "month", "year"]),
  /** Optional monthly dance-class quota (12/20/24 …). null/omitted = duration-only. */
  classQuota: z.number().int().min(0).nullish(),
  /** Optional weekly schedule line (e.g. "Monday – Friday"). null/omitted = derive from duration. */
  scheduleLabel: z.string().trim().max(60).nullish(),
  benefits: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const updatePlanSchema = createPlanSchema.partial();
const setActiveSchema = z.object({ isActive: z.boolean() });

const PLAN_KEYS = ["name", "description", "price", "durationValue", "durationUnit", "classQuota", "scheduleLabel", "benefits", "isActive", "sortOrder"];

async function findPlanOr404(gymId, id) {
  if (!Types.ObjectId.isValid(String(id))) throw notFound("Membership plan not found");
  const plan = await MembershipPlan.findOne({ _id: id, gymId }).lean();
  if (!plan) throw notFound("Membership plan not found");
  return plan;
}

/** GET /api/plans?includeInactive=1 → MembershipPlan[] */
router.get(
  "/plans",
  requireAuth,
  requireCap("plans.view"),
  asyncHandler(async (req, res) => {
    const includeInactive =
      req.query.includeInactive === "1" ||
      req.query.includeInactive === "true" ||
      req.query.includeInactive === undefined;
    const filter = { gymId: req.user.gymId };
    if (!includeInactive) filter.isActive = true;
    const rows = await MembershipPlan.find(filter).sort({ sortOrder: 1 }).lean();
    res.json(rows.map(toPlan));
  }),
);

/** POST /api/plans */
router.post(
  "/plans",
  requireAuth,
  requireCap("plans.manage"),
  asyncHandler(async (req, res) => {
    const input = parseBody(createPlanSchema, req.body);
    const gymId = req.user.gymId;

    const existing = await MembershipPlan.findOne({
      gymId,
      name: new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
    }).select("_id");
    if (existing) throw conflict("A plan with this name already exists", "duplicate_name");

    const [plan] = await MembershipPlan.create([
      {
        gymId,
        name: input.name,
        description: input.description ?? null,
        price: input.price,
        durationValue: input.durationValue,
        durationUnit: input.durationUnit,
        classQuota: input.classQuota ?? null,
        scheduleLabel: input.scheduleLabel ?? null,
        benefits: input.benefits ?? [],
        isActive: input.isActive ?? true,
        sortOrder: input.sortOrder ?? 0,
      },
    ]);

    await writeAudit({
      gymId,
      actorId: req.user.id,
      entity: "membership_plans",
      entityId: String(plan._id),
      action: "create",
      newValues: { name: plan.name, price: plan.price, classQuota: plan.classQuota ?? null },
    });

    res.status(201).json(toPlan(plan));
  }),
);

/** PATCH /api/plans/:id */
router.patch(
  "/plans/:id",
  requireAuth,
  requireCap("plans.manage"),
  asyncHandler(async (req, res) => {
    const input = parseBody(updatePlanSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const plan = await findPlanOr404(ctx.gym._id, req.params.id);

    if (input.name && input.name.toLowerCase() !== plan.name.toLowerCase()) {
      const dup = await MembershipPlan.findOne({
        gymId: ctx.gym._id,
        name: new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
        _id: { $ne: plan._id },
      }).select("_id");
      if (dup) throw conflict("A plan with this name already exists", "duplicate_name");
    }

    const updates = {};
    for (const key of PLAN_KEYS) {
      if (input[key] !== undefined) updates[key] = input[key];
    }

    const updated = await MembershipPlan.findOneAndUpdate(
      { _id: plan._id },
      { $set: updates },
      { new: true },
    ).lean();

    await writeAudit({
      gymId: ctx.gym._id,
      actorId: req.user.id,
      entity: "membership_plans",
      entityId: String(plan._id),
      action: "update",
      oldValues: pick(plan, PLAN_KEYS),
      newValues: pick(updates, PLAN_KEYS),
    });

    res.json(toPlan(updated));
  }),
);

/** PATCH /api/plans/:id/active { isActive } — archive/restore (never a hard delete). */
router.patch(
  "/plans/:id/active",
  requireAuth,
  requireCap("plans.manage"),
  asyncHandler(async (req, res) => {
    const { isActive } = parseBody(setActiveSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);
    const plan = await findPlanOr404(ctx.gym._id, req.params.id);

    const updated = await MembershipPlan.findOneAndUpdate(
      { _id: plan._id },
      { $set: { isActive } },
      { new: true },
    ).lean();

    await writeAudit({
      gymId: ctx.gym._id,
      actorId: req.user.id,
      entity: "membership_plans",
      entityId: String(plan._id),
      action: isActive ? "restore" : "archive",
      oldValues: { isActive: plan.isActive },
      newValues: { isActive },
    });

    res.json(toPlan(updated));
  }),
);

export default router;
