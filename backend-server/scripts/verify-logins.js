/** Verify the seeded logins actually work (bcrypt + member email fallback). */
import bcrypt from "bcryptjs";
import { connectDb, disconnectDb } from "../src/db.js";
import User from "../src/models/User.js";
import Member from "../src/models/Member.js";

const PASSWORD = process.env.SEED_PASSWORD ?? "test@123";

/** Mirrors POST /api/auth/login: staff by email, member via email fallback. */
async function login(email) {
    let user = await User.findOne({ email: email.toLowerCase() }).lean();
    if (!user) {
        const member = await Member.findOne({ email: email.toLowerCase() }).select("_id").lean();
        if (member) user = await User.findOne({ memberId: member._id, role: "member" }).lean();
    }
    if (!user) return { ok: false, why: "no such user" };
    const match = await bcrypt.compare(PASSWORD, user.passwordHash);
    if (!match) return { ok: false, why: "wrong password" };
    return { ok: true, role: user.role, name: user.fullName, active: user.isActive };
}

await connectDb();

const checks = ["admin@gmail.com", "frontdesk@gmail.com", "trainer1@gmail.com", "trainer3@gmail.com", "student1@gmail.com", "student12@gmail.com", "student24@gmail.com"];
console.log(`Password under test: ${PASSWORD}\n`);
let failures = 0;
for (const email of checks) {
    const r = await login(email);
    const status = r.ok ? "OK  " : "FAIL";
    if (!r.ok) failures += 1;
    console.log(`${status} ${email.padEnd(22)} → ${r.ok ? `${r.role} (${r.name})` : r.why}`);
}

await disconnectDb();
console.log(failures === 0 ? "\nAll logins verified." : `\n${failures} login(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
