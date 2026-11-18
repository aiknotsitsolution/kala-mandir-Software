import test from "node:test";
import assert from "node:assert/strict";
import { autoCheckoutAt } from "../src/lib/attendanceCheckout.js";

test("uses one hour after check-in when no slot is available", () => {
  const checkOut = autoCheckoutAt({ checkIn: "2026-11-18T04:00:00.000Z" });
  assert.equal(checkOut.toISOString(), "2026-11-18T05:00:00.000Z");
});

test("uses the slot end time in the gym timezone", () => {
  const checkOut = autoCheckoutAt(
    {
      checkIn: "2026-11-18T04:05:00.000Z",
      sessionDate: new Date("2026-11-18T00:00:00.000Z"),
    },
    { startTime: "09:00", endTime: "10:00" },
    "Asia/Kolkata",
  );
  assert.equal(checkOut.toISOString(), "2026-11-18T04:30:00.000Z");
});

test("handles a slot that ends after midnight", () => {
  const checkOut = autoCheckoutAt(
    {
      checkIn: "2026-11-18T16:30:00.000Z",
      sessionDate: new Date("2026-11-18T00:00:00.000Z"),
    },
    { startTime: "22:00", endTime: "02:00" },
    "Asia/Kolkata",
  );
  assert.equal(checkOut.toISOString(), "2026-11-18T20:30:00.000Z");
});
