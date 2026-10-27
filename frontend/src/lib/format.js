import { format, formatDistanceToNowStrict, isThisYear, parseISO } from "date-fns";
const inrFormatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
});
const inrFormatterPaise = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
/** ₹1,50,000 — used everywhere money is displayed. */
export function formatINR(value, options) {
    const safe = Number.isFinite(value) ? value : 0;
    return options?.withPaise ? inrFormatterPaise.format(safe) : inrFormatter.format(Math.round(safe));
}
/** 1,50,000 without the ₹ symbol (charts, CSV). */
export function formatNumberIN(value) {
    return new Intl.NumberFormat("en-IN").format(Number.isFinite(value) ? value : 0);
}
export function formatCompactIN(value) {
    return new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(value) ? value : 0);
}
export function formatDate(value) {
    if (!value)
        return "—";
    const date = typeof value === "string" ? parseISO(value) : value;
    if (Number.isNaN(date.getTime()))
        return "—";
    return isThisYear(date) ? format(date, "d MMM") : format(date, "d MMM yyyy");
}
export function formatDateTime(value) {
    if (!value)
        return "—";
    const date = typeof value === "string" ? parseISO(value) : value;
    if (Number.isNaN(date.getTime()))
        return "—";
    return format(date, "d MMM yyyy, h:mm a");
}
export function formatTime(value) {
    if (!value)
        return "—";
    const date = typeof value === "string" ? parseISO(value) : value;
    if (Number.isNaN(date.getTime()))
        return "—";
    return format(date, "h:mm a");
}
export function relativeTime(value) {
    if (!value)
        return "—";
    const date = typeof value === "string" ? parseISO(value) : value;
    if (Number.isNaN(date.getTime()))
        return "—";
    return formatDistanceToNowStrict(date, { addSuffix: true });
}
export function initialsOf(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return "?";
    if (parts.length === 1)
        return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
export const STATUS_LABELS = {
    active: "Active",
    expiring_soon: "Expiring soon",
    expired: "Expired",
    suspended: "Suspended",
    inactive: "Inactive",
    cancelled: "Cancelled",
    none: "No membership",
};
export const MEMBER_FILTER_LABELS = {
    all: "All students",
    active: "Active",
    expiring_soon: "Expiring soon",
    expired: "Expired",
    suspended: "Suspended",
    inactive: "Inactive",
};
export const PAYMENT_METHOD_LABELS = {
    cash: "Cash",
    upi: "UPI",
    card: "Card",
    bank_transfer: "Bank transfer",
    other: "Other",
};
export const PAYMENT_STATUS_LABELS = {
    paid: "Paid",
    partial: "Partially paid",
    pending: "Pending",
    refunded: "Refunded",
    failed: "Failed",
};
export function durationLabel(value, unit) {
    const plural = value === 1 ? "" : "s";
    const map = { day: "day", week: "week", month: "month", year: "year" };
    return `${value} ${map[unit]}${plural}`;
}
export function maskPhone(phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length <= 4)
        return digits;
    return `${digits.slice(0, 2)}****${digits.slice(-4)}`;
}
export function titleCase(value) {
    return value
        .split(/[_\s-]+/)
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join(" ");
}
/** `13:05` → `1:05 PM` — 12-hour clock with AM/PM (never `14:05`). */
export function format12h(hhmm) {
    const [h, m] = String(hhmm).split(":").map(Number);
    const suffix = h >= 12 ? "PM" : "AM";
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${String(m ?? 0).padStart(2, "0")} ${suffix}`;
}
/** Gym slot ("06:00-11:59" or {start,end}) → `06:00 AM – 11:59 AM`. */
export function timeSlotLabel(slot) {
    if (!slot)
        return null;
    if (typeof slot === "string") {
        const [start, end] = slot.split("-");
        return start && end ? `${format12h(start)} – ${format12h(end)}` : null;
    }
    return slot.start && slot.end ? `${format12h(slot.start)} – ${format12h(slot.end)}` : null;
}
