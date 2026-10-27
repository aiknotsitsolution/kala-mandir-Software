import { Router } from "express";
import { z } from "zod";
import Gym from "../models/Gym.js";
import GymSettings from "../models/GymSettings.js";
import ClassSlot from "../models/ClassSlot.js";
import { requireAuth, requireCap } from "../middleware/auth.js";
import { parseBody } from "../middleware/validate.js";
import { asyncHandler, badRequest } from "../lib/errors.js";
import { toGym, toSettings } from "../lib/serialize.js";
import { generateQrToken } from "../lib/qr.js";
import { writeAudit } from "../lib/audit.js";
import { loadGymContext } from "../services/context.js";
import config from "../config.js";

const router = Router();

/**
 * Login URL encoded into the printed studio QR. Scanning it with any phone
 * camera opens the sign-in page with `?checkin=<token>`; the token is the only
 * thing the QR carries — never a password or personal data.
 */
function gymCheckinUrl(token) {
  const origin = String(config.clientOrigin ?? "")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");
  if (!origin) return null;
  return `${origin}/login?checkin=${encodeURIComponent(token)}`;
}

const settingsPatchSchema = z.object({
  // Gym profile fields editable alongside settings.
  gymName: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  currency: z.string().min(1).optional(),
  logoUrl: z.string().nullish(),
  address: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  // GymSettings fields.
  checkinCooldownMinutes: z.number().int().min(0).max(1440).optional(),
  trackCheckout: z.boolean().optional(),
  expiringSoonDays: z.number().int().min(1).max(90).optional(),
  expiryReminderDays: z.array(z.number().int().min(0).max(365)).optional(),
  allowExpiredCheckin: z.boolean().optional(),
  enableEmail: z.boolean().optional(),
  enableSms: z.boolean().optional(),
  enableWhatsapp: z.boolean().optional(),
  enablePush: z.boolean().optional(),
  attendanceRetentionDays: z.number().int().min(1).max(3650).optional(),
});

/** GET /api/gym → Gym */
router.get(
  "/gym",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    res.json(toGym(ctx.gym));
  }),
);

/** GET /api/settings → GymSettings */
router.get(
  "/settings",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    res.json(toSettings(ctx.settings));
  }),
);

/** PATCH /api/settings (GymSettingsPatch incl. gymName/timezone) → GymSettings */
router.patch(
  "/settings",
  requireAuth,
  requireCap("settings.manage"),
  asyncHandler(async (req, res) => {
    const input = parseBody(settingsPatchSchema, req.body);
    const { gym, settings } = await loadGymContext(req.user.gymId);

    const gymUpdates = {};
    if (input.gymName !== undefined) gymUpdates.name = input.gymName;
    if (input.timezone !== undefined) gymUpdates.timezone = input.timezone;
    if (input.currency !== undefined) gymUpdates.currency = input.currency;
    if (input.logoUrl !== undefined) gymUpdates.logoUrl = input.logoUrl ?? null;
    if (input.address !== undefined) gymUpdates.address = input.address ?? null;
    if (input.phone !== undefined) gymUpdates.phone = input.phone ?? null;
    if (input.email !== undefined) gymUpdates.email = input.email ?? null;

    const settingsUpdates = {};
    const settingKeys = [
      "checkinCooldownMinutes",
      "trackCheckout",
      "expiringSoonDays",
      "expiryReminderDays",
      "allowExpiredCheckin",
      "enableEmail",
      "enableSms",
      "enableWhatsapp",
      "enablePush",
      "attendanceRetentionDays",
    ];
    for (const key of settingKeys) {
      if (input[key] !== undefined) settingsUpdates[key] = input[key];
    }

    if (Object.keys(gymUpdates).length > 0) {
      await Gym.updateOne({ _id: gym._id }, { $set: gymUpdates });
    }
    if (Object.keys(settingsUpdates).length > 0) {
      await GymSettings.updateOne({ gymId: gym._id }, { $set: settingsUpdates }, { upsert: true });
    }

    await writeAudit({
      gymId: gym._id,
      actorId: req.user.id,
      entity: "gym_settings",
      entityId: String(gym._id),
      action: "update",
      oldValues: { gymName: gym.name, timezone: gym.timezone },
      newValues: { ...gymUpdates, ...settingsUpdates },
    });

    const ctx = await loadGymContext(req.user.gymId);
    res.json(toSettings(ctx.settings));
  }),
);

const gymPatchSchema = z.object({
  timeSlots: z
    .array(z.object({
      start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm, e.g. 06:00"),
      end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm, e.g. 11:59"),
    }))
    .max(48, "Too many slots")
    .optional(),
  /** Self check-in guard rails (member portal gym-QR scans). */
  enforceSlotHours: z.boolean().optional(),
  locationLat: z.number().min(-90).max(90).nullish(),
  locationLng: z.number().min(-180).max(180).nullish(),
  locationRadiusM: z.number().int().min(50).max(5000).nullish(),
  enforceLocation: z.boolean().optional(),
  /** Institute-wide theme (admin picks in Manage Institute). */
  themeMode: z.enum(["light", "dark", "system"]).optional(),
  themeAccent: z.enum(["burgundy", "emerald", "indigo", "rose", "terracotta", "ocean"]).optional(),
});

