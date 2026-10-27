import mongoose from "mongoose";

const { Schema, model } = mongoose;

const GymSettingsSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, unique: true },
    /** Minimum minutes between two accepted check-ins for the same member. */
    checkinCooldownMinutes: { type: Number, default: 60, min: 0, max: 1440 },
    trackCheckout: { type: Boolean, default: false },
    expiringSoonDays: { type: Number, default: 7, min: 1, max: 90 },
    expiryReminderDays: { type: [Number], default: [7, 3, 1] },
    allowExpiredCheckin: { type: Boolean, default: false },
    enableEmail: { type: Boolean, default: false },
    enableSms: { type: Boolean, default: false },
    enableWhatsapp: { type: Boolean, default: false },
    enablePush: { type: Boolean, default: false },
    attendanceRetentionDays: { type: Number, default: 365 },
  },
  { timestamps: true, versionKey: false, collection: "gymsettings" },
);

export default model("GymSettings", GymSettingsSchema);
