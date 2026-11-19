import { Provider } from "react-redux";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MyAttendancePage } from "@/pages/portal/MyAttendancePage";
import { store } from "@/store";

const { mockData } = vi.hoisted(() => ({ mockData: {} }));

vi.mock("@/auth/AuthProvider", () => ({
    useData: () => mockData,
}));

describe("MyAttendancePage", () => {
    beforeEach(() => {
        Object.assign(mockData, {
            listMyAttendance: vi.fn(async () => [{
                id: "visit-1",
                checkIn: "2026-11-18T10:00:00.000Z",
                checkOut: "2026-11-18T11:00:00.000Z",
                status: "checked_out",
                method: "qr",
                meta: { slotName: "Kathak · 4:00 PM – 5:00 PM" },
            }]),
        });
    });

    it("shows the slot name for a visit in the calendar and attendance history", async () => {
        render(
          <Provider store={store}>
            <MemoryRouter>
              <MyAttendancePage />
            </MemoryRouter>
          </Provider>,
        );

        expect(await screen.findAllByText("Kathak · 4:00 PM – 5:00 PM")).toHaveLength(2);
    });
});
