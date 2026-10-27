/**
 * Kalamandir Dance Institute — a living, operating institute.
 *
 *   npm run seed            wipe + seed
 *   npm run seed -- --keep  seed on top of existing data
 *   SEED_STUDENTS=120 npm run seed   (bigger roster)
 *
 * Design goal: nothing should look "demo". Students join across the last
 * ~15 months, renewals stack into renewal chains, attendance runs daily for
 * the past year, some students churned out, dues linger, and today already
 * has live activity — so every dashboard, chart and report reads like a real
 * institute that has been running for over a year.
 *
 * Logins (password: `test@123`):
 *   admin@gmail.com / frontdesk@gmail.com / trainer1..4@gmail.com
 *   student1@gmail.com … studentN@gmail.com
 */

import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { connectDb, disconnectDb } from "../src/db.js";
import Gym from "../src/models/Gym.js";
import GymSettings from "../src/models/GymSettings.js";
import Tag from "../src/models/Tag.js";
import MembershipPlan from "../src/models/MembershipPlan.js";
import StaffProfile from "../src/models/StaffProfile.js";
import User from "../src/models/User.js";
import Member from "../src/models/Member.js";
import MemberMembership from "../src/models/MemberMembership.js";
import PaymentRecord from "../src/models/PaymentRecord.js";
import AttendanceRecord from "../src/models/AttendanceRecord.js";
import ClassSlot from "../src/models/ClassSlot.js";
import SlotEnrollment from "../src/models/SlotEnrollment.js";
import GymClass from "../src/models/GymClass.js";
import ClassEnrollment from "../src/models/ClassEnrollment.js";
import AppNotification from "../src/models/AppNotification.js";
import AuditLog from "../src/models/AuditLog.js";
import Counter from "../src/models/Counter.js";
import { computeEndDate, currentMembership } from "../src/lib/membership.js";
import { addDays, addMonthsClamped, parseDateOnly, startOfDayInTz, ymdInTz } from "../src/lib/dates.js";

/* ------------------------------ config ------------------------------ */

const PASSWORD = process.env.SEED_PASSWORD ?? "test@123";
const KEEP = process.argv.includes("--keep");
const TZ = "Asia/Kolkata";
const STUDENT_COUNT = Number(process.env.SEED_STUDENTS ?? 72);

/* ------------------------------ helpers ------------------------------ */

/** Deterministic PRNG so a re-seed always yields the same institute. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rnd = mulberry32(20261020);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const pickInt = (min, max) => min + Math.floor(rnd() * (max - min + 1));
const chance = (p) => rnd() < p;
const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const ymdOf = (date) => date.toISOString().slice(0, 10);
const qrToken = () => crypto.randomBytes(32).toString("hex");
const weekdayOf = (date) => new Date(`${ymdInTz(date, TZ)}T12:00:00Z`).getUTCDay();
const atTime = (day, hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(startOfDayInTz(day, TZ).getTime() + h * 3600_000 + m * 60_000);
};

/** "12:30 PM" style receipt line used in payment notes. */
const METHODS = ["cash", "upi", "upi", "card", "bank_transfer", "upi"];
const DISCOUNTS = [0, 0, 0, 100, 200, 300, 500];

/* ------------------------------ people ------------------------------ */

const PHOTOS = [
    "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1517841905240-472988babdf9?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?w=240&h=240&q=70&auto=format&fit=crop",
    "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=240&h=240&q=70&auto=format&fit=crop",
];

const FIRST = {
    female: ["Aadhya", "Ananya", "Diya", "Ishita", "Kavya", "Meera", "Nisha", "Pooja", "Priya", "Riya", "Saanvi", "Shreya", "Sneha", "Tanvi", "Aditi", "Ira", "Myra", "Navya", "Kiara", "Anika", "Rhea", "Tara", "Zoya", "Lavya"],
    male: ["Aarav", "Aditya", "Arjun", "Devansh", "Kabir", "Karan", "Manav", "Nikhil", "Rahul", "Rohan", "Siddharth", "Vivaan", "Yash", "Advait", "Dhruv", "Ishaan", "Kabir", "Neel", "Om", "Rehan", "Shaurya", "Veer", "Aryan", "Kartik"],
};
const LAST = ["Sharma", "Patel", "Mehta", "Iyer", "Singh", "Nair", "Reddy", "Kapoor", "Joshi", "Rao", "Malhotra", "Menon", "Gupta", "Verma", "Chawla", "Deshmukh", "Bhatia", "Kulkarni", "Trivedi", "Sinha", "Thakur", "Bose", "Pillai", "Ramesh", "Shetty", "Chopra", "Agarwal", "Naidu"];
const AREAS = ["Indiranagar", "Koramangala", "HSR Layout", "Jayanagar", "Whitefield", "Malleshwaram", "JP Nagar", "Bellandur", "Banashankari", "Rajajinagar", "Basavanagudi", "Hebbal"];

