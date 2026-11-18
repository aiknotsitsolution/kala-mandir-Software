import { useCallback, useEffect, useRef, useState } from "react";
import { registerQueryExecutor, useLazyExecuteQueryQuery } from "@/data/api/queryApi";

const objectIds = new WeakMap();
let nextObjectId = 1;

function objectId(value) {
    if (!objectIds.has(value))
        objectIds.set(value, nextObjectId++);
    return objectIds.get(value);
}

function serializeDependency(value) {
    if (value === null)
        return "null";
    if (value === undefined)
        return "undefined";
    if (value instanceof Date)
        return `date:${value.toISOString()}`;
    if (Array.isArray(value))
        return `[${value.map(serializeDependency).join(",")}]`;
    if (typeof value === "object") {
        if (value.mode === "api" && typeof value.gymId === "string")
            return `data-service:${value.gymId}`;
        const prototype = Object.getPrototypeOf(value);
        if (prototype === Object.prototype || prototype === null) {
            return `{${Object.keys(value)
                .sort()
                .map((key) => `${JSON.stringify(key)}:${serializeDependency(value[key])}`)
                .join(",")}}`;
        }
        return `object:${objectId(value)}`;
    }
    if (typeof value === "function")
        return `function:${objectId(value)}`;
    return `${typeof value}:${String(value)}`;
}

function queryKey(fn, deps) {
    return JSON.stringify([fn.toString(), deps.map(serializeDependency)]);
}

/**
 * RTK Query cache adapter for existing data calls. Callers provide complete
 * dependencies, which are used with the query callback to deduplicate/cache requests.
 */
export function useAsync(fn, deps, options) {
    const enabled = options?.enabled ?? true;
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const key = queryKey(fn, deps);
    const [trigger, query] = useLazyExecuteQueryQuery();
    useEffect(() => {
        if (!enabled)
            return;
        registerQueryExecutor(key, () => fnRef.current());
        const request = trigger(key, true);
        return () => {
            request.unsubscribe();
        };
    }, [enabled, key, trigger]);
    const reload = useCallback(() => {
        if (!enabled)
            return;
        registerQueryExecutor(key, () => fnRef.current());
        trigger(key);
    }, [enabled, key, trigger]);
    const error = query.error?.error ?? query.error?.data?.message ?? null;
    return {
        data: query.currentData ?? null,
        loading: enabled && (query.isUninitialized || query.isFetching),
        error,
        reload,
    };
}
/** Debounce a rapidly changing value (search inputs). */
export function useDebounced(value, delay = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}
/** Guard against double form submissions. */
export function useSubmitGuard() {
    const [submitting, setSubmitting] = useState(false);
    const run = useCallback(async (action) => {
        if (submitting)
            return false;
        setSubmitting(true);
        try {
            await action();
            return true;
        }
        finally {
            setSubmitting(false);
        }
    }, [submitting]);
    return [submitting, run];
}
