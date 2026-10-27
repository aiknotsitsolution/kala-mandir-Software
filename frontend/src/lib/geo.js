/**
 * Device location — the browser's built-in Geolocation API (HTML5). It is
 * free and needs no key/service, so no mock or paid API is involved.
 *
 * Best-effort by design: resolves `null` on denial/timeout so the caller can
 * fall through to the server's decision (the backend explains the rejection).
 */
export function getCurrentCoords({ timeoutMs = 5000 } = {}) {
    return new Promise((resolve) => {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
            resolve(null);
            return;
        }
        navigator.geolocation.getCurrentPosition((pos) => resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
        }), () => resolve(null), { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 });
    });
}
