import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeftIcon, CalendarDaysIcon, MailIcon, PencilIcon, PhoneIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, Skeleton, Stagger } from "@/components/shared/States";
import { SmartImage } from "@/components/shared/SmartImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { format12h, formatDate } from "@/lib/format";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { EMPLOYMENT_LABELS, EMPLOYMENT_STYLES } from "./staffMeta";
import { StaffFormDialog } from "./StaffFormDialog";
/** Weekday → short chip label (indexed by JS weekday: 0 = Sunday). */
const DAY_CHIPS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function DetailRow({ icon: Icon, label, value }) {
    return (<div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground"/>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{value || "—"}</p>
      </div>
    </div>);
}
export function StaffDetailPage() {
    const { staffId = "" } = useParams();
    const data = useData();
    const { session } = useAuth();
    const role = session?.profile.role;
    const canManage = can(role, "staff.manage");
    const staff = useAsync(() => data.getStaff(staffId), [data, staffId]);
    const [editOpen, setEditOpen] = useState(false);
    if (staff.loading) {
        return (<div className="space-y-6">
        <Skeleton className="h-16 w-full max-w-sm"/>
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-64"/>
          <Skeleton className="h-64"/>
          <Skeleton className="h-64"/>
          <Skeleton className="h-48"/>
        </div>
      </div>);
    }
    if (staff.error) {
        return (<ErrorState title="Unable to load this staff member" message={staff.error} onRetry={staff.reload}/>);
    }
    if (!staff.data) {
        return (<EmptyState icon={<UsersIcon className="size-5"/>} title="Staff member not found" description="This profile may have been deleted, or the link is out of date." action={<Button variant="outline" size="sm" asChild>
              <Link to="/staff">
                <ArrowLeftIcon className="size-4"/> Back to trainers & staff
              </Link>
            </Button>}/>);
    }
    const current = staff.data;
    const slots = (current.slots ?? []).filter((s) => s.isActive !== false);
    const students = current.students ?? [];
    const handleSave = async (input) => {
        try {
            await data.updateStaff(current.id, input);
            toast.success(`${input.fullName ?? current.fullName} updated`);
            staff.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save this staff member.");
            return false;
        }
    };
    return (<div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: "Trainers & staff", to: "/staff" }, { label: current.fullName }]} title={current.fullName} description={`${ROLE_LABELS[current.role]} · joined ${formatDate(current.joiningDate)}`} actions={canManage ? (<Button variant="outline" onClick={() => setEditOpen(true)}>
              <PencilIcon className="size-4"/> Edit
            </Button>) : null}/>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Profile */}
        <Stagger className="lg:col-span-2">
          <Card className="graphite-surface border-border/70">
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start gap-4">
                <SmartImage src={current.photoUrl} name={current.fullName} className="size-16 shrink-0"/>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <p className="text-lg font-semibold tracking-tight">{current.fullName}</p>
                  <Badge variant="outline" className="shrink-0">{ROLE_LABELS[current.role]}</Badge>
                  <Badge variant="outline" className={cn("shrink-0", EMPLOYMENT_STYLES[current.employmentStatus])}>
                    {EMPLOYMENT_LABELS[current.employmentStatus]}
                  </Badge>
                </div>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <DetailRow icon={MailIcon} label="Email" value={current.email}/>
                <DetailRow icon={PhoneIcon} label="Phone" value={current.phone}/>
                <DetailRow icon={UsersIcon} label="Specialization" value={current.specialization}/>
                <DetailRow icon={CalendarDaysIcon} label="Joined" value={formatDate(current.joiningDate)}/>
              </div>
              {current.notes ? (<p className="mt-4 border-t border-border/60 pt-3 text-sm text-muted-foreground">{current.notes}</p>) : null}
            </CardContent>
          </Card>
        </Stagger>

        {/* Assigned slots */}
        <Stagger delayIndex={1}>
          <Card className="graphite-surface border-border/70">
            <CardContent className="p-5">
              <div className="flex items-center gap-2">
                <CalendarDaysIcon className="size-4 text-muted-foreground"/>
                <p className="text-sm font-semibold">Assigned slots</p>
                <Badge variant="outline" className="ml-auto">{slots.length}</Badge>
              </div>
              <div className="mt-3 space-y-2">
                {slots.length === 0 ? (<p className="py-3 text-sm text-muted-foreground">No slots assigned yet.</p>) : (slots.map((slot) => (<div key={slot.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{format12h(slot.startTime)} – {format12h(slot.endTime)}</p>
                        <p className="text-xs text-muted-foreground">{slot.classTag ?? "—"}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {([...(slot.weekdays ?? [])].sort((a, b) => a - b).map((d) => (<span key={d} className="inline-flex h-6 min-w-10 items-center justify-center rounded-md border border-primary/20 bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
                            {DAY_CHIPS[d]}
                          </span>)))}
                      </div>
                    </div>)))}
              </div>
            </CardContent>
          </Card>
        </Stagger>

        {/* Assigned students */}
        <Stagger delayIndex={2}>
          <Card className="graphite-surface border-border/70">
            <CardContent className="p-5">
              <div className="flex items-center gap-2">
                <UsersIcon className="size-4 text-muted-foreground"/>
                <p className="text-sm font-semibold">Assigned students</p>
                <Badge variant="outline" className="ml-auto">{students.length}</Badge>
              </div>
              {students.length === 0 ? (<p className="mt-3 py-3 text-sm text-muted-foreground">No students assigned yet.</p>) : (<div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {students.map((student) => (<Link key={student.id} to={`/members/${student.id}`} className="rounded-md border border-border/60 px-3 py-2 transition-colors hover:border-km-gold/60 hover:bg-accent/40">
                      <p className="truncate text-sm font-medium">{student.fullName}</p>
                      <p className="text-xs text-muted-foreground">{student.memberCode ?? "—"}{student.phone ? ` · ${student.phone}` : ""}</p>
                    </Link>))}
                </div>)}
            </CardContent>
          </Card>
        </Stagger>
      </div>

      <StaffFormDialog open={editOpen} onOpenChange={setEditOpen} staff={current} onSave={handleSave}/>
    </div>);
}