/** GET /api/gym/qr → { token, url } — the single front-desk gym QR members scan. */
router.get(
  "/gym/qr",
  requireAuth,
  requireCap("settings.manage"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    let token = ctx.gym.gymQrToken;
    if (!token) {
      token = generateQrToken();
      await Gym.updateOne({ _id: ctx.gym._id }, { $set: { gymQrToken: token } });
    }
    res.json({ token, url: gymCheckinUrl(token) });
  }),
);

/** POST /api/gym/qr/rotate → { token, url } — invalidates every previously printed gym QR. */
router.post(
  "/gym/qr/rotate",
  requireAuth,
  requireCap("settings.manage"),
  asyncHandler(async (req, res) => {
    const ctx = await loadGymContext(req.user.gymId);
    const token = generateQrToken();
    await Gym.updateOne({ _id: ctx.gym._id }, { $set: { gymQrToken: token } });
    await writeAudit({
      gymId: ctx.gym._id,
      actorId: req.user.id,
      entity: "gyms",
      entityId: String(ctx.gym._id),
      action: "update",
      newValues: { gymQrRotated: true },
    });
    res.json({ token, url: gymCheckinUrl(token) });
  }),
);

/** PATCH /api/gym { timeSlots?, enforceSlotHours?, location… } → updated gym. */
router.patch(
  "/gym",
  requireAuth,
  requireCap("settings.manage"),
  asyncHandler(async (req, res) => {
    const input = parseBody(gymPatchSchema, req.body);
    const ctx = await loadGymContext(req.user.gymId);

    const updates = {};
    if (input.timeSlots !== undefined) {
      updates.timeSlots = [...input.timeSlots].sort((a, b) => a.start.localeCompare(b.start));
    }
    if (input.enforceSlotHours !== undefined) updates.enforceSlotHours = input.enforceSlotHours;
    if (input.locationLat !== undefined) updates.locationLat = input.locationLat;
    if (input.locationLng !== undefined) updates.locationLng = input.locationLng;
    if (input.locationRadiusM !== undefined) updates.locationRadiusM = input.locationRadiusM;
    if (input.enforceLocation !== undefined) updates.enforceLocation = input.enforceLocation;
    if (input.themeMode !== undefined) updates.themeMode = input.themeMode;
    if (input.themeAccent !== undefined) updates.themeAccent = input.themeAccent;
    if (Object.keys(updates).length === 0) throw badRequest("Nothing to update", "empty_patch");

    // Guard against a GPS requirement with no saved coordinates.
    const effLat = updates.locationLat !== undefined ? updates.locationLat : ctx.gym.locationLat ?? null;
    const effLng = updates.locationLng !== undefined ? updates.locationLng : ctx.gym.locationLng ?? null;
    const effEnforce = updates.enforceLocation !== undefined
      ? updates.enforceLocation
      : Boolean(ctx.gym.enforceLocation);
    if (effEnforce && (effLat == null || effLng == null)) {
      throw badRequest(
        "Save the studio's latitude & longitude before requiring the GPS range check.",
        "location_missing",
      );
    }

    await Gym.updateOne({ _id: ctx.gym._id }, { $set: updates });

    // Auto-sync ClassSlots from saved daily time slots, so the studio's
    // operating hours become teachable batches (assign instructor/weekdays
    // later via Classes & Schedule). Idempotent: a slot with the same time
    // range is reused rather than duplicated.
    if (input.timeSlots !== undefined) {
      for (const ts of input.timeSlots) {
        const start = ts.start;
        const end = ts.end;
        const existing = await ClassSlot.findOne({
          gymId: ctx.gym._id,
          startTime: start,
          endTime: end,
          isActive: true,
        }).lean();
        if (!existing) {
          await ClassSlot.create({
            gymId: ctx.gym._id,
            name: `${start} – ${end}`,
            weekdays: [0, 1, 2, 3, 4, 5, 6],
            startTime: start,
            endTime: end,
            capacity: null,
            instructorId: null,
            isActive: true,
            notes: "Auto-created from daily time slots",
            createdBy: req.user.id,
          });
        }
      }
    }
    await writeAudit({
      gymId: ctx.gym._id,
      actorId: req.user.id,
      entity: "gyms",
      entityId: String(ctx.gym._id),
      action: "update",
      oldValues: {
        timeSlots: ctx.gym.timeSlots ?? [],
        enforceSlotHours: ctx.gym.enforceSlotHours !== false,
        locationLat: ctx.gym.locationLat ?? null,
        locationLng: ctx.gym.locationLng ?? null,
        locationRadiusM: ctx.gym.locationRadiusM ?? 200,
        enforceLocation: Boolean(ctx.gym.enforceLocation),
      },
      newValues: updates,
    });
    res.json(toGym({ ...ctx.gym, ...updates }));
  }),
);

export default router;
