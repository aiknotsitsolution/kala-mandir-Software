import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, } from "recharts";
import { ActivityIcon, CalendarCheckIcon, ClockIcon, DownloadIcon, IndianRupeeIcon, RefreshCwIcon, UsersIcon, } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, Skeleton, Stagger } from "@/components/shared/States";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { CARD_BASE, CardArrow, CountUp, GoldCorner } from "../dashboard/DashboardCards";
import { useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { addDays, endOfDayInTz, startOfDayInTz, ymdInTz } from "@/lib/datetime";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatINR, formatNumberIN } from "@/lib/format";
import { cn } from "@/lib/utils";
const CHART_COLORS = [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
];
const RANGE_OPTIONS = [7, 30, 90];
function hourLabel(hour) {
    const display = hour % 12 === 0 ? 12 : hour % 12;
    return `${display} ${hour < 12 ? "AM" : "PM"}`;
}
function ChartTooltipCard({ active, payload, label, isCurrency, }) {
    if (!active || !payload || payload.length === 0)
        return null;
    return (<div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((entry, index) => (<p key={index} className="text-muted-foreground">
          {entry.name}:{" "}
          <span className="font-medium text-foreground">
            {isCurrency ? formatINR(Number(entry.value)) : Number(entry.value).toLocaleString("en-IN")}
          </span>
        </p>))}
    </div>);
}
/**
 * Reports stat card — same compact look as the dashboard Metric/Financial
 * cards (circular accent icon, eyebrow label, animated value, gold corner).
 * `to` makes the whole card a router link (like the dashboard cards).
 */