const STAFF = [
    { fullName: "Jeet Ahirwar", email: "admin@gmail.com", role: "owner", specialization: "Institute director & operations", employmentStatus: "active", photoIndex: 2, joinedMonths: 26 },
    { fullName: "Vikram Sethi", email: "frontdesk@gmail.com", role: "front_desk", specialization: "Front desk, check-ins & billing", employmentStatus: "active", photoIndex: 5, joinedMonths: 18 },
    { fullName: "Riya Sharma", email: "trainer1@gmail.com", role: "trainer", specialization: "Kathak & classical", employmentStatus: "active", photoIndex: 1, joinedMonths: 22 },
    { fullName: "Ananya Patel", email: "trainer2@gmail.com", role: "trainer", specialization: "Bollywood & hip-hop", employmentStatus: "active", photoIndex: 3, joinedMonths: 15 },
    { fullName: "Sneha Kumari", email: "trainer3@gmail.com", role: "trainer", specialization: "Yoga, mobility & contemporary", employmentStatus: "active", photoIndex: 6, joinedMonths: 11 },
    { fullName: "Aman Qureshi", email: "trainer4@gmail.com", role: "trainer", specialization: "Folk & bhangra", employmentStatus: "active", photoIndex: 7, joinedMonths: 9 },
    { fullName: "Kavita Menon", email: "trainer5@gmail.com", role: "trainer", specialization: "Bharatanatyam", employmentStatus: "active", photoIndex: 10, joinedMonths: 7 },
    { fullName: "Rahul Desai", email: "trainer6@gmail.com", role: "trainer", specialization: "Salsa & bachata", employmentStatus: "on_leave", photoIndex: 4, joinedMonths: 5 },
];

const PLANS = [
    { name: "3 Days a Week", description: "A balanced start for your dance journey.", price: 1500, durationValue: 1, durationUnit: "month", classQuota: 12, scheduleLabel: "3 days per week", benefits: ["3 fixed studio days each week", "12 classes every month", "Open practice floor access"], sortOrder: 0 },
    { name: "5 Days a Week", description: "More practice. Better progress.", price: 2000, durationValue: 1, durationUnit: "month", classQuota: 20, scheduleLabel: "Monday – Friday", benefits: ["Monday to Friday classes", "20 classes every month", "Priority batch seating"], sortOrder: 1 },
    { name: "6 Days a Week", description: "Build skills. Express more.", price: 2300, durationValue: 1, durationUnit: "month", classQuota: 24, scheduleLabel: "Monday – Saturday", benefits: ["Monday to Saturday classes", "24 classes every month", "Showcase & performance prep"], sortOrder: 2 },
];

const TAGS = [
    { name: "Bollywood", color: "#ec4899" }, { name: "Kathak", color: "#8b5cf6" },
    { name: "Hip-Hop", color: "#f59e0b" }, { name: "Classical", color: "#3b82f6" },
    { name: "Contemporary", color: "#06b6d4" }, { name: "Folk", color: "#84cc16" },
    { name: "Beginner", color: "#10b981" }, { name: "Kids", color: "#f97316" },
    { name: "Performance Team", color: "#ef4444" }, { name: "Weekend Batch", color: "#6366f1" },
];

