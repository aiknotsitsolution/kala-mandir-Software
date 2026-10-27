/** Payment row creation (shared by payments route, renewals and member signup). */

import PaymentRecord from "../models/PaymentRecord.js";
import Member from "../models/Member.js";
import MemberMembership from "../models/MemberMembership.js";
import MembershipPlan from "../models/MembershipPlan.js";
import { nextReceiptNo } from "../lib/codes.js";
import { writeAudit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { parseDateOnly } from "../lib/dates.js";
import { membershipBalance } from "../lib/membership.js";
import { ymd } from "../lib/serialize.js";

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Validate + insert a payment row and audit it. Honours idempotencyKey:
 * replaying the same key returns the original row untouched.
 * Pass `session` when running inside a transaction.
 */
export async function createPaymentRow(input, session = null) {
  const {
    gymId,
    actorId = null,
    memberId,
    membershipId = null,
    amount,
    method,
    paymentDate = null,
    status = "paid",
    transactionRef = null,
    notes = null,
    idempotencyKey = null,
  } = input;

  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw badRequest("Amount must be greater than zero", "invalid_amount");
  }

  const member = await Member.findOne({ _id: memberId, gymId }).session(session);
  if (!member) throw notFound("Student not found");

  if (membershipId) {
    const membership = await MemberMembership.findOne({ _id: membershipId, memberId, gymId })
      .session(session);
    if (!membership) {
      throw badRequest("Membership does not belong to this student", "invalid_membership");
    }
  }

  if (idempotencyKey) {
    const existing = await PaymentRecord.findOne({ gymId, idempotencyKey }).session(session);
    if (existing) return { row: existing, replayed: true };
  }

  const receiptNo = await nextReceiptNo(gymId, session);
  const [row] = await PaymentRecord.create(
    [
      {
        gymId,
        memberId,
        membershipId: membershipId || null,
        amount: round2(Number(amount)),
        method,
        paymentDate: paymentDate ? parseDateOnly(paymentDate) : new Date(),
        status,
        transactionRef: transactionRef || null,
        notes: notes || null,
        receiptNo,
        recordedBy: actorId,
        idempotencyKey: idempotencyKey || null,
      },
    ],
    { session },
  );

  await writeAudit(
    {
      gymId,
      actorId,
      entity: "payment_records",
      entityId: String(row._id),
      action: "create",
      newValues: { receiptNo, amount: row.amount, method, status, memberCode: member.memberCode },
    },
    session,
  );

  return { row, replayed: false };
}

/**
 * Dues: every non-cancelled membership with a positive outstanding balance.
 * Mirrors the demo data layer's getDues(). Sorted by balance desc.
 */
export async function getDuesRows(gymId) {
  const [memberships, members, plans, payments] = await Promise.all([
    MemberMembership.find({ gymId, status: { $ne: "cancelled" } }).lean(),
    Member.find({ gymId }).select("fullName memberCode").lean(),
    MembershipPlan.find({ gymId }).select("name").lean(),
    PaymentRecord.find({ gymId, status: { $in: ["paid", "partial"] } })
      .select("membershipId amount")
      .lean(),
  ]);

  const memberById = new Map(members.map((m) => [String(m._id), m]));
  const planById = new Map(plans.map((p) => [String(p._id), p]));
  const paidByMembership = new Map();
  for (const p of payments) {
    const key = String(p.membershipId);
    paidByMembership.set(key, round2((paidByMembership.get(key) ?? 0) + (p.amount ?? 0)));
  }

  const rows = [];
  for (const membership of memberships) {
    const member = memberById.get(String(membership.memberId));
    if (!member) continue;
    const paid = paidByMembership.get(String(membership._id)) ?? 0;
    const balance = membershipBalance(membership.price, membership.discount, [
      { amount: paid, status: "paid" },
    ]);
    if (balance <= 0) continue;
    rows.push({
      memberId: String(member._id),
      memberCode: member.memberCode,
      memberName: member.fullName,
      membershipId: String(membership._id),
      planName: planById.get(String(membership.planId))?.name ?? "Plan",
      endDate: ymd(membership.endDate),
      billed: Math.max(0, membership.price - membership.discount),
      paid,
      balance,
    });
  }
  return rows.sort((a, b) => b.balance - a.balance);
}
