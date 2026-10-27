import { Router } from "express";
import AppNotification from "../models/AppNotification.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { asyncHandler, notFound } from "../lib/errors.js";
import { toNotification } from "../lib/serialize.js";
import { intParam } from "../middleware/validate.js";
import { loadGymContext } from "../services/context.js";
import { rebuildNotifications } from "../services/notifications.js";

const router = Router();

/** GET /api/notifications?unreadOnly&limit=100 → AppNotification[] */
router.get(
  "/notifications",
  requireAuth,
  asyncHandler(async (req, res) => {
    const limit = intParam(req.query.limit, 100, { min: 1, max: 500 });
    const filter = { gymId: req.user.gymId };
    if (req.query.unreadOnly === "1" || req.query.unreadOnly === "true") filter.isRead = false;
    const rows = await AppNotification.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    res.json(rows.map(toNotification));
  }),
);

/** GET /api/notifications/unread-count → { count } */
router.get(
  "/notifications/unread-count",
  requireAuth,
  asyncHandler(async (req, res) => {
    const count = await AppNotification.countDocuments({ gymId: req.user.gymId, isRead: false });
    res.json({ count });
  }),
);

/** PATCH /api/notifications/:id/read */
router.patch(
  "/notifications/:id/read",
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await AppNotification.findOneAndUpdate(
      { _id: req.params.id, gymId: req.user.gymId },
      { $set: { isRead: true } },
      { new: true },
    ).lean();
    if (!row) throw notFound("Notification not found");
    res.json(toNotification(row));
  }),
);

/** POST /api/notifications/read-all */
router.post(
  "/notifications/read-all",
  requireAuth,
  asyncHandler(async (req, res) => {
    await AppNotification.updateMany(
      { gymId: req.user.gymId, isRead: false },
      { $set: { isRead: true } },
    );
    res.json({ ok: true });
  }),
);

/** POST /api/notifications/rebuild → { created } (recomputes expiry/dues notifications) */
router.post(
  "/notifications/rebuild",
  requireAuth,
  requireCap("notifications.manage"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const created = await rebuildNotifications(ctx.gym._id, ctx);
    res.json({ created });
  }),
);

export default router;
