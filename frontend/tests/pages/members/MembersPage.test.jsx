import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryApi } from "@/data/api/queryApi";
import { MembersPage } from "@/pages/members/MembersPage";
import { store } from "@/store";

const { mockData } = vi.hoisted(() => ({ mockData: {} }));

vi.mock("@/auth/AuthProvider", () => ({
    useAuth: () => ({ session: { profile: { id: "owner", role: "owner" } } }),
    useData: () => mockData,
}));

const members = [
    { id: "m1", fullName: "Asha Kapoor", status: "active", effectiveStatus: "active" },
    { id: "m2", fullName: "Riya Shah", status: "active", effectiveStatus: "expired" },
];
const statusCounts = {
    all: 2,
    active: 1,
    expiring_soon: 0,
    expired: 1,
    suspended: 0,
    inactive: 0,
};

function renderPage() {
    return render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/members"]}>
          <MembersPage />
        </MemoryRouter>
      </Provider>,
    );
}

describe("MembersPage status cards", () => {
    beforeEach(() => {
        store.dispatch(queryApi.util.resetApiState());
        Object.assign(mockData, {
            listMembers: vi.fn(async ({ status, page, pageSize }) => {
                const filtered = status === "all" ? members : members.filter((member) => member.effectiveStatus === status);
                return {
                    items: filtered.slice((page - 1) * pageSize, page * pageSize),
                    total: filtered.length,
                    page,
                    pageSize,
                    statusCounts,
                };
            }),
            listPlans: vi.fn(async () => []),
            listStaff: vi.fn(async () => []),
        });
    });

    it("uses the status cards to filter the directory and syncs the selector", async () => {
        const user = userEvent.setup();
        renderPage();

        expect(await screen.findByText("Asha Kapoor")).toBeInTheDocument();
        expect(within(screen.getByRole("button", { name: "Filter students by All students" })).getByText("2")).toBeInTheDocument();
        const expiredCard = screen.getByRole("button", { name: "Filter students by Expired" });
        expect(expiredCard).toHaveAttribute("aria-pressed", "false");

        await user.click(expiredCard);

        expect(await screen.findByText("Riya Shah")).toBeInTheDocument();
        expect(screen.queryByText("Asha Kapoor")).not.toBeInTheDocument();
        expect(expiredCard).toHaveAttribute("aria-pressed", "true");
        await waitFor(() => expect(mockData.listMembers).toHaveBeenLastCalledWith(expect.objectContaining({
            status: "expired",
            page: 1,
        })));
        expect(screen.getByRole("combobox", { name: "Filter by status" })).toHaveTextContent("Expired");
    });
});
