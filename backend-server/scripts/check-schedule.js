/** Quick sanity check of the seeded schedule data. */
import { connectDb, disconnectDb } from "../src/db.js";
import ClassSlot from "../src/models/ClassSlot.js";
import GymClass from "../src/models/GymClass.js";
import Member from "../src/models/Member.js";

await connectDb();

console.log("Class slots:");
for (const s of await ClassSlot.find({}).lean()) {
    const days = s.weekdays.sort((a, b) => a - b).map((d) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][d]).join(",");
    console.log(`  ${s.name.padEnd(22)} ${days.padEnd(12)} ${s.startTime}-${s.endTime}  cap=${s.capacity ?? "∞"}  instructor=${s.instructorId ? "yes" : "UNASSIGNED"}`);
}

const upcoming = await GymClass.find({ status: "scheduled", startsAt: { $gte: new Date() } }).sort({ startsAt: 1 }).limit(5).lean();
console.log(`\nNext ${upcoming.length} scheduled classes:`);
for (const c of upcoming) console.log(`  ${c.startsAt.toISOString().slice(0, 16).replace("T", " ")}  ${c.name} (${c.durationMinutes}m, cap ${c.capacity})`);

const students = await Member.find({}).select("memberCode fullName email").sort({ memberCode: 1 }).lean();
console.log(`\nFirst 3 / last student:`);
console.log(`  ${students[0].memberCode} ${students[0].fullName} ${students[0].email}`);
console.log(`  ${students[1].memberCode} ${students[1].fullName} ${students[1].email}`);
console.log(`  ${students.at(-1).memberCode} ${students.at(-1).fullName} ${students.at(-1).email}`);

await disconnectDb();
