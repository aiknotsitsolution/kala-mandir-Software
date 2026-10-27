import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import PaymentRecord from "../models/PaymentRecord.js";
import Member from "../models/Member.js";
import MemberMembership from "../models/MemberMembership.js";
import MembershipPlan from "../models/MembershipPlan.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler, badRequest, notFound } from "../lib/errors.js";
import { parseBody, intParam, escapeRegExp } from "../middleware/validate.js";
import { toPayment } from "../lib/serialize.js";
import { writeAudit } from "../lib/audit.js";
import { nextReceiptNo } from "../lib/codes.js";
import {
  parseDateOnly,
  addMonthsClamped,
  monthKeyInTz,
  monthShortYearLabel,
} from "../lib/dates.js";
import { withTransaction } from "../db.js";
import { loadGymContext } from "../services/context.js";
import { createPaymentRow, getDuesRows } from "../services/payments.js";

const router = Router();

const paymentMethodEnum = z.enum(["cash", "upi", "card", "bank_transfer", "other"]);

const createPaymentSchema = z.object({
  memberId: z.string().min(1, "Student is required"),
  membershipId: z.string().nullish(),
  amount: z.number().positive("Amount must be greater than zero"),
  method: paymentMethodEnum,
  paymentDate: z.string().optional(),
  status: z.enum(["paid", "partial", "pending"]).optional(),
  transactionRef: z.string().nullish(),
  notes: z.string().nullish(),
  idempotencyKey: z.string().optional(),
});

const refundSchema = z.object({
  amount: z.number().positive("Refund amount must be greater than zero"),
  reason: z.string().trim().min(1, "Refund reason is required"),
});

/** Decorate a batch of payment rows with member/membership/plan info. */
async function decoratePayments(gymId, rows) {
  const memberIds = [...new Set(rows.map((r) => String(r.memberId)))];
  const membershipIds = [...new Set(rows.map((r) => r.membershipId).filter(Boolean).map(String))];
  const [members, memberships] = await Promise.all([
    memberIds.length ? Member.find({ _id: { $in: memberIds }, gymId }).lean() : [],
    membershipIds.length ? MemberMembership.find({ _id: { $in: membershipIds } }).lean() : [],
  ]);
  const planIds = [...new Set(memberships.map((m) => String(m.planId)))];
  const plans = planIds.length ? await MembershipPlan.find({ _id: { $in: planIds } }).lean() : [];

  const memberById = new Map(members.map((m) => [String(m._id), m]));
  const membershipById = new Map(memberships.map((m) => [String(m._id), m]));
  const planById = new Map(plans.map((p) => [String(p._id), p]));

  return rows.map((row) => {
    const membership = row.membershipId ? membershipById.get(String(row.membershipId)) : null;
    const plan = membership ? planById.get(String(membership.planId)) : null;
    return toPayment(row, memberById.get(String(row.memberId)), membership, plan);
  });
}

