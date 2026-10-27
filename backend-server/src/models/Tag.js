import mongoose from "mongoose";

const { Schema, model } = mongoose;

/**
 * `Tag` — a reusable student label (dance style, batch, event, level, …).
 * Owned by one gym; members reference tags by id (`Member.tagIds`).
 */
const TagSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    name: { type: String, required: true, trim: true },
    color: { type: String, default: "#6366f1" },
  },
  { timestamps: true, versionKey: false, collection: "tags" },
);

/* One tag name per gym. */
TagSchema.index({ gymId: 1, name: 1 }, { unique: true });

export default model("Tag", TagSchema);
