import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarXIcon, CheckIcon, Loader2Icon, UserPlusIcon, UserXIcon, } from "lucide-react";
import { SmartImage } from "@/components/shared/SmartImage";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { useData } from "@/auth/AuthProvider";
import { useAsync, useSubmitGuard } from "@/hooks";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
const STATUS_STYLES = {
    enrolled: "border-primary/30 bg-primary/10 text-primary",
    attended: "border-info/30 bg-info/10 text-info",
    no_show: "border-warning/30 bg-warning/10 text-warning",
    cancelled: "border-border bg-muted text-muted-foreground",
};
const STATUS_LABELS = {
    enrolled: "Enrolled",
    attended: "Attended",
    no_show: "No show",
    cancelled: "Cancelled",
};
const PICK_MEMBER = "__pick__";
export function ManageEnrollmentsDialog({ gymClass, open, onOpenChange, canManage, onChanged, }) {
    const data = useData();
    const enabled = open && gymClass !== null;
    const classId = gymClass?.id ?? "";
    const enrollments = useAsync(() => data.listEnrollments(classId), [data, classId, enabled], {
        enabled,
    });
    const members = useAsync(() => data.listAllMembers(), [data, enabled], { enabled });
    const [pickedMemberId, setPickedMemberId] = useState(PICK_MEMBER);
    const [enrolling, runEnrol] = useSubmitGuard();
    useEffect(() => {
        if (!open)
            setPickedMemberId(PICK_MEMBER);
    }, [open]);
    const enrolledIds = new Set((enrollments.data ?? []).map((row) => row.memberId));
    const candidates = (members.data ?? []).filter((member) => !enrolledIds.has(member.id));
    const enrolled = (enrollments.data ?? []).length;
    const capacity = gymClass?.capacity ?? 0;
    const handleError = (error, fallback) => toast.error(error instanceof Error ? error.message : fallback);
    const handleEnrol = () => {
        if (!gymClass || pickedMemberId === PICK_MEMBER)
            return;
        void runEnrol(async () => {
            try {
                await data.enroll(gymClass.id, pickedMemberId);
                toast.success("Member enrolled");
                setPickedMemberId(PICK_MEMBER);
                enrollments.reload();
                onChanged();
            }
            catch (error) {
                handleError(error, "Unable to enrol this student.");
            }
        });
    };
    const updateStatus = async (enrollmentId, status) => {
        try {
            await data.setEnrollmentStatus(enrollmentId, status);
            toast.success(`Marked as ${STATUS_LABELS[status].toLowerCase()}`);
            enrollments.reload();
            onChanged();
        }
        catch (error) {
            handleError(error, "Unable to update the enrolment.");
        }
    };
    const cancelEnrollment = async (enrollmentId) => {
        try {
            await data.cancelEnrollment(enrollmentId);
            toast.success("Enrolment cancelled");
            enrollments.reload();
            onChanged();
        }
        catch (error) {
            handleError(error, "Unable to cancel the enrolment.");
        }
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage enrolments</DialogTitle>
          <DialogDescription>
            {gymClass
            ? `${gymClass.name} · ${enrolled} of ${capacity} seats taken.`
            : "Enrol members and record attendance."}
          </DialogDescription>
        </DialogHeader>

        {canManage ? (<div className="flex flex-col gap-2 rounded-lg border border-border/70 bg-card/60 p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              {members.loading ? (<Skeleton className="h-9 w-full"/>) : members.error ? (<p className="text-xs text-destructive">{members.error}</p>) : (<Select value={pickedMemberId} onValueChange={setPickedMemberId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose A student"/>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PICK_MEMBER}>
                      {candidates.length > 0 ? "Choose A student" : "Every Student is enrolled"}
                    </SelectItem>
                    {candidates.map((member) => (<SelectItem key={member.id} value={member.id}>
                        {member.fullName} · {member.memberCode}
                      </SelectItem>))}
                  </SelectContent>
                </Select>)}
            </div>
            <Button onClick={handleEnrol} disabled={enrolling ||
                members.loading ||
                Boolean(members.error) ||
                pickedMemberId === PICK_MEMBER ||
                candidates.length === 0}>
              {enrolling ? <Loader2Icon className="size-4 animate-spin"/> : <UserPlusIcon className="size-4"/>}
              {enrolling ? "Enrolling…" : "Enrol member"}
            </Button>
          </div>) : null}

        {enrollments.loading ? (<div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (<Skeleton key={index} className="h-14"/>))}
          </div>) : enrollments.error ? (<ErrorState title="Unable to load enrolments" message={enrollments.error} onRetry={enrollments.reload}/>) : (enrollments.data ?? []).length === 0 ? (<EmptyState icon={<UserXIcon className="size-5"/>} title="No enrolments yet" description={canManage
                ? "Pick A student above to fill the first seat."
                : "Nobody has enrolled in this class yet."} className="py-10"/>) : (<ul className="divide-y divide-border/60">
            {(enrollments.data ?? []).map((row) => (<li key={row.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <SmartImage src={row.memberPhoto} name={row.memberName ?? "Student"} className="size-9 shrink-0"/>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{row.memberName ?? "Student"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.memberCode} · enrolled {relativeTime(row.enrolledAt)}
                  </p>
                </div>
                <Badge variant="outline" className={cn(STATUS_STYLES[row.status])}>
                  {STATUS_LABELS[row.status]}
                </Badge>
                {canManage ? (<div className="flex items-center gap-1">
                    {row.status !== "attended" ? (<Button size="icon-xs" variant="ghost" aria-label="Mark attended" title="Mark attended" onClick={() => void updateStatus(row.id, "attended")}>
                        <CheckIcon />
                      </Button>) : null}
                    {row.status !== "no_show" ? (<Button size="icon-xs" variant="ghost" aria-label="Mark no show" title="Mark no show" onClick={() => void updateStatus(row.id, "no_show")}>
                        <CalendarXIcon />
                      </Button>) : null}
                    <Button size="icon-xs" variant="ghost" aria-label="Cancel enrolment" title="Cancel enrolment" onClick={() => void cancelEnrollment(row.id)}>
                      <UserXIcon />
                    </Button>
                  </div>) : null}
              </li>))}
          </ul>)}
      </DialogContent>
    </Dialog>);
}
