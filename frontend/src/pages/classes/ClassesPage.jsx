import { useMemo, useState } from "react";
import { toast } from "sonner";
import { addDays, addMonths, addWeeks, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { CalendarDaysIcon, CalendarRangeIcon, ChevronLeftIcon, ChevronRightIcon, PencilIcon, PlusIcon, Settings2Icon, XCircleIcon, } from "lucide-react";
import { EmptyState, ErrorState, Skeleton, Stagger } from "@/components/shared/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { endOfDayInTz, startOfDayInTz, ymdInTz } from "@/lib/datetime";
import { formatTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ClassFormDialog } from "./ClassFormDialog";
import { ClassSlotsSection } from "./ClassSlotsSection";
import { ConfirmDialog } from "./ConfirmDialog";
import { ManageEnrollmentsDialog } from "./ManageEnrollmentsDialog";
import { MonthCalendar } from "./MonthCalendar";
import { WeekTimetable } from "./WeekTimetable";

/** Status → label, legend dot and chip tones (ongoing = scheduled + in progress). */
const CLASS_STATUS = {
    scheduled: { label: "Scheduled", dot: "bg-success", chip: "border-success/30 bg-success/10 text-success" },
    ongoing: { label: "Ongoing", dot: "bg-info", chip: "border-info/30 bg-info/10 text-info" },
    completed: { label: "Completed", dot: "bg-km-gold-muted", chip: "border-km-gold/40 bg-km-gold/15 text-km-gold-muted" },
    cancelled: { label: "Cancelled", dot: "bg-destructive", chip: "border-destructive/30 bg-destructive/10 text-destructive" },
};
const VIEW_OPTIONS = ["day", "week", "month"];
const ALL = "__all__";

/** A scheduled class currently inside its start→end window reads as "ongoing". */
function displayStatus(gymClass) {
    if (gymClass.status !== "scheduled")
        return gymClass.status;
    const start = new Date(gymClass.startsAt).getTime();
    const end = start + (gymClass.durationMinutes ?? 60) * 60_000;
    const now = Date.now();
    return now >= start && now < end ? "ongoing" : "scheduled";
}

function ClassCard({ gymClass, canManage, onEdit, onEnrolments, onCancel, }) {
    const enrolled = gymClass.enrolledCount ?? 0;
    const percent = gymClass.capacity > 0 ? Math.min(100, Math.round((enrolled / gymClass.capacity) * 100)) : 0;
    const full = enrolled >= gymClass.capacity;
    const isCancelled = gymClass.status === "cancelled";
    const status = CLASS_STATUS[gymClass.displayStatus] ?? CLASS_STATUS.scheduled;
    return (<Card className={cn("graphite-surface border-border/70", isCancelled && "opacity-60")}>
      <CardContent className="space-y-2.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold tabular">
            {formatTime(gymClass.startsAt)}
            <span className="text-xs font-normal text-muted-foreground">
              {gymClass.durationMinutes} min
            </span>
          </span>
          <Badge variant="outline" className={status.chip}>
            {status.label}
          </Badge>
        </div>

        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{gymClass.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {gymClass.trainerName ?? "No trainer assigned"}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              {enrolled}/{gymClass.capacity} enrolled
            </span>
            <span className={full ? "font-medium text-warning" : undefined}>
              {full ? "Full" : `${percent}%`}
            </span>
          </div>
          <Progress value={percent} className="h-1.5"/>
        </div>

        {canManage && !isCancelled ? (<div className="flex items-center gap-1 border-t border-border/60 pt-2">
            <Button size="xs" variant="ghost" onClick={() => onEnrolments(gymClass)}>
              <Settings2Icon /> Enrolments
            </Button>
            <span className="ml-auto flex items-center">
              <Button size="icon-xs" variant="ghost" aria-label={`Edit ${gymClass.name}`} onClick={() => onEdit(gymClass)}>
                <PencilIcon />
              </Button>
              <Button size="icon-xs" variant="ghost" aria-label={`Cancel ${gymClass.name}`} onClick={() => onCancel(gymClass)}>
                <XCircleIcon />
              </Button>
            </span>
          </div>) : null}
      </CardContent>
    </Card>);
}

/** One day's classes as a card list (Day view). */
function DayAgenda({ day, items, canManage, onEdit, onEnrolments, onCancel, }) {
    return (<div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">{format(day, "EEEE")}</p>
          <p className="text-sm text-muted-foreground">{format(day, "d MMMM yyyy")}</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? "class" : "classes"}
        </span>
      </div>
      {items.length === 0 ? (<div className="rounded-lg border border-dashed border-border/70 px-3 py-10 text-center text-sm text-muted-foreground">
          Nothing scheduled for this day.
        </div>) : (<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((gymClass, index) => (<Stagger key={gymClass.id} delayIndex={index}>
              <ClassCard gymClass={gymClass} canManage={canManage} onEdit={onEdit} onEnrolments={onEnrolments} onCancel={onCancel}/>
            </Stagger>))}
        </div>)}
    </div>);
}

