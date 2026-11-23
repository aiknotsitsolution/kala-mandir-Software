import mongoose from "mongoose";

const { Schema, model } = mongoose;

const AuthChallengeSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    purpose: {
      type: String,
      enum: [
        "login",
        "student_registration",
        "password_setup",
        "password_reset",
        "password_reset_verified",
      ],
      required: true,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    secretHash: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "authchallenges" },
);

AuthChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
AuthChallengeSchema.index({ userId: 1, purpose: 1, createdAt: -1 });

export default model("AuthChallenge", AuthChallengeSchema);
