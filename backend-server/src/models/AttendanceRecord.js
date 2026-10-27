import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Check-in history. Rows are created via the check-in flow only (audited). */
const AttendanceRecordSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
    membershipId: { type: Schema.Types.ObjectId, ref: "MemberMembership", default: null },
    checkIn: { type: Date, default: Date.now },
    checkOut: { type: Date, default: null },
    status: { type: String, enum: ["checked_in", "checked_out"], default: "checked_in" },
    method: { type: String, enum: ["qr", "manual", "class"], default: "qr" },
    scannerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    notes: { type: String, default: null },
    meta: { type: Object, default: {} },

    /* ------------------------- dance-class quota ------------------------- */
    /** Recurring weekly slot this attendance belongs to (null = plain gym visit). */
    classSlotId: { type: Schema.Types.ObjectId, ref: "ClassSlot", default: null },
    /** Dated class session this attendance belongs to (demo classes, null otherwise). */
    classId: { type: Schema.Types.ObjectId, ref: "GymClass", default: null },
    /**
     * Calendar date of the class session in the gym's timezone (UTC midnight).
     * Part of the duplicate key: one attendance per member per slot per day.
     */
    sessionDate: { type: Date, default: null },
    /**
     * Whether this attendance deducts from the member's PAID class quota.
     *   true  — counted paid dance-class attendance
     *   false — demo-class attendance (never counted)
     *   null  — legacy / plain gym visit (never counted)
     */
    quotaCounted: { type: Boolean, default: null },
    /** True when recorded against a demo class. */
    demo: { type: Boolean, default: false },
    /**
     * Class-roster marking status for a slot/class session.
     *   "present" | "late" | "leave" → quotaCounted true (deducts 1)
     *   "absent" | "holiday"          → quotaCounted false
     *   null                → legacy gym visit / scan (no class status)
     */
    attendanceStatus: {
      type: String,
      enum: ["present", "absent", "late", "leave", "holiday"],
      default: null,
    },
    /**
     * Idempotency key `<slotId|classId>:<YYYY-MM-DD>` — enforced by a unique
     * partial index so duplicate marking cannot insert twice, even concurrently.
     */
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: "attendancerecords" },
);

AttendanceRecordSchema.index({ gymId: 1, checkIn: -1 });
AttendanceRecordSchema.index({ memberId: 1, checkIn: -1 });
/** Class quota accounting — count only quotaCounted rows for a membership. */
AttendanceRecordSchema.index({ membershipId: 1, quotaCounted: 1 });
AttendanceRecordSchema.index({ gymId: 1, classSlotId: 1, sessionDate: 1 });
AttendanceRecordSchema.index({ gymId: 1, demo: 1, checkIn: -1 });
/**
 * Duplicate attendance prevention: one row per member per slot/class session
 * date. Partial so it only applies where a dedupeKey was written (class
 * attendance); legacy gym visits are unaffected.
 */
AttendanceRecordSchema.index(
  { gymId: 1, memberId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);

export default model("AttendanceRecord", AttendanceRecordSchema);
