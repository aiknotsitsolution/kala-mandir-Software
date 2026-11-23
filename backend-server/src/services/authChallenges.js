import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Types } from "mongoose";
import config from "../config.js";
import AuthChallenge from "../models/AuthChallenge.js";
import { badRequest, unauthorized } from "../lib/errors.js";
import { renderBrandedEmail, sendEmail } from "./email.js";

export const OTP_TTL_MS = 60_000;
const PASSWORD_SETUP_TTL_MS = 24 * 60 * 60_000;
const PASSWORD_RESET_GRANT_TTL_MS = 10 * 60_000;
const OTP_RESEND_COOLDOWN_MS = 30_000;
const MAX_OTP_ATTEMPTS = 5;
const OTP_EMAIL_COPY = {
  login: {
    subject: "Your Kala Mandir sign-in code",
    preheader: "Your sign-in code expires in one minute.",
    eyebrow: "Secure sign-in",
    title: "Verify your email",
    message: "Use this one-time code to finish signing in to your Kala Mandir account.",
    note: "This code expires in 1 minute. Never share it with anyone. If you did not request this code, you can safely ignore this email.",
  },
  student_registration: {
    subject: "Verify your Kala Mandir student email",
    preheader: "Verify your email to activate your student account.",
    eyebrow: "Student registration",
    title: "Verify your email",
    message: "Enter this one-time code with the institute staff to verify your student account.",
    note: "This code expires in 1 minute. Never share it with anyone except the staff member completing your registration.",
  },
  password_reset: {
    subject: "Your Kala Mandir password reset code",
    preheader: "Use your one-time code to reset your password.",
    eyebrow: "Account security",
    title: "Reset your password",
    message: "Use this one-time code to verify your email and choose a new password for your Kala Mandir account.",
    note: "This code expires in 1 minute. Never share it with anyone. If you did not request a password reset, you can safely ignore this email.",
  },
};

function secretHash(challengeId, purpose, secret) {
  return createHmac("sha256", config.jwtSecret)
    .update(`${challengeId}:${purpose}:${secret}`)
    .digest("hex");
}

