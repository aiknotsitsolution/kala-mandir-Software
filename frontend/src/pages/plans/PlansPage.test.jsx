import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlansPage } from "./PlansPage";

/* The page reads auth + the data layer from the provider. Mock the provider
   with an in-memory plan fixture so the real filtering/view/dialog logic runs
   against realistic data. */
const { mockData } = vi.hoisted(() => ({ mockData: {} }));

vi.mock("@/auth/AuthProvider", () => ({
    useAuth: () => ({ session: { profile: { id: "u1", role: "owner", fullName: "Owner" } }, user: { id: "u1" } }),
    useData: () => mockData,
}));

/** The three real dance plans + one archived duration-only plan (no quota). */
const FIXTURE_PLANS = [
    { id: "p1", name: "3 Days a Week", description: "A balanced start for your dance journey.", price: 1500, durationValue: 1, durationUnit: "month", classQuota: 12, scheduleLabel: "3 days per week", benefits: [], isActive: true, sortOrder: 0 },
    { id: "p2", name: "5 Days a Week", description: "More practice. Better progress.", price: 2000, durationValue: 1, durationUnit: "month", classQuota: 20, scheduleLabel: "Monday – Friday", benefits: [], isActive: true, sortOrder: 1 },
    { id: "p3", name: "6 Days a Week", description: "Build skills. Express more.", price: 2300, durationValue: 1, durationUnit: "month", classQuota: 24, scheduleLabel: "Monday – Saturday", benefits: [], isActive: true, sortOrder: 2 },
    { id: "p4", name: "Workshop Pass", description: "Duration-only workshop access.", price: 4000, durationValue: 3, durationUnit: "month", classQuota: null, scheduleLabel: null, benefits: [], isActive: false, sortOrder: 3 },
];

function renderPage() {
    return render(<MemoryRouter initialEntries={["/plans"]}>
      <PlansPage/>
    </MemoryRouter>);
}

const searchInput = () => screen.getByRole("textbox", { name: /search plans by name/i });
const listRadio = () => screen.getByRole("radio", { name: /list view/i });
const gridRadio = () => screen.getByRole("radio", { name: /grid view/i });

beforeEach(() => {
    Object.assign(mockData, {
        listPlans: vi.fn(async () => FIXTURE_PLANS),
        getPlanDistribution: vi.fn(async () => [{ planId: "p1", count: 3 }]),
        archivePlan: vi.fn(async () => ({})),
        createPlan: vi.fn(async () => ({})),
        updatePlan: vi.fn(async () => ({})),
    });
});

describe("PlansPage — views", () => {
    it("defaults to list view", async () => {
        renderPage();
        expect(await screen.findByRole("heading", { name: "3 Days a Week" })).toBeInTheDocument();
        expect(listRadio()).toHaveAttribute("aria-checked", "true");
        expect(gridRadio()).toHaveAttribute("aria-checked", "false");
    });

    it("toggles to grid and back without reloading or clearing search", async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole("heading", { name: "6 Days a Week" });

        await user.type(searchInput(), "5 Days");
        expect(screen.queryByRole("heading", { name: "3 Days a Week" })).not.toBeInTheDocument();

        await user.click(gridRadio());
        expect(gridRadio()).toHaveAttribute("aria-checked", "true");
        // Search term survives the switch; page never reloaded (data fn called once per mount).
        expect(searchInput()).toHaveValue("5 Days");
        expect(screen.getByRole("heading", { name: "5 Days a Week" })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "6 Days a Week" })).not.toBeInTheDocument();
        expect(mockData.listPlans).toHaveBeenCalledTimes(1);

        await user.click(listRadio());
        expect(listRadio()).toHaveAttribute("aria-checked", "true");
        expect(searchInput()).toHaveValue("5 Days");
        expect(mockData.listPlans).toHaveBeenCalledTimes(1);
    });
});

