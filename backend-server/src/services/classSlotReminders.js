import AttendanceRecord from "../models/AttendanceRecord.js";
import AppNotification from "../models/AppNotification.js";
import { parseDateOnly } from "../lib/dates.js";
import { getCurrentEnrolledSlots } from "./gymSelfCheckin.js";

export async function syncCurrentClassSlotReminders({ gymId, memberId, userId, tz, now = new Date() }) {
  const { dayKey, slots } = await getCurrentEnrolledSlots({ gymId, memberId, tz, now });
  if (slots.length === 0) return 0;

  const attendedRows = await AttendanceRecord.find({
    gymId,
    memberId,
    classSlotId: { $in: slots.map((slot) => slot._id) },
    sessionDate: parseDateOnly(dayKey),
  })
    .select("classSlotId")
    .lean();
  const attendedSlotIds = new Set(attendedRows.map((row) => String(row.classSlotId)));

  let created = 0;
  for (const slot of slots) {
    if (attendedSlotIds.has(String(slot._id))) continue;

    const dedupeKey = `class-slot-reminder:${memberId}:${slot._id}:${dayKey}`;
    try {
      const result = await AppNotification.updateOne(
        { gymId, type: "class_reminder", dedupeKey },
        {
          $setOnInsert: {
            gymId,
            userId,
            memberId,
            type: "class_reminder",
            title: "Your class slot is active",
            body: `${slot.name} is active (${slot.startTime}–${slot.endTime}). Please scan the studio QR to mark your attendance.`,
            severity: "info",
            isRead: false,
            dedupeKey,
            link: "/portal",
          },
        },
        { upsert: true },
      );
      created += result.upsertedCount ?? 0;
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
  }

  return created;
}
