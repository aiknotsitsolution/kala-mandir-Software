import test from "node:test";
import assert from "node:assert/strict";
import { quotaForRenewal } from "../src/lib/quota.js";

test("adds the previous membership's unused classes to a renewed quota", () => {
  const renewed = quotaForRenewal(
    { classQuota: 12 },
    { quota: 12, remaining: 3 },
  );

  assert.deepEqual(renewed, { classQuota: 15, carriedClasses: 3 });
});

test("does not carry classes when the previous quota is exhausted", () => {
  const renewed = quotaForRenewal(
    { classQuota: 12 },
    { quota: 12, remaining: 0 },
  );

  assert.deepEqual(renewed, { classQuota: 12, carriedClasses: 0 });
});

test("does not create a quota or carry classes into a duration-only plan", () => {
  const renewed = quotaForRenewal(
    { classQuota: null },
    { quota: 12, remaining: 3 },
  );

  assert.deepEqual(renewed, { classQuota: null, carriedClasses: 0 });
});
