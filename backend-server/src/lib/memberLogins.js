import bcrypt from "bcryptjs";
import User from "../models/User.js";
import RefreshSession from "../models/RefreshSession.js";


export function memberLoginEmail(gymId, memberId) {
  return `${String(gymId)}.${String(memberId)}`.toLowerCase() + "@members.kalamandir.local";
}


export async function ensureMemberLogin(
  {
    gymId,
    memberId,
    fullName,
    phone,
    password,
    isActive = true,
    emailVerified = true,
    passwordSetupRequired = false,
  },
  session = null,
) {
  const existing = await User.findOne({ memberId, role: "member" })
    .select("_id")
    .session(session)
    .lean();
  if (existing) return null;

  if (!password) throw new Error("A generated password is required for a member login.");
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await User.create(
    [
      {
        gymId,
        memberId,
        fullName,
        email: memberLoginEmail(gymId, memberId),
        phone: phone ?? null,
        passwordHash,
        role: "member",
        isActive,
        emailVerified,
        passwordSetupRequired,
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
  const filter = {
    memberId,
    role: "member",
    ...(isActive ? { emailVerified: { $ne: false } } : {}),
  };
  const options = session ? { session } : {};
  const matchingUsers = isActive
    ? []
    : await User.find(filter).select("_id").session(session).lean();
  const result = await User.updateMany(
    filter,
    { $set: { isActive: Boolean(isActive) } },
    options,
  );
  if (matchingUsers.length) {
    await RefreshSession.updateMany(
      { userId: { $in: matchingUsers.map((user) => user._id) }, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      options,
    );
  }
  return result.modifiedCount ?? 0;
}