/** Recurring batches. `instructor` = index into the trainer staff list. */
const SLOTS = [
    { name: "Morning Kathak", description: "Beginner • All Levels", weekdays: [1, 3, 5], startTime: "08:00", endTime: "09:15", capacity: 20, instructor: 0, classTag: "Dance" },
    { name: "Bollywood Groove", description: "Intermediate • Choreography", weekdays: [2, 4], startTime: "18:00", endTime: "19:15", capacity: 25, instructor: 1, classTag: "Dance" },
    { name: "Sunset Yoga Flow", description: "All Levels • Mobility", weekdays: [0, 5], startTime: "18:30", endTime: "19:30", capacity: 18, instructor: 2, classTag: "Art" },
    { name: "Hip-Hop Foundations", description: "Beginner • All Levels", weekdays: [6], startTime: "10:00", endTime: "11:30", capacity: 22, instructor: 1, classTag: "Dance" },
    { name: "Contemporary Express", description: "Advanced • Performance", weekdays: [3], startTime: "19:30", endTime: "21:00", capacity: 16, instructor: 2, classTag: "Dance" },
    { name: "Bharatanatyam Basics", description: "Beginner • Classical", weekdays: [2, 5], startTime: "17:00", endTime: "18:15", capacity: 18, instructor: 4, classTag: "Dance" },
    { name: "Kids Bollywood", description: "Ages 6–12 • Fun", weekdays: [6], startTime: "09:00", endTime: "10:00", capacity: 20, instructor: 1, classTag: "Dance" },
    { name: "Bhangra Fitness", description: "All Levels • Cardio", weekdays: [5], startTime: "20:00", endTime: "21:00", capacity: 30, instructor: 3, classTag: "Dance" },
    { name: "Salsa Social", description: "All Levels • Partner", weekdays: [4], startTime: "19:30", endTime: "21:00", capacity: 24, instructor: null, classTag: "Art" },
];

/** Dated classes for the visible week. [name, description, time, minutes, capacity] */
const CLASS_TEMPLATES = [
    ["HIIT Blast", "High-intensity dance conditioning", "12:30", 45, 16],
    ["Strength & Barre", "Barre & bodyweight strength", "11:00", 60, 18],
    ["Kathak Chakkar Lab", "Spins, footwork & timing", "17:00", 75, 14],
    ["Bollywood Choreo", "Weekly routine build-up", "18:30", 90, 25],
    ["Hip-Hop Cypher", "Freestyle & groove", "19:00", 60, 22],
    ["Contemporary Flow", "Floor work & improvisation", "20:00", 75, 16],
    ["Morning Stretch", "Mobility to start the day", "07:30", 45, 20],
];

/* ------------------------------ main ------------------------------ */

const now = new Date();
const today = startOfDayInTz(now, TZ);
const passwordHash = await bcrypt.hash(PASSWORD, 10);
const trainerEmails = STAFF.filter((s) => s.role === "trainer").map((s) => s.email);

const conn = await connectDb();
console.log(`Connected → database "${conn.db.databaseName}"`);

if (!KEEP) {
    const collections = [Gym, GymSettings, Tag, MembershipPlan, StaffProfile, User, Member, MemberMembership, PaymentRecord, AttendanceRecord, ClassSlot, SlotEnrollment, GymClass, ClassEnrollment, AppNotification, AuditLog, Counter];
    await Promise.all(collections.map((m) => m.deleteMany({})));
    console.log("Cleared previous data.");
} else {
    console.log("Keeping existing data (--keep).");
}

/* ------------------------------ gym + settings ------------------------------ */

const [gym] = await Gym.create([{
    name: "Kalamandir Dance Institute",
    slug: "kalamandir-dance",
    timezone: TZ,
    currency: "INR",
    logoUrl: null,
    address: "14 Residency Road, Ashok Nagar, Bengaluru 560025",
    phone: "+91 80 4123 8899",
    email: "hello@kalamandirdance.in",
    isActive: true,
    timeSlots: [{ start: "06:30", end: "09:00" }, { start: "16:00", end: "21:30" }],
    gymQrToken: qrToken(),
    enforceSlotHours: true,
    locationLat: 12.9716,
    locationLng: 77.5946,
    locationRadiusM: 250,
    enforceLocation: false,
}]);
const gymId = gym._id;

