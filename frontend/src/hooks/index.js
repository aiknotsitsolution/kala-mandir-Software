import { useCallback, useEffect, useRef, useState } from "react";
/**
 * Small data-fetching helper: skips work when `enabled` is false, de-dupes
 * rapid reloads and cleans up on unmount.
 */
export function useAsync(fn, deps, options) {
    const enabled = options?.enabled ?? true;
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(enabled);
    const [error, setError] = useState(null);
    const [tick, setTick] = useState(0);
    const fnRef = useRef(fn);
    fnRef.current = fn;
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (!enabled) {
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        fnRef
            .current()
            .then((result) => {
            if (!cancelled && mounted.current) {
                setData(result);
                setLoading(false);
            }
        })
            .catch((err) => {
            if (!cancelled && mounted.current) {
                setError(err instanceof Error ? err.message : "Something went wrong.");
                setLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...deps, enabled, tick]);
    const reload = useCallback(() => setTick((t) => t + 1), []);
    return { data, loading, error, reload };
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
