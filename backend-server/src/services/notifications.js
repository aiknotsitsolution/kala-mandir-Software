/**
 * Notification sweep — port of the `generate_expiry_notifications` RPC.
 * Upserts expiry_warning / membership_expired / payment_pending rows,
 * idempotent via dedupeKey. Returns how many rows were created.
 */

import AppNotification from "../models/AppNotification.js";
import Member from "../models/Member.js";
import MemberMembership from "../models/MemberMembership.js";
import PaymentRecord from "../models/PaymentRecord.js";
import { ymdInTz, parseDateOnly, addDays } from "../lib/dates.js";
import { ymd } from "../lib/serialize.js";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Oct 2026" for a `YYYY-MM-DD` string. */
export function formatDateOnly(ymdStr) {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[(m ?? 1) - 1]} ${y}`;
}

export async function rebuildNotifications(gymId, ctx) {
  const { settings, tz } = ctx;
  const now = new Date();
  const todayYmd = ymdInTz(now, tz);
  const today = parseDateOnly(todayYmd);
  const soonDays = Math.max(1, settings?.expiringSoonDays ?? 7);
  const soonestYmd = ymd(addDays(today, soonDays));

  const [memberships, members, paidMemberships] = await Promise.all([
    MemberMembership.find({ gymId, status: "active", startDate: { $lte: addDays(today, 1) } }).lean(),
    Member.find({ gymId }).lean(),
    PaymentRecord.find({ gymId, status: { $in: ["paid", "partial"] }, membershipId: { $ne: null } })
      .select("membershipId")
      .lean(),
  ]);

  const memberById = new Map(members.map((m) => [String(m._id), m]));
  const hasPayment = new Set(paidMemberships.map((p) => String(p.membershipId)));

  const ops = [];
  const upsert = (type, memberId, dedupeKey, doc) => {
    ops.push({
      updateOne: {
        filter: { gymId, type, dedupeKey },
        update: {
          $setOnInsert: {
            gymId,
            userId: null,
            memberId,
            type,
            title: doc.title,
            body: doc.body,
            severity: doc.severity,
            isRead: false,
            dedupeKey,
            link: doc.link,
          },
        },
        upsert: true,
      },
    });
  };

  for (const membership of memberships) {
    const member = memberById.get(String(membership.memberId));
    if (!member) continue;
    const end = ymd(membership.endDate);
    const start = ymd(membership.startDate);
    const link = `/members/${member._id}`;

    // a) Expiring soon (warning)
    if (end >= todayYmd && end <= soonestYmd) {
      upsert("expiry_warning", member._id, `${member._id}:${membership._id}:expiry_warning`, {
        title: "Membership expiring soon",
        body: `${member.fullName} (${member.memberCode}) — membership ends on ${formatDateOnly(end)}.`,
        severity: "warning",
        link,
      });
    }

    // b) Already expired (once per membership+end date)
    if (end < todayYmd) {
      upsert(
        "membership_expired",
        member._id,
        `${member._id}:${membership._id}:membership_expired:${end}`,
        {
          title: "Membership expired",
          body: `${member.fullName} (${member.memberCode}) — membership expired on ${formatDateOnly(end)}.`,
          severity: "warning",
          link,
        },
      );
    }

    // c) Memberships with no paid/partial payment at all (pending dues)
    if (start <= todayYmd && !hasPayment.has(String(membership._id))) {
      upsert("payment_pending", member._id, `${member._id}:${membership._id}:payment_pending`, {
        title: "Payment pending",
        body: `${member.fullName} (${member.memberCode}) — no payment recorded for the current membership.`,
        severity: "info",
        link,
      });
    }
  }

  if (ops.length === 0) return 0;
  const result = await AppNotification.bulkWrite(ops, { ordered: false });
  return result.upsertedCount ?? 0;
}