await GymSettings.create({
    gymId,
    checkinCooldownMinutes: 60,
    trackCheckout: true,
    expiringSoonDays: 7,
    expiryReminderDays: [7, 3, 1],
    allowExpiredCheckin: false,
    enableEmail: false,
    enableSms: true,
    enableWhatsapp: true,
    enablePush: false,
    attendanceRetentionDays: 730,
});

/* ------------------------------ tags + plans ------------------------------ */

const tags = await Tag.insertMany(TAGS.map((t) => ({ ...t, gymId })));

const plans = await MembershipPlan.insertMany(
    PLANS.map((p) => ({ ...p, gymId, isActive: true, description: p.description })),
);

/* ------------------------------ staff + logins ------------------------------ */

const staffDocs = [];
const staffByRole = { trainer: [] };
for (const [i, s] of STAFF.entries()) {
    const [doc] = await StaffProfile.create([{
        gymId,
        fullName: s.fullName,
        email: s.email,
        phone: `+91 9${String(810000000 + i * 11111111).slice(0, 9)}`,
        role: s.role,
        specialization: s.specialization,
        employmentStatus: s.employmentStatus,
        joiningDate: ymdOf(addMonthsClamped(now, -s.joinedMonths)),
        photoUrl: PHOTOS[s.photoIndex % PHOTOS.length],
    }]);
    const [user] = await User.create([{
        gymId,
        fullName: s.fullName,
        email: s.email,
        phone: doc.phone,
        passwordHash,
        role: s.role,
        isActive: true,
    }]);
    doc.profileId = user._id;
    await doc.save();
    staffDocs.push(doc);
    (staffByRole[s.role] ??= []).push(doc);
}
const adminId = staffDocs[0]._id;
const frontdeskId = staffDocs.find((d) => d.role === "front_desk")._id;
const trainers = staffByRole.trainer.filter((d) => d.employmentStatus === "active");
const trainerIds = trainers.map((d) => d._id);

/* ------------------------------ students + history ------------------------------ */

