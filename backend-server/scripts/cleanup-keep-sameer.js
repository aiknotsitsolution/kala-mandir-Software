/**
 * One-off cleanup: remove ALL seeded/demo students, keep ONLY "Sameer".
 *
 * Deletes each removed student's memberships, attendance records, payments,
 * slot/class enrollments, member notifications, and member login accounts.
 * Plans, tags, staff, classes, slots, and the admin user are untouched.
 *
 * Usage:
 *   node scripts/cleanup-keep-sameer.js          # dry run (shows counts)
 *   node scripts/cleanup-keep-sameer.js --apply  # actually delete
 */
import { connectDb, disconnectDb } from "../src/db.js";
import Member from "../src/models/Member.js";
import MemberMembership from "../src/models/MemberMembership.js";
import PaymentRecord from "../src/models/PaymentRecord.js";
import AttendanceRecord from "../src/models/AttendanceRecord.js";
import SlotEnrollment from "../src/models/SlotEnrollment.js";
import ClassEnrollment from "../src/models/ClassEnrollment.js";
import AppNotification from "../src/models/AppNotification.js";
import User from "../src/models/User.js";

const APPLY = process.argv.includes("--apply");

await connectDb();

const keep = await Member.find({ fullName: /sameer/i }).lean();
if (keep.length === 0) {
  console.error("No member named Sameer found — aborting to avoid deleting everyone.");
  process.exit(1);
}
const keepIds = keep.map((m) => m._id);
console.log("Keeping:");
for (const m of keep) {
  console.log(`  - ${m.fullName} (${m.memberCode}) · ${m.phone}`);
}

const remove = await Member.find({ _id: { $nin: keepIds } }).lean();
console.log(`\nStudents to remove: ${remove.length}`);
const removeIds = remove.map((m) => m._id);

const count = async (model, filter) => model.countDocuments(filter);

const plan = {
  Members: await count(Member, { _id: { $in: removeIds } }),
  Memberships: await count(MemberMembership, { memberId: { $in: removeIds } }),
  AttendanceRecords: await count(AttendanceRecord, { memberId: { $in: removeIds } }),
  PaymentRecords: await count(PaymentRecord, { memberId: { $in: removeIds } }),
  SlotEnrollments: await count(SlotEnrollment, { memberId: { $in: removeIds } }),
  ClassEnrollments: await count(ClassEnrollment, { memberId: { $in: removeIds } }),
  Notifications: await count(AppNotification, { memberId: { $in: removeIds } }),
  MemberLogins: await count(User, { memberId: { $in: removeIds } }),
};
console.log("\nRecords to delete:");
for (const [k, v] of Object.entries(plan)) console.log(`  ${k}: ${v}`);

if (!APPLY) {
  console.log("\nDRY RUN — nothing deleted. Re-run with --apply to delete.");
  process.exit(0);
}

await Promise.all([
  Member.deleteMany({ _id: { $in: removeIds } }),
  MemberMembership.deleteMany({ memberId: { $in: removeIds } }),
  AttendanceRecord.deleteMany({ memberId: { $in: removeIds } }),
  PaymentRecord.deleteMany({ memberId: { $in: removeIds } }),
  SlotEnrollment.deleteMany({ memberId: { $in: removeIds } }),
  ClassEnrollment.deleteMany({ memberId: { $in: removeIds } }),
  AppNotification.deleteMany({ memberId: { $in: removeIds } }),
  User.deleteMany({ memberId: { $in: removeIds } }),
]);

const after = await count(Member, {});
console.log(`\nDone. Members remaining in DB: ${after}`);
await disconnectDb();
