/** Match physical visits, excluding separate class-register rows. */
export function visitRecordFilter(criteria = {}) {
  return {
    ...criteria,
    classSlotId: null,
    classId: null,
    $or: [
      { attendanceStatus: null },
      { "meta.extraVisit": true },
    ],
  };
}
