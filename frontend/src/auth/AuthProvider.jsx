import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { appMode, getAuthProvider, getDataService } from "@/data";
import { applyTheme } from "@/lib/theme";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const mode = appMode();
    const refresh = useCallback(async () => {
        if (mode === "unconfigured") {
            setSession(null);
            setLoading(false);
            return;
        }
        try {
            const next = await getAuthProvider().getSession();
            setSession(next);
            setError(null);
        }
        catch (err) {
            setSession(null);
            setError(err instanceof Error ? err.message : "Unable to verify your session.");
        }
        finally {
            setLoading(false);
        }
    }, [mode]);
    useEffect(() => {
        void refresh();
        if (mode === "unconfigured")
            return;
        const unsubscribe = getAuthProvider().onAuthChange((next) => {
            setSession(next);
        });
        return unsubscribe;
    }, [refresh, mode]);
    // Institute-wide theme (admin sets it in Manage Institute) drives the whole
    // platform — staff app + member portal + login screen.
    useEffect(() => {
        if (session?.gym?.themeMode || session?.gym?.themeAccent)
            applyTheme({ mode: session.gym.themeMode, accent: session.gym.themeAccent });
    }, [session?.gym?.themeMode, session?.gym?.themeAccent]);
    const signIn = useCallback(async (credentials) => {
        const next = await getAuthProvider().signIn(credentials);
        setSession(next);
        setError(null);
        toast.success(`Welcome back, ${next.profile.fullName.split(" ")[0]}`);
        return next;
    }, []);
    const signOut = useCallback(async () => {
        await getAuthProvider().signOut();
        setSession(null);
        toast.info("Signed out");
    }, []);
    const data = useMemo(() => (session ? getDataService(session) : null), [session]);
    const value = useMemo(() => ({ session, data, loading, error, mode, signIn, signOut, refresh }), [session, data, loading, error, mode, signIn, signOut, refresh]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error("useAuth must be used inside <AuthProvider>");
    return ctx;
}
export function useSession() {
    const { session } = useAuth();
    if (!session)
        throw new Error("No active session");
    return session;
}
export function useData() {
    const { data } = useAuth();
    if (!data)
        throw new Error("Data service is unavailable");
    return data;
}
/** Route guard: redirects to /login (or setup) while the session resolves. */
export function RequireAuth({ children }) {
    const { session, loading, mode } = useAuth();
    const location = useLocation();
    if (mode === "unconfigured")
        return <Navigate to="/login" replace/>;
    if (loading) {
        return (<div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"/>
          <p className="text-sm">Verifying your session…</p>
        </div>
      </div>);
    }
    if (!session)
        return <Navigate to="/login" state={{ from: location.pathname }} replace/>;
    return <>{children}</>;
}
