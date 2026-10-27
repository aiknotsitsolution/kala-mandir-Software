import { Link } from "react-router-dom";
import { ArrowRightIcon, CalendarClockIcon, CalendarDaysIcon, ClockIcon, KeyRoundIcon, MailIcon, Music2Icon, PhoneIcon, ShieldCheckIcon, TimerIcon, UserIcon, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { SmartImage } from "@/components/shared/SmartImage";
import { ErrorState, Skeleton } from "@/components/shared/States";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { durationLabel, formatDate, formatINR, timeSlotLabel, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Settle, Stamp } from "./PaperBits";

const STAMP_TONES = {
    active: { tone: "ok", label: "Active" },
    expiring_soon: { tone: "warn", label: "Expiring" },
    expired: { tone: "bad", label: "Expired" },
    suspended: { tone: "bad", label: "Suspended" },
    inactive: { tone: "muted", label: "Inactive" },
    none: { tone: "muted", label: "No plan" },
};
const STATUS_TEXT_TONES = {
    active: "text-[#3f7d51]",
    expiring_soon: "text-[#a3601f]",
    expired: "text-destructive",
    suspended: "text-destructive",
    inactive: "text-muted-foreground",
    none: "text-muted-foreground",
};
/** label → value row used across the profile cards. */
function Field({ icon: Icon, label, value }) {
    const empty = value === null || value === undefined || value === "";
    return (<div className="flex items-start justify-between gap-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        <Icon className="size-4 shrink-0" aria-hidden="true"/>
        <span className="truncate">{label}</span>
      </span>
      <span className={cn("min-w-0 break-words text-right text-sm font-medium", empty ? "text-muted-foreground" : "text-foreground")}>
        {empty ? "—" : value}
      </span>
    </div>);
}
/** Small stat tile (membership card). */
function Tile({ label, value, tone }) {
    return (<div className="rounded-lg bg-secondary/60 px-3 py-2 text-center">
      <p className={cn("truncate text-sm font-semibold tracking-tight", tone ?? "text-foreground")}>{value}</p>
      <p className="mt-0.5 truncate text-[10px] tracking-wide text-muted-foreground uppercase">{label}</p>
    </div>);
}
/**
 * Member profile — the details the front desk holds on file (identity,
 * membership + billing, account). Read-only: students can't edit these here,
 * but they can jump to the change-password screen.
 */
export function ProfilePage() {
    const data = useData();
    const { session } = useAuth();
    const profile = useAsync(() => data.getMyMemberProfile(), [data]);
    const me = profile.data;

    if (profile.loading && !me) {
        return (<div className="space-y-6">
          <PageHeader title="Your profile" description="Everything the front desk has on file for you."/>
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Skeleton className="h-72 rounded-xl"/>
            <Skeleton className="h-56 rounded-xl"/>
          </div>
        </div>);
    }
    if (profile.error && !me) {
        return (<div className="space-y-6">
          <PageHeader title="Your profile"/>
          <ErrorState title="Unable to load your profile" message={profile.error} onRetry={profile.reload}/>
        </div>);
    }

    const membership = me?.membership ?? null;
    const stamp = STAMP_TONES[me?.effectiveStatus] ?? STAMP_TONES.none;
    const statusTone = STATUS_TEXT_TONES[me?.effectiveStatus] ?? STATUS_TEXT_TONES.none;
    const loginEmail = session?.profile?.email ?? me?.email ?? null;
    const gymName = session?.gym?.name ?? "Kalamandir Dance Institute";
    const duration = membership?.planDurationValue != null && membership?.planDurationUnit
        ? durationLabel(membership.planDurationValue, membership.planDurationUnit)
        : null;

    return (<div className="space-y-6">
      <PageHeader title="Your profile" description="Keep your details accurate — the front desk uses them for your membership and billing."/>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ---------- main column: identity + membership ---------- */}
        <div className="min-w-0 space-y-6">
          <Settle>
            <Card className="graphite-surface border-border/70">
              <CardHeader>
                <div>
                  <CardTitle className="text-base">Student details</CardTitle>
                  <p className="text-xs text-muted-foreground">As recorded at the front desk</p>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <SmartImage src={me?.photoUrl} name={me?.fullName ?? "Student"} className="size-14 shrink-0 rounded-full text-sm ring-2 ring-border/60"/>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold tracking-tight">{me?.fullName ?? "Student"}</p>
                    <p className="truncate font-mono text-xs tracking-wide text-muted-foreground">
                      {me?.memberCode ?? "—"}
                      {membership?.planName ? ` · ${membership.planName}` : ""}
                    </p>
                  </div>
                  <Stamp label={stamp.label} tone={stamp.tone} className="shrink-0"/>
                </div>

                <div className="mt-3 divide-y divide-border/60">
                  <Field icon={MailIcon} label="Email" value={me?.email}/>
                  <Field icon={PhoneIcon} label="Phone" value={me?.phone}/>
                  <Field icon={UserIcon} label="Gender" value={me?.gender ? titleCase(me.gender) : null}/>
                  <Field icon={CalendarDaysIcon} label="Date of birth" value={formatDate(me?.dateOfBirth)}/>
                  <Field icon={CalendarClockIcon} label="Student since" value={formatDate(me?.joinDate)}/>
                  <Field icon={ClockIcon} label="Preferred slot" value={timeSlotLabel(me?.preferredSlot)}/>
                </div>
              </CardContent>
            </Card>
          </Settle>

          <Settle delay={0.08}>
            <Card className="graphite-surface border-border/70">
              <CardHeader>
                <div>
                  <CardTitle className="text-base">Membership</CardTitle>
                  <p className="text-xs text-muted-foreground">{membership?.planName ?? "No plan on file yet"}</p>
                </div>
              </CardHeader>
              <CardContent>
                {membership ? (<div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Tile label="Status" value={stamp.label} tone={statusTone}/>
                      <Tile label="Duration" value={duration ?? "—"}/>
                      <Tile label="Valid till" value={formatDate(membership.endDate)}/>
                    </div>

                    <div className="grid grid-cols-3 gap-2 border-t border-border/60 pt-3">
                      <Tile label="Billed" value={membership.billed != null ? formatINR(membership.billed) : "—"}/>
                      <Tile label="Paid" value={membership.paid != null ? formatINR(membership.paid) : "—"}/>
                      <Tile label={membership.balance > 0 ? "Due" : "Payment"} value={membership.balance > 0 ? formatINR(membership.balance) : "Paid in full"} tone={membership.balance > 0 ? "text-[#a3601f]" : "text-[#3f7d51]"}/>
                    </div>
                  </div>) : (<p className="text-sm text-muted-foreground">
                    No membership on file yet — visit the front desk to get started.
                  </p>)}
              </CardContent>
            </Card>
          </Settle>
        </div>

        {/* ---------- side column: account + password ---------- */}
        <div className="min-w-0 space-y-6">
          <Settle delay={0.16}>
            <Card className="graphite-surface border-border/70">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-base">Account</CardTitle>
                  <ShieldCheckIcon className="size-4 text-muted-foreground" aria-hidden="true"/>
                </div>
              </CardHeader>
              <CardContent className="divide-y divide-border/60">
                <Field icon={MailIcon} label="Sign-in email" value={loginEmail}/>
                <Field icon={UserIcon} label="Role" value="Student"/>
                <Field icon={Music2Icon} label="Institute" value={gymName}/>
                <Field icon={TimerIcon} label="Daily target" value={me?.plannedHoursPerDay ? `${me.plannedHoursPerDay}h` : null}/>
              </CardContent>
            </Card>
          </Settle>

          <Settle delay={0.24}>
            <Card className="graphite-surface border-border/70">
              <CardContent>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <KeyRoundIcon className="size-4 text-muted-foreground" aria-hidden="true"/>
                      Password
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">Only you can change it — staff never see it.</p>
                  </div>
                  <Button asChild size="sm" variant="outline" className="shrink-0">
                    <Link to="/portal/password">
                      Change <ArrowRightIcon className="size-3.5"/>
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Settle>
        </div>
      </div>
    </div>);
}
