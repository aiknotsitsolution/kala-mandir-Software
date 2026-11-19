const ONE_HOUR_MS = 60 * 60 * 1000;

/** Automatically check out one hour after the recorded check-in. */
export function autoCheckoutAt(record) {
  const checkIn = new Date(record.checkIn);
  return new Date(checkIn.getTime() + ONE_HOUR_MS);
}
