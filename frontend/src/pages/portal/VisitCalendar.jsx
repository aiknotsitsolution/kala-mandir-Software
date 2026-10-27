import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { parseDateOnly } from "@/lib/datetime";
import { formatDate, formatTime, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { computeVisitStats, monthGrid, monthLabel, weeklyVisitBuckets } from "./paper";

const WEEKDAY_HEAD = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Attendance snapshot on paper: a mini month calendar with volt visit stamps,
 * a small "visits per week" bar strip, and the last five visits.
 */
export function VisitCalendar({ records, showHistoryLink = true }) {
    const rows = useMemo(() => (Array.isArray(records) ? records : []), [records]);
    const stats = useMemo(() => computeVisitStats(rows), [rows]);
    const [offset, setOffset] = useState(0);
    const anchor = useMemo(() => {
        const base = parseDateOnly(stats.today);
        return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1));
    }, [stats.today, offset]);
    const cells = useMemo(() => monthGrid(anchor, stats.daySet), [anchor, stats.daySet]);
    const buckets = useMemo(() => weeklyVisitBuckets(rows, 6), [rows]);
    const maxBucket = Math.max(1, ...buckets.map((bucket) => bucket.count));
    const lastFive = rows.slice(0, 5);

    return (<div className="pp-stack paper-surface rounded-xl p-4 sm:p-5">
      {/* month nav */}
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-serif text-lg leading-none">{monthLabel(anchor)}</h3>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setOffset((value) => value - 1)} aria-label="Previous month" className="rounded-md border border-paper-edge p-1 text-paper-foreground/70 transition-colors hover:bg-paper-2">
            <ChevronLeftIcon className="size-4"/>
          </button>
          <button type="button" onClick={() => setOffset(0)} disabled={offset === 0} className={cn("rounded-md border border-paper-edge px-2 py-1 text-[10px] font-semibold tracking-wide uppercase", offset === 0 ? "cursor-default opacity-40" : "hover:bg-paper-2")}>
            Today
          </button>
          <button type="button" onClick={() => setOffset((value) => Math.min(0, value + 1))} disabled={offset === 0} aria-label="Next month" className={cn("rounded-md border border-paper-edge p-1", offset === 0 ? "cursor-default opacity-40" : "text-paper-foreground/70 hover:bg-paper-2")}>
            <ChevronRightIcon className="size-4"/>
          </button>
        </div>
      </div>

      {/* grid */}
      <div className="grid grid-cols-7 gap-1 text-center" role="grid" aria-label="Visit days this month">
        {WEEKDAY_HEAD.map((day, index) => (<span key={`${day}-${index}`} aria-hidden="true" className="pb-1 text-[10px] font-semibold text-paper-foreground/45 uppercase">
            {day}
          </span>))}
        {cells.map((cell, index) => cell ? (<span key={cell.ymd} title={cell.visited ? "Visited" : undefined} className={cn("relative mx-auto flex size-7 items-center justify-center rounded-full font-mono text-[11px]", cell.visited && "bg-primary font-bold text-primary-foreground", !cell.visited && "text-paper-foreground/70", cell.ymd === stats.today && !cell.visited && "ring-1 ring-paper-foreground/40 ring-inset")}>
            {cell.day}
            {cell.ymd === stats.today ? (<span aria-hidden="true" className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[#a3601f]"/>) : null}
          </span>) : (<span key={`blank-${index}`}/>))}
      </div>

      <p className="mt-2 font-mono text-[10px] text-paper-foreground/55">
        ● visited · {stats.thisMonth} visit{stats.thisMonth === 1 ? "" : "s"} this month ·{" "}
        {stats.streak} day streak
      </p>

      {/* visits per week strip */}
      <div className="pp-perf-h mt-4 pt-4">
        <p className="mb-2 text-[10px] tracking-[0.2em] text-paper-foreground/60 uppercase">
          Visits per week — last 6 weeks
        </p>
        <div className="flex items-end gap-2" role="img" aria-label={buckets.map((bucket) => `${bucket.label}: ${bucket.count}`).join(", ")}>
          {buckets.map((bucket) => (<div key={bucket.key} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[9px] text-paper-foreground/70">{bucket.count || ""}</span>
              <div className="w-full max-w-[16px] rounded-t-[3px] bg-primary" style={{ height: `${Math.round(6 + 38 * (bucket.count / maxBucket))}px`, opacity: bucket.count ? 1 : 0.25 }}/>
              <span className="font-mono text-[9px] text-paper-foreground/50">{bucket.label}</span>
            </div>))}
        </div>
      </div>

      {/* last visits */}
      <div className="pp-perf-h mt-4 pt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[10px] tracking-[0.2em] text-paper-foreground/60 uppercase">Last visits</p>
          {showHistoryLink ? (<Link to="/portal/attendance" className="inline-flex items-center gap-1 text-xs font-medium text-paper-foreground/80 underline-offset-4 hover:underline">
              View full history <ArrowRightIcon className="size-3"/>
            </Link>) : null}
        </div>
        {lastFive.length === 0 ? (<p className="py-3 text-center text-sm text-paper-foreground/60">
            No visits yet — your check-ins will appear here.
          </p>) : (<ul className="divide-y divide-dashed divide-paper-edge/70">
            {lastFive.map((record) => (<li key={record.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="font-medium">{formatDate(record.checkIn)}</span>
                <span className="flex items-center gap-2 text-xs text-paper-foreground/70">
                  <span className="font-mono">{formatTime(record.checkIn)}</span>
                  <span className="rounded border border-dashed border-paper-edge px-1.5 py-0.5 text-[10px] tracking-wide uppercase">
                    {titleCase(record.method)}
                  </span>
                  {record.checkOut ? null : (<span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary-foreground uppercase">
                      In studio
                    </span>)}
                </span>
              </li>))}
          </ul>)}
      </div>
    </div>);
}
