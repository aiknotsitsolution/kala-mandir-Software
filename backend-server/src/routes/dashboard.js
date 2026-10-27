import { Router } from "express";
import Member from "../models/Member.js";
import MemberMembership from "../models/MemberMembership.js";
import MembershipPlan from "../models/MembershipPlan.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import PaymentRecord from "../models/PaymentRecord.js";
import User from "../models/User.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler } from "../lib/errors.js";
import { can } from "../lib/permissions.js";
import { intParam } from "../middleware/validate.js";
import { toAttendance, ymd } from "../lib/serialize.js";
import { effectiveStatus } from "../lib/membership.js";
import {
  ymdInTz,
  parseDateOnly,
  startOfDayInTz,
  addDays,
  addMonthsClamped,
  monthKeyInTz,
  monthShortLabel,
} from "../lib/dates.js";
import { loadGymContext } from "../services/context.js";
import { decorateAllMembers } from "../services/members.js";
import { getDuesRows } from "../services/payments.js";

const router = Router();
const round2 = (v) => Math.round(v * 100) / 100;

/** GET /api/dashboard/stats → DashboardStats (real aggregation queries) */
router.get(
  "/dashboard/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const { settings, tz, now } = ctx;
    const gymId = ctx.gym._id;

    const todayYmd = ymdInTz(now, tz);
    const todayStart = startOfDayInTz(now, tz);
    const tomorrowStart = new Date(todayStart.getTime() + 86_400_000);
    const monthKey = monthKeyInTz(now, tz);
    const prevMonthKey = monthKeyInTz(addMonthsClamped(now, -1), tz);
    const prevMonthStart = parseDateOnly(`${prevMonthKey}-01`);

    // Governing membership per member (started, prefer active, latest end),
    // then classify with the exact same rules the UI uses.
    const [governing, members] = await Promise.all([
      MemberMembership.aggregate([
        { $match: { gymId, startDate: { $lt: tomorrowStart } } },
        { $addFields: { activeRank: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } } },
        { $sort: { memberId: 1, activeRank: -1, endDate: -1 } },
        {
          $group: {
            _id: "$memberId",
            status: { $first: "$status" },
            startDate: { $first: "$startDate" },
            endDate: { $first: "$endDate" },
          },
        },
      ]),
      Member.find({ gymId }).select("status joinDate").lean(),
    ]);

    const memberById = new Map(members.map((m) => [String(m._id), m]));
    let activeMembers = 0;
    let expiredMembers = 0;
    let expiringSoon = 0;
    for (const row of governing) {
      const member = memberById.get(String(row._id));
      if (!member) continue;
      const eff = effectiveStatus(
        { startDate: ymd(row.startDate), endDate: ymd(row.endDate), status: row.status },
        member.status,
        now,
        ctx.expiringSoonDays,
        tz,
      );
      if (eff === "active") activeMembers += 1;
      else if (eff === "expiring_soon") {
        activeMembers += 1;
        expiringSoon += 1;
      } else if (eff === "expired") expiredMembers += 1;
    }

    let newThisMonth = 0;
    for (const member of members) {
      if (member.joinDate && monthKeyInTz(new Date(member.joinDate), tz) === monthKey) newThisMonth += 1;
    }

    const [todayAttendance, insideRows, revenueRows, dues, totalPaidRows] = await Promise.all([
      AttendanceRecord.countDocuments({
        gymId,
        checkIn: { $gte: todayStart, $lt: tomorrowStart },
      }),
      AttendanceRecord.countDocuments({
        gymId,
        checkIn: { $gte: todayStart, $lt: tomorrowStart },
        status: "checked_in",
      }),
      PaymentRecord.aggregate([
        {
          $match: {
            gymId,
            status: { $in: ["paid", "partial"] },
            paymentDate: { $gte: prevMonthStart, $lt: tomorrowStart },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m", date: "$paymentDate", timezone: tz } },
            total: { $sum: "$amount" },
          },
        },
      ]),
      getDuesRows(gymId),
      PaymentRecord.aggregate([
        { $match: { gymId, status: { $in: ["paid", "partial"] } } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
    ]);

    const revenueByKey = new Map(revenueRows.map((r) => [r._id, r.total]));

    // Trainers get the operational stats but never the rupee figures.
    const financial = can(req.user.role, "payments.view");
    res.json({
      activeMembers,
      newThisMonth,
      expiredMembers,
      expiringSoon,
      todayAttendance,
      // Without checkout tracking, "currently inside" falls back to today's check-ins.
      currentCheckIns: settings.trackCheckout ? insideRows : todayAttendance,
      monthlyRevenue: financial ? round2(revenueByKey.get(monthKey) ?? 0) : null,
      previousMonthRevenue: financial ? round2(revenueByKey.get(prevMonthKey) ?? 0) : null,
      pendingPayments: financial ? dues.length : null,
      pendingAmount: financial ? round2(dues.reduce((sum, d) => sum + d.balance, 0)) : null,
      totalPayments: financial ? round2(totalPaidRows[0]?.total ?? 0) : null,
      totalMembers: await Member.countDocuments({ gymId }),
    });
  }),
);