const TONE_ACCENTS = {
    success: { bg: "var(--km-gold)", fg: "var(--km-burgundy)" },
    warning: { bg: "var(--warning)", fg: "#FFF7EA" },
    danger: { bg: "var(--destructive)", fg: "#FFF3F1" },
    default: { bg: "var(--km-burgundy)", fg: "var(--km-ivory)" },
};
function StatCard({ label, value, icon, hint, tone = "default", format, to, }) {
    const accent = TONE_ACCENTS[tone] ?? TONE_ACCENTS.default;
    const amountColor = tone === "success"
        ? "var(--primary)"
        : tone === "warning"
            ? "var(--warning)"
            : tone === "danger"
                ? "var(--destructive)"
                : "var(--primary)";
    const base = CARD_BASE + " min-h-[96px] p-3 sm:min-h-[112px] sm:p-4";
    const body = (<>
      <GoldCorner/>
      {to ? <CardArrow/> : null}
      <div className="relative flex items-center gap-2 sm:gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full sm:size-10" style={{ backgroundColor: accent.bg, color: accent.fg }} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{label}</p>
          <p className="mt-1 truncate text-[20px] leading-none font-semibold sm:text-[26px]" style={{ color: amountColor }}>
            <CountUp value={value} format={format}/>
          </p>
        </div>
      </div>
      {hint ? <p className="relative mt-2 hidden text-[11.5px] leading-snug text-muted-foreground sm:mt-2.5 sm:block">{hint}</p> : null}
    </>);
    if (!to)
        return <div className={base}>{body}</div>;
    return <Link to={to} className={base + " cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60"}>{body}</Link>;
}
function SectionError({ message, onRetry }) {
    return (<div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon className="size-4"/> Retry
      </Button>
    </div>);
}
export function ReportsPage() {
    const data = useData();
    const [days, setDays] = useState(30);
    const range = useMemo(() => ({
        from: startOfDayInTz(addDays(new Date(), -(days - 1))),
        to: endOfDayInTz(new Date()),
    }), [days]);
    const summary = useAsync(() => data.getAttendanceSummary({ from: range.from, to: range.to }), [data, range]);
    const peakHours = useAsync(() => data.getPeakHours({ from: range.from, to: range.to }), [data, range]);
    const trend = useAsync(() => data.getAttendanceTrend(days), [data, days]);
    const topMembers = useAsync(() => data.getMemberFrequencies({ from: range.from, to: range.to }, 10), [data, range]);
    const revenue = useAsync(() => data.getRevenueSummary(6), [data]);
    const planMix = useAsync(() => data.getPlanDistribution(), [data]);
    const exportPeakHours = () => {
        const rows = peakHours.data ?? [];
        if (rows.length === 0)
            return;
        downloadCsv(`peak-hours-${days}d`, toCsv(rows, [
            { header: "Hour", accessor: (row) => row.label },
            { header: "Check-ins", accessor: (row) => row.count },
        ]));
    };
    const exportTopMembers = () => {
        const rows = topMembers.data ?? [];
        if (rows.length === 0)
            return;
        downloadCsv(`top-members-${days}d`, toCsv(rows.map((row, index) => ({ ...row, rank: index + 1 })), [
            { header: "Rank", accessor: (row) => row.rank },
            { header: "Student", accessor: (row) => row.memberName },
            { header: "Student ID", accessor: (row) => row.memberCode },
            { header: "Visits", accessor: (row) => row.visits },
        ]));
    };
    const busiestHour = summary.data?.busiestHour;
    const peakRows = peakHours.data ?? [];
    const revenueRows = revenue.data ?? [];
    const planRows = (planMix.data ?? []).filter((row) => row.count > 0);
    const trendTotal = (trend.data ?? []).reduce((total, day) => total + day.count, 0);
    const revenueTotal = revenueRows.reduce((total, row) => total + row.collected + row.outstanding, 0);
    return (<div className="space-y-6">
      <PageHeader title="Reports & analytics" description="Attendance, peak hours, revenue and plan performance in one place." actions={<div className="flex items-center gap-1 rounded-lg border border-border/70 bg-card/60 p-1">
            {RANGE_OPTIONS.map((option) => (<button key={option} type="button" onClick={() => setDays(option)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium transition-colors", days === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground")}>
                {option} days
              </button>))}
          </div>}/>

      {/* Headline numbers — 2-up on mobile, 4-up on desktop; each card links out */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {summary.loading ? (Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28"/>)) : summary.error ? (<div className="col-span-2 xl:col-span-4">
            <ErrorState title="Unable to load the attendance summary" message={summary.error} onRetry={summary.reload}/>
          </div>) : (() => {
            const rangeYmd = `?from=${ymdInTz(range.from)}&to=${ymdInTz(range.to)}`;
            const historyLink = `/attendance/history${rangeYmd}`;
            return (<>
            <Stagger delayIndex={0}>
              <StatCard label="Total visits" value={summary.data?.totalVisits ?? 0} icon={<CalendarCheckIcon className="size-4"/>} hint={`Last ${days} days`} to={historyLink}/>
            </Stagger>
            <Stagger delayIndex={1}>
              <StatCard label="Unique students" value={summary.data?.uniqueMembers ?? 0} icon={<UsersIcon className="size-4"/>} hint="Distinct students who checked in" tone="success" to="/members?status=active"/>
            </Stagger>
            <Stagger delayIndex={2}>
              <StatCard label="Average per day" value={summary.data?.averagePerDay ?? 0} format={(n) => n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} icon={<ActivityIcon className="size-4"/>} hint="Check-ins per calendar day" to={historyLink}/>
            </Stagger>
            <Stagger delayIndex={3}>
              <StatCard label="Busiest hour" value={busiestHour ?? 0} format={busiestHour === null || busiestHour === undefined ? () => "—" : hourLabel} icon={<ClockIcon className="size-4"/>} hint={busiestHour === null || busiestHour === undefined
                ? "No check-ins recorded yet"
                : "Busiest check-in hour"} tone="warning" to={historyLink}/>
            </Stagger>
          </>);
        })()}
      </div>

      {/* Peak hours + Top students */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="graphite-surface border-border/70 lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Peak hours</CardTitle>
              <p className="text-xs text-muted-foreground">
                Check-ins by hour, last {days} days
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={exportPeakHours} disabled={peakRows.length === 0}>
              <DownloadIcon className="size-4"/> CSV
            </Button>
          </CardHeader>
          <CardContent className="h-72 pb-4">
            {peakHours.loading ? (<Skeleton className="size-full"/>) : peakHours.error ? (<SectionError message={peakHours.error} onRetry={peakHours.reload}/>) : peakRows.some((row) => row.count > 0) ? (<ResponsiveContainer width="100%" height="100%">
                <BarChart data={peakRows} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval={1}/>
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40}/>
                  <Tooltip content={<ChartTooltipCard />} cursor={{ fill: "var(--accent)" }}/>
                  <Bar dataKey="count" name="Check-ins" fill="var(--chart-2)" radius={[4, 4, 0, 0]} maxBarSize={22}/>
                </BarChart>
              </ResponsiveContainer>) : (<EmptyState title="No check-ins in this range" description="Try a longer range or check in a student to populate this chart." className="h-full py-6"/>)}
          </CardContent>
        </Card>

        <Card className="graphite-surface border-border/70">
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Top students</CardTitle>
              <p className="text-xs text-muted-foreground">Most frequent visitors</p>
            </div>
            <Button size="sm" variant="outline" onClick={exportTopMembers} disabled={(topMembers.data ?? []).length === 0}>
              <DownloadIcon className="size-4"/> CSV
            </Button>
          </CardHeader>
          <CardContent>
            {topMembers.loading ? (<div className="space-y-2">
                {Array.from({ length: 6 }).map((_, index) => (<Skeleton key={index} className="h-10"/>))}
              </div>) : topMembers.error ? (<SectionError message={topMembers.error} onRetry={topMembers.reload}/>) : (topMembers.data ?? []).length === 0 ? (<EmptyState title="No visits yet" description="Students with check-ins in this range will be ranked here." className="py-8"/>) : (<ol className="space-y-2">
                {(topMembers.data ?? []).map((member, index) => (<li key={member.memberId} className="flex items-center gap-3">
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", index === 0
                    ? "bg-primary/15 text-primary"
                    : "bg-secondary text-muted-foreground")}>
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{member.memberName}</p>
                      <p className="truncate text-xs text-muted-foreground">{member.memberCode}</p>
                    </div>
                    <span className="text-sm font-semibold tabular">
                      {formatNumberIN(member.visits)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {member.visits === 1 ? "visit" : "visits"}
                      </span>
                    </span>
                  </li>))}
              </ol>)}
          </CardContent>
        </Card>
      </div>

      {/* Attendance trend + plan mix */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="graphite-surface border-border/70 lg:col-span-2">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Attendance trend</CardTitle>
            <p className="text-xs text-muted-foreground">Daily check-ins, last {days} days</p>
          </CardHeader>
          <CardContent className="h-72 pb-4">
            {trend.loading ? (<Skeleton className="size-full"/>) : trend.error ? (<SectionError message={trend.error} onRetry={trend.reload}/>) : trendTotal > 0 ? (<ResponsiveContainer width="100%" height="100%">
                <AreaChart data={(trend.data ?? [])} margin={{ top: 6, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="reportAttendanceFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35}/>
                      <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.02}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                  <XAxis dataKey="date" tickFormatter={(value) => value.slice(5)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} minTickGap={18}/>
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40}/>
                  <Tooltip content={<ChartTooltipCard />} cursor={{ stroke: "var(--border)" }}/>
                  <Area type="monotone" dataKey="count" name="Check-ins" stroke="var(--chart-1)" strokeWidth={2} fill="url(#reportAttendanceFill)"/>
                </AreaChart>
              </ResponsiveContainer>) : (<EmptyState title="No attendance in this range" description="Check-ins will be plotted here once students start scanning in." className="h-full py-6"/>)}
          </CardContent>
        </Card>

        <Card className="graphite-surface border-border/70">
          <CardHeader className="space-y-1">
            <CardTitle className="text-base">Plan mix</CardTitle>
            <p className="text-xs text-muted-foreground">Active memberships by plan</p>
          </CardHeader>
          <CardContent className="h-72 pb-4">
            {planMix.loading ? (<Skeleton className="size-full"/>) : planMix.error ? (<SectionError message={planMix.error} onRetry={planMix.reload}/>) : planRows.length > 0 ? (<>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={planRows} dataKey="count" nameKey="planName" innerRadius={44} outerRadius={70} paddingAngle={3} stroke="none">
                        {planRows.map((row, index) => (<Cell key={row.planId} fill={CHART_COLORS[index % CHART_COLORS.length]}/>))}
                      </Pie>
                      <Tooltip content={<ChartTooltipCard />}/>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {planRows.slice(0, 5).map((row, index) => (<li key={row.planId} className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }}/>
                      {row.planName} · {row.count}
                    </li>))}
                </ul>
              </>) : (<EmptyState title="No active memberships" description="Assign plans to students to see the mix." className="h-full py-6"/>)}
          </CardContent>
        </Card>
      </div>

      {/* Revenue */}
      <Card className="graphite-surface border-border/70">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Revenue</CardTitle>
            <p className="text-xs text-muted-foreground">Collected vs outstanding, last 6 months</p>
          </div>
          <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
            <IndianRupeeIcon className="size-4"/>
            {formatINR(revenueRows.reduce((total, row) => total + row.collected, 0))}
          </span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="h-64">
            {revenue.loading ? (<Skeleton className="size-full"/>) : revenue.error ? (<SectionError message={revenue.error} onRetry={revenue.reload}/>) : revenueTotal > 0 ? (<ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenue.data ?? []} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false}/>
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false}/>
                  <YAxis tickFormatter={(value) => `${Math.round(value / 1000)}k`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={44}/>
                  <Tooltip content={<ChartTooltipCard isCurrency/>} cursor={{ fill: "var(--accent)" }}/>
                  <Bar dataKey="collected" name="Collected" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={30}/>
                  <Bar dataKey="outstanding" name="Outstanding" fill="var(--chart-4)" radius={[4, 4, 0, 0]} maxBarSize={30}/>
                </BarChart>
              </ResponsiveContainer>) : (<EmptyState title="No revenue in the last 6 months" description="Recorded payments will show up here." className="h-full py-6"/>)}
          </div>

          {revenue.loading ? (<div className="space-y-2">
              {Array.from({ length: 3 }).map((_, index) => (<Skeleton key={index} className="h-9"/>))}
            </div>) : (revenue.data ?? []).length > 0 ? (<div className="overflow-x-auto rounded-lg border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead className="text-right">Payments</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(revenue.data ?? []).map((row) => (<TableRow key={row.month}>
                      <TableCell className="font-medium">{row.label}</TableCell>
                      <TableCell className="text-right tabular">{formatINR(row.collected)}</TableCell>
                      <TableCell className={cn("text-right tabular", row.outstanding > 0 && "text-warning")}>
                        {formatINR(row.outstanding)}
                      </TableCell>
                      <TableCell className="text-right tabular">{formatNumberIN(row.count)}</TableCell>
                    </TableRow>))}
                </TableBody>
              </Table>
            </div>) : null}

          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: "var(--chart-1)" }}/>
              Collected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: "var(--chart-4)" }}/>
              Outstanding
            </span>
          </div>
        </CardContent>
      </Card>
    </div>);
}
