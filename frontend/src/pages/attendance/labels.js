import { isDataError } from "@/data/types";
/** Human-friendly copy for every rejection reason the service can return. */
export const REJECTION_LABELS = {
    invalid_qr: "Not a valid QR",
    revoked_qr: "QR revoked",
    member_inactive: "Student inactive",
    no_membership: "No active membership",
    expired: "Membership expired",
    suspended: "Membership suspended",
    cooldown: "Too soon since last check-in",
    duplicate: "Duplicate scan",
    forbidden: "Not allowed",
    not_found: "Student not found",
    network: "Network problem",
    server_error: "Server error",
};
export const METHOD_LABELS = {
    qr: "QR scan",
    manual: "Manual",
    class: "Class",
};
export const ATTENDANCE_STATUS_LABELS = {
    checked_in: "Checked in",
    checked_out: "Checked out",
};
const REJECTION_VALUES = [
    "invalid_qr",
    "revoked_qr",
    "member_inactive",
    "no_membership",
    "expired",
    "suspended",
    "cooldown",
    "duplicate",
    "forbidden",
    "not_found",
    "network",
    "server_error",
];
/** Turn an unexpected thrown error into a rejected result so the UI can render it. */
export function toRejection(error) {
    const message = error instanceof Error
        ? error.message
        : typeof error === "string" && error.trim().length > 0
            ? error
            : "Something went wrong while recording the check-in.";
    const code = isDataError(error) ? error.code : "";
    const reason = REJECTION_VALUES.includes(code)
        ? code
        : "server_error";
    return { status: "rejected", reason, message };
}
/** `17` → `5 PM`, `0` → `12 AM`. */
export function hourLabel(hour) {
    if (hour === null || hour === undefined || !Number.isFinite(hour))
        return "—";
    const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
    const suffix = normalized < 12 ? "AM" : "PM";
    const display = normalized % 12 === 0 ? 12 : normalized % 12;
    return `${display} ${suffix}`;
}
