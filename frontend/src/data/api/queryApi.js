import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";

const queryExecutors = new Map();

export function registerQueryExecutor(key, execute) {
    queryExecutors.set(key, execute);
}

export const queryApi = createApi({
    reducerPath: "queryApi",
    baseQuery: fakeBaseQuery(),
    tagTypes: ["Data"],
    refetchOnMountOrArgChange: 30,
    refetchOnFocus: true,
    refetchOnReconnect: true,
    endpoints: (builder) => ({
        executeQuery: builder.query({
            async queryFn(key) {
                const execute = queryExecutors.get(key);
                if (!execute) {
                    return {
                        error: {
                            status: "CUSTOM_ERROR",
                            error: "This data request is no longer available. Please retry.",
                        },
                    };
                }
                try {
                    return { data: await execute() };
                }
                catch (error) {
                    return {
                        error: {
                            status: "CUSTOM_ERROR",
                            error: error instanceof Error ? error.message : "Something went wrong.",
                        },
                    };
                }
            },
            providesTags: ["Data"],
            keepUnusedDataFor: 60,
            async onCacheEntryAdded(key, { cacheEntryRemoved }) {
                const executor = queryExecutors.get(key);
                await cacheEntryRemoved;
                if (queryExecutors.get(key) === executor)
                    queryExecutors.delete(key);
            },
        }),
    }),
});

export const { useLazyExecuteQueryQuery } = queryApi;
