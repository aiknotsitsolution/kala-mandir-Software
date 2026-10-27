import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import User from "../models/User.js";
import Member from "../models/Member.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { parseBody } from "../middleware/validate.js";
import { asyncHandler, unauthorized } from "../lib/errors.js";
import { toPublicUser } from "../lib/serialize.js";

const router = Router();

const loginSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address").optional(),
    memberCode: z.string().trim().min(3, "Student code is too short").optional(),
    phone: z.string().trim().optional(),
    password: z.string().min(1, "Password is required"),
  })
  .refine((v) => v.email || v.memberCode || v.phone, {
    message: "Email, Student code or mobile number is required",
    path: ["email"],
  });

const PHONE_LENGTH = 10;

/** Last 10 digits, so "+91 98765 43210" and "9876543210" are the same login. */
function phoneDigits(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > PHONE_LENGTH ? digits.slice(-PHONE_LENGTH) : digits;
}

/** Stored numbers vary ("+91 98765 43210", "98765-43210") — match on the digits. */
function phonePattern(digits) {
  return new RegExp(digits.split("").join("[^0-9]*"));
}

/**
 * Login users reachable by mobile number: staff through their login row's phone,
 * members through the member record (Member.phone is the source of truth — the
 * login row's copy can go stale after a front-desk edit).
 */
async function findPhoneUsers(phone) {
  const digits = phoneDigits(phone);
  if (digits.length !== PHONE_LENGTH) return [];

  const regex = phonePattern(digits);
  const [staff, members] = await Promise.all([
    User.find({ role: { $ne: "member" }, phone: { $regex: regex } })
      .sort({ isActive: -1, lastLoginAt: -1 })
      .limit(10)
      .lean(),
    Member.find({ phone: { $regex: regex } }).select("_id").limit(10).lean(),
  ]);

  const memberUsers = members.length
    ? await User.find({ memberId: { $in: members.map((m) => m._id) }, role: "member" })
        .sort({ isActive: -1, lastLoginAt: -1 })
        .lean()
    : [];

  return [...staff, ...memberUsers];
}

/** POST /api/auth/login { email | memberCode | phone, password } → { token, user } */
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, memberCode, phone, password } = parseBody(loginSchema, req.body);

    const candidates = [];
    if (memberCode) {
      // Legacy: identify by the printed member code (PG-0001).
      const member = await Member.findOne({ memberCode: memberCode.trim().toUpperCase() })
        .select("_id")
        .lean();
      if (member) {
        const user = await User.findOne({ memberId: member._id, role: "member" }).lean();
        if (user) candidates.push(user);
      }
    } else if (email) {
      const user = await User.findOne({ email: email.toLowerCase() }).lean();
      if (user) candidates.push(user);
      else {
        // Member portal: the member's own (real) email → their portal login.
        const member = await Member.findOne({ email: email.toLowerCase() })
          .select("_id")
          .lean();
        if (member) {
          const memberUser = await User.findOne({ memberId: member._id, role: "member" }).lean();
          if (memberUser) candidates.push(memberUser);
        }
      }
    }
    if (phone) candidates.push(...(await findPhoneUsers(phone)));

    // Same account can surface through several identifiers — check each password
    // once, active accounts first.
    const seen = new Set();
    const users = candidates
      .filter((candidate) => {
        const key = String(candidate._id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Number(b.isActive) - Number(a.isActive));

    let user = null;
    for (const candidate of users) {
      if (await bcrypt.compare(password, candidate.passwordHash)) {
        user = candidate;
        break;
      }
    }

    if (!user) {
      throw unauthorized(
        memberCode
          ? "Invalid student code or password"
          : phone && !email
            ? "Invalid mobile number or password"
            : email && !phone
              ? "Invalid email or password"
              : "Invalid login details or password",
        "invalid_credentials",
      );
    }
    if (!user.isActive) throw unauthorized("This account is disabled", "account_disabled");

    await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
    res.json({ token: signToken(user), user: toPublicUser(user) });
  }),
);

/** GET /api/auth/me → the authenticated user. */
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id).lean();
    if (!user) throw unauthorized();
    const shaped = toPublicUser(user);
    // Top-level fields plus a `user` alias — both shapes are harmless JSON.
    res.json({ ...shaped, user: shaped });
  }),
);

const updateMeSchema = z.object({
  fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(120).optional(),
  avatarUrl: z
    .string({ invalid_type_error: "Avatar must be a URL or data URL" })
    .max(800_000, "Photo is too large")
    .nullable()
    .optional(),
});

/** PATCH /api/auth/me { fullName?, avatarUrl? } → the updated user. */
router.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = parseBody(updateMeSchema, req.body);
    const updates = {};
    if (input.fullName !== undefined) updates.fullName = input.fullName;
    if (input.avatarUrl !== undefined) updates.avatarUrl = input.avatarUrl || null;
    const user = await User.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true }).lean();
    if (!user) throw unauthorized();
    const shaped = toPublicUser(user);
    res.json({ ...shaped, user: shaped });
  }),
);

export default router;
