/**
 * Planned-hours helpers — shared by staff checkout and the member's own
 * front-desk gym-QR scans. A visit counts at most 12h so a forgotten check-out
 * cannot skew the daily total. Reminders dedupe to one per member per day.
 */

import AppNotification from "../models/AppNotification.js";
import AttendanceRecord from "../models/AttendanceRecord.js";
import { startOfDayInTz, ymdInTz } from "../lib/dates.js";
import { loadGymContext } from "./context.js";

const MAX_VISIT_MS = 43_200_000;

/** Capped ms the member accumulated on the calendar day of `at` (gym tz). */
export async function dayHoursMs({ gymId, memberId, tz, at = new Date() }) {
  const dayStart = startOfDayInTz(at, tz);
  const rows = await AttendanceRecord.find({
    gymId,
    memberId,
    checkIn: { $gte: dayStart, $lt: new Date(dayStart.getTime() + 86_400_000) },
  })
    .select("checkIn checkOut")
    .lean();
  let ms = 0;
  for (const row of rows) {
    const end = row.checkOut ? new Date(row.checkOut).getTime() : new Date(at).getTime();
    ms += Math.min(Math.max(0, end - new Date(row.checkIn).getTime()), MAX_VISIT_MS);
  }
  return ms;
}

/** Upsert a once-per-day "you exceeded your planned time" reminder for the member. */
export async function notifyIfOverPlanned({ gymId, member, at = new Date() }) {
  if (!member?.plannedHoursPerDay) return false;
  const ctx = await loadGymContext(gymId);
  const hours = Math.round((await dayHoursMs({ gymId, memberId: member._id, tz: ctx.tz, at })) / 3_600_000) / 10;
  if (hours <= member.plannedHoursPerDay) return false;
  const today = ymdInTz(at, ctx.tz);
  const dedupeKey = `time_exceeded:${member._id}:${today}`;
  await AppNotification.updateOne(
    { gymId, dedupeKey },
    {
      $set: {
        gymId,
        userId: null,
        memberId: member._id,
        type: "general",
        title: "You exceeded your planned studio time",
        body: `Today you spent ${hours}h at the studio — your planned time is ${member.plannedHoursPerDay}h.`,
        severity: "warning",
        isRead: false,
        dedupeKey,
      },
    },
    { upsert: true },
  );
  return true;
}

/** Tell the staff when an expired member scans the gym QR (once per day). */
export async function notifyExpiredScan({ gymId, member, at = new Date() }) {
  const ctx = await loadGymContext(gymId);
  const today = ymdInTz(at, ctx.tz);
  const dedupeKey = `expired_scan:${member._id}:${today}`;
  await AppNotification.updateOne(
    { gymId, dedupeKey },
    {
      $set: {
        gymId,
        userId: null,
        memberId: null,
        type: "membership_expired",
        title: "Expired student tried to check in",
        body: `${member.fullName} (${member.memberCode}) scanned the front-desk QR but their membership has expired — please follow up.`,
        severity: "warning",
        isRead: false,
        dedupeKey,
      },
    },
    { upsert: true },
  );
  return true;
}