/** GET /api/dashboard/attendance-trend?days=14 → DayCount[] */
router.get(
  "/dashboard/attendance-trend",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const days = intParam(req.query.days, 14, { min: 1, max: 90 });
    const { tz, now } = ctx;
    const from = startOfDayInTz(addDays(now, -(days - 1)), tz);

    const rows = await AttendanceRecord.aggregate([
      { $match: { gymId: ctx.gym._id, checkIn: { $gte: from } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$checkIn", timezone: tz } },
          count: { $sum: 1 },
        },
      },
    ]);
    const countByKey = new Map(rows.map((r) => [r._id, r.count]));

    const out = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const key = ymdInTz(addDays(now, -i), tz);
      out.push({ date: key, count: countByKey.get(key) ?? 0 });
    }
    res.json(out);
  }),
);

/** GET /api/dashboard/revenue-trend?months=6 → MonthRevenue[] */
/** GET /api/dashboard/revenue-trend?months=6 → DayRevenue[] (financial roles only) */
router.get(
  "/dashboard/revenue-trend",
  requireAuth,
  requireCap("payments.view"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const months = intParam(req.query.months, 6, { min: 1, max: 36 });
    const { tz, now } = ctx;

    const keys = [];
    for (let i = months - 1; i >= 0; i -= 1) keys.push(monthKeyInTz(addMonthsClamped(now, -i), tz));
    const from = parseDateOnly(`${keys[0]}-01`);
    const end = new Date(addMonthsClamped(parseDateOnly(`${keys[keys.length - 1]}-01`), 1));

    const rows = await PaymentRecord.aggregate([
      {
        $match: {
          gymId: ctx.gym._id,
          status: { $in: ["paid", "partial"] },
          paymentDate: { $gte: from, $lt: end },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$paymentDate", timezone: tz } },
          total: { $sum: "$amount" },
        },
      },
    ]);
    const revenueByKey = new Map(rows.map((r) => [r._id, r.total]));

    res.json(
      keys.map((key) => ({
        month: key,
        label: monthShortLabel(key),
        revenue: round2(revenueByKey.get(key) ?? 0),
      })),
    );
  }),
);

/** GET /api/dashboard/plan-distribution → PlanDistribution[] */
router.get(
  "/dashboard/plan-distribution",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const todayYmd = ymdInTz(ctx.now, ctx.tz);

    const [groups, plans] = await Promise.all([
      MemberMembership.aggregate([
        {
          $match: {
            gymId: ctx.gym._id,
            status: "active",
            endDate: { $gte: parseDateOnly(todayYmd) },
          },
        },
        {
          $group: {
            _id: "$planId",
            count: { $sum: 1 },
            value: { $sum: "$price" },
          },
        },
      ]),
      MembershipPlan.find({ gymId: ctx.gym._id }).lean(),
    ]);

    const planById = new Map(plans.map((p) => [String(p._id), p]));
    res.json(
      groups
        .map((g) => ({
          planId: String(g._id),
          planName: planById.get(String(g._id))?.name ?? "Plan",
          count: g.count,
          value: round2(g.value),
        }))
        .sort((a, b) => b.count - a.count),
    );
  }),
);

/** GET /api/dashboard/recent-checkins?limit=6 → AttendanceRecord[] (joined member/scanner) */
router.get(
  "/dashboard/recent-checkins",
  requireAuth,
  asyncHandler(async (req, res) => {
    const gymId = req.user.gymId;
    const limit = intParam(req.query.limit, 6, { min: 1, max: 50 });
    const rows = await AttendanceRecord.find({ gymId }).sort({ checkIn: -1 }).limit(limit).lean();

    const memberIds = [...new Set(rows.map((r) => String(r.memberId)))];
    const scannerIds = [...new Set(rows.map((r) => r.scannerId).filter(Boolean).map(String))];
    const [members, scanners] = await Promise.all([
      memberIds.length ? Member.find({ _id: { $in: memberIds } }).lean() : [],
      scannerIds.length ? User.find({ _id: { $in: scannerIds } }).select("fullName").lean() : [],
    ]);
    const memberById = new Map(members.map((m) => [String(m._id), m]));
    const scannerById = new Map(scanners.map((s) => [String(s._id), s]));

    res.json(
      rows.map((row) =>
        toAttendance(
          row,
          memberById.get(String(row.memberId)),
          row.scannerId ? scannerById.get(String(row.scannerId)) : null,
        ),
      ),
    );
  }),
);

/** GET /api/dashboard/recent-members?limit=5 → MemberWithMembership[] */
router.get(
  "/dashboard/recent-members",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const limit = intParam(req.query.limit, 5, { min: 1, max: 50 });
    const rows = (await decorateAllMembers(ctx.gym._id, ctx))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
    res.json(rows);
  }),
);

/** GET /api/dashboard/upcoming-expiries?limit=5 → MemberWithMembership[] */
router.get(
  "/dashboard/upcoming-expiries",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const limit = intParam(req.query.limit, 5, { min: 1, max: 50 });
    const todayYmd = ymdInTz(ctx.now, ctx.tz);
    const rows = (await decorateAllMembers(ctx.gym._id, ctx))
      .filter((m) => m.membership && m.membership.endDate >= todayYmd && m.effectiveStatus !== "none")
      .sort((a, b) => ((a.membership?.endDate ?? "") < (b.membership?.endDate ?? "") ? -1 : 1))
      .slice(0, limit);
    res.json(rows);
  }),
);

export default router;
