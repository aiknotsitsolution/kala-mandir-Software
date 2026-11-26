import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { queryApi } from "@/data/api/queryApi";
import authReducer from "./authSlice";
import plansReducer from "./plansSlice";

export const store = configureStore({
    reducer: {
        auth: authReducer,
        plans: plansReducer,
        [queryApi.reducerPath]: queryApi.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(queryApi.middleware),
});

setupListeners(store.dispatch);
