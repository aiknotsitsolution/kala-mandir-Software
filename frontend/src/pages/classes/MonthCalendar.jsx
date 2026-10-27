import { useMemo } from "react";
import { addDays, endOfMonth, endOfWeek, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from "date-fns";
import { ymdInTz } from "@/lib/datetime";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Status → small chip tone used inside month cells. */
const CHIP_TONE = {
    scheduled: "border-success/30 bg-success/10 text-success",
    ongoing: "border-info/30 bg-info/10 text-info",
    completed: "border-km-gold/40 bg-km-gold/15 text-km-gold-muted",
    cancelled: "border-destructive/30 bg-destructive/10 text-destructive",
};
const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Compact month grid — every class shown as a chip inside its day cell.
 * Clicking a day drills into the Day view for that date.
 */
export function MonthCalendar({ monthAnchor, items, onSelectDay, }) {
    const days = useMemo(() => {
        const first = startOfWeek(startOfMonth(monthAnchor), { weekStartsOn: 1 });
        const last = endOfWeek(endOfMonth(monthAnchor), { weekStartsOn: 1 });
        const list = [];
        for (let day = first; day <= last; day = addDays(day, 1))
            list.push(day);
        return list;
    }, [monthAnchor]);
    const byDay = useMemo(() => {
        const map = new Map();
        for (const day of days)
            map.set(ymdInTz(day), []);
        for (const gymClass of items) {
            const bucket = map.get(ymdInTz(new Date(gymClass.startsAt)));
            if (bucket)
                bucket.push(gymClass);
        }
        return map;
    }, [days, items]);
    const today = new Date();
    return (<div className="overflow-x-auto pb-1">
      <div className="min-w-[720px]">
        <div className="grid grid-cols-7 rounded-t-lg border border-b-0 border-border/70 bg-card/60">
          {WEEKDAY_HEADERS.map((label) => (<div key={label} className="border-r border-border/60 px-2 py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground last:border-r-0">
              {label}
            </div>))}
        </div>
        <div className="grid grid-cols-7 overflow-hidden rounded-b-lg border border-border/70">
          {days.map((day) => {
            const key = ymdInTz(day);
            const list = byDay.get(key) ?? [];
            const inMonth = isSameMonth(day, monthAnchor);
            const isToday = isSameDay(day, today);
            return (<button key={key} type="button" onClick={() => onSelectDay(day)} aria-label={`Open ${format(day, "d MMMM yyyy")} in day view`} className={cn("min-h-24 space-y-1 border-r border-t border-border/50 p-1.5 text-left align-top transition-colors first:border-t-0 [&:nth-child(7n+1)]:border-r-0 [&:nth-child(-n+7)]:border-t-0", inMonth ? "bg-card/60 hover:bg-secondary/60" : "bg-muted/30 hover:bg-muted/50")}>
                <span className={cn("inline-flex size-6 items-center justify-center rounded-full text-xs font-medium tabular", isToday ? "bg-primary text-primary-foreground" : inMonth ? "text-foreground" : "text-muted-foreground")}>
                  {format(day, "d")}
                </span>
                <span className="block space-y-1">
                  {list.slice(0, 3).map((gymClass) => (<span key={gymClass.id} className={cn("block truncate rounded border px-1 py-0.5 text-[10px] font-medium", CHIP_TONE[gymClass.displayStatus] ?? CHIP_TONE.scheduled, gymClass.displayStatus === "cancelled" && "line-through")}>
                      {formatTime(gymClass.startsAt)} · {gymClass.name}
                    </span>))}
                  {list.length > 3 ? (<span className="block text-[10px] font-medium text-muted-foreground">+{list.length - 3} more</span>) : null}
                </span>
              </button>);
        })}
        </div>
      </div>
    </div>);
}
