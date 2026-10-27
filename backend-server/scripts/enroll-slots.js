/**
 * Top up every active ClassSlot with a healthy roster.
 *
 * The regular seed assigns each student 1–3 random batches, which can leave
 * some slots empty. This script walks every ACTIVE slot and enrolls enough
 * active members (that aren't already in it) to reach a target roster size,
 * so the Attendance page always has students to mark for each class.
 *
 *   node scripts/enroll-slots.js            # target 12 per slot (or capacity)
 *   TARGET=20 node scripts/enroll-slots.js  # custom target
 *
 * Respects each slot's capacity (null capacity = unlimited). Existing
 * enrollments are kept; cancelled ones are flipped back to "enrolled".
 */

import { connectDb, disconnectDb } from "../src/db.js";
import Gym from "../src/models/Gym.js";
import ClassSlot from "../src/models/ClassSlot.js";
import Member from "../src/models/Member.js";
import SlotEnrollment from "../src/models/SlotEnrollment.js";

const TARGET_PER_SLOT = Number(process.env.TARGET ?? 12);

await connectDb();

try {
  const gym = await Gym.findOne().lean();
  if (!gym) {
    console.log("No gym found — run the seed first.");
    process.exit(0);
  }
  const gymId = gym._id;

  const slots = await ClassSlot.find({ gymId, isActive: true }).lean();
  // Active = status is active (effectiveStatus logic is on memberships, but for
  // roster purposes we take every member whose account isn't inactive/deleted).
  const members = await Member.find({ gymId, status: { $ne: "inactive" } })
    .sort({ createdAt: 1 })
    .lean();

  if (!slots.length) {
    console.log("No active class slots found.");
    process.exit(0);
  }
  if (!members.length) {
    console.log("No active members found.");
    process.exit(0);
  }

  console.log(`Slots: ${slots.length} | Members: ${members.length} | Target/slot: ${TARGET_PER_SLOT}`);

  // Cursor over members so we can hand out different students per slot.
  let cursor = 0;
  let totalEnrolled = 0;

  for (const slot of slots) {
    const cap = slot.capacity ?? Infinity;
    const target = Math.min(TARGET_PER_SLOT, cap);

    const existing = await SlotEnrollment.find({ slotId: slot._id, status: "enrolled" }).lean();
    const have = new Set(existing.map((e) => String(e.memberId)));
    let need = Math.max(0, target - have.size);

    if (need === 0) {
      console.log(`  • ${slot.name}: already ${have.size}/${target} — skipping`);
      continue;
    }

    const creates = [];
    // Walk the member list from the current cursor so each slot gets a fresh
    // slice; wrap around once we run out.
    let scanned = 0;
    while (need > 0 && scanned < members.length) {
      const m = members[cursor % members.length];
      cursor += 1;
      scanned += 1;
      if (have.has(String(m._id))) continue;
      have.add(String(m._id));
      creates.push({ gymId, slotId: slot._id, memberId: m._id, status: "enrolled", enrolledAt: new Date() });
      need -= 1;
    }

    if (creates.length) {
      // Upsert so a cancelled row flips back to enrolled instead of duplicating.
      await SlotEnrollment.bulkWrite(
        creates.map((c) => ({
          updateOne: {
            filter: { slotId: c.slotId, memberId: c.memberId },
            update: { $set: { status: "enrolled", enrolledAt: c.enrolledAt, gymId: c.gymId } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      totalEnrolled += creates.length;
    }

    console.log(`  • ${slot.name}: ${have.size - creates.length} → ${have.size} students (+${creates.length})`);
  }

  console.log(`\nDone. Enrolled ${totalEnrolled} new roster seats across ${slots.length} slots.`);
} finally {
  await disconnectDb();
}
