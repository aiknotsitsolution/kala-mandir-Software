import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { BanIcon, CalendarDaysIcon, EyeIcon, Grid2x2Icon, LayoutListIcon, PencilIcon, PlusIcon, Trash2Icon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, Skeleton, Stagger } from "@/components/shared/States";
import { SmartImage } from "@/components/shared/SmartImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { ArchiveStaffDialog } from "./ArchiveStaffDialog";
import { AssignSlotDialog } from "./AssignSlotDialog";
import { AssignStudentDialog } from "./AssignStudentDialog";
import { DeleteStaffDialog } from "./DeleteStaffDialog";
import { StaffFormDialog } from "./StaffFormDialog";
import { EMPLOYMENT_LABELS, EMPLOYMENT_STYLES } from "./staffMeta";
/** Same list/grid switch as the plans page — icons only, labels in title/aria. */
const VIEW_OPTIONS = [
    { value: "list", label: "List view", Icon: LayoutListIcon },
    { value: "grid", label: "Grid view", Icon: Grid2x2Icon },
];
/**
 * One staff member. `layout="list"` renders a compact horizontal row
 * (photo + identity, badges, joined + actions); "grid" is the original card.
 */
function StaffCard({ member, layout = "grid", canManage, currentUserId, index = 0, onEdit, onArchive, onDelete, onAssignStudents, onAssignSlots }) {
    const navigate = useNavigate();
    const isList = layout === "list";
    const openDetail = () => navigate(`/staff/${member.id}`);
const actions = canManage ? (<div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <Button size="xs" variant="outline" onClick={() => openDetail()} title={`View ${member.fullName}`}>
          <EyeIcon /> View
        </Button>
        <Button size="xs" variant="outline" onClick={() => onAssignStudents(member)} title={`Assign students to ${member.fullName}`}>
          <UsersIcon /> Students
        </Button>
        <Button size="xs" variant="outline" onClick={() => onAssignSlots(member)} title={`Assign slots to ${member.fullName}`}>
          <CalendarDaysIcon /> Slots
        </Button>
        <Button size="xs" variant="outline" onClick={() => onEdit(member)} title={`Edit ${member.fullName}`}>
          <PencilIcon /> Edit
        </Button>
        {member.employmentStatus !== "resigned" && member.profileId !== currentUserId ? (<Button size="xs" variant="outline" onClick={() => onArchive(member)} title={`Disable ${member.fullName}`}>
            <BanIcon /> Disable
          </Button>) : null}
        {member.profileId !== currentUserId ? (<Button size="xs" variant="outline" onClick={() => onDelete(member)} title={`Delete ${member.fullName}`} className="text-destructive hover:bg-destructive/10">
          <Trash2Icon /> Delete
        </Button>) : null}
      </div>) : null;
    const statusBadge = (<Badge variant="outline" className={cn("shrink-0", EMPLOYMENT_STYLES[member.employmentStatus])}>
      {EMPLOYMENT_LABELS[member.employmentStatus]}
    </Badge>);
    return (<Stagger delayIndex={index} className="h-full">
      <Card onClick={openDetail} className={cn("graphite-surface h-full cursor-pointer border-border/70 transition-all duration-300 hover:-translate-y-0.5 hover:border-km-gold/60", isList && "rounded-xl")}>
        {isList ? (<CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4">
            {/* Identity */}
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <SmartImage src={member.photoUrl} name={member.fullName} className="size-12 shrink-0"/>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold">{member.fullName}</p>
                  <Badge variant="outline" className="shrink-0">
                    {ROLE_LABELS[member.role]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email ?? "No email"}
                  </p>
                  {statusBadge}
                </div>
                {member.specialization ? (<p className="truncate text-xs text-muted-foreground">
                    {member.specialization}
                  </p>) : null}
              </div>
            </div>
            {/* Actions */}
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border/60 pt-3 sm:justify-end sm:border-0 sm:pt-0">
              {actions}
            </div>
          </CardContent>) : (<CardContent className="flex h-full flex-col p-5">
            <div className="flex items-start gap-3">
              <SmartImage src={member.photoUrl} name={member.fullName} className="size-12 shrink-0"/>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{member.fullName}</p>
                  <Badge variant="outline" className="shrink-0">
                    {ROLE_LABELS[member.role]}
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email ?? "No email"}
                  </p>
                  {statusBadge}
                </div>
                {member.specialization ? (<p className="truncate text-xs text-muted-foreground">{member.specialization}</p>) : null}
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
              {actions}
            </div>
          </CardContent>)}
      </Card>
    </Stagger>);
}
export function StaffPage() {
    const data = useData();
    const { session } = useAuth();
    const reduceMotion = useReducedMotion();
    const role = session?.profile.role;
    const canManage = can(role, "staff.manage");
    const currentUserId = session?.profile?.id ?? null;
    const [includeInactive, setIncludeInactive] = useState(true);
    /* List view is the default, matching the plans page. */
    const [view, setView] = useState("list");
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [archiving, setArchiving] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [assigningStudents, setAssigningStudents] = useState(null);
    const [assigningSlots, setAssigningSlots] = useState(null);
    const staff = useAsync(() => data.listStaff(includeInactive), [data, includeInactive]);
    const openCreate = () => {
        setEditing(null);
        setFormOpen(true);
    };
    const openEdit = (member) => {
        setEditing(member);
        setFormOpen(true);
    };
    const handleSave = async (input) => {
        try {
            if (editing) {
                const saved = await data.updateStaff(editing.id, input);
                toast.success(input.loginPassword && saved?.hasLogin
                    ? `${input.fullName} updated — portal password saved`
                    : `${input.fullName} updated`);
            }
            else {
                const saved = await data.createStaff(input);
                toast.success(saved?.hasLogin
                    ? `${input.fullName} added to the team — portal login ready with ${input.email}`
                    : `${input.fullName} added to the team`);
            }
            staff.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save the staff member.");
            return false;
        }
    };
    const handleArchive = async () => {
        if (!archiving)
            return false;
        try {
            await data.archiveStaff(archiving.id);
            toast.success(`${archiving.fullName} disabled`);
            staff.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to disable this staff member.");
            return false;
        }
    };
    const handleDelete = async () => {
        if (!deleting)
            return false;
        try {
            await data.deleteStaff(deleting.id);
            toast.success(`${deleting.fullName} deleted`);
            staff.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to delete this staff member.");
            return false;
        }
    };
    const header = (<PageHeader title="Trainers & staff" description="Everyone who runs the floor — admins, front desk and trainers."/>);
    /* Toolbar card — view switch + include-inactive on the left, Add staff on
       the right; controls stack full-width on mobile (students page pattern). */
    const toolbar = (<div className="flex flex-col gap-2.5 rounded-xl border border-km-gold/25 bg-card/70 p-2.5 sm:flex-row sm:items-center sm:justify-between sm:p-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Layout switch — same data, same handlers, different arrangement. */}
            <div role="radiogroup" aria-label="Choose staff view" className="flex items-center gap-1 rounded-lg border border-km-gold/25 bg-background/60 p-1">
              {VIEW_OPTIONS.map(({ value, label, Icon }) => {
                const active = view === value;
                return (<button key={value} type="button" role="radio" aria-checked={active} aria-label={label} title={label} onClick={() => setView(value)} className={cn("inline-flex h-7 items-center justify-center rounded-md px-2.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60", active
                    ? "bg-km-burgundy text-km-ivory shadow-xs"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
                  <Icon className="size-4"/>
                </button>);
            })}
            </div>

            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5">
              <Label htmlFor="staff-inactive" className="text-xs text-muted-foreground">
                Include inactive
              </Label>
              <Switch id="staff-inactive" size="sm" checked={includeInactive} onCheckedChange={setIncludeInactive}/>
            </div>
          </div>
          {canManage ? (<Button className="w-full sm:w-auto" onClick={openCreate}>
              <PlusIcon className="size-4"/> Add staff
            </Button>) : null}
        </div>);
    if (staff.loading) {
        return (<div className="space-y-6">
        {header}
        {toolbar}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (<Skeleton key={index} className="h-48"/>))}
        </div>
      </div>);
    }
    if (staff.error) {
        return (<div className="space-y-6">
        {header}
        {toolbar}
        <ErrorState title="Unable to load staff" message={staff.error} onRetry={staff.reload}/>
      </div>);
    }
    const rows = staff.data ?? [];
    return (<div className="space-y-6">
      {header}
      {toolbar}

      {rows.length === 0 ? (<EmptyState icon={<UsersIcon className="size-5"/>} title={includeInactive ? "No staff yet" : "No active staff"} description={includeInactive
                ? "Add your first team member to assign classes and share the front desk."
                : "Turn on “Include inactive” to see on-leave and resigned staff."} action={canManage ? (<Button size="sm" onClick={openCreate}>
                <PlusIcon className="size-4"/> Add staff
              </Button>) : undefined}/>) : (<>
          {/* Layout switch — same data, same handlers, different arrangement. */}
          <motion.div key={view} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }} className={view === "list"
            ? "space-y-3"
            : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"}>
            {rows.map((member, index) => (<StaffCard key={member.id} member={member} layout={view} canManage={canManage} currentUserId={currentUserId} index={index} onEdit={openEdit} onArchive={setArchiving} onDelete={setDeleting} onAssignStudents={setAssigningStudents} onAssignSlots={setAssigningSlots}/>))}
          </motion.div>

          <p className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "person" : "people"} on record
          </p>
        </>)}

      <StaffFormDialog open={formOpen} onOpenChange={setFormOpen} staff={editing} onSave={handleSave}/>
      <ArchiveStaffDialog staff={archiving} onOpenChange={(open) => {
            if (!open)
                setArchiving(null);
        }} onConfirm={handleArchive}/>
      <DeleteStaffDialog staff={deleting} onOpenChange={(open) => {
            if (!open)
                setDeleting(null);
        }} onConfirm={handleDelete}/>
      <AssignStudentDialog staff={assigningStudents} open={!!assigningStudents} onOpenChange={(o) => !o && setAssigningStudents(null)} onChanged={() => staff.reload()}/>
      <AssignSlotDialog staff={assigningSlots} open={!!assigningSlots} onOpenChange={(o) => !o && setAssigningSlots(null)} onChanged={() => staff.reload()}/>
    </div>);
}
