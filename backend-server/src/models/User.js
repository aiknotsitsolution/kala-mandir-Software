import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Authenticated user: staff (profiles + password hash) or a member portal login. */
const UserSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: null },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["owner", "admin", "front_desk", "trainer", "member"],
      default: "front_desk",
    },
    /** Set for role "member": the gym member this login belongs to. */
    memberId: { type: Schema.Types.ObjectId, ref: "Member", default: null, index: true },
    avatarUrl: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "users" },
);

UserSchema.index({ gymId: 1, role: 1 });

export default model("User", UserSchema);
