import { addDays, DEFAULT_GYM_TIMEZONE, instantInTz, ymdInTz } from "./dates.js";

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Scheduled slot end, or one hour after check-in when no slot is available. */
export function autoCheckoutAt(record, slot, timeZone = DEFAULT_GYM_TIMEZONE) {
  const checkIn = new Date(record.checkIn);
  if (!slot?.startTime || !slot?.endTime) {
    return new Date(checkIn.getTime() + ONE_HOUR_MS);
  }

  const sessionDate = record.sessionDate
    ? new Date(record.sessionDate).toISOString().slice(0, 10)
    : ymdInTz(checkIn, timeZone);
  const slotStart = instantInTz(sessionDate, slot.startTime, timeZone);
  let slotEnd = instantInTz(sessionDate, slot.endTime, timeZone);
  if (slotEnd <= slotStart) slotEnd = addDays(slotEnd, 1);
  return slotEnd;
}