/** GET /api/payments?search&from&to&status&method&memberId&page&pageSize → Paginated<PaymentRecord> */
router.get(
  "/payments",
  requireAuth,
  requireCap("payments.view"),
  asyncHandler(async (req, res) => {
    const gymId = req.user.gymId;
    const filter = { gymId };

    const search = String(req.query.search ?? "").trim();
    if (search) {
      const rx = new RegExp(escapeRegExp(search), "i");
      const members = await Member.find({
        gymId,
        $or: [{ fullName: rx }, { memberCode: rx }],
      })
        .select("_id")
        .lean();
      filter.$or = [
        { memberId: { $in: members.map((m) => m._id) } },
        { receiptNo: rx },
        { transactionRef: rx },
      ];
    }
    if (req.query.from) filter.paymentDate = { ...filter.paymentDate, $gte: parseDateOnly(req.query.from) };
    if (req.query.to) filter.paymentDate = { ...filter.paymentDate, $lte: parseDateOnly(req.query.to) };
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.method && req.query.method !== "all") filter.method = req.query.method;
    if (req.query.memberId && Types.ObjectId.isValid(String(req.query.memberId))) {
      filter.memberId = req.query.memberId;
    }

    const page = intParam(req.query.page, 1);
    const pageSize = intParam(req.query.pageSize, 15, { min: 5, max: 100 });
    const [total, rows] = await Promise.all([
      PaymentRecord.countDocuments(filter),
      PaymentRecord.find(filter)
        .sort({ paymentDate: -1, createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    res.json({ items: await decoratePayments(gymId, rows), total, page, pageSize });
  }),
);

/** POST /api/payments (PaymentCreateInput incl. idempotencyKey) → PaymentRecord */
router.post(
  "/payments",
  requireAuth,
  requireCap("payments.record"),
  asyncHandler(async (req, res) => {
    const input = parseBody(createPaymentSchema, req.body);
    const gymId = req.user.gymId;

    const membershipId =
      input.membershipId && Types.ObjectId.isValid(String(input.membershipId))
        ? input.membershipId
        : null;

    const { row } = await withTransaction((session) =>
      createPaymentRow(
        {
          gymId,
          actorId: req.user.id,
          memberId: input.memberId,
          membershipId,
          amount: input.amount,
          method: input.method,
          paymentDate: input.paymentDate ?? null,
          status: input.status ?? "paid",
          transactionRef: input.transactionRef ?? null,
          notes: input.notes ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
        },
        session,
      ),
    );

    const [decorated] = await decoratePayments(gymId, [row.toObject()]);
    res.status(201).json(decorated);
  }),
);

/** POST /api/payments/:id/refund { amount, reason } → PaymentRecord (creates a refund row) */
router.post(
  "/payments/:id/refund",
  requireAuth,
  requireCap("payments.refund"),
  asyncHandler(async (req, res) => {
    const input = parseBody(refundSchema, req.body);
    const gymId = req.user.gymId;

    const original = await PaymentRecord.findOne({ _id: req.params.id, gymId }).lean();
    if (!original) throw notFound("Payment not found");
    if (original.refundOf) throw badRequest("This row is already a refund", "already_refund");
    if (input.amount <= 0 || input.amount > original.amount) {
      throw badRequest("Refund must be between ₹0 and the original amount", "invalid_amount");
    }

    const refund = await withTransaction(async (session) => {
      const [row] = await PaymentRecord.create(
        [
          {
            gymId,
            memberId: original.memberId,
            membershipId: original.membershipId ?? null,
            amount: input.amount,
            paymentDate: new Date(),
            method: original.method,
            status: "refunded",
            transactionRef: original.transactionRef ?? null,
            notes: `Refund: ${input.reason}`,
            receiptNo: await nextReceiptNo(gymId, session),
            recordedBy: req.user.id,
            refundOf: original._id,
          },
        ],
        { session },
      );

      await writeAudit(
        {
          gymId,
          actorId: req.user.id,
          entity: "payment_records",
          entityId: String(row._id),
          action: "refund_payment",
          newValues: {
            amount: input.amount,
            reason: input.reason,
            original: original.receiptNo,
          },
        },
        session,
      );

      return row;
    });

    const [decorated] = await decoratePayments(gymId, [refund.toObject()]);
    res.status(201).json(decorated);
  }),
);

/** GET /api/payments/dues → DuesRow[] (memberships with a positive balance) */
router.get(
  "/payments/dues",
  requireAuth,
  requireCap("payments.view"),
  asyncHandler(async (req, res) => {
    res.json(await getDuesRows(req.user.gymId));
  }),
);

/** GET /api/payments/revenue?months=6 → RevenueSummary[] */
router.get(
  "/payments/revenue",
  requireAuth,
  requireCap("reports.view"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const months = intParam(req.query.months, 6, { min: 1, max: 36 });
    const now = ctx.now;

    const monthKeys = [];
    for (let i = months - 1; i >= 0; i -= 1) {
      monthKeys.push(monthKeyInTz(addMonthsClamped(now, -i), ctx.tz));
    }

    const firstMonthStart = parseDateOnly(`${monthKeys[0]}-01`);
    const end = new Date(addMonthsClamped(parseDateOnly(`${monthKeys[monthKeys.length - 1]}-01`), 1));

    const [collectedRows, refundedRows, expectedRows] = await Promise.all([
      PaymentRecord.find({
        gymId: ctx.gym._id,
        status: { $in: ["paid", "partial"] },
        paymentDate: { $gte: firstMonthStart, $lt: end },
      })
        .select("paymentDate amount")
        .lean(),
      PaymentRecord.find({
        gymId: ctx.gym._id,
        status: "refunded",
        paymentDate: { $gte: firstMonthStart, $lt: end },
      })
        .select("paymentDate amount")
        .lean(),
      MemberMembership.find({
        gymId: ctx.gym._id,
        startDate: { $gte: firstMonthStart, $lt: end },
      })
        .select("startDate price discount")
        .lean(),
    ]);

    const round2 = (v) => Math.round(v * 100) / 100;
    const keyOf = (date) => monthKeyInTz(new Date(date), ctx.tz);

    const collectedByKey = new Map();
    const countByKey = new Map();
    for (const p of collectedRows) {
      const key = keyOf(p.paymentDate);
      collectedByKey.set(key, round2((collectedByKey.get(key) ?? 0) + p.amount));
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }
    const refundedByKey = new Map();
    for (const p of refundedRows) {
      const key = keyOf(p.paymentDate);
      refundedByKey.set(key, round2((refundedByKey.get(key) ?? 0) + p.amount));
    }
    const expectedByKey = new Map();
    for (const m of expectedRows) {
      const key = keyOf(m.startDate);
      expectedByKey.set(key, round2((expectedByKey.get(key) ?? 0) + Math.max(0, m.price - m.discount)));
    }

    const out = monthKeys.map((key) => {
      const collected = Math.max(0, (collectedByKey.get(key) ?? 0) - (refundedByKey.get(key) ?? 0));
      const expected = expectedByKey.get(key) ?? 0;
      return {
        month: key,
        label: monthShortYearLabel(key),
        collected,
        expected,
        outstanding: Math.max(0, round2(expected - collected)),
        count: countByKey.get(key) ?? 0,
      };
    });
    res.json(out);
  }),
);

export default router;
