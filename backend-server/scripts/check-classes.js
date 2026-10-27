import { connectDb, disconnectDb } from "../src/db.js";
import GymClass from "../src/models/GymClass.js";
import { ymdInTz } from "../src/lib/dates.js";

const conn = await connectDb();
console.log(`DB: ${conn.db.databaseName}`);
const total = await GymClass.countDocuments({});
const now = new Date();
const upcoming = await GymClass.countDocuments({ startsAt: { $gte: now } });
const past = await GymClass.countDocuments({ startsAt: { $lt: now } });
console.log(`GymClass total=${total} upcoming=${upcoming} past=${past}`);

const minMax = await GymClass.aggregate([
  { $group: { _id: null, min: { $min: "$startsAt" }, max: { $max: "$startsAt" } } },
]);
if (minMax[0]) {
  console.log(`range: ${minMax[0].min.toISOString()} .. ${minMax[0].max.toISOString()}`);
}
const earliest = await GymClass.findOne({}).sort({ startsAt: 1 }).lean();
if (earliest) console.log(`earliest: ${ymdInTz(earliest.startsAt, "Asia/Kolkata")} ${earliest.name} [${earliest.status}]`);
await disconnectDb();
