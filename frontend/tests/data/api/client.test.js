import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/config/env", () => ({ apiUrl: "https://api.example.test/api" }));

import { apiGet, apiPost, getAuthToken, setAuthToken } from "@/data/api/client";

function response(status, payload) {
    return {
        status,
        ok: status >= 200 && status < 300,
        text: async () => JSON.stringify(payload),
    };
}

describe("API client access-token refresh", () => {
    beforeEach(() => {
        setAuthToken(null);
        vi.stubGlobal("fetch", vi.fn());
    });

    it("refreshes once and retries a protected request with the new access token", async () => {
        fetch
            .mockResolvedValueOnce(response(401, { message: "Expired" }))
            .mockResolvedValueOnce(response(200, { accessToken: "fresh-access-token" }))
            .mockResolvedValueOnce(response(200, { members: [] }));
        setAuthToken("expired-access-token");

        await expect(apiGet("/members")).resolves.toEqual({ members: [] });

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer expired-access-token");
        expect(fetch.mock.calls[0][1].credentials).toBe("include");
        expect(fetch.mock.calls[1][0]).toBe("https://api.example.test/api/auth/refresh");
        expect(fetch.mock.calls[1][1].credentials).toBe("include");
        expect(fetch.mock.calls[2][1].headers.Authorization).toBe("Bearer fresh-access-token");
        expect(getAuthToken()).toBe("fresh-access-token");
    });

    it("shares one refresh request between concurrent protected requests", async () => {
        fetch
            .mockResolvedValueOnce(response(401, { message: "Expired" }))
            .mockResolvedValueOnce(response(401, { message: "Expired" }))
            .mockResolvedValueOnce(response(200, { accessToken: "fresh-access-token" }))
            .mockResolvedValueOnce(response(200, { members: [] }))
            .mockResolvedValueOnce(response(200, { members: [] }));
        setAuthToken("expired-access-token");

        await Promise.all([apiGet("/members"), apiGet("/members")]);

        expect(fetch).toHaveBeenCalledTimes(5);
        expect(fetch.mock.calls.filter(([url]) => url.endsWith("/auth/refresh"))).toHaveLength(1);
    });

    it("does not refresh or clear the session for a rejected login request", async () => {
        fetch.mockResolvedValueOnce(response(401, { message: "Invalid OTP" }));
        setAuthToken("existing-access-token");

        await expect(apiPost("/auth/login/verify", { code: "000000" })).rejects.toMatchObject({
            status: 401,
            message: "Invalid OTP",
        });

        expect(fetch).toHaveBeenCalledTimes(1);
        expect(getAuthToken()).toBe("existing-access-token");
    });
});
