import { useMemo } from "react";
import { format, isSameDay } from "date-fns";
import { PencilIcon, Settings2Icon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ymdInTz } from "@/lib/datetime";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const HOUR_PX = 56;
/** Left-edge accent per display status (ongoing = scheduled + in progress). */
const STATUS_ACCENT = {
    scheduled: "bg-success",
    ongoing: "bg-info",
    completed: "bg-km-gold-muted",
    cancelled: "bg-destructive",
};

function hourLabel(hour) {
    const h = hour % 12 || 12;
    return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

/** Split overlapping classes into side-by-side lanes within a day column. */
function layoutDay(list) {
    const sorted = [...list].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
    const placed = [];
    let lane = [];
    let laneEnd = null;
    const flush = () => {
        const cols = lane.length || 1;
        lane.forEach((gymClass, index) => placed.push({ gymClass, col: index, cols }));
        lane = [];
    };
    for (const gymClass of sorted) {
        const start = new Date(gymClass.startsAt).getTime();
        const end = start + (gymClass.durationMinutes ?? 60) * 60_000;
        if (lane.length > 0 && start >= laneEnd) {
            flush();
            laneEnd = null;
        }
        lane.push(gymClass);
        laneEnd = Math.max(laneEnd ?? 0, end);
    }
    if (lane.length > 0)
        flush();
    return placed;
}

function ClassBlock({ gymClass, col, cols, top, height, canManage, onEdit, onEnrolments, onCancel, }) {
    const enrolled = gymClass.enrolledCount ?? 0;
    const capacity = gymClass.capacity ?? 0;
    const percent = capacity > 0 ? Math.min(100, Math.round((enrolled / capacity) * 100)) : 0;
    const full = capacity > 0 && enrolled >= capacity;
    const cancelled = gymClass.status === "cancelled";
    return (<div className={cn("group absolute overflow-hidden rounded-md border border-border/70 graphite-surface transition-colors hover:border-primary/50", cancelled && "opacity-60")} style={{ top, height, left: `calc(${(col / cols) * 100}% + 3px)`, width: `calc(${100 / cols}% - 6px)` }}>
      <span aria-hidden className={cn("absolute left-0 top-0 h-full w-1", STATUS_ACCENT[gymClass.displayStatus] ?? STATUS_ACCENT.scheduled)}/>
      <div className="h-full px-2.5 py-1.5">
        <p className="flex items-baseline gap-1.5 text-[11px] tabular text-muted-foreground">
          <span className="font-semibold text-foreground">{formatTime(gymClass.startsAt)}</span>
          <span>{gymClass.durationMinutes ?? 60}m</span>
        </p>
        <p className="truncate text-xs font-medium">{gymClass.name}</p>
        {height >= 64 ? (<p className="truncate text-[10px] text-muted-foreground">{gymClass.trainerName ?? "No trainer"}</p>) : null}
        {height >= 88 && !cancelled ? (<div className="mt-1 space-y-0.5">
            <p className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{enrolled}/{capacity}</span>
              <span className={full ? "font-medium text-warning" : undefined}>{full ? "Full" : `${percent}%`}</span>
            </p>
            <Progress value={percent} className="h-1"/>
          </div>) : null}
      </div>
      {canManage && !cancelled ? (<div className="absolute right-1 top-1 flex items-center gap-0.5 rounded-md border border-border/70 bg-background/95 p-0.5 opacity-0 shadow-sm transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button size="icon-xs" variant="ghost" aria-label={`Enrolments for ${gymClass.name}`} onClick={() => onEnrolments(gymClass)}>
            <Settings2Icon/>
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label={`Edit ${gymClass.name}`} onClick={() => onEdit(gymClass)}>
            <PencilIcon/>
          </Button>
          <Button size="icon-xs" variant="ghost" aria-label={`Cancel ${gymClass.name}`} onClick={() => onCancel(gymClass)}>
            <XCircleIcon/>
          </Button>
        </div>) : null}
    </div>);
}

/**
 * Week timetable: a real time-axis grid (hour rows × day columns) with every
 * class placed at its actual time — like a gym noticeboard timetable. The
 * bounds flex to the day's earliest/latest class (clamped to 0–24h), and a
 * volt line marks "now" on today's column.
 */
export function WeekTimetable({ days, byDay, canManage, onEdit, onEnrolments, onCancel, }) {
    const bounds = useMemo(() => {
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        for (const list of byDay.values()) {
            for (const gymClass of list) {
                const start = new Date(gymClass.startsAt);
                const startH = start.getHours() + start.getMinutes() / 60;
                const endH = startH + (gymClass.durationMinutes ?? 60) / 60;
                min = Math.min(min, startH);
                max = Math.max(max, endH);
            }
        }
        if (!Number.isFinite(min)) {
            min = 6;
            max = 21;
        }
        return {
            startHour: Math.max(0, Math.floor(min) - 1),
            endHour: Math.min(24, Math.ceil(max) + 1),
        };
    }, [byDay]);
    const hours = useMemo(() => Array.from({ length: bounds.endHour - bounds.startHour }, (_, index) => bounds.startHour + index), [bounds]);
    const gridHeight = hours.length * HOUR_PX;
    const now = new Date();
    const nowTop = (now.getHours() + now.getMinutes() / 60 - bounds.startHour) * HOUR_PX;
    return (<div className="overflow-x-auto pb-2">
      <div className="min-w-[1080px]">
        {/* Day headers */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] rounded-t-lg border border-b-0 border-border/70 bg-card/60">
          <div className="border-r border-border/70"/>
          {days.map((day) => {
                const key = ymdInTz(day);
                const isToday = isSameDay(day, now);
                const count = (byDay.get(key) ?? []).length;
                return (<div key={key} className={cn("flex items-center justify-between gap-1 border-r border-border/60 px-2 py-2 last:border-r-0", isToday && "bg-primary/10")}>
                <div className="min-w-0">
                  <p className={cn("text-[11px] font-semibold uppercase tracking-wide", isToday ? "text-primary" : "text-muted-foreground")}>
                    {format(day, "EEE")}
                  </p>
                  <p className={cn("text-xs", isToday ? "text-foreground" : "text-muted-foreground")}>{format(day, "d MMM")}</p>
                </div>
                <span className={cn("flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-medium", isToday ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                  {count}
                </span>
              </div>);
            })}
        </div>

        {/* Grid: hour rows × day columns */}
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] rounded-b-lg border border-border/70 bg-card/30" style={{ height: gridHeight }}>
          {/* Time gutter */}
          <div className="relative border-r border-border/70 bg-card/60">
            {hours.map((hour, index) => (<div key={hour} className={cn("absolute inset-x-0 pr-2 text-right text-[10px] tabular text-muted-foreground", index > 0 && "-translate-y-1/2")} style={{ top: (hour - bounds.startHour) * HOUR_PX + (index === 0 ? 4 : 0) }}>
                {hourLabel(hour)}
              </div>))}
          </div>

          {days.map((day) => {
                const key = ymdInTz(day);
                const list = byDay.get(key) ?? [];
                const isToday = isSameDay(day, now);
                return (<div key={key} className={cn("relative border-r border-border/60 last:border-r-0", isToday && "bg-primary/[0.03]")}>
                {hours.map((hour) => (<div key={hour} className="absolute inset-x-0 border-t border-border/40" style={{ top: (hour - bounds.startHour) * HOUR_PX }}/>))}
                {isToday && nowTop >= 0 && nowTop <= gridHeight ? (<div aria-hidden className="absolute inset-x-0 z-10 border-t-2 border-primary/70" style={{ top: nowTop }}>
                    <span className="absolute -top-[5px] -left-[3px] size-2 rounded-full bg-primary"/>
                  </div>) : null}
                {layoutDay(list).map(({ gymClass, col, cols }) => {
                        const start = new Date(gymClass.startsAt);
                        const startH = start.getHours() + start.getMinutes() / 60;
                        const top = Math.max(0, Math.min(gridHeight - 22, (startH - bounds.startHour) * HOUR_PX));
                        const height = Math.max(24, (gymClass.durationMinutes ?? 60) * (HOUR_PX / 60) - 3);
                        return (<ClassBlock key={gymClass.id} gymClass={gymClass} col={col} cols={cols} top={top} height={height} canManage={canManage} onEdit={onEdit} onEnrolments={onEnrolments} onCancel={onCancel}/>);
                    })}
              </div>);
            })}
        </div>
      </div>
    </div>);
}
