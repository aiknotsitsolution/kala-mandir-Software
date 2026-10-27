import { useEffect, useState } from "react";
import { CalendarCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/States";
import { useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { cn } from "@/lib/utils";
import { formatDateTime, titleCase } from "@/lib/format";
import { computeVisitStats } from "./paper";
import { Settle, SectionHeading } from "./PaperBits";
import { StatsTickets } from "./StatsTickets";
import { VisitCalendar } from "./VisitCalendar";
/** A visit counts at most 12h so a forgotten check-out cannot skew totals. */
const MAX_VISIT_MS = 12 * 3_600_000;
/** Capped hours spent for one visit (open visits run live). */
function visitSpanMs(record, nowMs) {
    const start = new Date(record.checkIn).getTime();
    const end = record.checkOut ? new Date(record.checkOut).getTime() : nowMs;
    return Math.min(Math.max(0, end - start), MAX_VISIT_MS);
}
function hoursLabel(ms) {
    const hours = ms / 3_600_000;
    return hours >= 1 ? `${Math.round(hours * 10) / 10} h` : `${Math.round(ms / 60_000)} min`;
}
export function MyAttendancePage() {
    const data = useData();
    const attendance = useAsync(() => data.listMyAttendance(50), [data]);
    const rows = attendance.data ?? [];
    const stats = computeVisitStats(rows);
    const hasOpen = rows.some((r) => r.status === "checked_in" && !r.checkOut);
    const [tick, setTick] = useState(() => Date.now());
    useEffect(() => {
        if (!hasOpen)
            return;
        const id = setInterval(() => setTick(Date.now()), 1000);
        return () => clearInterval(id);
    }, [hasOpen]);
    return (<div className="space-y-8">
      <PageHeader title="My attendance" description="Your visits, check-ins and streaks — recorded by the front desk."/>

      <Settle>
        <StatsTickets items={[
            { label: "Total visits", value: attendance.loading && !attendance.data ? "…" : stats.total, sub: "on record" },
            { label: "This month", value: attendance.loading && !attendance.data ? "…" : stats.thisMonth, sub: "since the 1st" },
            { label: "Current streak", value: attendance.loading && !attendance.data ? "…" : stats.streak, sub: stats.streak === 1 ? "day in a row" : "days in a row" },
        ]}/>
      </Settle>

      <Settle delay={0.08}>
        <section aria-label="Visit calendar" className="space-y-3">
          <SectionHeading title="Calendar"/>
          {attendance.loading && !attendance.data ? (<div className="h-96 rounded-xl bg-card"/>)
            : attendance.error && !attendance.data ? (<ErrorState title="Unable to load your visits" message={attendance.error} onRetry={attendance.reload}/>)
                : (<VisitCalendar records={rows} showHistoryLink={false}/>)}
        </section>
      </Settle>

      <Settle delay={0.16}>
        <section aria-labelledby="history-heading" className="space-y-3">
          <SectionHeading title={<span id="history-heading">Full history</span>}/>
          <Card className="graphite-surface gap-0 border-border/70 py-0">
            {attendance.loading && !attendance.data ? (<TableSkeleton rows={6} cols={5}/>) : attendance.error ? (<div className="p-4">
                <ErrorState title="Unable to load your visits" message={attendance.error} onRetry={attendance.reload}/>
              </div>) : rows.length === 0 ? (<div className="p-4">
                <EmptyState icon={<CalendarCheckIcon className="size-5"/>} title="No visits yet" description="Your check-ins will show up here after your first QR scan at the front desk." className="py-8"/>
              </div>) : (<Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead>Hours</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((record) => {
            const open = record.status === "checked_in" && !record.checkOut;
            const ms = visitSpanMs(record, tick);
            return (<TableRow key={record.id}>
                      <TableCell className="text-sm">{formatDateTime(record.checkIn)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.checkOut ? formatDateTime(record.checkOut) : "—"}
                      </TableCell>
                      <TableCell className={cn("text-sm font-medium tabular-nums", open && "text-primary")}>
                        {hoursLabel(ms)}
                        {open ? <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-primary">live</span> : null}
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {titleCase(record.method)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={record.status === "checked_out"
                    ? "border-border bg-muted text-muted-foreground"
                    : "border-primary/30 bg-primary/10 text-primary"}>
                          {record.status === "checked_out" ? "Checked out" : "In studio"}
                        </Badge>
                      </TableCell>
                    </TableRow>);
        })}
                </TableBody>
              </Table>)}
          </Card>
        </section>
      </Settle>
    </div>);
}