const usedEmails = new Set();
const usedPhones = new Set();
function makeIdentity(index) {
    const gender = chance(0.62) ? "female" : "male";
    const fullName = `${pick(FIRST[gender])} ${pick(LAST)}`;
    const seq = index + 1;
    const email = `student${seq}@gmail.com`; // requested login pattern
    usedEmails.add(email);
    let phone;
    do {
        phone = `+91 9${String(pickInt(100000000, 999999999)).slice(0, 9)}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);
    return { fullName, gender, email, phone, seq };
}

const memberDocs = [];
const memberContext = []; // things the later stages need to look up
const userCreates = []; // portal logins (member role)
const membershipCreates = [];
const paymentCreates = [];

let receiptSeq = 0;
const nextReceipt = () => `RCP-${now.getFullYear()}-${String(++receiptSeq).padStart(6, "0")}`;

/** Record one payment for a membership. */
function pushPayment(memberId, membershipId, amount, onDate, status = "paid", method = pick(METHODS)) {
    paymentCreates.push({
        gymId,
        memberId,
        membershipId,
        amount,
        paymentDate: ymdOf(onDate),
        method,
        status,
        transactionRef: method === "upi" ? `UPI${pickInt(100000, 999999)}` : method === "card" ? `TERM${pickInt(1000, 9999)}` : null,
        receiptNo: nextReceipt(),
        recordedBy: chance(0.7) ? frontdeskId : adminId,
        refundOf: null,
        createdAt: onDate,
        updatedAt: onDate,
    });
}

for (let i = 0; i < STUDENT_COUNT; i += 1) {
    const id = makeIdentity(i);
    const memberCode = `KD-${String(i + 1).padStart(4, "0")}`;

    // Join across the last ~15 months; newer members skew toward recent joins.
    const joinedDaysAgo = Math.round(Math.pow(rnd(), 1.4) * 460) + pickInt(0, 9);
    const joinDate = addDays(today, -joinedDaysAgo);

    // A minority churned: inactive members stop showing up.
    const churned = chance(0.1);
    const status = churned ? "inactive" : "active";

    const tagCount = pickInt(1, 3);
    const memberTags = shuffle(tags).slice(0, tagCount).map((t) => t._id);

    const [member] = await Member.create([{
        gymId,
        memberCode,
        fullName: id.fullName,
        email: id.email,
        phone: id.phone,
        photoUrl: PHOTOS[i % PHOTOS.length],
        dateOfBirth: chance(0.7) ? ymdOf(addDays(today, -pickInt(16 * 365, 46 * 365))) : null,
        age: pickInt(14, 48),
        gender: id.gender,
        address: `${pickInt(1, 220)}, ${pick(AREAS)}, Bengaluru`,
        emergencyContactName: chance(0.65) ? `${pick(FIRST[id.gender === "female" ? "male" : "female"])} ${id.fullName.split(" ")[1]} (spouse)` : null,
        emergencyContactPhone: chance(0.65) ? `+91 9${String(pickInt(100000000, 999999999)).slice(0, 9)}` : null,
        joinDate: ymdOf(joinDate),
        qrToken: qrToken(),
        qrStatus: "active",
        status,
        plannedHoursPerDay: chance(0.5) ? pickInt(1, 3) : null,
        preferredSlot: chance(0.3) ? pick(["06:30-09:00", "16:00-21:30"]) : null,
        classTag: chance(0.7) ? "Dance" : "Art",
        tagIds: memberTags,
        createdBy: adminId,
    }]);
    memberDocs.push(member);

    // Portal login — same email + shared password.
    userCreates.push({
        gymId,
        memberId: member._id,
        fullName: id.fullName,
        email: id.email,
        phone: id.phone,
        passwordHash,
        role: "member",
        isActive: status === "active",
    });

    /* --- membership history: a chain of terms from joinDate to now --- */
    // Active members keep renewing until their current term reaches past
    // today (so most read as "active"); churned/lapsed ones stop early.
    let planIndex = 1 + (chance(0.35) ? pickInt(0, 1) : 0); // skew 5/6-day plans; drifts up
    let cursor = joinDate;
    const terms = [];
    let stillRunning = !churned;
    const maxTerms = 24; // safety cap

    for (let t = 0; t < maxTerms && cursor <= today; t += 1) {
        const plan = plans[Math.min(planIndex, plans.length - 1)];
        const end = computeEndDate(cursor, plan.durationValue, plan.durationUnit);
        const isCurrent = end >= today;
        // If this term already ended and the member is still active, they likely
        // renewed — unless they quietly lapsed (expired).
        const lapsed = !isCurrent && !stillRunning;
        const termStatus = lapsed ? "active" : "active"; // stored status stays active; dates drive expiry

        const discount = pick(DISCOUNTS);
        const [membership] = await MemberMembership.create([{
            gymId,
            memberId: member._id,
            planId: plan._id,
            startDate: ymdOf(cursor),
            endDate: ymdOf(end),
            status: termStatus,
            price: plan.price,
            classQuota: plan.classQuota,
            discount,
            source: t === 0 ? "new" : pick(["renewal", "renewal", "renewal", "extension"]),
            notes: t === 0 ? null : `Renewal #${t}`,
            createdBy: chance(0.8) ? frontdeskId : adminId,
        }]);
        membershipCreates.push(membership);
        terms.push({ membership, plan, start: cursor, end, discount });

        // Money: usually paid in full up-front, sometimes split, rarely pending.
        const due = plan.price - discount;
        const payShape = rnd();
        if (payShape < 0.7) {
            pushPayment(member._id, membership._id, due, addDays(cursor, pickInt(0, 2)));
        } else if (payShape < 0.9) {
            const first = Math.round(due * pick([0.4, 0.5, 0.6]));
            pushPayment(member._id, membership._id, first, addDays(cursor, pickInt(0, 2)), "partial");
            if (chance(0.8)) pushPayment(member._id, membership._id, due - first, addDays(cursor, pickInt(8, 40)), "paid");
        } else {
            pushPayment(member._id, membership._id, Math.round(due * 0.5), addDays(cursor, pickInt(0, 3)), "partial");
        }

        // Next term? An active member keeps renewing until their chain
        // reaches past today; only ~10% of long-standing ones quietly lapse.
        if (!stillRunning) break;
        if (!isCurrent && chance(0.09)) stillRunning = false; // quietly lapse
        // Step the cursor to the next term; drift the plan up for loyal members.
        cursor = addDays(end, 1);
        if (chance(0.25)) planIndex = Math.min(planIndex + 1, plans.length - 1);
    }

    const current = terms.find((x) => x.end >= today && x.start <= today) ?? terms.at(-1);
    memberContext.push({ member, terms, current, tags: memberTags, active: status === "active" });
}

