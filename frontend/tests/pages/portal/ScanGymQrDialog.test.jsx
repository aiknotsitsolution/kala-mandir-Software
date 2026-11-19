import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ScanGymQrDialog } from "@/pages/portal/ScanGymQrDialog";

const TOKEN = "0123456789abcdef0123456789abcdef";
const { mockData, mockOnScanDone, mockOnOpenChange } = vi.hoisted(() => ({
    mockData: {},
    mockOnScanDone: vi.fn(),
    mockOnOpenChange: vi.fn(),
}));

vi.mock("@/auth/AuthProvider", () => ({
    useData: () => mockData,
}));

vi.mock("@/hooks", () => ({
    useAsync: () => ({ data: { locationRequired: false }, loading: false, error: null }),
}));

vi.mock("@/pages/attendance/CameraScanner", () => ({
    CameraScanner: ({ active, onDecoded }) => active
        ? <button type="button" onClick={() => onDecoded("PGS1:0123456789abcdef0123456789abcdef")}>Simulate shared QR scan</button>
        : null,
}));

describe("ScanGymQrDialog", () => {
    it("waits for the student's confirmation before recording attendance", async () => {
        const user = userEvent.setup();
        Object.assign(mockData, {
            gymScan: vi.fn(async () => ({ action: "check_in", message: "Attendance marked" })),
        });
        mockOnScanDone.mockReset();
        mockOnOpenChange.mockReset();

        render(<ScanGymQrDialog open onOpenChange={mockOnOpenChange} onScanDone={mockOnScanDone}/>);
        await user.click(screen.getByRole("button", { name: "Simulate shared QR scan" }));

        expect(await screen.findByText("Your attendance will be recorded only after you confirm below.")).toBeInTheDocument();
        expect(mockData.gymScan).not.toHaveBeenCalled();

        await user.click(screen.getByRole("button", { name: "Mark attendance" }));

        expect(mockData.gymScan).toHaveBeenCalledWith(TOKEN, null);
        expect(mockOnScanDone).toHaveBeenCalledWith({ action: "check_in", message: "Attendance marked" });
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
    });

    it("shows a confirmation button for a printed QR link without auto-marking", async () => {
        Object.assign(mockData, {
            gymScan: vi.fn(async () => ({ action: "check_in", message: "Attendance marked" })),
        });
        render(<ScanGymQrDialog open initialToken={TOKEN} onOpenChange={mockOnOpenChange}/>);

        expect(await screen.findByRole("button", { name: "Mark attendance" })).toBeInTheDocument();
        expect(mockData.gymScan).not.toHaveBeenCalled();
    });
});
