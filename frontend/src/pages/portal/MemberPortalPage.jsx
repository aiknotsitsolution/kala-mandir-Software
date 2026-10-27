import { useEffect, useMemo, useState } from "react";
import { BellIcon, QrCodeIcon } from "lucide-react";
import { Skeleton, ErrorState } from "@/components/shared/States";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { cn } from "@/lib/utils";
import { greetingForHour, computeVisitStats } from "./paper";
import { Settle, SectionHeading } from "./PaperBits";
import { MembershipPass } from "./MembershipPass";
import { ScanGymQrDialog } from "./ScanGymQrDialog";
import { StatsTickets } from "./StatsTickets";
import { ClassTickets } from "./ClassTickets";
import { VisitCalendar } from "./VisitCalendar";
import { ReceiptStubs } from "./ReceiptStubs";

/** A visit counts at most 12h so a forgotten check-out cannot skew totals. */
const MAX_VISIT_MS = 12 * 3_600_000;
const pad2 = (value) => String(value).padStart(2, "0");
function ymdLocal(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}
/** `73800000` → `20h 30m`, `185000` → `3m 05s`. */
function durationLabel(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0 ? `${hours}h ${pad2(minutes)}m` : `${minutes}m ${pad2(seconds)}s`;
}
function visitSpanMs(record, nowMs) {
    const start = new Date(record.checkIn).getTime();
    const end = record.checkOut ? new Date(record.checkOut).getTime() : nowMs;
    return Math.min(Math.max(0, end - start), MAX_VISIT_MS);
}
/**
 * Colored timer beside the hero greeting: live while today's check-in is
 * open, today's total once checked out, otherwise the last visit's time.
 * Flips to red ("Time up") the moment the live time passes planned hours.
 */
