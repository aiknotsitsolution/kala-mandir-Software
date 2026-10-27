import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Append-only audit trail. No updated_at (append-only). */
const AuditLogSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    /** Logical entity name, e.g. 'members', 'attendance_records'. */
    entity: { type: String, required: true },
    entityId: { type: String, default: null },
    action: { type: String, required: true },
    oldValues: { type: Object, default: null },
    newValues: { type: Object, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false }, versionKey: false, collection: "auditlogs" },
);

AuditLogSchema.index({ gymId: 1, createdAt: -1 });
AuditLogSchema.index({ gymId: 1, entity: 1, entityId: 1 });

export default model("AuditLog", AuditLogSchema);
