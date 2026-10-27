import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Sellable plan template. Plans referenced by memberships are archived, never deleted. */
const MembershipPlanSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    price: { type: Number, default: 0, min: 0 },
    durationValue: { type: Number, required: true, min: 1 },
    durationUnit: { type: String, enum: ["day", "week", "month", "year"], required: true },
    /**
     * Optional monthly dance-class quota baked into this plan (e.g. 12 / 20 / 24).
     * null = duration-only plan with no class quota — legacy plans keep working.
     * Snapshotted onto each MemberMembership at enrollment so later plan edits
     * never change an already-sold allowance.
     */
    classQuota: { type: Number, default: null, min: 0 },
    /** Optional weekly schedule shown on the plan card (e.g. "Monday – Friday"). */
    scheduleLabel: { type: String, default: null, trim: true },
    benefits: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false, collection: "membershipplans" },
);

MembershipPlanSchema.index(
  { gymId: 1, name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } },
);
MembershipPlanSchema.index({ gymId: 1, isActive: 1, sortOrder: 1 });

export default model("MembershipPlan", MembershipPlanSchema);
