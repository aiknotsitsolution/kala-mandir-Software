import AttendanceRecord from "../models/AttendanceRecord.js";
import { writeAudit } from "../lib/audit.js";
import { autoCheckoutAt } from "../lib/attendanceCheckout.js";

/** Close every open attendance record one hour after its check-in. */
export async function autoCheckoutDueAttendance({ gymId, now = new Date() } = {}) {
  const filter = {
    status: "checked_in",
    checkOut: null,
    checkIn: { $lte: now },
  };
  if (gymId) filter.gymId = gymId;

  const rows = await AttendanceRecord.find(filter)
    .select("gymId checkIn")
    .lean();
  if (rows.length === 0) return 0;

  const dueRows = rows
    .map((row) => {
      return { row, checkOut: autoCheckoutAt(row) };
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