function maskEmail(email) {
  const [name, domain] = email.split("@");
  const visible = name.length > 2 ? name.slice(0, 2) : name.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(1, name.length - visible.length))}@${domain}`;
}

async function createChallenge({ userId, email, purpose, secret, expiresAt }) {
  const now = new Date();
  await AuthChallenge.updateMany(
    { userId, purpose, consumedAt: null },
    { $set: { consumedAt: now } },
  );
  const challenge = new AuthChallenge({
    userId,
    purpose,
    email: email.trim().toLowerCase(),
    secretHash: "",
    expiresAt,
  });
  challenge.secretHash = secretHash(String(challenge._id), purpose, secret);
  await challenge.save();
  return challenge;
}

async function enforceResendCooldown(userId, purpose) {
  const cutoff = new Date(Date.now() - OTP_RESEND_COOLDOWN_MS);
  const recent = await AuthChallenge.findOne({
    userId,
    purpose,
    createdAt: { $gt: cutoff },
  })
    .select("_id")
    .lean();
  if (recent) {
    throw badRequest("Wait 30 seconds before requesting another email.", "otp_rate_limited");
  }
}

export async function issueEmailOtp({ userId, email, purpose, name }) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw badRequest("A valid email address is required for verification.", "email_required");
  }
  await enforceResendCooldown(userId, purpose);
  const now = new Date();

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = await createChallenge({
    userId,
    email: normalizedEmail,
    purpose,
    secret: code,
    expiresAt: new Date(now.getTime() + OTP_TTL_MS),
  });
  try {
    const copy = OTP_EMAIL_COPY[purpose] ?? OTP_EMAIL_COPY.login;
    const email = renderBrandedEmail({
      preheader: copy.preheader,
      eyebrow: copy.eyebrow,
      title: copy.title,
      greeting: name || "there",
      message: copy.message,
      otpCode: code,
      note: copy.note,
    });
    await sendEmail({
      to: normalizedEmail,
      subject: copy.subject,
      ...email,
    });
  } catch (error) {
    await AuthChallenge.deleteOne({ _id: challenge._id });
    throw error;
  }
  return {
    challengeId: String(challenge._id),
    expiresAt: challenge.expiresAt.toISOString(),
    email: maskEmail(normalizedEmail),
  };
}

export async function verifyEmailOtp({ challengeId, code, purpose, userId }) {
  if (!Types.ObjectId.isValid(challengeId)) {
    throw unauthorized("The code is invalid or has expired.", "otp_invalid");
  }
  const now = new Date();
  const challenge = await AuthChallenge.findOne({
    _id: challengeId,
    purpose,
    ...(userId ? { userId } : {}),
    expiresAt: { $gt: now },
    consumedAt: null,
    attempts: { $lt: MAX_OTP_ATTEMPTS },
  }).lean();
  if (!challenge) {
    throw unauthorized("The code is invalid or has expired.", "otp_invalid");
  }

  const submittedHash = Buffer.from(secretHash(String(challenge._id), purpose, code), "hex");
  const storedHash = Buffer.from(challenge.secretHash, "hex");
  if (submittedHash.length !== storedHash.length || !timingSafeEqual(submittedHash, storedHash)) {
    await AuthChallenge.updateOne(
      { _id: challenge._id, consumedAt: null, attempts: { $lt: MAX_OTP_ATTEMPTS } },
      { $inc: { attempts: 1 } },
    );
    throw unauthorized("The code is invalid or has expired.", "otp_invalid");
  }

  const consumed = await AuthChallenge.updateOne(
    {
      _id: challenge._id,
      expiresAt: { $gt: now },
      consumedAt: null,
      attempts: { $lt: MAX_OTP_ATTEMPTS },
    },
    { $set: { consumedAt: now } },
  );
  if (consumed.modifiedCount !== 1) {
    throw unauthorized("The code is invalid or has expired.", "otp_invalid");
  }
  return challenge;
}

export async function issuePasswordResetGrant({ userId, email }) {
  const token = randomBytes(32).toString("base64url");
  const challenge = await createChallenge({
    userId,
    email: String(email).trim().toLowerCase(),
    purpose: "password_reset_verified",
    secret: token,
    expiresAt: new Date(Date.now() + PASSWORD_RESET_GRANT_TTL_MS),
  });
  return `${challenge._id}.${token}`;
}

export async function consumePasswordResetGrant(token) {
  const separator = String(token ?? "").indexOf(".");
  if (separator <= 0) {
    throw unauthorized("This password reset session is invalid or expired.", "password_reset_invalid");
  }
  const challengeId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!Types.ObjectId.isValid(challengeId) || !secret) {
    throw unauthorized("This password reset session is invalid or expired.", "password_reset_invalid");
  }
  const now = new Date();
  const challenge = await AuthChallenge.findOne({
    _id: challengeId,
    purpose: "password_reset_verified",
    expiresAt: { $gt: now },
    consumedAt: null,
  }).lean();
  if (!challenge) {
    throw unauthorized("This password reset session is invalid or expired.", "password_reset_invalid");
  }

  const submittedHash = Buffer.from(secretHash(challengeId, "password_reset_verified", secret), "hex");
  const storedHash = Buffer.from(challenge.secretHash, "hex");
  if (submittedHash.length !== storedHash.length || !timingSafeEqual(submittedHash, storedHash)) {
    throw unauthorized("This password reset session is invalid or expired.", "password_reset_invalid");
  }
  const consumed = await AuthChallenge.updateOne(
    {
      _id: challengeId,
      purpose: "password_reset_verified",
      expiresAt: { $gt: now },
      consumedAt: null,
    },
    { $set: { consumedAt: now } },
  );
  if (consumed.modifiedCount !== 1) {
    throw unauthorized("This password reset session is invalid or expired.", "password_reset_invalid");
  }
  return challenge;
}

export async function issuePasswordSetupLink({ userId, email, name, memberId, phone, planName }) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw badRequest("A valid email address is required for verification.", "email_required");
  }
  await enforceResendCooldown(userId, "password_setup");
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const challenge = await createChallenge({
    userId,
    email: normalizedEmail,
    purpose: "password_setup",
    secret: token,
    expiresAt: new Date(now.getTime() + PASSWORD_SETUP_TTL_MS),
  });
  const origin = (process.env.CLIENT_ORIGIN || "http://localhost:5173").split(",")[0].trim();
  const setupUrl = new URL("/set-password", origin);
  setupUrl.searchParams.set("token", `${challenge._id}.${token}`);

  try {
    const email = renderBrandedEmail({
      preheader: "Your student portal is ready. Set a password to get started.",
      eyebrow: "Student portal",
      title: "Your registration is verified",
      greeting: name,
      message: "Your student registration is complete. Use the secure link below to choose a password and access your Kala Mandir portal.",
      details: [
        { label: "Student ID", value: memberId },
        { label: "Email", value: normalizedEmail },
        ...(phone ? [{ label: "Phone", value: phone }] : []),
        ...(planName ? [{ label: "Plan", value: planName }] : []),
      ],
      action: { label: "Set my password", url: setupUrl.toString() },
      note: "This one-time link expires in 24 hours. Never share it with anyone. If you did not expect this email, please contact Kala Mandir.",
    });
    await sendEmail({
      to: normalizedEmail,
      subject: "Your Kala Mandir student portal is ready",
      ...email,
    });
  } catch (error) {
    await AuthChallenge.deleteOne({ _id: challenge._id });
    throw error;
  }
  return { email: maskEmail(normalizedEmail), expiresAt: challenge.expiresAt.toISOString() };
}

export async function sendStudentAccountReadyEmail({ email, name, memberId, phone, planName }) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw badRequest("A valid email address is required for verification.", "email_required");
  }
  const message = renderBrandedEmail({
    preheader: "Your Kala Mandir student account is verified and ready.",
    eyebrow: "Student portal",
    title: "Your account is ready",
    greeting: name,
    message: "Your email has been verified and your student portal account is ready. Sign in with your email or student ID and the password shared by the institute.",
    details: [
      { label: "Student ID", value: memberId },
      { label: "Email", value: normalizedEmail },
      ...(phone ? [{ label: "Phone", value: phone }] : []),
      ...(planName ? [{ label: "Plan", value: planName }] : []),
    ],
    note: "For your security, your password is not included in this email. Use Forgot password on the sign-in page if you need to choose a new one.",
  });
  await sendEmail({
    to: normalizedEmail,
    subject: "Your Kala Mandir student account is ready",
    ...message,
  });
}

export async function sendPasswordChangedEmail({ email, name }) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) {
    throw badRequest("A valid email address is required for verification.", "email_required");
  }
  const message = renderBrandedEmail({
    preheader: "Your Kala Mandir account password was changed.",
    eyebrow: "Account security",
    title: "Password changed",
    greeting: name,
    message: "The password for your Kala Mandir account was successfully updated.",
    note: "If you did not make this change, contact Kala Mandir immediately and secure your email account. For your safety, this email does not include your password.",
  });
  await sendEmail({
    to: normalizedEmail,
    subject: "Your Kala Mandir password was changed",
    ...message,
  });
}

export async function consumePasswordSetupToken(token) {
  const separator = String(token ?? "").indexOf(".");
  if (separator <= 0) {
    throw unauthorized("This password setup link is invalid or expired.", "setup_token_invalid");
  }
  const challengeId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!Types.ObjectId.isValid(challengeId) || !secret) {
    throw unauthorized("This password setup link is invalid or expired.", "setup_token_invalid");
  }
  const now = new Date();
  const challenge = await AuthChallenge.findOne({
    _id: challengeId,
    purpose: "password_setup",
    expiresAt: { $gt: now },
    consumedAt: null,
  }).lean();
  if (!challenge) {
    throw unauthorized("This password setup link is invalid or expired.", "setup_token_invalid");
  }

  const submittedHash = Buffer.from(secretHash(challengeId, "password_setup", secret), "hex");
  const storedHash = Buffer.from(challenge.secretHash, "hex");
  if (submittedHash.length !== storedHash.length || !timingSafeEqual(submittedHash, storedHash)) {
    throw unauthorized("This password setup link is invalid or expired.", "setup_token_invalid");
  }
  const consumed = await AuthChallenge.updateOne(
    { _id: challengeId, purpose: "password_setup", expiresAt: { $gt: now }, consumedAt: null },
    { $set: { consumedAt: now } },
  );
  if (consumed.modifiedCount !== 1) {
    throw unauthorized("This password setup link is invalid or expired.", "setup_token_invalid");
  }
  return challenge;
}

