import mongoose from "mongoose";
import { CLASS_TAGS } from "../lib/constants.js";

const { Schema, model } = mongoose;

const MemberSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    memberCode: { type: String, required: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    photoUrl: { type: String, default: null },
    dateOfBirth: { type: Date, default: null },
    /** Student's age in years (collected at registration; DOB still supported). */
    age: { type: Number, default: null, min: 1, max: 120 },
    gender: {
      type: String,
      enum: ["male", "female", "other", "prefer_not_to_say", null],
      default: null,
    },
    address: { type: String, default: null },
    emergencyContactName: { type: String, default: null },
    emergencyContactPhone: { type: String, default: null },
    joinDate: { type: Date, required: true },
    /** Opaque 64-char random hex; contains no personal data. */
    qrToken: { type: String, required: true, unique: true },
    qrStatus: { type: String, enum: ["active", "revoked"], default: "active" },
    qrRotatedAt: { type: Date, default: null },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
    /** Daily time commitment agreed at joining (hours); null = not set. */
    plannedHoursPerDay: { type: Number, default: null },
    /** Preferred front-desk slot ("HH:mm-HH:mm", from gym.timeSlots); null = no preference. */
    preferredSlot: { type: String, default: null },
    /** Class stream the student belongs to — "Art" | "Dance". */
    classTag: { type: String, enum: [...CLASS_TAGS, null], default: null },
    /** Assigned tag ids (student labels — dance styles, batches, events…). */
    tagIds: { type: [{ type: Schema.Types.ObjectId, ref: "Tag" }], default: () => [] },
    /** Trainer assigned to this student (StaffProfile._id), null = unassigned. */
    trainerId: { type: Schema.Types.ObjectId, ref: "StaffProfile", default: null },
    notes: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Internal mutex counter used to serialise concurrent check-in scans. */
    scanLock: { type: Number, default: 0, select: false },
  },
  { timestamps: true, versionKey: false, collection: "members" },
);

// Case-insensitive duplicate prevention per gym (mirrors the Postgres indexes).
MemberSchema.index({ gymId: 1, memberCode: 1 }, { unique: true });
MemberSchema.index({ gymId: 1, phone: 1 }, { unique: true });
MemberSchema.index(
  { gymId: 1, email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: "string" } } },
);
MemberSchema.index({ gymId: 1, status: 1 });
MemberSchema.index({ fullName: "text", phone: "text", email: "text", memberCode: "text" });

export default model("Member", MemberSchema);