await User.insertMany(userCreates);
await PaymentRecord.insertMany(paymentCreates);
console.log(`Created ${memberDocs.length} students + ${membershipCreates.length} memberships + ${paymentCreates.length} payments.`);

/* ------------------------------ class slots + rosters ------------------------------ */

const slots = await ClassSlot.insertMany(SLOTS.map((s) => ({
    gymId,
    name: s.name,
    description: s.description,
    weekdays: s.weekdays,
    startTime: s.startTime,
    endTime: s.endTime,
    capacity: s.capacity,
    classTag: s.classTag,
    instructorId: s.instructor == null ? null : trainerIds[s.instructor] ?? null,
    isActive: true,
    createdBy: adminId,
})));

// Students join 1–3 batches that match their tags / energy. Roster builds over
// time, so older members are in more batches.
const slotEnrollCreates = [];
const enrolledSlotIdsByMember = new Map();
for (const ctx of memberContext) {
    if (!ctx.active) continue;
    const months = (now - ctx.member.joinDate instanceof Date ? Math.round((now - new Date(ctx.member.joinDate)) / 86_400_000) : 0);
    const howMany = Math.min(slots.length, months > 270 ? pickInt(2, 3) : months > 90 ? pickInt(1, 2) : 1);
    const chosen = shuffle(slots).slice(0, howMany);
    enrolledSlotIdsByMember.set(String(ctx.member._id), chosen.map((s) => String(s._id)));
    for (const slot of chosen) {
        const enrolledAt = addDays(today, -pickInt(1, Math.max(2, months)));
        slotEnrollCreates.push({
            gymId,
            slotId: slot._id,
            memberId: ctx.member._id,
            status: "enrolled",
            enrolledAt,
        });
    }
}
await SlotEnrollment.insertMany(slotEnrollCreates);

/* ------------------------------ dated classes + enrolments ------------------------------ */

const classDocs = [];
const classEnrollCreates = [];
let classSeq = 0;

// Past classes: a running history for the last ~2 months (feeds Reports).
for (let offset = -64; offset <= -1; offset += 1) {
    const day = addDays(today, offset);
    for (const [tplIndex, tpl] of CLASS_TEMPLATES.entries()) {
        // Not every template runs every day — mirror a realistic rotation.
        if ((offset + tplIndex) % 3 !== 0) continue;
        const [doc] = await GymClass.create([{
            gymId,
            name: tpl[0],
            description: tpl[1],
            trainerId: trainerIds[classSeq % trainerIds.length] ?? null,
            startsAt: atTime(day, tpl[2]),
            durationMinutes: tpl[3],
            capacity: tpl[4],
            status: "completed",
            kind: "regular",
        }]);
        classDocs.push(doc);
        // Attendance for most of the roster; a few no-shows.
        const attendees = shuffle(memberContext.filter((c) => c.active)).slice(0, pickInt(6, Math.min(14, tpl[4])));
        for (const att of attendees) {
            classEnrollCreates.push({
                gymId,
                classId: doc._id,
                memberId: att.member._id,
                status: chance(0.85) ? "attended" : "no_show",
                enrolledAt: addDays(day, -pickInt(1, 6)),
            });
        }
        classSeq += 1;
    }
}

// Upcoming classes: fill the visible week so the schedule looks alive.
for (let offset = 0; offset <= 14; offset += 1) {
    const day = addDays(today, offset);
    for (const [tplIndex, tpl] of CLASS_TEMPLATES.entries()) {
        if ((offset + tplIndex) % 2 !== 0) continue;
        const startsAt = atTime(day, tpl[2]);
        if (offset === 0 && startsAt < now) continue; // don't seed today's already-past classes
        const status = offset === 5 && tplIndex === 2 ? "cancelled" : "scheduled";
        const [doc] = await GymClass.create([{
            gymId,
            name: tpl[0],
            description: tpl[1],
            trainerId: trainerIds[classSeq % trainerIds.length] ?? null,
            startsAt,
            durationMinutes: tpl[3],
            capacity: tpl[4],
            status,
            kind: "regular",
        }]);
        classDocs.push(doc);
        const target = Math.min(tpl[4], pickInt(5, 12));
        const enrolled = shuffle(memberContext.filter((c) => c.active)).slice(0, target);
        for (const att of enrolled) {
            classEnrollCreates.push({
                gymId,
                classId: doc._id,
                memberId: att.member._id,
                status: "enrolled",
                enrolledAt: addDays(today, -pickInt(1, 7)),
            });
        }
        classSeq += 1;
    }
}
await ClassEnrollment.insertMany(classEnrollCreates);
console.log(`Created ${classDocs.length} classes + ${classEnrollCreates.length} enrolments.`);

