import jwt from "jsonwebtoken";
import config from "../config.js";
import User from "../models/User.js";
import { ApiError, unauthorized, forbidden } from "../lib/errors.js";
import { can } from "../lib/permissions.js";

/** Verify the Bearer token and attach req.user = { id, gymId, role, fullName, email }. */
export async function requireAuth(req, _res, next) {
  try {
    if (req.user) return next(); // already resolved by an earlier mount
    const header = req.headers.authorization || "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw unauthorized("Invalid or expired token");
    }

    const user = await User.findById(payload.sub).lean();
    if (!user || !user.isActive) {
      throw unauthorized("Account is disabled or no longer exists");
    }

    req.user = {
      id: String(user._id),
      gymId: String(user.gymId),
      role: user.role,
      fullName: user.fullName,
      email: user.email ?? null,
      memberId: user.memberId ? String(user.memberId) : null,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** 403 unless the caller's role holds the capability (src/lib/permissions.ts). */
export function requireCap(capability) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user.role, capability)) {
      return next(forbidden(`Missing capability: ${capability}`));
    }
    next();
  };
}

export function signToken(user) {
  return jwt.sign(
    { sub: String(user._id), gymId: String(user.gymId), role: user.role, fullName: user.fullName },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  );
}

export { ApiError };
