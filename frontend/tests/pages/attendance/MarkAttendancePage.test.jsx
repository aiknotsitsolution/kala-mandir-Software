import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "react-redux";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryApi } from "@/data/api/queryApi";
import { MarkAttendancePage } from "@/pages/attendance/MarkAttendancePage";
import { store } from "@/store";

const { mockData } = vi.hoisted(() => ({ mockData: {} }));

vi.mock("@/auth/AuthProvider", () => ({
    useData: () => mockData,
}));

const memberId = "64e7a9b5c3d2e1f012345678";

function renderPage() {
    return render(
      <Provider store={store}>
        <MemoryRouter>
          <MarkAttendancePage />
        </MemoryRouter>
      </Provider>,
    );
}

describe("MarkAttendancePage MongoDB ID attendance", () => {
    beforeEach(() => {
        store.dispatch(queryApi.util.resetApiState());
        Object.assign(mockData, {
            listClassSlots: vi.fn(async () => [
                { id: "slot-1", name: "Dance", isActive: true, startTime: "09:00" },
            ]),
            getClassRoster: vi.fn(async () => ({
                isSlotDay: true,
                students: [
                    { memberId, fullName: "Asha Kapoor", status: "active", enrolled: true, marked: false },
                ],
            })),
            markClassAttendance: vi.fn(async () => ({
                status: "ok",
                member: { fullName: "Asha Kapoor" },
                quota: null,
            })),
        });
    });

    it("marks the roster student using the MongoDB member ID", async () => {
        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByRole("button", { name: "Mark", exact: true }));

        await waitFor(() => {
            expect(mockData.markClassAttendance).toHaveBeenCalledWith(
                expect.objectContaining({ slotId: "slot-1", memberId }),
            );
        });
    });

    it("accepts a MongoDB ID for a walk-in and sends it as memberId", async () => {
        const user = userEvent.setup();
        renderPage();

        const memberIdInput = await screen.findByLabelText("Mark by MongoDB member ID");
        await waitFor(() => expect(memberIdInput).toBeEnabled());
        await user.type(memberIdInput, memberId);
        await user.click(screen.getByRole("button", { name: "Mark attendance" }));

        await waitFor(() => {
            expect(mockData.markClassAttendance).toHaveBeenCalledWith(
                expect.objectContaining({ slotId: "slot-1", memberId }),
            );
        });
    });
});
