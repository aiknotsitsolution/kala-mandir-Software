import { Provider } from "react-redux";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryApi } from "@/data/api/queryApi";
import { AttendancePage } from "@/pages/attendance/AttendancePage";
import { store } from "@/store";

const { mockData, mockDownloadCsv, mockToCsv } = vi.hoisted(() => ({
    mockData: {},
    mockDownloadCsv: vi.fn(),
    mockToCsv: vi.fn((rows) => rows.map((row) => row.memberName).join(",")),
}));

vi.mock("@/lib/csv", () => ({
    downloadCsv: mockDownloadCsv,
    toCsv: mockToCsv,
}));

vi.mock("@/auth/AuthProvider", () => ({
    useAuth: () => ({ session: { profile: { id: "owner", role: "owner" } } }),
    useData: () => mockData,
}));

function renderPage(initialEntry = "/attendance") {
    return render(
      <Provider store={store}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <AttendancePage/>
        </MemoryRouter>
      </Provider>,
    );
}

describe("AttendancePage tabs and data loading", () => {
    beforeEach(() => {
        store.dispatch(queryApi.util.resetApiState());
        mockDownloadCsv.mockReset();
        mockToCsv.mockClear();
        Object.assign(mockData, {
            getClassDaySummary: vi.fn(async () => ({})),
            listClassSlots: vi.fn(async () => [{
                id: "slot1",
                isActive: true,
                startTime: "09:00",
                endTime: "10:00",
                weekdays: [new Date().getDay()],
            }]),
            listAllMembers: vi.fn(async () => [
                { id: "m1", fullName: "Asha Kapoor", memberCode: "KM-001", status: "active" },
                { id: "m2", fullName: "Riya Shah", memberCode: "KM-002", status: "active" },
                { id: "m3", fullName: "Inactive Student", memberCode: "KM-003", status: "inactive" },
            ]),
            listAttendance: vi.fn(async () => ({
                items: [{ id: "a1", memberId: "m1", attendanceStatus: "present" }],
                total: 1,
                page: 1,
                pageSize: 100,
            })),
            getClassRoster: vi.fn(async () => ({
                students: [
                    { memberId: "m1", fullName: "Asha Kapoor", memberCode: "KM-001", enrolled: true, trainerName: "Maya Joshi", attendanceStatus: "present" },
                    { memberId: "m2", fullName: "Riya Shah", memberCode: "KM-002", enrolled: false, trainerName: "Neha Shah", attendanceStatus: "absent" },
                ],
            })),
        });
    });

    it("opens on the first View All tab and loads only its attendance list", async () => {
        renderPage();

        const viewAllTab = screen.getByRole("tab", { name: "View All" });
        expect(screen.getAllByRole("tab")[0]).toBe(viewAllTab);
        expect(viewAllTab).toHaveAttribute("aria-selected", "true");
        expect(await screen.findByText("Asha Kapoor")).toBeInTheDocument();
        expect(screen.getByText("Riya Shah")).toBeInTheDocument();
        expect(screen.getByText("Not marked")).toBeInTheDocument();
        expect(screen.queryByText("Inactive Student")).not.toBeInTheDocument();
        expect(mockData.listAttendance).toHaveBeenCalledTimes(1);
        expect(mockData.listAllMembers).toHaveBeenCalledTimes(1);
        expect(mockData.getClassRoster).not.toHaveBeenCalled();
    });

    it("keeps the selected non-default tab and fetches its data only when opened", async () => {
        const user = userEvent.setup();
        renderPage();

        await screen.findByText("Asha Kapoor");
        await user.click(screen.getByRole("tab", { name: /Mark/ }));
        expect(screen.getByRole("tab", { name: /Mark/ })).toHaveAttribute("aria-selected", "true");
        expect(mockData.listAttendance).toHaveBeenCalledTimes(1);

        await user.click(screen.getByRole("tab", { name: /View Attendance/ }));
        expect(screen.getByRole("tab", { name: /View Attendance/ })).toHaveAttribute("aria-selected", "true");
        await waitFor(() => expect(mockData.listAttendance).toHaveBeenCalledTimes(2));
    });

    it("shows attendance for students outside the selected slot roster", async () => {
        renderPage("/attendance?tab=mark");

        expect(await screen.findByText("Asha Kapoor")).toBeInTheDocument();
        expect(screen.getByText("Riya Shah")).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "Edit attendance for Riya Shah" })).toHaveLength(2);
    });

    it("filters the Mark Attendance roster by trainer name", async () => {
        const user = userEvent.setup();
        renderPage("/attendance?tab=mark");

        expect(await screen.findByText("Asha Kapoor")).toBeInTheDocument();
        await user.selectOptions(screen.getAllByRole("combobox", { name: "Trainer" })[0], "Neha Shah");

        expect(screen.getByText("Riya Shah")).toBeInTheDocument();
        expect(screen.queryByText("Asha Kapoor")).not.toBeInTheDocument();
    });

    it("searches attendance history and exports only matching records to CSV", async () => {
        const user = userEvent.setup();
        const records = [
            { id: "a1", memberId: "m1", memberName: "Asha Kapoor", memberCode: "KM-001", status: "checked_in", checkIn: "2026-11-18T09:00:00.000Z", method: "qr" },
            { id: "a2", memberId: "m2", memberName: "Riya Shah", memberCode: "KM-002", status: "checked_in", checkIn: "2026-11-18T10:00:00.000Z", method: "manual" },
        ];
        mockData.listAttendance = vi.fn(async ({ page, pageSize }) => ({
            items: records.slice((page - 1) * pageSize, page * pageSize),
            total: records.length,
            page,
            pageSize,
        }));
        renderPage("/attendance?tab=history&from=2026-11-18&to=2026-11-18");

        expect(await screen.findByText("Asha Kapoor")).toBeInTheDocument();
        await user.type(screen.getByRole("textbox", { name: "Search student" }), "Riya");

        expect(await screen.findByText("Riya Shah")).toBeInTheDocument();
        expect(screen.queryByText("Asha Kapoor")).not.toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Export CSV" }));

        await waitFor(() => expect(mockDownloadCsv).toHaveBeenCalledTimes(1));
        expect(mockToCsv.mock.calls[0][0].map((record) => record.memberName)).toEqual(["Riya Shah"]);
        expect(mockDownloadCsv.mock.calls[0][0]).toContain("search-Riya");
    });
});
