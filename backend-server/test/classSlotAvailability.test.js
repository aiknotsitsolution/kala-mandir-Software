import test from "node:test";
import assert from "node:assert/strict";
import { isWithinSlotTime } from "../src/lib/schedule.js";

test("class slot is available from its start through the minute before its end", () => {
  assert.equal(isWithinSlotTime(9 * 60, "09:00", "10:00"), true);
  assert.equal(isWithinSlotTime(9 * 60 + 59, "09:00", "10:00"), true);
  assert.equal(isWithinSlotTime(9 * 60 - 1, "09:00", "10:00"), false);
  assert.equal(isWithinSlotTime(10 * 60, "09:00", "10:00"), false);
});

test("invalid or reversed slot times are never available", () => {
  assert.equal(isWithinSlotTime(9 * 60, "bad", "10:00"), false);
  assert.equal(isWithinSlotTime(9 * 60, "10:00", "09:00"), false);
});
