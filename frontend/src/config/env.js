/**
 * Centralised, typed access to public runtime configuration.
 * Values are baked in at build time by Vite (all VITE_* variables are PUBLIC).
 */
const rawApiUrl = import.meta.env.VITE_API_URL || 'https://kalamandir-dance-institute.vercel.app/api';
const rawTimezone = import.meta.env.VITE_GYM_TIMEZONE || 'Asia/Kolkata';
const rawGymName = import.meta.env.VITE_GYM_NAME || 'Kalamandir Dance Institute';
/** Accepts only absolute http(s) URLs; trailing slashes are trimmed. */
function normalizeApiUrl(value)
{
    const trimmed = value?.trim();
    if (!trimmed)
        return null;
    let parsed;
    try
    {
        parsed = new URL(trimmed);
    }
    catch
    {
        return null;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        return null;
    return trimmed.replace(/\/+$/, "");
}
/**
 * Deployed API fallback — baked in so a production build works even when the
 * host has no environment configuration. `VITE_API_URL` always wins when set.
 */
const PRODUCTION_API_URL = "https://gym-management-software-api.vercel.app/api";
export const apiUrl = normalizeApiUrl(rawApiUrl) ?? (import.meta.env.PROD ? normalizeApiUrl(PRODUCTION_API_URL) : null);
export const hasApiConfig = apiUrl !== null;
export const isDemoMode = false;
export const isUnconfigured = !hasApiConfig;
export const gymTimezone = rawTimezone && rawTimezone.trim().length > 0 ? rawTimezone.trim() : "Asia/Kolkata";
export const defaultGymName = rawGymName && rawGymName.trim().length > 0 ? rawGymName.trim() : "Kalamandir Dance Institute";
export const appVersion = "1.0.0";
/** Never log these. Kept here as a single source of truth for redaction. */
export const SENSITIVE_ENV_KEYS = ["VITE_API_URL"];
