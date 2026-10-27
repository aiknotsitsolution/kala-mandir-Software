import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Staff/trainer directory (separate from login users). */
const StaffProfileSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    profileId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, default: null, lowercase: true, trim: true },
    phone: { type: String, default: null, trim: true },
    role: {
      type: String,
      enum: ["owner", "admin", "front_desk", "trainer"],
      default: "trainer",
    },
    specialization: { type: String, default: null },
    employmentStatus: {
      type: String,
      enum: ["active", "on_leave", "resigned"],
      default: "active",
    },
    joiningDate: { type: Date, default: null },
    photoUrl: { type: String, default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: "staffprofiles" },
);

StaffProfileSchema.index({ gymId: 1, employmentStatus: 1 });
/** Fast lookup of a login's staff profile (instructor scoping). */
StaffProfileSchema.index({ profileId: 1 });

export default model("StaffProfile", StaffProfileSchema);
