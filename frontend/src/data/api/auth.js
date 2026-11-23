import { apiGet, apiPost, ApiError, getAuthToken, refreshAuthToken, setAuthToken } from "@/data/api/client";
import { loadGym } from "@/data/api/service";
import { gymTimezone } from "@/lib/datetime";
/** Handles `{user: ...}` and the bare user object from GET /auth/me. */
function userFromMeResponse(payload) {
    const record = (payload ?? {});
    const user = record.user ?? payload;
    if (!user || typeof user.id !== "string")
        return null;
    return user;
}
/**
 * Access-token auth against the REST backend. The short-lived access token is
 * held in memory; the refresh token is an HttpOnly cookie managed by the API.
 *
 * `onAuthChange` is a local emitter fired by login/sign-out — no websockets
 * involved.
 */
export class ApiAuthProvider {
    mode = "api";
    listeners = new Set();
    emit(session) {
        for (const listener of this.listeners)
            listener(session);
    }
    /**
     * The gym record powers the header/branding everywhere. Staff reach it via
     * GET /gym; member tokens are scoped to /me only, whose payload carries the
     * gym name + timezone — so fall back to that before giving up.
     */
    async resolveGym(user) {
        try {
            return await loadGym();
        }
        catch (err) {
            if (user.role !== "member")
                throw err;
            const payload = await apiGet("/me");
            const now = new Date().toISOString();
            const fallback = payload?.gym ?? {};
            return {
                id: user.gymId,
                name: fallback.name ?? "Student portal",
                slug: fallback.slug ?? "",
                timezone: fallback.timezone ?? gymTimezone,
                currency: fallback.currency ?? "INR",
                logoUrl: fallback.logoUrl ?? null,
                themeMode: fallback.themeMode ?? "light",
                themeAccent: fallback.themeAccent ?? "burgundy",
                address: fallback.address ?? null,
                phone: fallback.phone ?? null,
                email: fallback.email ?? null,
                isActive: fallback.isActive ?? true,
                createdAt: fallback.createdAt ?? now,
                updatedAt: fallback.updatedAt ?? now,
            };
        }
    }
    async buildSession(user) {
        const gym = await this.resolveGym(user);
        const now = new Date().toISOString();
        const profile = {
            id: user.id,
            gymId: user.gymId ?? gym.id,
            fullName: user.fullName,
            email: user.email ?? null,
            phone: user.phone ?? null,
            role: user.role,
            avatarUrl: user.avatarUrl ?? null,
            isActive: true,
            lastLoginAt: null,
            createdAt: now,
            updatedAt: now,
        };
        return {
            userId: user.id,
            email: user.email ?? null,
            profile,
            gym,
            demo: false,
        };
    }
    /** Request a one-minute email OTP after validating the account password. */
    async requestLoginOtp(credentials) {
        const identifier = String(credentials?.identifier ?? "").trim();
        const phone = String(credentials?.phone ?? "").trim();
        const password = String(credentials?.password ?? "");
        const body = { password };
        if (identifier) {
            const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
            if (isEmail)
                body.email = identifier;
            else
                body.memberId = identifier;
        }
        if (phone)
            body.phone = phone;
        try {
            return await apiPost("/auth/login", body);
        }
        catch (err) {
            if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
                throw new ApiError(err.status, "invalid_credentials", "Incorrect email/account ID/mobile or password.");
            }
            throw err;
        }
    }
    /** Verify the OTP and create the authenticated session. */
    async verifyLoginOtp({ challengeId, code }) {
        const payload = await apiPost("/auth/login/verify", { challengeId, code });
        setAuthToken(payload.accessToken);
        const session = await this.buildSession(payload.user);
        this.emit(session);
        return session;
    }
    async requestPasswordResetOtp(email) {
        return apiPost("/auth/password/forgot", { email });
    }
    async verifyPasswordResetOtp(email, code) {
        return apiPost("/auth/password/reset/verify", { email, code });
    }
    async resetPasswordWithOtp(input) {
        return apiPost("/auth/password/reset", input);
    }
    async getSession() {
        try {
            if (!getAuthToken()) {
                await refreshAuthToken();
            }
            const payload = await apiGet("/auth/me");
            const user = userFromMeResponse(payload);
            if (!user) {
                setAuthToken(null);
                return null;
            }
            return await this.buildSession(user);
        }
        catch (err) {
            if (err instanceof ApiError && err.status === 401) {
                setAuthToken(null);
                return null;
            }
            throw err;
        }
    }
    async signOut() {
        try {
            await apiPost("/auth/logout", {});
        } finally {
            setAuthToken(null);
            this.emit(null);
        }
    }
    onAuthChange(cb) {
        this.listeners.add(cb);
        return () => {
            this.listeners.delete(cb);
        };
    }
}
