import { useMemo, useState } from "react";
import { CalendarClockIcon, TimerIcon, UserRoundIcon } from "lucide-react";
import { Skeleton, ErrorState } from "@/components/shared/States";
import { formatTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Stamp } from "./PaperBits";

const ENROLLMENT_BADGES = {
    enrolled: "border-[#3f7d51]/40 bg-[#3f7d51]/10 text-[#3f7d51]",
    attended: "border-primary/40 bg-primary/15 text-paper-foreground",
    no_show: "border-[#a33d2a]/40 bg-[#a33d2a]/10 text-[#a33d2a]",
};

const ENROLLMENT_LABELS = {
    enrolled: "Enrolled",
    attended: "Attended",
    no_show: "Missed",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayOf(iso) {
    const date = new Date(iso);
    return WEEKDAYS[date.getDay()] ?? "";
}

/** One boarding-pass ticket for an enrolled class. */
function ClassTicket({ item, index }) {
    const cls = item?.class ?? {};
    const enrollment = item?.enrollment ?? {};
    const start = cls.startsAt ? new Date(cls.startsAt) : null;
    const cancelled = cls.status === "cancelled";
    const enrolledCount = Number(cls.enrolledCount ?? 0);
    const capacity = Number(cls.capacity ?? 0);
    const fill = capacity > 0 ? Math.min(100, Math.round((enrolledCount / capacity) * 100)) : 0;
    return (<li className={cn("pp-stack-sm relative", cancelled && "opacity-70")} style={{ rotate: index % 2 === 0 ? "-0.7deg" : "0.6deg" }}>
      <div className="paper-surface flex overflow-hidden rounded-xl">
        {/* left stub */}
        <div className="pp-dotted relative flex w-16 shrink-0 flex-col items-center justify-center gap-1 py-4 text-center sm:w-20">
          <span className="font-serif text-2xl leading-none">{start ? start.getDate() : "—"}</span>
          <span className="font-mono text-[10px] tracking-[0.2em] text-paper-foreground/70 uppercase">
            {start ? start.toLocaleString("en", { month: "short" }) : ""}
          </span>
          <span aria-hidden="true" className="pp-vertical mt-1 text-[9px] font-semibold text-paper-foreground/45">
            KALAMANDIR
          </span>
        </div>

        {/* body */}
        <div className="pp-perf-v relative min-w-0 flex-1 px-4 py-4">
          <span aria-hidden="true" className="pp-notch pp-notch-top"/>
          <span aria-hidden="true" className="pp-notch pp-notch-bottom"/>

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight">
                {cls.name ?? "Class"}
              </h3>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-paper-foreground/70">
                <UserRoundIcon className="size-3.5 shrink-0"/> {cls.trainerName ?? "Trainer TBC"}
              </p>
            </div>
            {cancelled ? (<Stamp label="Cancelled" tone="bad" className="shrink-0 text-[10px]"/>) : (<span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase", ENROLLMENT_BADGES[enrollment.status] ?? ENROLLMENT_BADGES.enrolled)}>
                {ENROLLMENT_LABELS[enrollment.status] ?? titleCase(enrollment.status ?? "enrolled")}
              </span>)}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-paper-foreground/80">
            <span className="inline-flex items-center gap-1">
              <CalendarClockIcon className="size-3.5"/> {weekdayOf(cls.startsAt)} · {formatTime(cls.startsAt)}
            </span>
            <span className="inline-flex items-center gap-1">
              <TimerIcon className="size-3.5"/> {cls.durationMinutes ?? 60} min
            </span>
          </div>

          {!cancelled && capacity > 0 ? (<div className="mt-2.5 flex items-center gap-2">
              <div className="h-1.5 w-24 overflow-hidden rounded-full bg-paper-2">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(6, fill)}%` }}/>
              </div>
              <span className="font-mono text-[10px] text-paper-foreground/60">
                {enrolledCount}/{capacity} booked
              </span>
            </div>) : null}
        </div>
      </div>
    </li>);
}

/**
 * My classes as boarding-pass tickets — upcoming first, then a short list of
 * earlier / cancelled enrollments behind a toggle.
 */
export function ClassTickets({ classes }) {
    const items = useMemo(() => (Array.isArray(classes.data) ? classes.data : []), [classes.data]);
    const [showPast, setShowPast] = useState(false);
    const { upcoming, past } = useMemo(() => {
        const now = Date.now();
        const up = [];
        const old = [];
        for (const item of items) {
            const start = item?.class?.startsAt ? new Date(item.class.startsAt).getTime() : 0;
            const scheduled = item?.class?.status === "scheduled";
            if (scheduled && start >= now)
                up.push(item);
            else
                old.push(item);
        }
        up.sort((a, b) => new Date(a.class?.startsAt ?? 0) - new Date(b.class?.startsAt ?? 0));
        old.sort((a, b) => new Date(b.class?.startsAt ?? 0) - new Date(a.class?.startsAt ?? 0));
        return { upcoming: up, past: old };
    }, [items]);

    if (classes.loading && !classes.data) {
        return (<ul className="space-y-4">
        {[0, 1].map((index) => (<li key={index} className="rounded-xl">
            <Skeleton className="h-24 rounded-xl bg-card"/>
          </li>))}
      </ul>);
    }
    if (classes.error && !classes.data) {
        return <ErrorState title="Unable to load your classes" message={classes.error} onRetry={classes.reload}/>;
    }
    if (items.length === 0) {
        return (<div className="pp-note paper-surface mx-auto max-w-md rotate-[-1deg] px-6 py-8 text-center">
            <p className="font-serif text-lg">No classes yet</p>
            <p className="mt-1 text-sm text-paper-foreground/70">
              Ask the front desk to enroll you in a session — it will show up here as a boarding pass.
            </p>
          </div>);
    }
    return (<div className="space-y-4">
      {upcoming.length === 0 ? (<div className="pp-note paper-surface rotate-[0.8deg] px-5 py-4 text-center">
          <p className="font-serif text-base">No upcoming sessions</p>
          <p className="mt-0.5 text-xs text-paper-foreground/70">
            You’re all caught up — ask the front desk to book your next class.
          </p>
        </div>) : null}
      <ul className="space-y-4">
        {upcoming.map((item, index) => (<ClassTicket key={item?.enrollment?.id ?? item?.class?.id} item={item} index={index}/>))}
      </ul>

      {past.length > 0 ? (<div className="space-y-3">
          <button type="button" onClick={() => setShowPast((value) => !value)} aria-expanded={showPast} className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
            {showPast ? "Hide" : "Show"} earlier &amp; cancelled classes ({past.length})
          </button>
          {showPast ? (<ul className="space-y-4">
              {past.map((item, index) => (<ClassTicket key={item?.enrollment?.id ?? item?.class?.id} item={item} index={index}/>))}
            </ul>) : null}
        </div>) : null}
    </div>);
}
