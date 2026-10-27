import bcrypt from "bcryptjs";
import User from "../models/User.js";

/**
 * Member portal logins.
 *
 * Every gym member gets a `role: "member"` user so they can sign in with
 * their printed member code. The login uses a synthetic unique email (the
 * User model requires one) that is never exposed through the API.
 */
export const MEMBER_DEFAULT_PASSWORD = process.env.MEMBER_DEFAULT_PASSWORD ?? "test@123";

export function memberLoginEmail(gymId, memberCode) {
  return `${String(gymId)}.${memberCode}`.toLowerCase() + "@members.kalamandir.local";
}

/**
 * Create the member's login if it doesn't exist yet (idempotent).
 * Returns the created user, or null when one already existed.
 */
export async function ensureMemberLogin(
  { gymId, memberId, memberCode, fullName, phone, password },
  session = null,
) {
  const existing = await User.findOne({ memberId, role: "member" })
    .select("_id")
    .session(session)
    .lean();
  if (existing) return null;

  const passwordHash = await bcrypt.hash(password ?? MEMBER_DEFAULT_PASSWORD, 10);
  const [user] = await User.create(
    [
      {
        gymId,
        memberId,
        fullName,
        email: memberLoginEmail(gymId, memberCode),
        phone: phone ?? null,
        passwordHash,
        role: "member",
        isActive: true,
      },
    ],
    session ? { session } : {},
  );
  return user;
}

/**
 * Keep Member.status ↔ User.isActive in lockstep.
 *
 * Deactivating a member must also block their portal login; reactivating
 * restores it. Handles legacy members with NO login row (no-op) and members
 * whose login exists but was already toggled. Returns the number of users
 * updated so callers can report/audit accurately.
 */
export async function syncMemberLoginStatus(memberId, isActive, session = null) {
  const result = await User.updateMany(
    { memberId, role: "member" },
    { $set: { isActive: Boolean(isActive) } },
    session ? { session } : {},
  );
  return result.modifiedCount ?? 0;
}
