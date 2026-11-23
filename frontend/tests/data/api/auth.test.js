import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiGet, apiPost, getAuthToken, refreshAuthToken, setAuthToken, loadGym } = vi.hoisted(() => ({
    apiGet: vi.fn(),
    apiPost: vi.fn(),
    getAuthToken: vi.fn(),
    refreshAuthToken: vi.fn(),
    setAuthToken: vi.fn(),
    loadGym: vi.fn(),
}));

vi.mock("@/data/api/client", () => ({
    apiGet,
    apiPost,
    ApiError: class ApiError extends Error {},
    getAuthToken,
    refreshAuthToken,
    setAuthToken,
}));

vi.mock("@/data/api/service", () => ({ loadGym }));
vi.mock("@/lib/datetime", () => ({ gymTimezone: "Asia/Kolkata" }));

import { ApiAuthProvider } from "@/data/api/auth";

describe("ApiAuthProvider email OTP login", () => {
    beforeEach(() => {
        apiGet.mockReset();
        apiPost.mockReset();
        getAuthToken.mockReset();
        refreshAuthToken.mockReset();
        setAuthToken.mockReset();
        loadGym.mockReset();
        apiPost.mockResolvedValue({
            otpRequired: true,
            challengeId: "challenge-1",
            email: "as***@example.com",
            expiresAt: "2026-11-23T12:00:00.000Z",
        });
        loadGym.mockResolvedValue({ id: "gym-1", name: "Kala Mandir", timezone: "Asia/Kolkata" });
    });

    it("requests an OTP using the MongoDB member ID as memberId", async () => {
        const provider = new ApiAuthProvider();

        const challenge = await provider.requestLoginOtp({
            identifier: "64e7a9b5c3d2e1f012345678",
            password: "secret",
        });

        expect(apiPost).toHaveBeenCalledWith("/auth/login", {
            memberId: "64e7a9b5c3d2e1f012345678",
            password: "secret",
        });
        expect(challenge.otpRequired).toBe(true);
        expect(setAuthToken).not.toHaveBeenCalled();
    });

    it("does not create a session until the OTP endpoint returns a token", async () => {
        const provider = new ApiAuthProvider();
        apiPost.mockResolvedValueOnce({
            accessToken: "session-token",
            user: { id: "user-1", fullName: "Asha Kapoor", role: "member", gymId: "gym-1" },
        });

        const session = await provider.verifyLoginOtp({ challengeId: "challenge-1", code: "123456" });

        expect(apiPost).toHaveBeenCalledWith("/auth/login/verify", {
            challengeId: "challenge-1",
            code: "123456",
        });
        expect(setAuthToken).toHaveBeenCalledWith("session-token");
        expect(session.profile.id).toBe("user-1");
    });

    it("restores a session from the refresh cookie after a page reload", async () => {
        const provider = new ApiAuthProvider();
        getAuthToken.mockReturnValue(null);
        refreshAuthToken.mockImplementationOnce(async () => {
            setAuthToken("restored-access-token");
            return { accessToken: "restored-access-token" };
        });
        apiGet.mockResolvedValueOnce({
            user: { id: "user-1", fullName: "Asha Kapoor", role: "member", gymId: "gym-1" },
        });

        const session = await provider.getSession();

        expect(refreshAuthToken).toHaveBeenCalledTimes(1);
        expect(setAuthToken).toHaveBeenCalledWith("restored-access-token");
        expect(apiGet).toHaveBeenCalledWith("/auth/me");
        expect(session.profile.id).toBe("user-1");
    });

    it("requests a password reset, verifies its OTP, and submits the new password", async () => {
        const provider = new ApiAuthProvider();

        await provider.requestPasswordResetOtp("asha@example.com");
        await provider.verifyPasswordResetOtp("asha@example.com", "123456");
        await provider.resetPasswordWithOtp({
            token: "verified-reset-token",
            newPassword: "newPassword123",
            confirmPassword: "newPassword123",
        });

        expect(apiPost).toHaveBeenNthCalledWith(1, "/auth/password/forgot", {
            email: "asha@example.com",
        });
        expect(apiPost).toHaveBeenNthCalledWith(2, "/auth/password/reset/verify", {
            email: "asha@example.com",
            code: "123456",
        });
        expect(apiPost).toHaveBeenNthCalledWith(3, "/auth/password/reset", {
            token: "verified-reset-token",
            newPassword: "newPassword123",
            confirmPassword: "newPassword123",
        });
    });
});