/* ------------------------------ attendance (a year of visits) ------------------------------ */

const attendanceCreates = [];
const membershipByMember = new Map();
for (const m of membershipCreates) {
    const key = String(m.memberId);
    if (!membershipByMember.has(key)) membershipByMember.set(key, []);
    membershipByMember.get(key).push(m);
}

// Plain floor visits for the last ~10 months (quotaCounted = null).
for (const ctx of memberContext) {
    if (!ctx.active) continue;
    const joinedDaysAgo = Math.round((today - new Date(ctx.member.joinDate)) / 86_400_000);
    const depth = Math.min(300, joinedDaysAgo);
    const freq = chance(0.5) ? 0.34 : 0.2; // some come almost daily, others weekly-ish
    for (let d = 1; d <= depth; d += 1) {
        if (!chance(freq)) continue;
        const day = addDays(today, -d);
        if (day < new Date(ctx.member.joinDate)) continue;
        const hour = pick([7, 8, 9, 10, 17, 18, 19, 20]);
        const checkIn = new Date(day.getTime() + hour * 3600_000 + pickInt(0, 55) * 60_000);
        const stay = pickInt(45, 100);
        const checkOut = chance(0.8) ? new Date(checkIn.getTime() + stay * 60_000) : null;
        const membershipId = membershipByMember.get(String(ctx.member._id))?.[0]?._id ?? null;
        attendanceCreates.push({
            gymId,
            memberId: ctx.member._id,
            membershipId,
            checkIn,
            checkOut,
            status: checkOut ? "checked_out" : "checked_in",
            method: chance(0.82) ? "qr" : "manual",
            scannerId: frontdeskId,
            quotaCounted: null,
            demo: false,
            attendanceStatus: null,
            dedupeKey: null,
            createdAt: checkIn,
            updatedAt: checkOut ?? checkIn,
        });
    }
}

