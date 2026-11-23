import { Router } from "express";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";
import bcrypt from "bcryptjs";
import { z } from "zod";
import config from "../config.js";
import User from "../models/User.js";
import Member from "../models/Member.js";
import AuthChallenge from "../models/AuthChallenge.js";
import RefreshSession from "../models/RefreshSession.js";
import { signAccessToken, requireAuth } from "../middleware/auth.js";
import { parseBody } from "../middleware/validate.js";
import { asyncHandler, badRequest, forbidden, unauthorized } from "../lib/errors.js";
import { toPublicUser } from "../lib/serialize.js";
import {
  consumePasswordResetGrant,
  consumePasswordSetupToken,
  issueEmailOtp,
  issuePasswordResetGrant,
  sendPasswordChangedEmail,
  verifyEmailOtp,
} from "../services/authChallenges.js";

const router = Router();

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: config.env === "production" ? "none" : "lax",
    path: "/api/auth",
    maxAge: config.refreshTokenTtlMs,
  };
}

function clearRefreshCookie(res) {
  const { maxAge: _maxAge, ...options } = refreshCookieOptions();
  res.clearCookie(config.refreshCookieName, options);
}

function readCookie(req, name) {
  for (const part of String(req.headers.cookie ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return null;
}

function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function hashesMatch(left, right) {
  const leftHash = Buffer.from(left, "hex");
  const rightHash = Buffer.from(right, "hex");
  return leftHash.length === rightHash.length && timingSafeEqual(leftHash, rightHash);
}

function parseRefreshToken(token) {
  if (!token) return null;
  const separator = token.indexOf(".");
  if (separator < 1) return null;
  const sessionId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!Types.ObjectId.isValid(sessionId) || !/^[a-f\d]{64}$/i.test(secret)) return null;
  return { sessionId, token };
}

async function revokeRefreshToken(token) {
  const parsedToken = parseRefreshToken(token);
  if (!parsedToken) return;
  await RefreshSession.updateOne(
    {
      _id: parsedToken.sessionId,
      tokenHash: hashRefreshToken(parsedToken.token),
      revokedAt: null,
    },
    { $set: { revokedAt: new Date() } },
  );
}

function assertAuthOrigin(req) {
  const origin = req.get("origin");
  const allowedOrigins = config.clientOrigin.split(",").map((value) => value.trim()).filter(Boolean);
  let host = "";
  try {
    host = new URL(origin).hostname;
  } catch {
    // Missing or malformed Origin headers are rejected below.
  }
  const isLocalDevelopmentOrigin = config.env !== "production" && (
    host === "localhost" ||
    host === "127.0.0.1" ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );

  if (
    !origin ||
    (!allowedOrigins.includes(origin) && !isLocalDevelopmentOrigin) ||
    req.get("x-km-auth") !== "1"
  ) {
    throw forbidden("This authentication request is not allowed.", "untrusted_auth_origin");
  }
}

async function createAuthSession(user, res) {
  const sessionId = new Types.ObjectId();
  const refreshToken = `${sessionId}.${randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlMs);
  await RefreshSession.create({
    _id: sessionId,
    userId: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
  });
  res.cookie(config.refreshCookieName, refreshToken, refreshCookieOptions());
  return signAccessToken(user, sessionId);
}

async function revokeUserRefreshSessions(userId) {
  await RefreshSession.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
}

const loginSchema = z
  .object({
    email: z.string().trim().email("Enter a valid email address").optional(),
    memberId: z.string().regex(/^[a-f\d]{24}$/i, "Enter a valid MongoDB student ID").optional(),
    phone: z.string().trim().optional(),
    password: z.string().min(1, "Password is required"),
  })
  .refine((v) => v.email || v.memberId || v.phone, {
    message: "Email, MongoDB student ID or mobile number is required",
    path: ["email"],
  });

const verifyLoginOtpSchema = z.object({
  challengeId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const passwordSetupSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6, "Password must be at least 6 characters").max(72),
});

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
});

const passwordResetVerifySchema = z.object({
  email: z.string().trim().email("Enter a valid email address").max(254),
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

const passwordResetSchema = z
  .object({
    token: z.string().min(1),
    newPassword: z.string().min(8, "Password must be at least 8 characters").max(72),
    confirmPassword: z.string().min(8, "Confirm your new password").max(72),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
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

async function getAccountEmail(user) {
  if (user.role === "member") {
    const member = await Member.findOne({ _id: user.memberId, gymId: user.gymId })
      .select("email status")
      .lean();
    return { email: member?.email, member };
  }
  return { email: user.email, member: null };
}

async function findPasswordResetUser(email) {
  const normalizedEmail = email.trim().toLowerCase();
  let user = await User.findOne({ email: normalizedEmail }).lean();
  if (!user) {
    const member = await Member.findOne({ email: normalizedEmail })
      .select("_id gymId")
      .lean();
    if (member) {
      user = await User.findOne({
        gymId: member.gymId,
        memberId: member._id,
        role: "member",
      }).lean();
    }
  }
  if (!user || user.emailVerified === false) return null;
  const { email: accountEmail } = await getAccountEmail(user);
  return accountEmail?.trim().toLowerCase() === normalizedEmail ? user : null;
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

/** POST /api/auth/login { email | memberId | phone, password } → OTP challenge */
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, memberId, phone, password } = parseBody(loginSchema, req.body);

    const candidates = [];
    if (memberId && Types.ObjectId.isValid(memberId)) {
      const member = await Member.findById(memberId).select("_id").lean();
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
        memberId
          ? "Invalid student ID or password"
          : phone && !email
            ? "Invalid mobile number or password"
            : email && !phone
              ? "Invalid email or password"
              : "Invalid login details or password",
        "invalid_credentials",
      );
    }
    if (!user.isActive) throw unauthorized("This account is disabled", "account_disabled");

    const member = user.role === "member"
      ? await Member.findOne({ _id: user.memberId, gymId: user.gymId }).select("email").lean()
      : null;
    const destinationEmail = member?.email ?? user.email;
    if (!destinationEmail || destinationEmail.toLowerCase().endsWith("@members.kalamandir.local")) {
      throw badRequest("Add a real email address to this account before signing in.", "login_email_missing");
    }

    const challenge = await issueEmailOtp({
      userId: user._id,
      email: destinationEmail,
      purpose: "login",
      name: user.fullName,
    });
    res.json({ otpRequired: true, ...challenge });
  }),
);

/** POST /api/auth/login/verify { challengeId, code } → { accessToken, user } */
router.post(
  "/login/verify",
  asyncHandler(async (req, res) => {
    const input = parseBody(verifyLoginOtpSchema, req.body);
    const challenge = await verifyEmailOtp({ ...input, purpose: "login" });
    const user = await User.findById(challenge.userId).lean();
    if (!user || !user.isActive) throw unauthorized("This account is disabled", "account_disabled");

    let currentEmail = user.email;
    if (user.role === "member") {
      const member = await Member.findOne({ _id: user.memberId, gymId: user.gymId })
        .select("email")
        .lean();
      currentEmail = member?.email ?? null;
      if (!currentEmail) throw unauthorized("The student email address is no longer available.", "login_email_missing");
    }
    if (currentEmail?.trim().toLowerCase() !== challenge.email) {
      throw unauthorized("The account email changed. Request a new verification code.", "otp_invalid");
    }

    const lastLoginAt = new Date();
    if (user.role === "member") {
      await Member.updateOne(
        { _id: user.memberId, gymId: user.gymId },
        { $set: { emailVerifiedAt: lastLoginAt } },
      );
    }
    await User.updateOne(
      { _id: user._id },
      { $set: { lastLoginAt, emailVerified: true } },
    );
    const authenticatedUser = { ...user, lastLoginAt, emailVerified: true };
    await revokeRefreshToken(readCookie(req, config.refreshCookieName));
    const accessToken = await createAuthSession(authenticatedUser, res);
    res.json({ accessToken, user: toPublicUser(authenticatedUser) });
  }),
);

/** POST /api/auth/refresh → rotate the refresh cookie and issue a new access token. */
router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    assertAuthOrigin(req);
    const parsedToken = parseRefreshToken(readCookie(req, config.refreshCookieName));
    if (!parsedToken) {
      clearRefreshCookie(res);
      throw unauthorized("Your session has expired. Please sign in again.", "refresh_invalid");
    }

    const now = new Date();
    const session = await RefreshSession.findOne({
      _id: parsedToken.sessionId,
      revokedAt: null,
      expiresAt: { $gt: now },
    }).lean();
    if (!session) {
      clearRefreshCookie(res);
      throw unauthorized("Your session has expired. Please sign in again.", "refresh_invalid");
    }
    if (!hashesMatch(session.tokenHash, hashRefreshToken(parsedToken.token))) {
      throw unauthorized("Your session has expired. Please sign in again.", "refresh_invalid");
    }

    const user = await User.findById(session.userId).lean();
    if (!user || !user.isActive) {
      await RefreshSession.updateOne(
        { _id: session._id, revokedAt: null },
        { $set: { revokedAt: now } },
      );
      clearRefreshCookie(res);
      throw unauthorized("This account is disabled or no longer exists.", "account_disabled");
    }

    const nextRefreshToken = `${session._id}.${randomBytes(32).toString("hex")}`;
    const expiresAt = new Date(now.getTime() + config.refreshTokenTtlMs);
    const rotated = await RefreshSession.updateOne(
      {
        _id: session._id,
        tokenHash: session.tokenHash,
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          tokenHash: hashRefreshToken(nextRefreshToken),
          expiresAt,
        },
      },
    );
    if (rotated.modifiedCount !== 1) {
      throw unauthorized("Your session has expired. Please sign in again.", "refresh_invalid");
    }

    res.cookie(config.refreshCookieName, nextRefreshToken, refreshCookieOptions());
    res.json({
      accessToken: signAccessToken(user, session._id),
      expiresAt: new Date(now.getTime() + config.accessTokenTtlMs).toISOString(),
    });
  }),
);

/** POST /api/auth/logout → revoke this browser session and clear its cookie. */
router.post(
  "/logout",
  asyncHandler(async (req, res) => {
    assertAuthOrigin(req);
    await revokeRefreshToken(readCookie(req, config.refreshCookieName));
    clearRefreshCookie(res);
    res.status(204).end();
  }),
);

/** POST /api/auth/password/setup { token, password } → activate verified student login */
router.post(
  "/password/setup",
  asyncHandler(async (req, res) => {
    const input = parseBody(passwordSetupSchema, req.body);
    const challenge = await consumePasswordSetupToken(input.token);
    const user = await User.findById(challenge.userId).lean();
    if (!user || user.role !== "member" || user.emailVerified === false) {
      throw unauthorized("This password setup link is invalid or expired.", "setup_token_invalid");
    }
    const member = await Member.findOne({ _id: user.memberId, gymId: user.gymId })
      .select("email status")
      .lean();
    if (!member || member.email?.trim().toLowerCase() !== challenge.email) {
      throw unauthorized("This password setup link is invalid or expired.", "setup_token_invalid");
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    const updated = await User.updateOne(
      { _id: user._id, emailVerified: true },
      { $set: { passwordHash, isActive: member.status === "active", passwordSetupRequired: false } },
    );
    if (updated.matchedCount !== 1) {
      throw unauthorized("This password setup link is invalid or expired.", "setup_token_invalid");
    }
    await revokeUserRefreshSessions(user._id);
    res.json({ ok: true });
  }),
);

/** POST /api/auth/password/forgot { email } → generic OTP request acknowledgement */
router.post(
  "/password/forgot",
  asyncHandler(async (req, res) => {
    const { email } = parseBody(passwordResetRequestSchema, req.body);
    const user = await findPasswordResetUser(email);
    let expiresAt = new Date(Date.now() + 60_000);
    if (user) {
      try {
        const challenge = await issueEmailOtp({
          userId: user._id,
          email: email.trim().toLowerCase(),
          purpose: "password_reset",
          name: user.fullName,
        });
        expiresAt = new Date(challenge.expiresAt);
      } catch (error) {
        if (error?.code !== "otp_rate_limited") throw error;
      }
    }
    res.json({
      ok: true,
      message: "If a verified account uses this email, a verification code has been sent.",
      expiresAt: expiresAt.toISOString(),
    });
  }),
);

/** POST /api/auth/password/reset/verify { email, code } → short-lived reset session */
router.post(
  "/password/reset/verify",
  asyncHandler(async (req, res) => {
    const input = parseBody(passwordResetVerifySchema, req.body);
    const email = input.email.trim().toLowerCase();
    const challenge = await AuthChallenge.findOne({
      email,
      purpose: "password_reset",
      expiresAt: { $gt: new Date() },
      consumedAt: null,
      attempts: { $lt: 5 },
    })
      .sort({ createdAt: -1 })
      .lean();
    if (!challenge) throw unauthorized("The code is invalid or has expired.", "otp_invalid");

    const verifiedChallenge = await verifyEmailOtp({
      challengeId: String(challenge._id),
      code: input.code,
      purpose: "password_reset",
      userId: challenge.userId,
    });
    const user = await User.findById(challenge.userId).lean();
    if (!user || user.emailVerified === false) {
      throw unauthorized("The code is invalid or has expired.", "otp_invalid");
    }
    const { email: accountEmail } = await getAccountEmail(user);
    if (accountEmail?.trim().toLowerCase() !== verifiedChallenge.email) {
      throw unauthorized("The account email changed. Request a new code.", "otp_invalid");
    }

    const token = await issuePasswordResetGrant({
      userId: user._id,
      email: verifiedChallenge.email,
    });
    res.json({ token });
  }),
);

/** POST /api/auth/password/reset { token, newPassword, confirmPassword } */
router.post(
  "/password/reset",
  asyncHandler(async (req, res) => {
    const input = parseBody(passwordResetSchema, req.body);
    const challenge = await consumePasswordResetGrant(input.token);
    const user = await User.findById(challenge.userId).lean();
    if (!user || user.emailVerified === false) {
      throw unauthorized("This password reset session is invalid or expired.", "password_reset_invalid");
    }
    const { email: accountEmail, member } = await getAccountEmail(user);
    if (accountEmail?.trim().toLowerCase() !== challenge.email) {
      throw unauthorized("This password reset session is invalid or expired.", "password_reset_invalid");
    }
    const updates = {
      passwordHash: await bcrypt.hash(input.newPassword, 10),
      passwordSetupRequired: false,
    };
    if (user.role === "member") updates.isActive = member?.status === "active";
    const updated = await User.updateOne(
      { _id: user._id, emailVerified: { $ne: false } },
      { $set: updates },
    );
    if (updated.matchedCount !== 1) {
      throw unauthorized("The code is invalid or has expired.", "otp_invalid");
    }
    await revokeUserRefreshSessions(user._id);
    let notificationDelivery = "sent";
    try {
      await sendPasswordChangedEmail({ email: accountEmail, name: user.fullName });
    } catch (error) {
      if (error?.code !== "email_delivery_failed") throw error;
      notificationDelivery = "failed";
    }
    res.json({ ok: true, notificationDelivery });
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
