import { describe, expect, it } from "vitest";
import authReducer, { authCheckFailed, authCheckStarted, authSessionChanged } from "@/store/authSlice";

describe("auth reducer", () => {
    it("clears an existing session when session verification fails", () => {
        const session = { userId: "user-1" };
        const authenticated = authReducer(undefined, authSessionChanged(session));
        const checking = authReducer(authenticated, authCheckStarted());
        const failed = authReducer(checking, authCheckFailed("Unable to verify your session."));

        expect(failed).toEqual({
            session: null,
            loading: false,
            error: "Unable to verify your session.",
        });
    });
});
