import { Types } from "mongoose";
import AttendanceRecord from "../models/AttendanceRecord.js";
import ClassSlot from "../models/ClassSlot.js";
import Gym from "../models/Gym.js";
import { DEFAULT_GYM_TIMEZONE } from "../lib/dates.js";
import { writeAudit } from "../lib/audit.js";
import { autoCheckoutAt } from "../lib/attendanceCheckout.js";

/** Close open records at their slot end, falling back to one hour after check-in. */
export async function autoCheckoutDueAttendance({ gymId, now = new Date() } = {}) {
  const filter = {
    status: "checked_in",
    checkOut: null,
    checkIn: { $lte: now },
  };
  if (gymId) filter.gymId = gymId;

  const rows = await AttendanceRecord.find(filter)
    .select("gymId checkIn sessionDate classSlotId meta")
    .lean();
  if (rows.length === 0) return 0;

  const gymIds = [...new Set(rows.map((row) => String(row.gymId)))];
  const slotIds = [...new Set(rows
    .map((row) => row.classSlotId ?? row.meta?.slotId)
    .filter((id) => id != null && Types.ObjectId.isValid(String(id)))
    .map(String))];
  const [gyms, slots] = await Promise.all([
    Gym.find({ _id: { $in: gymIds } }).select("timezone").lean(),
    slotIds.length ? ClassSlot.find({ _id: { $in: slotIds } }).select("startTime endTime").lean() : [],
  ]);
  const timezoneByGym = new Map(gyms.map((gym) => [String(gym._id), gym.timezone || DEFAULT_GYM_TIMEZONE]));
  const slotById = new Map(slots.map((slot) => [String(slot._id), slot]));

  const dueRows = rows
    .map((row) => {
      const slotId = row.classSlotId ?? row.meta?.slotId;
      const slot = slotId ? slotById.get(String(slotId)) : null;
      const timeZone = timezoneByGym.get(String(row.gymId)) || DEFAULT_GYM_TIMEZONE;
      return { row, checkOut: autoCheckoutAt(row, slot, timeZone) };
    })
    .filter(({ checkOut }) => checkOut <= now);

  const results = await Promise.all(dueRows.map(async ({ row, checkOut }) => {
    const result = await AttendanceRecord.updateOne(
      { _id: row._id, status: "checked_in", checkOut: null },
      { $set: { checkOut, status: "checked_out" } },
    );
    if (result.modifiedCount === 0) return false;

    await writeAudit({
      gymId: row.gymId,
      entity: "attendance_records",
      entityId: String(row._id),
      action: "auto_checkout",
      oldValues: { status: "checked_in", checkOut: null },
      newValues: { status: "checked_out", checkOut: checkOut.toISOString() },
    });
    return true;
  }));
  return results.filter(Boolean).length;
}
