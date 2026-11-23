import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { Types } from "mongoose";
import config from "../src/config.js";
import { requireAuth, signAccessToken } from "../src/middleware/auth.js";

test("access tokens are short-lived and scoped to the app issuer and audience", () => {
  const user = {
    _id: new Types.ObjectId(),
    gymId: new Types.ObjectId(),
    role: "admin",
    fullName: "Asha Kapoor",
  };
  const sessionId = new Types.ObjectId();

  const payload = jwt.verify(signAccessToken(user, sessionId), config.jwtSecret, {
    algorithms: ["HS256"],
    issuer: "kalamandir-api",
    audience: "kalamandir-app",
  });

  assert.equal(payload.tokenUse, "access");
  assert.equal(payload.sid, String(sessionId));
  assert.ok(payload.exp - payload.iat <= 15 * 60);
});

test("the bearer middleware rejects refresh-purpose tokens", async () => {
  const token = jwt.sign(
    {
      sub: String(new Types.ObjectId()),
      sid: String(new Types.ObjectId()),
      tokenUse: "refresh",
    },
    config.jwtSecret,
    {
      expiresIn: "15m",
      issuer: "kalamandir-api",
      audience: "kalamandir-app",
      algorithm: "HS256",
    },
  );
  let middlewareError;

  await requireAuth(
    { headers: { authorization: `Bearer ${token}` } },
    {},
    (error) => {
      middlewareError = error;
    },
  );

  assert.equal(middlewareError?.status, 401);
});
