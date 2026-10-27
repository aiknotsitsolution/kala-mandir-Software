import mongoose from "mongoose";
import { CLASS_TAGS } from "../lib/constants.js";

const { Schema, model } = mongoose;

/**
 * A recurring weekly dance-class slot (e.g. "Bollywood Beginners — Mon/Wed/Fri
 * 17:00–18:00, cap 20, instructor Riya").
 *
 * This is intentionally SEPARATE from Gym.timeSlots, which describes the
 * institute's daily opening hours for check-in guard rails. A ClassSlot is a
 * teachable recurring session students are enrolled into and whose attendance
 * counts against their class quota.
 */
const ClassSlotSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    /** Weekdays the slot runs on: 0 = Sunday … 6 = Saturday. */
    weekdays: { type: [Number], required: true, validate: (v) => v.length > 0 },
    /** "HH:mm" local studio time (24h). */
    startTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    endTime: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    /** Seats in the room; null = unlimited / not enforced. */
    capacity: { type: Number, default: null, min: 1 },
    /** Class stream this batch teaches — "Art" | "Dance" (from the Class Tag field). */
    classTag: { type: String, enum: [...CLASS_TAGS, null], default: null },
    instructorId: { type: Schema.Types.ObjectId, ref: "StaffProfile", default: null },
    isActive: { type: Boolean, default: true },
    notes: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false, collection: "classslots" },
);

ClassSlotSchema.index({ gymId: 1, isActive: 1, weekdays: 1 });
ClassSlotSchema.index({ gymId: 1, instructorId: 1, isActive: 1 });
ClassSlotSchema.index(
  { gymId: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);

export default model("ClassSlot", ClassSlotSchema);
