import { configureStore } from "@reduxjs/toolkit";
import { queryApi } from "@/data/api/queryApi";
import authReducer from "./authSlice";

export const store = configureStore({
    reducer: {
        auth: authReducer,
        [queryApi.reducerPath]: queryApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(queryApi.middleware),
});
