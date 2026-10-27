/**
 * Tiny pub/sub for live studio events.
 *
 * The Topbar polls notifications every 10s for the bell badge; when something
 * genuinely NEW arrives (e.g. a student scanned the studio QR from the door),
 * it is broadcast here so any open page can react live — Attendance reloads
 * its roster/register/state cards without a manual refresh.
 *
 * Uses window CustomEvents so React strict-mode remounts and HMR stay safe.
 */

const EVENT = "km:live-notification";

/** Broadcast a newly-arrived notification to every interested page. */
export function emitLiveNotification(notification) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: notification ?? {} }));
}

/**
 * Listen for live notifications. Returns the unsubscribe function.
 * @returns {() => void} unsubscribe
 */
export function subscribeLiveNotification(handler) {
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
