/**
 * Pure scheduling helpers for recurring ClassSlots.
 *
 * Kept dependency-free so the overlap/conflict rules are unit-testable without
 * a database. Times are "HH:mm" strings in the studio's local timezone.
 */

/** "HH:mm" → minutes since midnight. Returns null when malformed. */
export function toMinutes(hhmm) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? "").trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** True when [aStart, aEnd) overlaps [bStart, bEnd) in minutes. */
export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Find a conflicting slot for an instructor.
 *
 * Two slots conflict when they share a weekday, their times overlap, and the
 * instructor is the same. `existing` is an array of lean ClassSlot rows for the
 * gym (active ones only should be passed). `candidate` is
 * { instructorId, weekdays, startTime, endTime, id? } — `id` excludes the slot
 * being updated from the check.
 *
 * Returns the conflicting slot row, or null when the candidate is free.
 */
export function findInstructorConflict(existing, candidate) {
  const instructorId = candidate?.instructorId ? String(candidate.instructorId) : null;
  if (!instructorId) return null;

  const start = toMinutes(candidate?.startTime);
  const end = toMinutes(candidate?.endTime);
  if (start == null || end == null || end <= start) return null;

  const days = new Set(Array.isArray(candidate?.weekdays) ? candidate.weekdays.map(Number) : []);
  const selfId = candidate?.id ? String(candidate.id) : null;

  for (const slot of existing ?? []) {
    if (selfId && String(slot._id ?? slot.id) === selfId) continue;
    if (!slot.instructorId || String(slot.instructorId) !== instructorId) continue;
    if (slot.isActive === false) continue;

    const slotStart = toMinutes(slot.startTime);
    const slotEnd = toMinutes(slot.endTime);
    if (slotStart == null || slotEnd == null) continue;

    const sharesDay = (slot.weekdays ?? []).some((d) => days.has(Number(d)));
    if (!sharesDay) continue;

    if (rangesOverlap(start, end, slotStart, slotEnd)) return slot;
  }
  return null;
}
