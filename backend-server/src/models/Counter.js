import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Named monotonic counters (currently receipt numbers). */
const CounterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false, collection: "counters" },
);

export default model("Counter", CounterSchema);
