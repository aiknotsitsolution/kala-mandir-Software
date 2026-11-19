import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiPost, setAuthToken, loadGym } = vi.hoisted(() => ({
    apiPost: vi.fn(),
    setAuthToken: vi.fn(),
    loadGym: vi.fn(),
}));

vi.mock("@/data/api/client", () => ({
    apiGet: vi.fn(),
    apiPost,
    ApiError: class ApiError extends Error {},
    getAuthToken: vi.fn(),
    setAuthToken,
}));

vi.mock("@/data/api/service", () => ({ loadGym }));
vi.mock("@/lib/datetime", () => ({ gymTimezone: "Asia/Kolkata" }));

import { ApiAuthProvider } from "@/data/api/auth";

describe("ApiAuthProvider MongoDB ID login", () => {
    beforeEach(() => {
        apiPost.mockReset();
        setAuthToken.mockReset();
        loadGym.mockReset();
        apiPost.mockResolvedValue({
            token: "session-token",
            user: {
                id: "user-1",
                fullName: "Asha Kapoor",
                role: "member",
                gymId: "gym-1",
                memberId: "64e7a9b5c3d2e1f012345678",
            },
        });
        loadGym.mockResolvedValue({ id: "gym-1", name: "Kala Mandir", timezone: "Asia/Kolkata" });
    });

    it("sends a MongoDB member ID as memberId instead of a member code", async () => {
        const provider = new ApiAuthProvider();

        await provider.signIn({ identifier: "64e7a9b5c3d2e1f012345678", password: "secret" });

        expect(apiPost).toHaveBeenCalledWith("/auth/login", {
            memberId: "64e7a9b5c3d2e1f012345678",
            password: "secret",
        });
    });
});
