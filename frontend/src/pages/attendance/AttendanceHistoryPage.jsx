import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ActivityIcon, CalendarCheckIcon, CheckCircle2Icon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, Loader2Icon, LogOutIcon, PencilIcon, SearchIcon, } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { subscribeLiveNotification } from "@/lib/liveBus";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/States";
import { SmartImage } from "@/components/shared/SmartImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync, useDebounced } from "@/hooks";
import { downloadCsv, toCsv } from "@/lib/csv";
import { addDays, ymdInTz } from "@/lib/datetime";
import { formatDateTime, formatNumberIN } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { AttendanceCorrectionDialog } from "./AttendanceCorrectionDialog";
import { ATTENDANCE_STATUS_LABELS, METHOD_LABELS } from "./labels";
/** Rows per page of the history table. */
const PAGE_SIZE = 15;
/** Default window shown when the panel opens. */
const DEFAULT_RANGE_DAYS = 7;
/** API page-size limit; use it to sweep the export in fewest calls. */
const EXPORT_PAGE_SIZE = 100;
const STATUS_STYLES = {
    checked_in: "border-primary/30 bg-primary/10 text-primary",
    checked_out: "border-border bg-muted text-muted-foreground",
};
const STATUS_OPTIONS = [
    { value: "all", label: "All statuses" },
    { value: "checked_in", label: "Checked in" },
    { value: "checked_out", label: "Checked out" },
];
function defaultFrom() {
    return ymdInTz(addDays(new Date(), -(DEFAULT_RANGE_DAYS - 1)));
}
function defaultTo() {
    return ymdInTz(new Date());
}
function matchesSearch(record, query) {
    const normalized = query.trim().toLocaleLowerCase();
    return !normalized || `${record.memberName ?? ""} ${record.memberId ?? ""}`.toLocaleLowerCase().includes(normalized);
}
function AttendanceBadge({ status }) {
    return (<Badge variant="outline" className={cn("font-medium", STATUS_STYLES[status])}>
      {ATTENDANCE_STATUS_LABELS[status]}
    </Badge>);
}
/**
 * The history register as a drop-in panel: filters, export, table + pagination.
 * Used inside the /attendance page "Attendance history" tab; reads ?from/?to
 * so the dashboard's date deep-links still land pre-filtered.
 */
