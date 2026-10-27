import { useCallback, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { CheckIcon, Music2Icon, KeyRoundIcon, LogOutIcon, TriangleAlertIcon, UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NotificationBellPanel } from "@/components/shared/NotificationBellPanel";
import { SmartImage } from "@/components/shared/SmartImage";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { cn } from "@/lib/utils";
import "./portal-paper.css";

const NAV_ITEMS = [
    { to: "/portal", label: "Home", end: true },
    { to: "/portal/attendance", label: "Attendance" },
    { to: "/portal/payments", label: "Payments" },
    { to: "/portal/profile", label: "Profile" },
    { to: "/portal/password", label: "Password" },
];
/** Staff-sent / automatic reminders (e.g. "your planned time is over"). */
function ReminderBanner({ rows, busy, onGotIt }) {
    if (rows.length === 0)
        return null;
    return (<div role="status" className="border-b border-warning/30 bg-warning/10">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-2 px-4 py-2 sm:px-6">
        <TriangleAlertIcon className="size-4 shrink-0 text-warning"/>
        <p className="min-w-0 flex-1 text-xs sm:text-sm">
          <span className="font-semibold">{rows[0].title}</span>
          {" — "}
          {rows[0].body}
          {rows.length > 1 ? ` (+${rows.length - 1} more)` : ""}
        </p>
        <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={onGotIt}>
          <CheckIcon className="size-3.5"/> Got it
        </Button>
      </div>
    </div>);
}
/**
 * Shell for the student self-service portal — deliberately NOT the staff
 * AppShell: no sidebar, no topbar, no capability-gated staff navigation.
 * The paper-craft stylesheet (portal-paper.css) is loaded once, here, so every
 * portal page can use the `pp-*` surfaces.
 */
export function MemberPortalLayout() {
    const { session, signOut } = useAuth();
    const data = useData();
    const navigate = useNavigate();
    const profile = session?.profile;
    const reminders = useAsync(() => data.getMyReminders(), [data]);
    const reminderRows = reminders.data ?? [];
    const [clearingReminders, setClearingReminders] = useState(false);
    const clearReminders = async () => {
        setClearingReminders(true);
        try {
            await data.readMyReminders();
            reminders.reload();
        }
        finally {
            setClearingReminders(false);
        }
    };
    // Panel rows: member reminders are unread by definition.
    const fetchReminders = useCallback(async () => ((await data.getMyReminders()) ?? []).map((row) => ({ ...row, isRead: false })), [data]);
    const handleSignOut = async () => {
        await signOut();
        navigate("/login", { replace: true });
    };
    return (<div className="min-h-dvh bg-background">
      <ReminderBanner rows={reminderRows} busy={clearingReminders} onGotIt={() => void clearReminders()}/>
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Music2Icon className="size-4"/>
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight">
                {session?.gym?.name ?? "Kalamandir Dance Institute"}
              </p>
              <p className="truncate font-serif text-[11px] text-muted-foreground italic">Student portal</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {/* Bell → same mobile-style shade as the staff topbar. */}
            <NotificationBellPanel unreadCount={reminderRows.length} fetchItems={fetchReminders} label="Reminders" emptyTitle="No reminders" emptyBody="You're all caught up." onOpenItem={async (item) => {
            await data.readMyReminder(item.id);
            reminders.reload();
        }} onMarkAllRead={clearReminders}/>

            {/* The whole gray pill (name + avatar) is the dropdown trigger. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div aria-label="Account menu" tabIndex={0} onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.currentTarget.click();
                  }
                }} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg bg-muted px-2 py-1 outline-none ring-offset-background transition-shadow focus-visible:ring-2 focus-visible:ring-ring sm:gap-3">
                  <span className="hidden min-w-0 text-right sm:block">
                    <span className="block truncate text-sm font-medium">{profile?.fullName}</span>
                    {profile?.email ? (
                      <span className="block truncate text-[11px] text-muted-foreground">{profile.email}</span>
                    ) : null}
                  </span>
                  <SmartImage src={profile?.avatarUrl} name={profile?.fullName ?? "Student"} className="size-8 shrink-0 text-[11px]"/>
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <p className="text-sm font-medium">{profile?.fullName}</p>
                    {profile?.email ? (
                      <p className="text-xs font-normal text-muted-foreground">{profile.email}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-primary">Student</p>
                  </DropdownMenuLabel>
                <DropdownMenuSeparator/>
                <DropdownMenuItem asChild>
                  <Link to="/portal/profile">
                    <UserIcon className="size-4"/> Profile
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/portal/password">
                    <KeyRoundIcon className="size-4"/> Change password
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator/>
                <DropdownMenuItem onSelect={() => {
              void handleSignOut();
          }}>
                  <LogOutIcon className="size-4"/> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <nav aria-label="Student portal" className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
          {NAV_ITEMS.map((item) => (<NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => cn("rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors", isActive
                ? "bg-secondary font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground")}>
              {item.label}
            </NavLink>))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>
    </div>);
}
