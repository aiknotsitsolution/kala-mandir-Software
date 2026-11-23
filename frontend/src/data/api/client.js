import { apiUrl } from "@/config/env";
import { DataError } from "@/data/types";

export const TOKEN_STORAGE_KEY = "kalamandir-token";
let accessToken = null;
let refreshInFlight = null;

function clearPersistedAccessToken() {
    try {
        window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
        // The access token stays in memory; the refresh cookie restores it after reload.
    }
}

clearPersistedAccessToken();

export function getAuthToken() {
    return accessToken;
}
export function setAuthToken(token) {
    accessToken = typeof token === "string" && token ? token : null;
    clearPersistedAccessToken();
}
function codeForStatus(status) {
    if (status === 401)
        return "unauthorized";
    if (status === 403)
        return "forbidden";
    if (status === 404)
        return "not_found";
    return "server_error";
}
function defaultMessageForStatus(status) {
    if (status === 401)
        return "Your session has expired. Please sign in again.";
    if (status === 403)
        return "You do not have permission to perform this action.";
    if (status === 404)
        return "The requested record was not found.";
    if (status === 400)
        return "The request was invalid.";
    if (status >= 500)
        return "The server had a problem. Please try again.";
    return "Something went wrong. Please try again.";
}
/** Thrown for every failed HTTP response (and for network failures). */
export class ApiError extends DataError {
    status;
    constructor(status, code, message) {
        super(code, message);
        this.name = "ApiError";
        this.status = status;
    }
}
export function buildUrl(path, query) {
    if (!apiUrl) {
        throw new ApiError(0, "not_configured", "The API URL is not configured. Set VITE_API_URL and restart the app.");
    }
    const params = new URLSearchParams();
    if (query) {
        for (const [key, value] of Object.entries(query)) {
            if (value === undefined || value === null || value === "")
                continue;
            params.set(key, String(value));
        }
    }
    const qs = params.toString();
    return `${apiUrl}${path}${qs ? `?${qs}` : ""}`;
}
async function parseBody(response) {
    if (response.status === 204)
        return null;
    const text = await response.text();
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}

function refreshAccessToken() {
    if (!refreshInFlight) {
        refreshInFlight = (async () => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            try {
                const response = await fetch(buildUrl("/auth/refresh"), {
                    method: "POST",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        "X-KM-Auth": "1",
                    },
                    credentials: "include",
                    signal: controller.signal,
                    body: "{}",
                });
                const payload = await parseBody(response);
                if (!response.ok) {
                    const record = payload ?? {};
                    const message = typeof record.message === "string" && record.message.trim()
                        ? record.message
                        : defaultMessageForStatus(response.status);
                    const code = typeof record.code === "string" && record.code.trim()
                        ? record.code
                        : codeForStatus(response.status);
                    throw new ApiError(response.status, code, message);
                }
                if (typeof payload?.accessToken !== "string")
                    throw new ApiError(500, "invalid_response", "The server returned an invalid session.");
                setAuthToken(payload.accessToken);
                return payload;
            } catch (err) {
                if (err instanceof ApiError)
                    throw err;
                const aborted = err instanceof DOMException && err.name === "AbortError";
                throw new ApiError(
                    0,
                    aborted ? "timeout" : "network",
                    aborted
                        ? "Session refresh timed out. Please try again."
                        : "Unable to refresh your session. Check your connection and try again.",
                );
            } finally {
                clearTimeout(timeoutId);
            }
        })().finally(() => {
            refreshInFlight = null;
        });
    }
    return refreshInFlight;
}

export function refreshAuthToken() {
    return refreshAccessToken();
}

function expireAuthSession() {
    setAuthToken(null);
    if (typeof window !== "undefined")
        window.dispatchEvent(new Event("kalamandir:auth-expired"));
}

function shouldRefreshOnUnauthorized(path, auth) {
    return auth && (!path.startsWith("/auth/") || path === "/auth/me");
}

export async function apiRequest(path, options = {}) {
    const { method = "GET", body, query, signal, auth = true, timeoutMs = 30000 } = options;
    const headers = { Accept: "application/json" };
    const token = getAuthToken();
    if (auth && token)
        headers.Authorization = `Bearer ${token}`;
    if (body !== undefined)
        headers["Content-Type"] = "application/json";
    if (path === "/auth/refresh" || path === "/auth/logout")
        headers["X-KM-Auth"] = "1";
    let response;
    let controller;
    let timeoutId;
    try {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        const combinedSignal = signal
            ? (() => { const c = new AbortController(); signal.addEventListener("abort", () => c.abort()); controller.signal.addEventListener("abort", () => c.abort()); return c.signal; })()
            : controller.signal;
        const url = buildUrl(path, query);
        const requestOptions = {
            method,
            headers,
            signal: combinedSignal,
            credentials: "include",
            body: body !== undefined ? JSON.stringify(body) : undefined,
        };
        response = await fetch(url, requestOptions);
        if (response.status === 401 && shouldRefreshOnUnauthorized(path, auth)) {
            let refreshed = null;
            try {
                refreshed = await refreshAccessToken();
            } catch {
                // Preserve the original protected request's 401 for callers.
            }
            if (refreshed) {
                const retryHeaders = { ...headers, Authorization: `Bearer ${getAuthToken()}` };
                response = await fetch(url, { ...requestOptions, headers: retryHeaders });
            }
            if (response.status === 401)
                expireAuthSession();
        }
    }
    catch (err) {
        if (err instanceof ApiError)
            throw err;
        const aborted = err instanceof DOMException && err.name === "AbortError";
        throw new ApiError(0, aborted ? "timeout" : "network", aborted ? "Request timed out. The server may be starting up — please try again in a moment." : "Unable to reach the server. Check your connection and try again.");
    }
    finally {
        clearTimeout(timeoutId);
    }
    const payload = await parseBody(response);
    if (!response.ok) {
        const record = (payload ?? {});
        const message = typeof record.message === "string" && record.message.trim().length > 0
            ? record.message
            : defaultMessageForStatus(response.status);
        const code = typeof record.code === "string" && record.code.trim().length > 0 ? record.code : codeForStatus(response.status);
        throw new ApiError(response.status, code, message);
    }
    return payload;
}
export function apiGet(path, query, signal) {
    return apiRequest(path, { method: "GET", query, signal });
}
export function apiPost(path, body) {
    return apiRequest(path, { method: "POST", body });
}
export function apiPatch(path, body) {
    return apiRequest(path, { method: "PATCH", body });
}
export function apiDelete(path) {
    return apiRequest(path, { method: "DELETE" });
}