export function ClassesPage() {
    const data = useData();
    const { session } = useAuth();
    const canManage = can(session?.profile.role, "classes.manage");

    /* Focus + granularity (both mirrored between the toolbar select and the
       "View by" segmented control, exactly like the design). */
    const [view, setView] = useState("week");
    const [anchor, setAnchor] = useState(() => new Date());
    const [filters, setFilters] = useState({ className: ALL, instructor: ALL });

    /* Dialogs */
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [managing, setManaging] = useState(null);
    const [cancelling, setCancelling] = useState(null);

    /* Schedule / Class Slots tabs — only one section is mounted at a time. */
    const [activeTab, setActiveTab] = useState("schedule");

    /* ------------------------------ range ------------------------------- */
    const range = useMemo(() => {
        if (view === "day") {
            return {
                from: startOfDayInTz(anchor),
                to: endOfDayInTz(anchor),
                label: format(anchor, "d MMMM yyyy"),
                title: format(anchor, "EEEE, d MMMM yyyy"),
            };
        }
        if (view === "month") {
            const start = startOfMonth(anchor);
            const end = endOfMonth(anchor);
            return {
                from: startOfDayInTz(start),
                to: endOfDayInTz(end),
                label: format(anchor, "MMMM yyyy"),
                title: format(anchor, "MMMM yyyy"),
            };
        }
        const start = startOfWeek(anchor, { weekStartsOn: 1 });
        const end = endOfWeek(anchor, { weekStartsOn: 1 });
        return {
            from: startOfDayInTz(start),
            to: endOfDayInTz(end),
            label: `${format(start, "d MMM")} – ${format(end, "d MMM yyyy")}`,
            title: `Week of ${format(start, "d MMM yyyy")}`,
        };
    }, [view, anchor]);

    const classes = useAsync(() => data.listClasses(range.from, range.to), [data, range.from, range.to]);

    /* Filter options come from whatever the schedule currently holds. */
    const items = useMemo(() => (classes.data ?? []).map((gymClass) => ({ ...gymClass, displayStatus: displayStatus(gymClass) })), [classes.data]);
    const classOptions = useMemo(() => [...new Set(items.map((gymClass) => gymClass.name))].sort(), [items]);
    const instructorOptions = useMemo(() => [...new Set(items.map((gymClass) => gymClass.trainerName).filter(Boolean))].sort(), [items]);
    const filtered = useMemo(() => items.filter((gymClass) => (filters.className === ALL || gymClass.name === filters.className) &&
        (filters.instructor === ALL || (gymClass.trainerName ?? "No trainer") === filters.instructor)), [items, filters]);

    /* Days of the visible grid */
    const days = useMemo(() => {
        if (view === "day")
            return [anchor];
        const start = view === "month"
            ? startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
            : startOfWeek(anchor, { weekStartsOn: 1 });
        const count = view === "month"
            ? Math.round(((endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }).getTime() - start.getTime()) / 86_400_000) + 1)
            : 7;
        return Array.from({ length: count }, (_, index) => addDays(start, index));
    }, [view, anchor]);

    const byDay = useMemo(() => {
        const map = new Map();
        for (const day of days)
            map.set(ymdInTz(day), []);
        for (const gymClass of filtered) {
            const bucket = map.get(ymdInTz(new Date(gymClass.startsAt)));
            if (bucket)
                bucket.push(gymClass);
        }
        return map;
    }, [days, filtered]);

    /* ------------------------------ actions ------------------------------ */
    const step = (direction) => setAnchor((current) => view === "day"
        ? addDays(current, direction)
        : view === "month"
            ? addMonths(current, direction)
            : addWeeks(current, direction));
    const openCreate = () => {
        setEditing(null);
        setFormOpen(true);
    };
    const openEdit = (gymClass) => {
        setEditing(gymClass);
        setFormOpen(true);
    };
    const handleSave = async (input) => {
        try {
            if (editing) {
                await data.updateClass(editing.id, input);
                toast.success("Class updated");
            }
            else {
                await data.createClass(input);
                toast.success(`${input.name} scheduled`);
            }
            classes.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save the class.");
            return false;
        }
    };
    const handleCancelClass = async () => {
        if (!cancelling)
            return false;
        try {
            await data.cancelClass(cancelling.id);
            toast.success(`${cancelling.name} cancelled`);
            classes.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to cancel this class.");
            return false;
        }
    };

    const total = filtered.length;
    const tabButton = (key, label, Icon) => (<button key={key} type="button" onClick={() => setActiveTab(key)} aria-pressed={activeTab === key} className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors", activeTab === key
        ? "border-primary bg-primary text-primary-foreground"
        : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground")}>
      <Icon className="size-4"/> {label}
    </button>);

    return (<div className="space-y-5">
      {/* ------------------------------ Page banner ------------------------------ */}
      <header className="relative flex overflow-hidden rounded-2xl burgundy-surface">
        <div className="flex flex-1 items-center gap-4 px-5 py-5 sm:px-6">
          <span className="gold-halo flex size-12 shrink-0 items-center justify-center rounded-xl border border-km-gold/40 bg-km-gold/12 text-km-gold">
            <CalendarDaysIcon className="size-6"/>
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight text-km-ivory">Classes &amp; Schedule</h1>
            <p className="mt-0.5 max-w-xl text-sm text-km-ivory/70">
              View class schedule, manage class slots and track instructor assignments — all in one place.
            </p>
          </div>
        </div>
        {/* Studio artwork + quote (supplied banner image) */}
        <div className="relative hidden shrink-0 lg:block" aria-hidden="true">
          <img src="/images/image-nextpage.png" alt="" className="h-full w-auto max-w-[540px] object-cover"/>
          <span className="pointer-events-none absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-km-burgundy via-km-burgundy/60 to-transparent"/>
        </div>
      </header>

      {/* ------------------------------ Toolbar ------------------------------ */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5">
        {/* Section tabs — both sections live on this page */}
        <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1" role="group" aria-label="Page sections">
          {tabButton("schedule", "Schedule", CalendarDaysIcon)}
          {tabButton("slots", "Class Slots", CalendarRangeIcon)}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Range navigator */}
          <div className="flex items-center gap-0.5 rounded-lg border border-border/70 bg-card px-1 py-1">
            <Button size="icon-sm" variant="ghost" aria-label="Previous period" onClick={() => step(-1)}>
              <ChevronLeftIcon/>
            </Button>
            <button type="button" onClick={() => setAnchor(new Date())} title="Jump to today" className="flex items-center gap-1.5 rounded-md px-1.5 text-sm font-medium tabular transition-colors hover:bg-secondary">
              <CalendarDaysIcon className="size-4 text-muted-foreground"/>
              {range.label}
            </button>
            <Button size="icon-sm" variant="ghost" aria-label="Next period" onClick={() => step(1)}>
              <ChevronRightIcon/>
            </Button>
          </div>

          {/* Granularity */}
          <Select value={view} onValueChange={(value) => {
                if (VIEW_OPTIONS.includes(value))
                    setView(value);
            }}>
            <SelectTrigger className="w-28" aria-label="Schedule granularity">
              <SelectValue/>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Day</SelectItem>
              <SelectItem value="week">Week</SelectItem>
              <SelectItem value="month">Month</SelectItem>
            </SelectContent>
          </Select>

          {canManage ? (<Button onClick={openCreate}>
              <PlusIcon className="size-4"/> Add Class
            </Button>) : null}
        </div>
      </div>

      {/* ------------------------------ Schedule ------------------------------ */}
      {activeTab === "schedule" ? (<section id="schedule" aria-label="Class schedule" className="rounded-xl border border-border/70 bg-card/60 p-4">
        <div className="grid gap-4 lg:grid-cols-[224px_minmax(0,1fr)]">
          {/* Filters rail */}
          <aside className="space-y-4 lg:border-r lg:border-border/60 lg:pr-4">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">View by</p>
              <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/40 p-1" role="group" aria-label="View by">
                {VIEW_OPTIONS.map((option) => (<button key={option} type="button" onClick={() => setView(option)} aria-pressed={view === option} className={cn("h-8 flex-1 rounded-md text-sm font-medium capitalize transition-colors", view === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
                    {option}
                  </button>))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Filters</p>
              <Select value={filters.className} onValueChange={(value) => setFilters((f) => ({ ...f, className: value }))}>
                <SelectTrigger className="w-full" aria-label="Filter by class">
                  <SelectValue placeholder="All Classes"/>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Classes</SelectItem>
                  {classOptions.map((name) => (<SelectItem key={name} value={name}>{name}</SelectItem>))}
                </SelectContent>
              </Select>
              <Select value={filters.instructor} onValueChange={(value) => setFilters((f) => ({ ...f, instructor: value }))}>
                <SelectTrigger className="w-full" aria-label="Filter by instructor">
                  <SelectValue placeholder="All Instructors"/>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All Instructors</SelectItem>
                  {instructorOptions.map((name) => (<SelectItem key={name} value={name}>{name}</SelectItem>))}
                  {items.some((gymClass) => !gymClass.trainerName) ? (<SelectItem value="No trainer">No trainer</SelectItem>) : null}
                </SelectContent>
              </Select>
            </div>

            {/* Status legend */}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
              <ul className="space-y-1.5">
                {Object.entries(CLASS_STATUS).map(([key, status]) => (<li key={key} className="flex items-center gap-2 text-sm">
                    <span className={cn("size-2.5 shrink-0 rounded-full", status.dot)}/>
                    <span className="text-foreground">{status.label}</span>
                  </li>))}
              </ul>
            </div>
          </aside>

          {/* Grid / agenda */}
          <div className="min-w-0">
            {classes.loading ? (view === "week" ? (<div className="space-y-2">
                  <Skeleton className="h-12 w-full"/>
                  <Skeleton className="h-[480px] w-full"/>
                </div>) : view === "month" ? (<Skeleton className="h-[480px] w-full"/>) : (<Skeleton className="h-[360px] w-full"/>)) : classes.error ? (<ErrorState title="Unable to load the schedule" message={classes.error} onRetry={classes.reload}/>) : total === 0 ? (<EmptyState icon={<CalendarDaysIcon className="size-5"/>} title={view === "month" ? "Nothing scheduled this month" : view === "day" ? "Nothing scheduled this day" : "Nothing scheduled this week"} description={canManage
                ? "Jump to another period or schedule a new class to fill the calendar."
                : "No classes are scheduled for this period yet."} action={canManage ? (<Button size="sm" onClick={openCreate}>
                  <PlusIcon className="size-4"/> Add Class
                </Button>) : undefined}/>) : view === "week" ? (<WeekTimetable days={days} byDay={byDay} canManage={canManage} onEdit={openEdit} onEnrolments={setManaging} onCancel={setCancelling}/>) : view === "month" ? (<MonthCalendar monthAnchor={anchor} items={filtered} onSelectDay={(day) => {
                    setAnchor(day);
                    setView("day");
                }}/>) : (<DayAgenda day={anchor} items={filtered} canManage={canManage} onEdit={openEdit} onEnrolments={setManaging} onCancel={setCancelling}/>)}
          </div>
        </div>
      </section>) : null}

      {/* ------------------------------ Class Slots ------------------------------ */}
      {activeTab === "slots" ? (<ClassSlotsSection/>) : null}

      {/* ------------------------------ Dialogs ------------------------------ */}
      <ClassFormDialog open={formOpen} onOpenChange={setFormOpen} gymClass={editing} onSave={handleSave}/>
      <ManageEnrollmentsDialog gymClass={managing} open={managing !== null} onOpenChange={(open) => {
            if (!open)
                setManaging(null);
        }} canManage={canManage} onChanged={classes.reload}/>
      <ConfirmDialog open={cancelling !== null} onOpenChange={(open) => {
            if (!open)
                setCancelling(null);
        }} title={`Cancel ${cancelling?.name ?? "class"}?`} description="The class will be marked as cancelled and every active enrolment will be released. This cannot be undone from here." confirmLabel="Cancel class" onConfirm={handleCancelClass}/>
    </div>);
}
