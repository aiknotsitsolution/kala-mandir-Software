import { Provider } from "react-redux";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceHistoryContent } from "@/pages/attendance/AttendanceHistoryPage";
import { store } from "@/store";

const { mockData } = vi.hoisted(() => ({ mockData: {} }));

vi.mock("@/auth/AuthProvider", () => ({
    useAuth: () => ({ session: { profile: { role: "member" } } }),
    useData: () => mockData,
}));

vi.mock("@/lib/liveBus", () => ({
    subscribeLiveNotification: () => () => {},
}));

function renderHistory() {
    return render(
      <Provider store={store}>
        <MemoryRouter>
          <AttendanceHistoryContent />
        </MemoryRouter>
      </Provider>,
    );
}

describe("AttendanceHistoryContent", () => {
    beforeEach(() => {
        Object.assign(mockData, {
            listAttendance: vi.fn(async () => ({
                items: [],
                total: 37,
                page: 1,
                pageSize: 15,
                analytics: {
                    summary: { totalVisits: 37, checkedIn: 4, checkedOut: 33 },
                    trend: [{ date: "2026-11-18", visits: 37 }],
                },
            })),
        });
    });

    it("shows filtered overview metrics and the attendance trend", async () => {
        renderHistory();

        expect(await screen.findByText("Total visits")).toBeInTheDocument();
        expect(screen.getByText("Checked in")).toBeInTheDocument();
        expect(screen.getByText("Checked out")).toBeInTheDocument();
        expect(screen.getByText("Attendance trend")).toBeInTheDocument();
        expect(screen.queryByText("No attendance to chart")).not.toBeInTheDocument();
        expect(mockData.listAttendance).toHaveBeenCalledWith(expect.objectContaining({
            page: 1,
            pageSize: 15,
        }));
    });
});
