import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, RequireAuth, useAuth } from "@/auth/AuthProvider";
import { AppShell } from "@/components/layout/AppShell";
const lazyPage = (load, name) => lazy(() => load().then((module) => ({ default: module[name] })));
const LoginPage = lazyPage(() => import("@/pages/LoginPage"), "LoginPage");
const SetPasswordPage = lazyPage(() => import("@/pages/SetPasswordPage"), "SetPasswordPage");
const DashboardPage = lazyPage(() => import("@/pages/DashboardPage"), "DashboardPage");
const StaffPage = lazyPage(() => import("@/pages/staff/StaffPage"), "StaffPage");
const StaffDetailPage = lazyPage(() => import("@/pages/staff/StaffDetailPage"), "StaffDetailPage");
const ClassesPage = lazyPage(() => import("@/pages/classes/ClassesPage"), "ClassesPage");
const ReportsPage = lazyPage(() => import("@/pages/reports/ReportsPage"), "ReportsPage");
const NotificationsPage = lazyPage(() => import("@/pages/notifications/NotificationsPage"), "NotificationsPage");
const SettingsPage = lazyPage(() => import("@/pages/settings/SettingsPage"), "SettingsPage");
const ManageGymPage = lazyPage(() => import("@/pages/manage/ManageGymPage"), "ManageGymPage");
const PlansPage = lazyPage(() => import("@/pages/plans/PlansPage"), "PlansPage");
const PaymentsPage = lazyPage(() => import("@/pages/payments/PaymentsPage"), "PaymentsPage");
const MembersPage = lazyPage(() => import("@/pages/members/MembersPage"), "MembersPage");
const MemberDetailPage = lazyPage(() => import("@/pages/members/MemberDetailPage"), "MemberDetailPage");
const AttendancePage = lazyPage(() => import("@/pages/attendance/AttendancePage"), "AttendancePage");
const MemberPortalLayout = lazyPage(() => import("@/pages/portal/MemberPortalLayout"), "MemberPortalLayout");
/** Old history page → now a tab on /attendance; keep deep links (dashboard, reports). */
function AttendanceHistoryRedirect() {
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    params.set("tab", "history");
    return <Navigate to={{ pathname: "/attendance", search: `?${params.toString()}` }} replace />;
}
const MemberPortalPage = lazyPage(() => import("@/pages/portal/MemberPortalPage"), "MemberPortalPage");
const MyAttendancePage = lazyPage(() => import("@/pages/portal/MyAttendancePage"), "MyAttendancePage");
const MyPaymentsPage = lazyPage(() => import("@/pages/portal/MyPaymentsPage"), "MyPaymentsPage");
const ProfilePage = lazyPage(() => import("@/pages/portal/ProfilePage"), "ProfilePage");
const ChangePasswordPage = lazyPage(() => import("@/pages/portal/ChangePasswordPage"), "ChangePasswordPage");
/** Staff tree — identical to the pre-portal behaviour (AppShell + dashboard routes). */
function StaffRoutes() {
    return (<Routes>
      <Route element={<RequireAuth>
            <AppShell />
          </RequireAuth>}>
        <Route index element={<DashboardPage />}/>
        <Route path="/members" element={<MembersPage />}/>
        <Route path="/members/:memberId" element={<MemberDetailPage />}/>
        {/* History is now a tab on /attendance — deep links land pre-filtered. */}
        <Route path="/attendance/history" element={<AttendanceHistoryRedirect />}/>
        <Route path="/attendance" element={<AttendancePage />}/>
        {/* Old split routes now redirect to the unified Attendance page. */}
        <Route path="/attendance/view" element={<Navigate to="/attendance" replace/>}/>
        <Route path="/attendance/mark" element={<Navigate to="/attendance" replace/>}/>
        <Route path="/plans" element={<PlansPage />}/>
        <Route path="/payments" element={<PaymentsPage />}/>
        <Route path="/staff" element={<StaffPage />}/>
        <Route path="/staff/:staffId" element={<StaffDetailPage />}/>
        <Route path="/classes" element={<ClassesPage />}/>
        {/* Class Slots now lives inside the merged Classes & Schedule page. */}
        <Route path="/slots" element={<Navigate to="/classes" replace/>}/>
        <Route path="/reports" element={<ReportsPage />}/>
        <Route path="/notifications" element={<NotificationsPage />}/>
        <Route path="/manage-gym" element={<ManageGymPage />}/>
        <Route path="/settings" element={<SettingsPage />}/>
        {/* Members never see staff screens — keep them inside the portal. */}
        <Route path="/portal" element={<Navigate to="/" replace/>}/>
        <Route path="*" element={<Navigate to="/" replace/>}/>
      </Route>
    </Routes>);
}
/** Member tree — self-service portal only; every other path lands on /portal. */
function MemberRoutes() {
    return (<Routes>
      <Route path="/portal" element={<RequireAuth>
            <MemberPortalLayout />
          </RequireAuth>}>
        <Route index element={<MemberPortalPage />}/>
        <Route path="attendance" element={<MyAttendancePage />}/>
        <Route path="payments" element={<MyPaymentsPage />}/>
        <Route path="profile" element={<ProfilePage />}/>
        <Route path="password" element={<ChangePasswordPage />}/>
      </Route>
      <Route path="/" element={<Navigate to="/portal" replace/>}/>
      <Route path="*" element={<Navigate to="/portal" replace/>}/>
    </Routes>);
}
/**
 * Role gate: signed-in members get the portal exclusively, staff keep the
 * existing AppShell tree. While the session is still resolving (or signed
 * out) this renders the staff tree, whose `RequireAuth` owns the loading and
 * redirect-to-login behaviour exactly as before.
 */
function RoleRoutes() {
    const { session } = useAuth();
    if (session?.profile.role === "member")
        return <MemberRoutes />;
    return <StaffRoutes />;
}
export default function App() {
    return (<AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="flex min-h-dvh items-center justify-center" role="status">Loading...</div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />}/>
            <Route path="/set-password" element={<SetPasswordPage />}/>
            <Route path="*" element={<RoleRoutes />}/>
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster position="top-right" richColors closeButton/>
    </AuthProvider>);
}