function SessionTimer({ records, plannedHours }) {
    const [tick, setTick] = useState(() => Date.now());
    const rows = records ?? [];
    const today = ymdLocal(new Date());
    const todayRows = useMemo(() => rows.filter((r) => ymdLocal(new Date(r.checkIn)) === today), [rows, today]);
    const openToday = todayRows.find((r) => r.status === "checked_in" && !r.checkOut);
    useEffect(() => {
        if (!openToday)
            return;
        const id = setInterval(() => setTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [openToday]);
    if (rows.length === 0)
        return null;
    let label = null;
    let tone = "text-muted-foreground";
    if (openToday) {
        const ms = visitSpanMs(openToday, tick);
        const warning = Boolean(plannedHours) && ms > plannedHours * 3_600_000;
        tone = warning ? "text-destructive" : "text-primary";
        label = warning ? `Time up · ${durationLabel(ms)}` : `In studio · ${durationLabel(ms)}`;
    }
    else if (todayRows.length > 0) {
        const ms = todayRows.reduce((sum, r) => sum + visitSpanMs(r, tick), 0);
        label = `Today · ${durationLabel(ms)}`;
    }
    else {
        const last = rows.find((r) => r.checkOut) ?? rows[0];
        label = `Last visit · ${durationLabel(visitSpanMs(last, tick))}`;
    }
    return (<span title={plannedHours ? `Planned practice time: ${plannedHours}h per day` : "Time spent in the studio"} className={cn("inline-flex h-9 w-full items-center justify-center gap-2 bg-primary/10 px-3.5 text-sm font-bold tracking-tight tabular-nums whitespace-nowrap", tone === "text-destructive"
        ? "bg-destructive/15 text-destructive"
        : "text-primary")}>
      <span className={cn("size-1.5 rounded-full", tone === "text-destructive" ? "bg-destructive" : "animate-pulse bg-primary")}/>
      {label}
    </span>);
}

export function MemberPortalPage() {
    const data = useData();
    const { session } = useAuth();
    const [scanOpen, setScanOpen] = useState(false);
    const [scanBump, setScanBump] = useState(0);
    const profile = useAsync(() => data.getMyMemberProfile(), [data]);
    const attendance = useAsync(() => data.listMyAttendance(60), [data, scanBump]);
    const classes = useAsync(() => data.listMyClasses(), [data]);
    const payments = useAsync(() => data.listMyPayments(), [data]);

    const me = profile.data;
    const firstName = (me?.fullName ?? session?.profile.fullName ?? "").split(" ")[0] || "there";
    const now = new Date();
    const todayLabel = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    const stats = computeVisitStats(attendance.data ?? []);
    const quota = me?.quota ?? null;

    return (<div className="space-y-10 pb-6">
      {/* ---------- greeting + timer + scan ---------- */}
      <Settle>
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <p className="font-serif text-sm tracking-wide text-muted-foreground italic">{todayLabel}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {greetingForHour(now.getHours())},{" "}
              <span className="font-serif italic">{firstName}</span>
            </h1>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Your pass, visits and sessions — pressed onto one sheet of paper.
            </p>
          </div>

          {/* right column: highlighted live timer + gradient scan button — equal width */}
          <div className="flex w-44 shrink-0 flex-col gap-3">
            <SessionTimer records={attendance.data} plannedHours={me?.plannedHoursPerDay ?? null}/>
            <button type="button" onClick={() => setScanOpen(true)} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary via-primary to-[#c9d92e] px-4 text-xs font-bold text-primary-foreground shadow-[0_8px_20px_-12px_rgba(212,242,60,0.9)] transition-transform hover:scale-[1.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <QrCodeIcon className="size-3.5"/> Scan QR code
            </button>
          </div>
        </header>
      </Settle>

      <ScanGymQrDialog open={scanOpen} onOpenChange={setScanOpen} onScanDone={() => setScanBump((n) => n + 1)}/>

      {/* ---------- hero: 3D membership pass ---------- */}
      <Settle delay={0.08} rotate={0}>
        <section aria-labelledby="pass-heading" className="space-y-3">
          <SectionHeading title={<span id="pass-heading">Your membership pass</span>}/>
          {profile.error && !me ? (<ErrorState title="Unable to load your profile" message={profile.error} onRetry={profile.reload}/>) : (<MembershipPass profile={me}/>)}
        </section>
      </Settle>

      {/* ---------- class-quota reminder ("2 classes left" / "Expired") ---------- */}
      {quota && ["warning", "critical", "expired", "exceeded"].includes(quota.status) ? (<Settle delay={0.12}>
          <div role="status" className={cn("flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium", quota.status === "warning"
            ? "border-warning/40 bg-warning/10 text-foreground"
            : "border-destructive/40 bg-destructive/10 text-destructive")}>
            <BellIcon className="size-4 shrink-0"/>
            <span>
              {quota.status === "warning" && `Only ${quota.remaining} classes left in your plan.`}
              {quota.status === "critical" && "Only 1 class left in your plan — renew soon."}
              {quota.status === "expired" && "All your paid classes are used. Renew to book more."}
              {quota.status === "exceeded" && `You've attended ${quota.exceeded} ${quota.exceeded === 1 ? "class" : "classes"} beyond your plan.`}
            </span>
          </div>
        </Settle>) : null}

      {/* ---------- stats tickets ---------- */}
      <Settle delay={0.16}>
        <section aria-label="Your numbers at a glance">
          <StatsTickets items={[
            { label: "Visits this month", value: attendance.loading && !attendance.data ? "…" : stats.thisMonth, sub: "since the 1st" },
            { label: "Visit streak", value: attendance.loading && !attendance.data ? "…" : stats.streak, sub: stats.streak === 1 ? "day in a row" : "days in a row" },
            { label: "Total visits", value: attendance.loading && !attendance.data ? "…" : stats.total, sub: "on record" },
            { label: "Classes left", value: profile.loading && !me ? "…" : !quota || quota.status === "none" ? "—" : quota.status === "exceeded" ? `${quota.exceeded} over` : quota.remaining, sub: !quota || quota.status === "none" ? "no class quota" : `of ${quota.quota} paid` },
        ]}/>
          {attendance.error && !attendance.data ? (<p className="mt-3 text-xs text-muted-foreground">
              Visit stats unavailable — <button type="button" onClick={attendance.reload} className="underline underline-offset-4 hover:text-foreground">retry</button>
            </p>) : null}
        </section>
      </Settle>

      {/* ---------- classes: boarding passes ---------- */}
      <Settle delay={0.24}>
        <section aria-labelledby="classes-heading" className="space-y-3">
          <SectionHeading title={<span id="classes-heading">My classes</span>}/>
          <ClassTickets classes={classes}/>
        </section>
      </Settle>

      {/* ---------- calendar + receipts ---------- */}
      <Settle delay={0.32}>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <section aria-labelledby="calendar-heading" className="space-y-3">
            <SectionHeading title={<span id="calendar-heading">Visit calendar</span>}/>
            {attendance.loading && !attendance.data ? (<Skeleton className="h-96 rounded-xl"/>) : attendance.error && !attendance.data ? (<ErrorState title="Unable to load your visits" message={attendance.error} onRetry={attendance.reload}/>) : (<VisitCalendar records={attendance.data ?? []}/>)}
          </section>

          <section aria-labelledby="payments-heading" className="space-y-3">
            <SectionHeading title={<span id="payments-heading">Recent payments</span>}/>
            <ReceiptStubs payments={payments} linkTo="/portal/payments"/>
          </section>
        </div>
      </Settle>
    </div>);
}
