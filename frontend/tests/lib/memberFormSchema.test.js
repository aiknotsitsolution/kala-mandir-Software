import { describe, expect, it } from "vitest";
import { memberFormSchema } from "../../src/lib/validation";

function createStudentInput(overrides = {}) {
    return {
        fullName: "Asha Sharma",
        email: "asha@example.com",
        password: "studentPass123",
        confirmPassword: "studentPass123",
        phone: "9876543210",
        joinDate: "2026-11-23",
        planId: "plan-id",
        membershipStart: "2026-11-23",
        mode: "create",
        classTags: ["Dance"],
        ...overrides,
    };
}

describe("member form password validation", () => {
    it("requires a password when creating a student", () => {
        const result = memberFormSchema.safeParse(createStudentInput({ password: "", confirmPassword: "" }));

        expect(result.success).toBe(false);
        expect(result.error.issues.some((issue) => issue.path[0] === "password")).toBe(true);
    });

    it("requires the confirmation to match", () => {
        const result = memberFormSchema.safeParse(createStudentInput({ confirmPassword: "differentPass123" }));

        expect(result.success).toBe(false);
        expect(result.error.issues.some((issue) => issue.path[0] === "confirmPassword")).toBe(true);
    });

    it("does not require a new password when editing an existing student", () => {
        const result = memberFormSchema.safeParse(createStudentInput({
            mode: "edit",
            password: "",
            confirmPassword: "",
        }));

        expect(result.success).toBe(true);
    });
});
