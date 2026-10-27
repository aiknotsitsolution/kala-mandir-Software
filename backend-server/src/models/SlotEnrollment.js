import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * A student's membership in a recurring ClassSlot (the recurring analogue of
 * ClassEnrollment, which signs members up for one-off dated GymClass rows).
 *
 * Cancelled rows are kept for history; re-enrolling flips status back to
 * "enrolled" instead of inserting a second row.
 */
const SlotEnrollmentSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    slotId: { type: Schema.Types.ObjectId, ref: "ClassSlot", required: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
    status: { type: String, enum: ["enrolled", "cancelled"], default: "enrolled" },
    enrolledAt: { type: Date, default: Date.now },
    notes: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: "slotenrollments" },
);

SlotEnrollmentSchema.index({ slotId: 1, memberId: 1 }, { unique: true });
SlotEnrollmentSchema.index({ gymId: 1, memberId: 1, status: 1 });
SlotEnrollmentSchema.index({ gymId: 1, slotId: 1, status: 1 });

export default model("SlotEnrollment", SlotEnrollmentSchema);
