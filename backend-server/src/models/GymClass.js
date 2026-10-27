import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Group class schedule. Cancel via status = 'cancelled' to keep history. */
const GymClassSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: null },
    trainerId: { type: Schema.Types.ObjectId, ref: "StaffProfile", default: null },
    startsAt: { type: Date, default: Date.now },
    durationMinutes: { type: Number, default: 60, min: 1 },
    capacity: { type: Number, default: 20, min: 1 },
    status: { type: String, enum: ["scheduled", "cancelled", "completed"], default: "scheduled" },
    /** "regular" counts against the class quota; "demo" never does. */
    kind: { type: String, enum: ["regular", "demo"], default: "regular" },
  },
  { timestamps: true, versionKey: false, collection: "gymclasses" },
);

GymClassSchema.index({ gymId: 1, startsAt: 1 });

export default model("GymClass", GymClassSchema);
