import mongoose from "mongoose";

const { Schema, model } = mongoose;

const RefreshSessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false, collection: "refreshsessions" },
);

RefreshSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default model("RefreshSession", RefreshSessionSchema);
