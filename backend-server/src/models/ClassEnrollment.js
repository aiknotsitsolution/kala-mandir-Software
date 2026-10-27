import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Member sign-ups for group classes. One enrollment per member per class. */
const ClassEnrollmentSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    classId: { type: Schema.Types.ObjectId, ref: "GymClass", required: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
    status: {
      type: String,
      enum: ["enrolled", "cancelled", "attended", "no_show"],
      default: "enrolled",
    },
    enrolledAt: { type: Date, default: Date.now },
  },
  { timestamps: true, versionKey: false, collection: "classenrollments" },
);

ClassEnrollmentSchema.index({ classId: 1, memberId: 1 }, { unique: true });
ClassEnrollmentSchema.index({ gymId: 1, classId: 1 });
ClassEnrollmentSchema.index({ gymId: 1, memberId: 1 });

export default model("ClassEnrollment", ClassEnrollmentSchema);
