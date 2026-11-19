/** Sequential receipt number generator (RCP-0001). */

import Counter from "../models/Counter.js";
import PaymentRecord from "../models/PaymentRecord.js";

/** Atomically bump and return a named sequence. */
export async function nextSequence(key, session = null) {
  const doc = await Counter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session },
  );
  return doc.seq;
}

function formatCode(prefix, n) {
  return `${prefix}-${String(n).padStart(4, "0")}`;
}

/** Next free receipt number (`RCP-0001` style) for a gym. */
export async function nextReceiptNo(gymId, session = null) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const n = await nextSequence(`receipt_no:${gymId}`, session);
    const receiptNo = formatCode("RCP", n);
    const existing = await PaymentRecord.findOne({ gymId, receiptNo })
      .select("_id")
      .session(session);
    if (!existing) return receiptNo;
  }
  throw new Error("Unable to allocate a unique receipt number");
}