// Class attendance for recurring slots (quotaCounted = true → burns quota).
const seen = new Set();
for (const slot of slots) {
    const roster = slotEnrollCreates.filter((e) => String(e.slotId) === String(slot._id));
    const maxBack = 60;
    for (let d = 1; d <= maxBack; d += 1) {
        const day = addDays(today, -d);
        if (!slot.weekdays.includes(weekdayOf(day))) continue;
        const dayKey = ymdInTz(day, TZ);
        for (const enr of roster) {
            if (!chance(0.66)) continue;
            const dedupeKey = `slot:${slot._id}:${dayKey}`;
            const key = `${enr.memberId}:${dedupeKey}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const roll = rnd();
            const status = roll < 0.74 ? "present" : roll < 0.88 ? "late" : "absent";
            const membershipId = membershipByMember.get(String(enr.memberId))?.[0]?._id ?? null;
            attendanceCreates.push({
                gymId,
                memberId: enr.memberId,
                membershipId,
                checkIn: atTime(day, slot.startTime),
                checkOut: atTime(day, slot.endTime),
                status: status === "absent" ? "checked_in" : "checked_out",
                method: "class",
                scannerId: slot.instructorId ?? frontdeskId,
                classSlotId: slot._id,
                sessionDate: parseDateOnly(dayKey),
                quotaCounted: status !== "absent",
                demo: false,
                attendanceStatus: status,
                dedupeKey,
                createdAt: atTime(day, slot.startTime),
                updatedAt: atTime(day, slot.endTime),
            });
        }
    }
}

// TODAY: a burst of live check-ins so the dashboard shows the institute mid-day.
const todayRoster = shuffle(memberContext.filter((c) => c.active)).slice(0, 14);
for (const ctx of todayRoster) {
    const hour = pick([8, 9, 10, 11, 12, 17]);
    const checkIn = new Date(today.getTime() + hour * 3600_000 + pickInt(0, 59) * 60_000);
    if (checkIn > now) continue;
    const checkOut = chance(0.55) ? new Date(checkIn.getTime() + pickInt(45, 95) * 60_000) : null;
    const membershipId = membershipByMember.get(String(ctx.member._id))?.[0]?._id ?? null;
    attendanceCreates.push({
        gymId,
        memberId: ctx.member._id,
        membershipId,
        checkIn,
        checkOut: checkOut && checkOut <= now ? checkOut : null,
        status: checkOut && checkOut <= now ? "checked_out" : "checked_in",
        method: "qr",
        scannerId: frontdeskId,
        quotaCounted: null,
        demo: false,
        attendanceStatus: null,
        dedupeKey: null,
        createdAt: checkIn,
        updatedAt: checkOut ?? checkIn,
    });
}

await AttendanceRecord.insertMany(attendanceCreates);
console.log(`Created ${attendanceCreates.length} attendance records (incl. today's live check-ins).`);

/* ------------------------------ counters ------------------------------ */

await Counter.bulkWrite([
    { updateOne: { filter: { key: `member_code:${gymId}` }, update: { $set: { seq: STUDENT_COUNT + 120 } }, upsert: true } },
    { updateOne: { filter: { key: `receipt_no:${gymId}` }, update: { $set: { seq: receiptSeq + 120 } }, upsert: true } },
]);

/* ------------------------------ notifications + audit ------------------------------ */

const expiringSoon = memberContext
    .filter((c) => c.current?.end && c.active && (c.current.end - today) / 86_400_000 <= 7 && c.current.end >= today)
    .slice(0, 3);

await AppNotification.insertMany([
    {
        gymId, userId: adminId, memberId: null, type: "general",
        title: "Annual Day rehearsals start Monday",
        body: "Performance Team slots move to the main floor from next week. Confirm costumes with Riya.",
        severity: "info", isRead: false, dedupeKey: "ann-day", link: "/classes",
        createdAt: addDays(now, -0.2),
    },
    ...expiringSoon.map((c, i) => ({
        gymId, userId: adminId, memberId: c.member._id, type: "expiry_warning",
        title: "Membership expiring soon",
        body: `${c.member.memberCode} — ${c.member.fullName}'s membership ends ${c.current.end}. Nudge for renewal.`,
        severity: "warning", isRead: false, dedupeKey: `expiry-${i}`, link: "/members",
        createdAt: addDays(now, -0.4 - i * 0.2),
    })),
    {
        gymId, userId: adminId, memberId: null, type: "payment_pending",
        title: "Dues follow-up",
        body: "A few students still carry an outstanding balance for the current term.",
        severity: "warning", isRead: true, dedupeKey: "dues", link: "/payments",
        createdAt: addDays(now, -1.2),
    },
]);

await AuditLog.insertMany([
    {
        gymId, actorId: adminId, entity: "system", entityId: null, action: "institute_seeded",
        newValues: { students: STUDENT_COUNT, classes: classDocs.length, slots: slots.length, attendance: attendanceCreates.length },
        createdAt: now,
    },
]);

/* ------------------------------ summary ------------------------------ */

const counts = await Promise.all(
    [Member, User, StaffProfile, MemberMembership, PaymentRecord, AttendanceRecord, ClassSlot, SlotEnrollment, GymClass, ClassEnrollment, AppNotification, Tag, MembershipPlan]
        .map(async (m) => [m.modelName, await m.countDocuments()]),
);

console.log("\nSeeded institute:");
for (const [name, count] of counts) console.log(`  ${name.padEnd(18)} ${count}`);

console.log(`\nLogins (password: ${PASSWORD})`);
console.log("  Staff    admin@gmail.com · frontdesk@gmail.com");
console.log("  Trainers " + trainerEmails.join(" · "));
console.log(`  Students student1@gmail.com … student${STUDENT_COUNT}@gmail.com`);

await disconnectDb();
