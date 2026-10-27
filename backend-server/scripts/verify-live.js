/**
 * Verify the seeded institute reads like a living business:
 * logins, membership status mix, today's check-ins, this week's schedule.
 */
import bcrypt from "bcryptjs";
import { connectDb, disconnectDb } from "../src/db.js";
import User from "../src/models/User.js";
import Member from "../src/models/Member.js";
import MemberMembership from "../src/models/MemberMembership.js";
import AttendanceRecord from "../src/models/AttendanceRecord.js";
import GymClass from "../src/models/GymClass.js";
import ClassSlot from "../src/models/ClassSlot.js";
import { currentMembership, effectiveStatus } from "../src/lib/membership.js";
import { addDays, startOfDayInTz, ymdInTz } from "../src/lib/dates.js";

const PASSWORD = process.env.SEED_PASSWORD ?? "test@123";
const TZ = "Asia/Kolkata";

/** Mirrors POST /api/auth/login: staff by email, member via email fallback. */
async function login(email) {
  let user = await User.findOne({ email: email.toLowerCase() }).lean();
  if (!user) {
    const member = await Member.findOne({ email: email.toLowerCase() }).select("_id").lean();
    if (member) user = await User.findOne({ memberId: member._id, role: "member" }).lean();
  }
  if (!user) return { ok: false, why: "no such user" };
  if (!(await bcrypt.compare(PASSWORD, user.passwordHash))) return { ok: false, why: "wrong password" };
  if (!user.isActive) return { ok: false, why: "account disabled" };
  return { ok: true, role: user.role, name: user.fullName };
}

await connectDb();
const now = new Date();
const today = startOfDayInTz(now, TZ);
const todayKey = ymdInTz(now, TZ);

console.log("=== LOGINS (password: test@123) ===");
const checks = [
  "admin@gmail.com", "frontdesk@gmail.com", "trainer1@gmail.com", "trainer3@gmail.com", "trainer6@gmail.com",
  "student1@gmail.com", "student36@gmail.com", "student72@gmail.com",
];
let failures = 0;
for (const email of checks) {
  const r = await login(email);
  if (!r.ok) failures += 1;
  console.log(`${r.ok ? "OK  " : "FAIL"} ${email.padEnd(22)} → ${r.ok ? `${r.role} (${r.name})` : r.why}`);
}

console.log("\n=== MEMBERSHIP STATUS MIX ===");
const members = await Member.find({}).lean();
const mix = { active: 0, expiring: 0, expired: 0, none: 0 };
for (const m of members) {
  const subs = await MemberMembership.find({ memberId: m._id }).lean();
  const cur = currentMembership(subs);
  const status = cur ? effectiveStatus(cur, m.status, now, 7) : "none";
  mix[status] = (mix[status] ?? 0) + 1;
}
console.log(JSON.stringify(mix), `total=${members.length}`);

console.log("\n=== TODAY'S ACTIVITY ===");
const todaysVisits = await AttendanceRecord.countDocuments({
  checkIn: { $gte: today, $lte: now },
});
const last7 = await AttendanceRecord.countDocuments({
  checkIn: { $gte: addDays(today, -7) },
});
const last30 = await AttendanceRecord.countDocuments({
  checkIn: { $gte: addDays(today, -30) },
});
console.log(`check-ins today: ${todaysVisits} | last 7 days: ${last7} | last 30 days: ${last30}`);

console.log("\n=== THIS WEEK'S SCHEDULE ===");
const upcoming = await GymClass.find({ startsAt: { $gte: now } }).sort({ startsAt: 1 }).limit(8).lean();
for (const c of upcoming) {
  console.log(`  ${ymdInTz(c.startsAt, TZ)} ${c.startsAt.toISOString().slice(11, 16)}Z  ${c.name.padEnd(20)} ${c.status}`);
}

console.log("\n=== RECURRING BATCHES ===");
for (const s of await ClassSlot.find({}).lean()) {
  const days = [...s.weekdays].sort((a, b) => a - b).map((d) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d]).join(",");
  console.log(`  ${s.name.padEnd(22)} ${days.padEnd(12)} ${s.startTime}-${s.endTime} cap=${s.capacity}`);
}

await disconnectDb();
console.log(failures === 0 ? "\nALL LOGINS OK" : `\n${failures} LOGIN(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
