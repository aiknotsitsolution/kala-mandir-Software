import { createSlice } from "@reduxjs/toolkit";

const plansSlice = createSlice({
    name: "plans",
    initialState: {
        view: "list",
        query: "",
        status: "all",
    },
    reducers: {
        plansViewChanged(state, action) {
            state.view = action.payload;
        },
        plansQueryChanged(state, action) {
            state.query = action.payload;
        },
        plansStatusChanged(state, action) {
            state.status = action.payload;
        },
        plansFiltersReset(state) {
            state.view = "list";
            state.query = "";
            state.status = "all";
        },
    },
});

export const {
    plansViewChanged,
    plansQueryChanged,
    plansStatusChanged,
    plansFiltersReset,
} = plansSlice.actions;

export default plansSlice.reducer;