describe("PlansPage — plan data", () => {
    it("shows the three dance plans with fee, schedule and class quota", async () => {
        renderPage();

        expect(await screen.findByRole("heading", { name: "3 Days a Week" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "5 Days a Week" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "6 Days a Week" })).toBeInTheDocument();

        // Fees (INR) + monthly period.
        expect(screen.getByText("₹1,500")).toBeInTheDocument();
        expect(screen.getByText("₹2,000")).toBeInTheDocument();
        expect(screen.getByText("₹2,300")).toBeInTheDocument();
        expect(screen.getAllByText("/ month")).toHaveLength(3);

        // Weekly schedule labels.
        expect(screen.getByText("3 days per week")).toBeInTheDocument();
        expect(screen.getByText("Monday – Friday")).toBeInTheDocument();
        expect(screen.getByText("Monday – Saturday")).toBeInTheDocument();

        // Monthly class quotas.
        expect(screen.getByText("12 classes per month")).toBeInTheDocument();
        expect(screen.getByText("20 classes per month")).toBeInTheDocument();
        expect(screen.getByText("24 classes per month")).toBeInTheDocument();

        // Supplied artwork is wired to each card.
        expect(document.querySelector('img[src="/images/plan1.png"]')).toBeTruthy();
        expect(document.querySelector('img[src="/images/plan2.png"]')).toBeTruthy();
        expect(document.querySelector('img[src="/images/plan3.png"]')).toBeTruthy();
    });

    it("keeps duration-only plans honest (no fake quota, true period)", async () => {
        renderPage();
        // Archived duration-only plan still listed (status filter default = All).
        expect(await screen.findByRole("heading", { name: "Workshop Pass" })).toBeInTheDocument();
        expect(screen.getByText("Duration-based access")).toBeInTheDocument();
        expect(screen.getByText("/ 3 months")).toBeInTheDocument();
        expect(screen.getByText("Archived")).toBeInTheDocument();
    });
});

describe("PlansPage — toolbar filters", () => {
    it("search filters in both views", async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole("heading", { name: "3 Days a Week" });

        await user.type(searchInput(), "no such plan");
        await waitFor(() => expect(screen.queryByRole("heading", { name: "3 Days a Week" })).not.toBeInTheDocument());
        expect(screen.getByText(/no results/i)).toBeInTheDocument();

        await user.click(gridRadio());
        expect(screen.queryByRole("heading", { name: "3 Days a Week" })).not.toBeInTheDocument();
    });

    it("status filter shows only real statuses", async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole("heading", { name: "3 Days a Week" });

        // Filter → Inactive: only the archived duration-only plan remains.
        await user.click(screen.getByRole("combobox", { name: /filter plans by status/i }));
        await user.click(await screen.findByRole("option", { name: "Inactive" }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "Workshop Pass" })).toBeInTheDocument();
            expect(screen.queryByRole("heading", { name: "3 Days a Week" })).not.toBeInTheDocument();
        });

        // Filter → Active: only the three dance plans remain.
        await user.click(screen.getByRole("combobox", { name: /filter plans by status/i }));
        await user.click(await screen.findByRole("option", { name: "Active" }));
        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "6 Days a Week" })).toBeInTheDocument();
            expect(screen.queryByRole("heading", { name: "Workshop Pass" })).not.toBeInTheDocument();
        });
    });
});

describe("PlansPage — dialogs", () => {
    it("opens the edit dialog prefilled from the card", async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole("heading", { name: "3 Days a Week" });

        await user.click(screen.getByRole("button", { name: "Edit 3 Days a Week" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("heading", { name: "Edit plan" })).toBeInTheDocument();
        expect(within(dialog).getByLabelText("Plan name")).toHaveValue("3 Days a Week");
        expect(within(dialog).getByLabelText("Price (₹)")).toHaveValue(1500);
        expect(within(dialog).getByLabelText("Monthly class quota")).toHaveValue(12);
        expect(within(dialog).getByLabelText("Weekly schedule")).toHaveValue("3 days per week");
    });

    it("archives via the confirm dialog (never deletes)", async () => {
        const user = userEvent.setup();
        renderPage();
        await screen.findByRole("heading", { name: "5 Days a Week" });

        await user.click(screen.getByRole("button", { name: "More options for 5 Days a Week" }));
        await user.click(await screen.findByRole("menuitem", { name: /archive plan/i }));

        const confirmDialog = await screen.findByRole("dialog");
        expect(within(confirmDialog).getByRole("heading", { name: /Archive 5 Days a Week\?/ })).toBeInTheDocument();
        await user.click(within(confirmDialog).getByRole("button", { name: /archive plan/i }));

        await waitFor(() => expect(mockData.archivePlan).toHaveBeenCalledWith("p2", false));
    });
});
