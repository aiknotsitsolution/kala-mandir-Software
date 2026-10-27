/** Sequential code generators: member codes (KD-0001) and receipts (RCP-0001). */

import Counter from "../models/Counter.js";
import Member from "../models/Member.js";
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

/**
 * Next free member code (`KD-0001` style) for a gym, retrying past any
 * collisions left behind by deleted members (unique-index retry).
 */
export async function nextMemberCode(gymId, session = null) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const n = await nextSequence(`member_code:${gymId}`, session);
    const code = formatCode("KD", n);
    const existing = await Member.findOne({ gymId, memberCode: code })
      .select("_id")
      .session(session);
    if (!existing) return code;
  }
  throw new Error("Unable to allocate a unique student code");
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
