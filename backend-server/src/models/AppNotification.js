import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** In-app notifications (written by generators; users only mark read). */
const AppNotificationSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    /** null = broadcast to the whole gym. */
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", default: null },
    type: {
      type: String,
      enum: [
        "expiry_warning",
        "membership_expired",
        "payment_pending",
        "checkin_success",
        "checkin_rejected",
        "class_reminder",
        "quota_low",
        "quota_exhausted",
        "quota_exceeded",
        "general",
      ],
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    severity: { type: String, enum: ["info", "success", "warning", "error"], default: "info" },
    isRead: { type: Boolean, default: false },
    /** Idempotency key, e.g. `<memberId>:<membershipId>:expiry_warning`. */
    dedupeKey: { type: String, default: null },
    link: { type: String, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, versionKey: false, collection: "notifications" },
);

AppNotificationSchema.index(
  { gymId: 1, type: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);
AppNotificationSchema.index({ gymId: 1, isRead: 1, createdAt: -1 });

export default model("AppNotification", AppNotificationSchema);
