import { useCallback, useEffect, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Navigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { appMode, getAuthProvider, getDataService } from "@/data";
import { queryApi } from "@/data/api/queryApi";
import { applyTheme } from "@/lib/theme";
import { authCheckFailed, authCheckStarted, authSessionChanged } from "@/store/authSlice";

const MUTATING_METHODS = new Set([
    "updateProfile", "updateSettings",
    "createMember", "updateMember", "deleteMember", "setMemberStatus",
    "renewMembership", "setMembershipStatus", "rotateQrToken",
    "createPlan", "updatePlan", "archivePlan",
    "checkInByToken", "checkInByMemberCode", "recordCheckout", "correctAttendance", "remindCheckout",
    "createPayment", "refundPayment", "uploadPhoto", "changeMyPassword",
    "readMyReminders", "readMyReminder", "rotateGymQr", "updateTimeSlots",
    "updateCheckinSettings", "updateTheme", "gymScan", "checkinGym",
    "createStaff", "updateStaff", "archiveStaff", "deleteStaff",
    "assignStaffSlots", "assignStaffStudents",
    "createClass", "updateClass", "cancelClass", "enroll", "cancelEnrollment", "setEnrollmentStatus",
    "createClassSlot", "updateClassSlot", "archiveClassSlot", "enrollSlotStudent", "unenrollSlotStudent",
    "markClassAttendance", "markDemoAttendance", "markRosterAttendance",
    "markNotificationRead", "markAllNotificationsRead", "generateNotifications",
]);

function setAuthSession(dispatch, session) {
    dispatch(queryApi.util.resetApiState());
    dispatch(authSessionChanged(session));
}

function dataServiceFor(session, dispatch) {
    if (!session)
        return null;
    const service = getDataService(session);
    return new Proxy(service, {
        get(target, property) {
            const value = Reflect.get(target, property, target);
            if (typeof value !== "function")
                return value;
            if (!MUTATING_METHODS.has(property))
                return value.bind(target);
            return async (...args) => {
                const result = await value.apply(target, args);
                dispatch(queryApi.util.invalidateTags(["Data"]));
                return result;
            };
        },
    });
}

async function refreshAuthSession(dispatch, mode) {
    dispatch(authCheckStarted());
    if (mode === "unconfigured") {
        setAuthSession(dispatch, null);
        return;
    }
    try {
        const next = await getAuthProvider().getSession();
        setAuthSession(dispatch, next);
    }
    catch (err) {
        dispatch(queryApi.util.resetApiState());
        dispatch(authCheckFailed(err instanceof Error ? err.message : "Unable to verify your session."));
    }
}

export function AuthProvider({ children }) {
    const dispatch = useDispatch();
    const session = useSelector((state) => state.auth.session);
    const mode = appMode();
    const refresh = useCallback(() => refreshAuthSession(dispatch, mode), [dispatch, mode]);
    useEffect(() => {
        void refresh();
        if (mode === "unconfigured")
            return;
        const unsubscribe = getAuthProvider().onAuthChange((next) => {
            setAuthSession(dispatch, next);
        });
        return unsubscribe;
    }, [dispatch, refresh, mode]);
    // Institute-wide theme (admin sets it in Manage Institute) drives the whole
    // platform — staff app + member portal + login screen.
    useEffect(() => {
        if (session?.gym?.themeMode || session?.gym?.themeAccent)
            applyTheme({ mode: session.gym.themeMode, accent: session.gym.themeAccent });
    }, [session?.gym?.themeMode, session?.gym?.themeAccent]);
    return children;
}

export function useAuth() {
    const dispatch = useDispatch();
    const { session, loading, error } = useSelector((state) => state.auth);
    const mode = appMode();
    const data = useMemo(() => dataServiceFor(session, dispatch), [session, dispatch]);
    const refresh = useCallback(() => refreshAuthSession(dispatch, mode), [dispatch, mode]);
    const signIn = useCallback(async (credentials) => {
        const next = await getAuthProvider().signIn(credentials);
        setAuthSession(dispatch, next);
        toast.success(`Welcome back, ${next.profile.fullName.split(" ")[0]}`);
        return next;
    }, [dispatch]);
    const signOut = useCallback(async () => {
        await getAuthProvider().signOut();
        setAuthSession(dispatch, null);
        toast.info("Signed out");
    }, [dispatch]);
    return { session, data, loading, error, mode, signIn, signOut, refresh };
}

export function useSession() {
    const { session } = useAuth();
    if (!session)
        throw new Error("No active session");
    return session;
}
export function useData() {
    const dispatch = useDispatch();
    const session = useSelector((state) => state.auth.session);
    const data = useMemo(() => dataServiceFor(session, dispatch), [session, dispatch]);
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
