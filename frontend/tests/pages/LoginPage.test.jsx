import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/pages/LoginPage";

const authMocks = vi.hoisted(() => ({
    useAuth: vi.fn(),
    requestPasswordResetOtp: vi.fn(),
    verifyPasswordResetOtp: vi.fn(),
    resetPasswordWithOtp: vi.fn(),
}));

vi.mock("@/auth/AuthProvider", () => ({
    useAuth: authMocks.useAuth,
}));

function PortalProbe() {
    const [params] = useSearchParams();
    return <p>Pending studio QR: {params.get("checkin")}</p>;
}

beforeEach(() => {
    authMocks.requestPasswordResetOtp.mockReset().mockResolvedValue({ ok: true });
    authMocks.verifyPasswordResetOtp.mockReset().mockResolvedValue({ token: "verified-reset-token" });
    authMocks.resetPasswordWithOtp.mockReset().mockResolvedValue({ ok: true });
    authMocks.useAuth.mockReturnValue({
        session: null,
        loading: false,
        requestLoginOtp: vi.fn(),
        verifyLoginOtp: vi.fn(),
        requestPasswordResetOtp: authMocks.requestPasswordResetOtp,
        verifyPasswordResetOtp: authMocks.verifyPasswordResetOtp,
        resetPasswordWithOtp: authMocks.resetPasswordWithOtp,
    });
});

describe("LoginPage shared studio QR", () => {
    it("opens a confirmation in the portal without auto-marking attendance", async () => {
        const token = "0123456789abcdef0123456789abcdef";
        authMocks.useAuth.mockReturnValue({
            session: { profile: { role: "member" } },
            loading: false,
        });
        render(
          <MemoryRouter initialEntries={[`/login?checkin=${token}`]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/portal" element={<PortalProbe />} />
            </Routes>
          </MemoryRouter>,
        );

        expect(await screen.findByText(`Pending studio QR: ${token}`)).toBeInTheDocument();
        expect(screen.queryByText("Marking your attendance…")).not.toBeInTheDocument();
    });

    it("resets a password after requesting and verifying an email OTP", async () => {
        const user = userEvent.setup();
        render(
          <MemoryRouter initialEntries={["/login"]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </MemoryRouter>,
        );

        await user.click(screen.getByRole("button", { name: "Forgot password?" }));
        await user.type(screen.getByLabelText("Account email"), "asha@example.com");
        await user.click(screen.getByRole("button", { name: "Send verification code" }));

        await waitFor(() => expect(authMocks.requestPasswordResetOtp).toHaveBeenCalledWith("asha@example.com"));
        await user.type(screen.getByLabelText("Email verification code"), "123456");
        await user.click(screen.getByRole("button", { name: "Verify email" }));
        await waitFor(() => expect(authMocks.verifyPasswordResetOtp).toHaveBeenCalledWith("asha@example.com", "123456"));
        await user.type(screen.getByLabelText("New password"), "newPassword123");
        await user.type(screen.getByLabelText("Confirm new password"), "newPassword123");
        await user.click(screen.getByRole("button", { name: "Update password" }));

        await waitFor(() => expect(authMocks.resetPasswordWithOtp).toHaveBeenCalledWith({
            token: "verified-reset-token",
            newPassword: "newPassword123",
            confirmPassword: "newPassword123",
        }));
        expect(await screen.findByText("Password updated. Sign in with your new password.")).toBeInTheDocument();
    }, 15_000);
});
