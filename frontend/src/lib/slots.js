/**
 * The institute's canonical slot schedule — hourly batches from 8 AM to 9 PM,
 * grouped by time of day. Used by Manage Institute (daily slots), the member
 * form's preferred-slot picker, and Manage Attendance's slot dropdowns so
 * every screen follows the same grouping.
 */
export const SLOT_GROUPS = [
    { key: "morning", label: "Morning Slots", range: "8:00 AM – 12:00 PM" },
    { key: "afternoon", label: "Afternoon Slots", range: "12:00 PM – 4:00 PM" },
    { key: "evening", label: "Evening Slots", range: "4:00 PM – 9:00 PM" },
];

/** Ready-made hourly slots: 8–9, 9–10 … 8–9 pm (13 slots). */
export const HOURLY_SLOTS = (() => {
    const out = [];
    for (let startH = 8; startH + 1 <= 21; startH += 1) {
        out.push({
            start: `${String(startH).padStart(2, "0")}:00`,
            end: `${String(startH + 1).padStart(2, "0")}:00`,
        });
    }
    return out;
})();

/** "HH:mm" start time → group key (morning < 12, afternoon < 16, evening ≥ 16). */
export function slotGroupOf(startHHMM) {
    const h = Number(String(startHHMM ?? "").split(":")[0]);
    if (!Number.isFinite(h)) return null;
    if (h < 12) return "morning";
    if (h < 16) return "afternoon";
    return "evening";
}

/** The hourly slots belonging to one group key, e.g. hoursOf("morning"). */
export function hoursOf(groupKey) {
    return HOURLY_SLOTS.filter((s) => slotGroupOf(s.start) === groupKey);
}

/**
 * Group an array of slots ({start,…} gym slots or {startTime,…} class slots)
 * into { morning: [], afternoon: [], evening: [] } by their start time.
 */
export function groupSlotsByTime(slots, startKey = "start") {
    const out = { morning: [], afternoon: [], evening: [] };
    for (const slot of slots ?? []) {
        const group = slotGroupOf(slot[startKey]);
        if (group) out[group].push(slot);
    }
    return out;
}
