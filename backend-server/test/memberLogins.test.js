import test from "node:test";
import assert from "node:assert/strict";
import { memberLoginEmail } from "../src/lib/memberLogins.js";

test("member portal login email is derived from the MongoDB member ID", () => {
  const gymId = "64e7a9b5c3d2e1f000000001";
  const memberId = "64e7a9b5c3d2e1f012345678";

  assert.equal(
    memberLoginEmail(gymId, memberId),
    `${gymId}.${memberId}@members.kalamandir.local`,
  );
});
