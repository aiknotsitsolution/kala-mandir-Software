import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * Concrete membership instance sold to a member. Renewals always INSERT a new
 * row — old rows are never mutated, preserving history.
 */
const MemberMembershipSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "MembershipPlan", required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "suspended", "inactive", "cancelled"],
      default: "active",
    },
    /** Honoured price at time of sale. */
    price: { type: Number, default: 0, min: 0 },
    /**
     * Class quota snapshotted from the plan at enrollment. null = no quota
     * (duration-only / legacy plans). Never re-read from the plan afterwards.
     */
    classQuota: { type: Number, default: null, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    source: {
      type: String,
      enum: ["new", "renewal", "extension", "correction"],
      default: "new",
    },
    notes: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, versionKey: false, collection: "membermemberships" },
);

MemberMembershipSchema.index({ memberId: 1, startDate: -1 });
MemberMembershipSchema.index({ gymId: 1, endDate: 1 });
MemberMembershipSchema.index({ gymId: 1, status: 1 });

export default model("MemberMembership", MemberMembershipSchema);
