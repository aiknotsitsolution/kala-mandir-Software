import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CalendarCheckIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, DownloadIcon, GaugeIcon, HistoryIcon, Loader2Icon, TriangleAlertIcon, UsersIcon, } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, Skeleton, Stagger, TableSkeleton } from "@/components/shared/States";
import { SmartImage } from "@/components/shared/SmartImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDateTime, formatNumberIN, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ATTENDANCE_STATUS_LABELS, METHOD_LABELS, hourLabel } from "./labels";
/** Rows per page of the register table. */
const PAGE_SIZE = 25;
/** A visit counts at most 12h so a forgotten check-out cannot skew the hours. */
const MAX_VISIT_MS = 12 * 3_600_000;
/** Sweeping the export in 100-row pages keeps huge periods to a few calls. */
const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_PAGES = 10;
const MODES = [
    { value: "day", label: "Day" },
    { value: "month", label: "Month" },
    { value: "year", label: "Year" },
];
const STATUS_OPTIONS = [
    { value: "all", label: "All statuses" },
    { value: "checked_in", label: "Checked in" },
    { value: "checked_out", label: "Checked out" },
];
const STATUS_STYLES = {
    checked_in: "border-primary/30 bg-primary/10 text-primary",
    checked_out: "border-border bg-muted text-muted-foreground",
};
const pad = (value) => String(value).padStart(2, "0");
function ymdOf(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function todayYmd() {
    return ymdOf(new Date());
}
function currentMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}
function currentYear() {
    return String(new Date().getFullYear());
}
/** `2` → `2h 14m 03s`, `0.5` → `0h 30m 00s`. */
function durationLabel(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
}
/** Capped hours spent in the gym for one visit. */
function visitMs(record, nowMs) {
    const start = new Date(record.checkIn).getTime();
    const end = record.checkOut ? new Date(record.checkOut).getTime() : nowMs;
    return Math.min(Math.max(0, end - start), MAX_VISIT_MS);
}
function hoursLabel(ms) {
    const hours = ms / 3_600_000;
    return hours >= 1 ? `${Math.round(hours * 10) / 10} h` : `${Math.round(ms / 60_000)} min`;
}
function SummaryCard({ label, display, hint, icon, }) {
    return (<Card className="graphite-surface border-border/70">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
          <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            {icon}
          </span>
        </div>
        <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">{display}</p>
        {hint ? <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>);
}
function AttendanceBadge({ status }) {
    return (<Badge variant="outline" className={cn("font-medium", STATUS_STYLES[status])}>
      {ATTENDANCE_STATUS_LABELS[status]}
    </Badge>);
}
export function ViewAttendancePage({ hideHeader = false }) {
    const data = useData();
    const [mode, setMode] = useState("day");
    const [day, setDay] = useState(todayYmd);
    const [month, setMonth] = useState(currentMonth);
    const [year, setYear] = useState(currentYear);
    const [status, setStatus] = useState("all");
    const [page, setPage] = useState(1);
    const [exporting, setExporting] = useState(false);
    const [reminded, setReminded] = useState(() => new Set());
    const [reminding, setReminding] = useState(null);
    // Live ticker for open sessions — only runs in the day view.
    const [nowTick, setNowTick] = useState(() => Date.now());
    useEffect(() => {
        if (mode !== "day")
            return;
        const id = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [mode]);
    const range = useMemo(() => {
        if (mode === "day") {
            const [y, m, d] = day.split("-").map(Number);
            const start = new Date(y, m - 1, d);
            return { from: start, to: new Date(start.getTime() + 86_399_999) };
        }
        if (mode === "month") {
            const [y, m] = month.split("-").map(Number);
            return { from: new Date(y, m - 1, 1), to: new Date(y, m, 1, 0, 0, 0, -1) };
        }
        const y = Number(year);
        return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59, 999) };
    }, [mode, day, month, year]);
    const query = useMemo(() => ({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        status,
        page,
        pageSize: PAGE_SIZE,
    }), [range, status, page]);
    const list = useAsync(() => data.listAttendance(query), [data, query]);
    const summary = useAsync(() => data.getAttendanceSummary(range), [data, range]);
    // Members who passed their planned daily hours — the "time up" strip.
    const overtime = useAsync(() => data.getAttendanceOvertime(query.from, query.to), [data, query.from, query.to]);
    // A shrunken result set can leave us stranded past the last page — snap back.
    useEffect(() => {
        if (!list.data)
            return;
        const totalPages = Math.max(1, Math.ceil(list.data.total / list.data.pageSize));
        if (list.data.page > totalPages)
            setPage(totalPages);
    }, [list.data]);
    const items = list.data?.items ?? [];
    const total = list.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const lastRow = Math.min(page * PAGE_SIZE, total);
    const periodLabel = mode === "day"
        ? formatDateTime(range.from).split(",")[0]
        : mode === "month"
            ? range.from.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
            : year;
    const shiftPeriod = (dir) => {
        if (mode === "day") {
            setDay(ymdOf(new Date(range.from.getTime() + dir * 86_400_000)));
        }
        else if (mode === "month") {
            const [y, m] = month.split("-").map(Number);
            const next = new Date(y, m - 1 + dir, 1);
            setMonth(`${next.getFullYear()}-${pad(next.getMonth() + 1)}`);
        }
        else {
            setYear(String(Number(year) + dir));
        }
        setPage(1);
    };
    const handleExport = () => {
        if (exporting)
            return;
        setExporting(true);
        const now = nowTick;
        void (async () => {
            try {
                const collected = [];
                let currentPage = 1;
                let currentTotal = Number.POSITIVE_INFINITY;
                while (collected.length < currentTotal &&
                    currentPage <= MAX_EXPORT_PAGES) {
                    const result = await data.listAttendance({
                        from: query.from,
                        to: query.to,
                        status,
                        page: currentPage,
                        pageSize: EXPORT_PAGE_SIZE,
                    });
                    currentTotal = result.total;
                    collected.push(...result.items);
                    if (result.items.length === 0)
                        break;
                    currentPage += 1;
                }
                if (collected.length === 0) {
                    toast.info("Nothing to export for this period.");
                    return;
                }
                downloadCsv(`attendance-${mode}-${periodLabel.replace(/\s+/g, "-").toLowerCase()}`, toCsv(collected, [
                    { header: "Student", accessor: (row) => row.memberName ?? "" },
                    { header: "Student ID", accessor: (row) => row.memberCode ?? "" },
                    { header: "Plan", accessor: (row) => row.planName ?? "" },
                    { header: "Check-in", accessor: (row) => formatDateTime(row.checkIn) },
                    { header: "Check-out", accessor: (row) => (row.checkOut ? formatDateTime(row.checkOut) : "") },
                    { header: "Hours (capped)", accessor: (row) => (visitMs(row, now) / 3_600_000).toFixed(1) },
                    { header: "Status", accessor: (row) => ATTENDANCE_STATUS_LABELS[row.status] },
                    { header: "Method", accessor: (row) => METHOD_LABELS[row.method] },
                ]));
                toast.success(`Exported ${collected.length} ${collected.length === 1 ? "record" : "records"}`);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to export these attendance records.");
            }
            finally {
                setExporting(false);
            }
        })();
    };
    const timeOf = (value) => (mode === "day" ? formatTime(value) : formatDateTime(value));
    const handleRemind = (row) => {
        if (reminding)
            return;
        setReminding(row.memberId);
        void (async () => {
            try {
                await data.remindCheckout(row.memberId);
                setReminded((prev) => new Set(prev).add(row.memberId));
                toast.success(`Reminder sent to ${row.memberName} — your time is up, please check out.`);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to send the reminder.");
            }
            finally {
                setReminding(null);
            }
        })();
    };
    return (<div className="space-y-6">
      {!hideHeader ? <PageHeader title="View attendance" description="Day, month or year-wise register with time spent per visit (hours capped at 12h)." breadcrumbs={[{ label: "Attendance" }, { label: "View" }]} actions={<Button variant="outline" asChild>
            <Link to="/attendance/history">
              <HistoryIcon className="size-4"/> View full attendance history
            </Link>
          </Button>}/> : null}

      {/* Summary strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.loading ? (Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32"/>)) : summary.error ? (<Card className="border-destructive/30 bg-destructive/5 sm:col-span-2 xl:col-span-4">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <p className="max-w-md text-sm text-muted-foreground">
                Unable to load the summary: {summary.error}
              </p>
              <Button variant="outline" size="sm" onClick={summary.reload}>
                Retry summary
              </Button>
            </CardContent>
          </Card>) : (<>
            <Stagger delayIndex={0}>
              <SummaryCard label="Total visits" display={formatNumberIN(summary.data?.totalVisits ?? 0)} hint={periodLabel} icon={<CalendarCheckIcon className="size-4"/>}/>
            </Stagger>
            <Stagger delayIndex={1}>
              <SummaryCard label="Unique students" display={formatNumberIN(summary.data?.uniqueMembers ?? 0)} hint="Distinct students who visited" icon={<UsersIcon className="size-4"/>}/>
            </Stagger>
            <Stagger delayIndex={2}>
              <SummaryCard label="Studio hours" display={`${formatNumberIN(summary.data?.totalHours ?? 0)} h`} hint="Time spent, capped at 12h per visit" icon={<ClockIcon className="size-4"/>}/>
            </Stagger>
            <Stagger delayIndex={3}>
              <SummaryCard label="Busiest hour" display={hourLabel(summary.data?.busiestHour ?? null)} hint={(summary.data?.busiestHour ?? null) === null
                ? "No check-ins in this period yet"
                : "Peak check-in time"} icon={<GaugeIcon className="size-4"/>}/>
            </Stagger>
          </>)}
      </div>

      {/* Filters */}
      <Card className="graphite-surface gap-0 border-border/70 py-4 sm:py-5">
        <CardContent className="flex flex-col gap-3 px-4 sm:px-5 lg:flex-row lg:items-end">
          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>View by</Label>
              <div className="flex items-center gap-1 rounded-lg border border-border/70 p-1" role="group" aria-label="Attendance view mode">
                {MODES.map((option) => (<Button key={option.value} size="sm" variant={mode === option.value ? "secondary" : "ghost"} className="h-8 flex-1 px-2" aria-pressed={mode === option.value} onClick={() => {
                    setMode(option.value);
                    setPage(1);
                }}>
                    {option.label}
                  </Button>))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="view-period">{mode === "day" ? "Day" : mode === "month" ? "Month" : "Year"}</Label>
              <div className="flex items-center gap-2">
                <Button size="icon-sm" variant="outline" aria-label={`Previous ${mode}`} onClick={() => shiftPeriod(-1)}>
                  <ChevronLeftIcon />
                </Button>
                {mode === "day" ? (<Input id="view-period" type="date" value={day} onChange={(event) => {
                    setDay(event.target.value);
                    setPage(1);
                }}/>) : mode === "month" ? (<Input id="view-period" type="month" value={month} onChange={(event) => {
                    setMonth(event.target.value);
                    setPage(1);
                }}/>) : (<Select value={year} onValueChange={(value) => {
                    setYear(value);
                    setPage(1);
                }}>
                    <SelectTrigger id="view-period" className="w-full" aria-label="Filter by year">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 6 }, (_, index) => String(new Date().getFullYear() - index)).map((option) => (<SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>))}
                    </SelectContent>
                  </Select>)}
                <Button size="icon-sm" variant="outline" aria-label={`Next ${mode}`} onClick={() => shiftPeriod(1)}>
                  <ChevronRightIcon />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(value) => {
            setStatus(value);
            setPage(1);
        }}>
                <SelectTrigger className="w-full" aria-label="Filter by status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (<SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || list.loading}>
              {exporting ? <Loader2Icon className="animate-spin"/> : <DownloadIcon />}
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Overtime — members over their planned daily hours */}
      {overtime.data && overtime.data.length > 0 ? (<Card className="gap-0 border-warning/30 bg-warning/5 py-4 sm:py-5">
          <CardContent className="px-4 sm:px-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <TriangleAlertIcon className="size-4 shrink-0 text-warning"/>
              <p className="text-sm font-semibold">Planned time exceeded</p>
              <p className="text-xs text-muted-foreground">— these students are over their daily hours; send a checkout reminder.</p>
            </div>
            <ul className="space-y-2">
              {overtime.data.map((row) => (<li key={row.memberId} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 bg-card px-3 py-2">
                  <SmartImage src={row.memberPhoto} name={row.memberName} className="size-8 shrink-0"/>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{row.memberName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {row.memberCode} · planned {row.plannedHours}h/day{row.stillInside ? " · still inside" : ""}
                    </p>
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums text-warning">
                    {row.hours}h / {row.plannedHours}h
                  </span>
                  <Button size="sm" variant="outline" disabled={reminded.has(row.memberId) || reminding === row.memberId} onClick={() => handleRemind(row)}>
                    {reminded.has(row.memberId) ? "Reminder sent" : "Send reminder"}
                  </Button>
                </li>))}
            </ul>
          </CardContent>
        </Card>) : null}

      {/* Register table */}
      <Card className="graphite-surface gap-0 border-border/70">
        {list.loading ? (<CardContent>
            <TableSkeleton rows={6} cols={8}/>
          </CardContent>) : list.error ? (<CardContent>
            <ErrorState title="Unable to load attendance" message={list.error} onRetry={list.reload}/>
          </CardContent>) : items.length === 0 ? (<CardContent>
            <EmptyState title={`No attendance for ${periodLabel}`} description="Try another period, or check back after the first scan."/>
          </CardContent>) : (<>
            <div className="overflow-x-auto px-2 sm:px-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead>Status</TableHead>
                    {mode === "day" ? <TableHead>Timer</TableHead> : null}
                    <TableHead>Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((record, index) => {
            const open = record.status === "checked_in" && !record.checkOut;
            const ms = visitMs(record, nowTick);
            return (<TableRow key={record.id}>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">
                        {(page - 1) * PAGE_SIZE + index + 1}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <SmartImage src={record.memberPhoto} name={record.memberName ?? "Student"} className="size-8 shrink-0"/>
                          <div className="min-w-0">
                            <Link to={`/members/${record.memberId}`} className="block truncate text-sm font-medium text-foreground hover:underline">
                              {record.memberName ?? "Student"}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">
                              {record.memberCode ?? "—"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.planName ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm tabular-nums">{timeOf(record.checkIn)}</TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {record.checkOut ? timeOf(record.checkOut) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-sm font-medium tabular-nums", open && "text-primary")}>
                        {hoursLabel(ms)}
                        {open ? <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-primary">live</span> : null}
                      </TableCell>
                      <TableCell>
                        <AttendanceBadge status={record.status}/>
                      </TableCell>
                      {mode === "day" ? (<TableCell className="text-sm tabular-nums text-muted-foreground">
                          {open ? durationLabel(ms) : "—"}
                        </TableCell>) : null}
                      <TableCell className="text-sm text-muted-foreground">
                        {METHOD_LABELS[record.method]}
                      </TableCell>
                    </TableRow>);
        })}
                </TableBody>
              </Table>
            </div>

            <div className="mt-0 flex flex-col gap-3 border-t px-3 py-3 sm:flex-row sm:items-center sm:justify-center sm:px-5">
              <p className="text-xs text-muted-foreground">
                Showing {firstRow}–{lastRow} of {formatNumberIN(total)}{" "}
                {total === 1 ? "visit" : "visits"}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1 || list.loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  <ChevronLeftIcon /> Previous
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {Math.min(page, totalPages)} of {totalPages}
                </span>
                <Button size="sm" variant="outline" disabled={page >= totalPages || list.loading} onClick={() => setPage((value) => value + 1)}>
                  Next <ChevronRightIcon />
                </Button>
              </div>
            </div>
          </>)}
      </Card>
    </div>);
}
