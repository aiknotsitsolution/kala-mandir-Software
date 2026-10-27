import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { AlertTriangleIcon, CalendarCheckIcon, CheckIcon, Loader2Icon, ScanLineIcon, } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useData } from "@/auth/AuthProvider";
import { useAsync, useSubmitGuard } from "@/hooks";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A quota readout chip ("2 classes left" / "Expired" / "1 class exceeded"). */
function QuotaChip({ quota }) {
    if (!quota || quota.status === "none")
        return null;
    if (quota.status === "warning")
        return (<Badge className="border-warning/40 bg-warning/15 text-foreground tabular-nums">{quota.label}</Badge>);
    if (["critical", "expired", "exceeded"].includes(quota.status))
        return (<Badge variant="destructive" className="tabular-nums">{quota.label}</Badge>);
    return (<Badge variant="secondary" className="tabular-nums">{quota.label}</Badge>);
}
export function MarkAttendancePage({ hideHeader = false }) {
    const data = useData();
    const slots = useAsync(() => data.listClassSlots(), [data]);
    const activeSlots = useMemo(() => (slots.data ?? []).filter((s) => s.isActive), [slots.data]);

    const [slotId, setSlotId] = useState("");
    const [date, setDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
    const [code, setCode] = useState("");
    const [lastResult, setLastResult] = useState(null);
    const [markingId, setMarkingId] = useState(null);

    // Default to the first active slot once slots load.
    useEffect(() => {
        if (!slotId && activeSlots.length > 0)
            setSlotId(activeSlots[0].id);
    }, [activeSlots, slotId]);

    const roster = useAsync(() => (slotId ? data.getClassRoster(slotId, date) : Promise.resolve(null)), [data, slotId, date], { enabled: !!slotId });

    const [manualSubmitting, runManual] = useSubmitGuard();

    const applyResult = (result, reload) => {
        setLastResult(result);
        if (result.status === "ok") {
            const who = result.member?.fullName ?? "Student";
            const quotaLabel = result.quota && result.quota.status !== "none" ? ` · ${result.quota.label}` : "";
            toast.success(`Attendance marked for ${who}${quotaLabel}`);
            setCode("");
            reload?.();
        }
        else {
            toast.error(result.message ?? "Attendance could not be marked.");
        }
    };

    const markByMember = async (student) => {
        setMarkingId(student.memberId);
        try {
            const result = await data.markClassAttendance({ slotId, date, memberId: student.memberId });
            applyResult(result, roster.reload);
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to mark attendance.");
        }
        finally {
            setMarkingId(null);
        }
    };

    const markByCode = () => {
        if (!code.trim() || !slotId)
            return;
        runManual(async () => {
            try {
                const result = await data.markClassAttendance({ slotId, date, code: code.trim() });
                applyResult(result, roster.reload);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to mark attendance.");
            }
        });
    };

    const selected = activeSlots.find((s) => s.id === slotId) ?? null;
    const students = (roster.data?.students ?? []).filter((s) => s.enrolled);
    const markedCount = students.filter((s) => s.marked).length;

    return (<div className="space-y-6">
      {!hideHeader ? <PageHeader title="Mark Attendance" description="Open a slot and tap Mark next to each student's name — or enter a Student ID for walk-ins and younger kids who can't scan."/> : null}

      {/* Slot + date picker */}
      <Card>
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
          <div className="space-y-1.5 sm:w-72">
            <Label>Class slot</Label>
            <Select value={slotId || "__none__"} onValueChange={(v) => setSlotId(v === "__none__" ? "" : v)} disabled={activeSlots.length === 0}>
              <SelectTrigger className="w-full"><SelectValue placeholder={slots.loading ? "Loading slots…" : "Pick a slot"}/></SelectTrigger>
              <SelectContent>
                {activeSlots.map((s) => (<SelectItem key={s.id} value={s.id}>
                    {s.name} · {formatTime(s.startTime)}
                  </SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:w-44">
            <Label htmlFor="mark-date">Session date</Label>
            <Input id="mark-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}/>
          </div>
          {selected ? (<div className="flex-1 text-sm text-muted-foreground sm:text-right">
              {selected.instructorName ? (<span>Instructor: <span className="font-medium text-foreground">{selected.instructorName}</span></span>) : (<span>No instructor assigned</span>)}
            </div>) : null}
        </CardContent>
      </Card>

      {/* Manual entry (walk-ins / kids) */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="mark-code">Mark by Student ID</Label>
            <div className="relative">
              <ScanLineIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"/>
              <Input id="mark-code" placeholder="Enter or scan Student ID (e.g. KM-1042)" className="pl-8" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && markByCode()} disabled={!slotId}/>
            </div>
          </div>
          <Button onClick={markByCode} disabled={!slotId || !code.trim() || manualSubmitting}>
            {manualSubmitting ? <Loader2Icon className="size-4 animate-spin"/> : <CheckIcon className="size-4"/>}
            Mark attendance
          </Button>
        </CardContent>
      </Card>

      {/* Last result */}
      {lastResult ? (<div className={cn("rounded-xl border px-4 py-3 text-sm", lastResult.status === "ok" ? "border-km-gold/40 bg-km-gold/5" : "border-destructive/30 bg-destructive/5")} role="status">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{lastResult.member?.fullName ?? "Student"}</span>
            {lastResult.status === "ok" ? (<>
                <Badge variant="secondary">Marked</Badge>
                <QuotaChip quota={lastResult.quota}/>
                {lastResult.warning === "expired" ? (<Badge variant="destructive">Membership expired</Badge>) : null}
              </>) : (<span className="text-destructive">{lastResult.message}</span>)}
          </div>
        </div>) : null}

      {/* Roster */}
      {!slotId ? (<EmptyState icon={<CalendarCheckIcon className="size-5"/>} title="Pick a class slot" description="Choose a slot and date above to load its roster and start marking attendance."/>) : roster.loading ? (<TableSkeleton rows={5} cols={3}/>) : roster.error ? (<ErrorState message={roster.error} onRetry={roster.reload}/>) : (<>
          {roster.data && roster.data.isSlotDay === false ? (<div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-foreground">
              <AlertTriangleIcon className="size-4 shrink-0"/>
              This date is not one of this slot's scheduled days — you can still mark it.
            </div>) : null}

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{markedCount}/{students.length} marked</Badge>
            <span>{selected?.name}</span>
          </div>

          {students.length === 0 ? (<EmptyState icon={<CalendarCheckIcon className="size-5"/>} title="No students in this slot" description="Enroll students into this batch from the Class Slots page (Roster)."/>) : (<Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Student</TableHead>
                      <TableHead>Student ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Attendance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {students.map((student) => (<TableRow key={student.memberId} className={cn(student.marked && "bg-km-gold/5")}>
                        <TableCell className="font-medium">{student.fullName}</TableCell>
                        <TableCell className="text-muted-foreground">{student.memberCode ?? "—"}</TableCell>
                        <TableCell>
                          {student.status === "active" ? (<Badge variant="secondary">Active</Badge>) : (<Badge variant="outline">{student.status}</Badge>)}
                        </TableCell>
                        <TableCell className="text-right">
                          {student.marked ? (<Badge variant="secondary" className="gap-1">
                              <CheckIcon className="size-3"/> Marked
                            </Badge>) : (<Button size="sm" onClick={() => markByMember(student)} disabled={markingId === student.memberId}>
                              {markingId === student.memberId ? <Loader2Icon className="size-4 animate-spin"/> : null}
                              Mark
                            </Button>)}
                        </TableCell>
                      </TableRow>))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>)}
        </>)}
    </div>);
}
