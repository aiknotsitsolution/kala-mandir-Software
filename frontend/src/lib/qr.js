import QRCode from "qrcode";
/**
 * QR identity helpers.
 *
 * The QR payload carries ONLY an opaque random token — never a Student ID, name
 * or any personal data. The database stores that opaque token and resolves it
 * server-side (`record_attendance` RPC), which re-validates membership state
 * and cooldown before writing anything.
 */
export const QR_PAYLOAD_PREFIX = "PGS1";
/** 32 random bytes as lowercase hex (256 bits of entropy). */
export function generateQrToken() {
    const bytes = new Uint8Array(32);
    if (typeof globalThis.crypto?.getRandomValues === "function") {
        globalThis.crypto.getRandomValues(bytes);
    }
    else {
        // Extremely defensive fallback; only reachable in exotic runtimes.
        for (let i = 0; i < bytes.length; i += 1)
            bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
/** Canonical payload encoded into the printed QR image. */
export function qrPayload(token) {
    return `${QR_PAYLOAD_PREFIX}:${token}`;
}
/** Query-string key the studio QR uses to hand the token to the login page. */
export const GYM_CHECKIN_PARAM = "checkin";
/**
 * URL encoded into the printed institute QR. A phone's normal camera opens it,
 * landing on the sign-in page with `?checkin=<token>` — the token is the ONLY
 * thing in the QR (no password, no personal data).
 */
export function gymCheckinUrl(token, origin) {
    const base = origin ?? (typeof window !== "undefined" ? window.location.origin : "");
    return `${base}/login?${GYM_CHECKIN_PARAM}=${encodeURIComponent(token)}`;
}
/** Extract a token from a scanned payload (tolerates raw token without prefix). */
export function parseQrPayload(payload) {
    const trimmed = payload.trim();
    if (trimmed.length === 0)
        return null;
    if (trimmed.startsWith(`${QR_PAYLOAD_PREFIX}:`)) {
        const token = trimmed.slice(QR_PAYLOAD_PREFIX.length + 1).trim();
        return token.length >= 16 ? token : null;
    }
    // Studio QR encodes a login URL (…/login?checkin=<token>) — pull the token out.
    try {
        const url = new URL(trimmed);
        const token = url.searchParams.get(GYM_CHECKIN_PARAM);
        if (token && token.length >= 16)
            return token.toLowerCase();
    }
    catch {
        /* not a URL — fall through to the raw-token check */
    }
    // Raw token support (e.g. someone printed only the token).
    if (/^[a-f0-9]{32,128}$/i.test(trimmed))
        return trimmed.toLowerCase();
    return null;
}
/** Generate a PNG data URL for the QR (used for display + downloads). */
export async function renderQrDataUrl(token, options) {
    return renderQrImage(qrPayload(token), options);
}
/** Render an arbitrary payload (e.g. the studio login URL) as a PNG data URL. */
export async function renderQrImage(payload, options) {
    return QRCode.toDataURL(payload, {
        width: options?.width ?? 320,
        margin: options?.margin ?? 2,
        errorCorrectionLevel: "M",
        color: {
            dark: options?.dark ?? "#0d0f10",
            light: options?.light ?? "#ffffff",
        },
    });
}
/** Short human-readable token fragment for support conversations. */
export function tokenHint(token) {
    return token.slice(0, 4).toUpperCase() + "…" + token.slice(-4).toUpperCase();
}
