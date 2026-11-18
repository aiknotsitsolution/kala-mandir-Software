import { createSlice } from "@reduxjs/toolkit";

const authSlice = createSlice({
    name: "auth",
    initialState: {
        session: null,
        loading: true,
        error: null,
    },
    reducers: {
        authCheckStarted(state) {
            state.loading = true;
            state.error = null;
        },
        authSessionChanged(state, action) {
            state.session = action.payload;
            state.loading = false;
            state.error = null;
        },
        authCheckFailed(state, action) {
            state.session = null;
            state.loading = false;
            state.error = action.payload;
        },
    },
});

export const { authCheckStarted, authSessionChanged, authCheckFailed } = authSlice.actions;
export default authSlice.reducer;
