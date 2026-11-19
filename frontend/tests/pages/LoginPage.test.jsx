import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useSearchParams } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { LoginPage } from "@/pages/LoginPage";

vi.mock("@/auth/AuthProvider", () => ({
    useAuth: () => ({
        session: { profile: { role: "member" } },
        loading: false,
        signIn: vi.fn(),
    }),
}));

function PortalProbe() {
    const [params] = useSearchParams();
    return <p>Pending studio QR: {params.get("checkin")}</p>;
}

describe("LoginPage shared studio QR", () => {
    it("opens a confirmation in the portal without auto-marking attendance", async () => {
        const token = "0123456789abcdef0123456789abcdef";
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
});