export function AttendanceHistoryContent() {
    const data = useData();
    const { session } = useAuth();
    const canCorrect = can(session?.profile.role, "attendance.correct");
    const [searchParams] = useSearchParams();
    // Deep link: /attendance?tab=history&from=YYYY-MM-DD&to=YYYY-MM-DD (dashboard stat card).
    const [from, setFrom] = useState(() => {
        const preset = searchParams.get("from");
        return preset && /^\d{4}-\d{2}-\d{2}$/.test(preset) ? preset : defaultFrom();
    });
    const [to, setTo] = useState(() => {
        const preset = searchParams.get("to");
        return preset && /^\d{4}-\d{2}-\d{2}$/.test(preset) ? preset : defaultTo();
    });
    const [status, setStatus] = useState("all");
    const [page, setPage] = useState(1);
    const [search, setSearch] = useState("");
    const [editing, setEditing] = useState(null);
    const [exporting, setExporting] = useState(false);
    const debouncedSearch = useDebounced(search, 300);
    const searchSettled = search.trim() === debouncedSearch.trim();
    const rangeValid = from.length > 0 && to.length > 0 && from <= to;
    const query = useMemo(() => ({ from, to, status, page, pageSize: PAGE_SIZE, search: debouncedSearch.trim() }), [from, to, status, page, debouncedSearch]);
    const list = useAsync(() => data.listAttendance(query), [data, query], {
        enabled: rangeValid,
        pollingInterval: 60_000,
        skipPollingIfUnfocused: true,
    });
    /* Live refresh — a fresh studio QR check-in appears in history without a
       manual refresh (throttled bursts make it one reload, not five). */
    const lastLiveReloadRef = useRef(0);
    useEffect(() => subscribeLiveNotification(() => {
        const now = Date.now();
        if (now - lastLiveReloadRef.current < 2500)
            return;
        lastLiveReloadRef.current = now;
        list.reload();
    }), [list.reload]);
    // A shrunken result set can leave us stranded past the last page — snap back.
    useEffect(() => {
        if (!list.data)
            return;
        const totalPages = Math.max(1, Math.ceil(list.data.total / list.data.pageSize));
        if (list.data.page > totalPages)
            setPage(totalPages);
    }, [list.data]);
    const resetFilters = () => {
        setFrom(defaultFrom());
        setTo(defaultTo());
        setStatus("all");
        setSearch("");
        setPage(1);
    };
    const items = list.data?.items ?? [];
    const total = list.data?.total ?? 0;
    const analytics = list.data?.analytics;
    const summary = analytics?.summary;
    const trend = analytics?.trend ?? [];
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const firstRow = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const lastRow = Math.min(page * PAGE_SIZE, total);
    const loading = list.loading || !searchSettled;
    const error = list.error;
    const handleExport = () => {
        if (exporting || !rangeValid)
            return;
        setExporting(true);
        void (async () => {
            try {
                const collected = [];
                let currentPage = 1;
                let currentTotal = Number.POSITIVE_INFINITY;
                while (collected.length < currentTotal) {
                    const result = await data.listAttendance({
                        from,
                        to,
                        status,
                        search: debouncedSearch.trim() || undefined,
                        page: currentPage,
                        pageSize: EXPORT_PAGE_SIZE,
                    });
                    currentTotal = result.total;
                    collected.push(...result.items);
                    if (result.items.length === 0)
                        break;
                    currentPage += 1;
                }
                const matchingRecords = collected.filter((record) => matchesSearch(record, debouncedSearch));
                if (matchingRecords.length === 0) {
                    toast.info("Nothing to export for these filters.");
                    return;
                }
                const searchSuffix = search.trim()
                    ? `-search-${search.trim().replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "")}`
                    : "";
                downloadCsv(`attendance-${from}-to-${to}${status === "all" ? "" : `-${status}`}${searchSuffix}`, toCsv(matchingRecords, [
                    { header: "Student", accessor: (row) => row.memberName ?? "" },
                    { header: "MongoDB ID", accessor: (row) => row.memberId ?? "" },
                    { header: "Slot", accessor: (row) => row.meta?.slotName ?? "" },
                    { header: "Check-in", accessor: (row) => formatDateTime(row.checkIn) },
                    {
                        header: "Check-out",
                        accessor: (row) => (row.checkOut ? formatDateTime(row.checkOut) : ""),
                    },
                    { header: "Status", accessor: (row) => ATTENDANCE_STATUS_LABELS[row.status] },
                    { header: "Method", accessor: (row) => METHOD_LABELS[row.method] },
                    { header: "Scanner", accessor: (row) => row.scannerName ?? "" },
                    { header: "Notes", accessor: (row) => row.notes ?? "" },
                ]));
                toast.success(`Exported ${matchingRecords.length} ${matchingRecords.length === 1 ? "record" : "records"}`);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to export these attendance records.");
            }
            finally {
                setExporting(false);
            }
        })();
    };
    return (<div className="space-y-4">
      {/* Filters */}
      <Card className="graphite-surface gap-0 border-border/70 py-4 sm:py-5">
        <CardContent className="flex flex-col gap-3 px-4 sm:px-5 lg:flex-row lg:items-end">
          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="history-from">From</Label>
              <Input id="history-from" type="date" value={from} max={to || undefined} onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
        }}/>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="history-to">To</Label>
              <Input id="history-to" type="date" value={to} min={from || undefined} onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
        }}/>
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
            <div className="space-y-1.5">
              <Label htmlFor="history-search">Search student</Label>
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
                <Input
                  id="history-search"
                  aria-label="Search student"
                  placeholder="Name or student ID"
                  maxLength={100}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  className="pl-8"
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Reset
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !rangeValid || loading}>
              {exporting ? <Loader2Icon className="animate-spin"/> : <DownloadIcon />}
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section aria-label="Attendance overview" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {[
              { label: "Total visits", value: summary?.totalVisits, hint: "Matching your filters", icon: <ActivityIcon />, tone: "text-primary" },
              { label: "Checked in", value: summary?.checkedIn, hint: "Currently in the studio", icon: <CheckCircle2Icon />, tone: "text-emerald-500" },
              { label: "Checked out", value: summary?.checkedOut, hint: "Completed visits", icon: <LogOutIcon />, tone: "text-sky-500" },
          ].map((stat) => (
            <Card key={stat.label} className="graphite-surface gap-0 overflow-hidden border-border/70 py-0 transition-colors hover:border-primary/30">
              <CardContent className="flex items-center justify-between gap-4 p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  {loading ? <Skeleton className="mt-2 h-8 w-20" /> : <p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{formatNumberIN(stat.value ?? 0)}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">{stat.hint}</p>
                </div>
                <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted/70", stat.tone)}>
                  {stat.icon}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="graphite-surface gap-0 border-border/70">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="text-base">Attendance trend</CardTitle>
              <p className="text-xs text-muted-foreground">Daily visits for the selected filters</p>
            </div>
            <span className="rounded-lg bg-primary/10 p-2 text-primary"><CalendarCheckIcon className="size-4" /></span>
          </CardHeader>
          <CardContent className="h-64 pb-4 sm:h-72">
            {loading ? <Skeleton className="size-full" /> : error ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Trend is unavailable while attendance is loading.</div>
            ) : trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="attendanceHistoryFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} minTickGap={18} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "0.75rem", color: "var(--foreground)" }} labelStyle={{ color: "var(--muted-foreground)" }} />
                  <Area type="monotone" dataKey="visits" name="Visits" stroke="var(--chart-1)" strokeWidth={2} fill="url(#attendanceHistoryFill)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground"><ActivityIcon className="size-5" /></span>
                <p className="text-sm font-medium">No attendance to chart</p>
                <p className="text-xs text-muted-foreground">Try a wider date range or different filters.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Records */}
      <Card className="graphite-surface gap-0 border-border/70">
        <CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/70 px-4 py-4 sm:px-5">
          <div className="space-y-1">
            <CardTitle className="text-base">Attendance records</CardTitle>
            <p className="text-xs text-muted-foreground">Search, review, and export visit details</p>
          </div>
          <Badge variant="secondary" className="shrink-0 tabular-nums">{formatNumberIN(total)} {total === 1 ? "visit" : "visits"}</Badge>
        </CardHeader>
        {loading ? (<CardContent>
            <TableSkeleton rows={6} cols={9}/>
          </CardContent>) : !rangeValid ? (<CardContent>
            <EmptyState title="Check the date range" description="The start date has to be on or before the end date."/>
          </CardContent>) : error ? (<CardContent>
            <ErrorState title="Unable to load attendance" message={error} onRetry={list.reload}/>
          </CardContent>) : items.length === 0 ? (<CardContent>
            <EmptyState title={debouncedSearch ? "No matching attendance" : "No attendance in this range"} description={debouncedSearch ? "Try another student name or ID." : "Try a wider date range, or check back after the first scan of the day."} action={<Button size="sm" variant="outline" onClick={resetFilters}>
                  Reset filters
                </Button>}/>
          </CardContent>) : (<>
            <div className="px-2 sm:px-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Slot</TableHead>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Scanner</TableHead>
                    <TableHead>Notes</TableHead>
                    {canCorrect ? <TableHead className="text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((record) => (<TableRow key={record.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <SmartImage src={record.memberPhoto} name={record.memberName ?? "Student"} className="size-8 shrink-0"/>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">
                              {record.memberName ?? "Student"}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                              {record.memberId ?? "—"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.meta?.slotName
                          ? (<span className="block max-w-32 truncate text-sm" title={record.meta.slotName}>
                              {record.meta.slotName}
                            </span>)
                          : (<span className="text-sm text-muted-foreground">—</span>)}
                      </TableCell>
                      <TableCell className="text-sm">{formatDateTime(record.checkIn)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.checkOut ? formatDateTime(record.checkOut) : "—"}
                      </TableCell>
                      <TableCell>
                        <AttendanceBadge status={record.status}/>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {METHOD_LABELS[record.method]}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.scannerName ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-48">
                        {record.notes ? (<span className="block truncate text-sm text-muted-foreground" title={record.notes}>
                            {record.notes}
                          </span>) : (<span className="text-sm text-muted-foreground">—</span>)}
                      </TableCell>
                      {canCorrect ? (<TableCell className="text-right">
                          <Button size="icon-xs" variant="ghost" aria-label={`Correct attendance for ${record.memberName ?? "member"}`} onClick={() => setEditing(record)}>
                            <PencilIcon />
                          </Button>
                        </TableCell>) : null}
                    </TableRow>))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-0 flex flex-col gap-3 border-t px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p className="text-xs text-muted-foreground">
                Showing {firstRow}–{lastRow} of {formatNumberIN(total)}{" "}
                {total === 1 ? "visit" : "visits"}
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  <ChevronLeftIcon /> Previous
                </Button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Page {Math.min(page, totalPages)} of {totalPages}
                </span>
                <Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>
                  Next <ChevronRightIcon />
                </Button>
              </div>
            </div>
          </>)}
      </Card>

      <AttendanceCorrectionDialog record={editing} open={editing !== null} onOpenChange={(open) => {
            if (!open)
                setEditing(null);
        }} onSaved={() => {
            list.reload();
        }}/>
    </div>);
}
