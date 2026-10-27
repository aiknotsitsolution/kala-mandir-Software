import mongoose from "mongoose";

const { Schema, model } = mongoose;

/** Financial history. Never hard-deleted by clients. */
const PaymentRecordSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    memberId: { type: Schema.Types.ObjectId, ref: "Member", required: true },
    membershipId: { type: Schema.Types.ObjectId, ref: "MemberMembership", default: null },
    amount: { type: Number, required: true },
    paymentDate: { type: Date, default: Date.now },
    method: {
      type: String,
      enum: ["cash", "upi", "card", "bank_transfer", "other"],
      required: true,
    },
    status: {
      type: String,
      enum: ["paid", "partial", "pending", "refunded", "failed"],
      default: "paid",
    },
    transactionRef: { type: String, default: null },
    notes: { type: String, default: null },
    receiptNo: { type: String, required: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    refundOf: { type: Schema.Types.ObjectId, ref: "PaymentRecord", default: null },
    /** Client-supplied idempotency key guarding double submissions. */
    idempotencyKey: { type: String, default: null },
  },
  { timestamps: true, versionKey: false, collection: "paymentrecords" },
);

PaymentRecordSchema.index({ gymId: 1, receiptNo: 1 }, { unique: true });
PaymentRecordSchema.index(
  { gymId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);
PaymentRecordSchema.index({ gymId: 1, paymentDate: -1 });
PaymentRecordSchema.index({ memberId: 1, paymentDate: -1 });
PaymentRecordSchema.index({ gymId: 1, status: 1 });

export default model("PaymentRecord", PaymentRecordSchema);
