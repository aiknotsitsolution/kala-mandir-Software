import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon, UserCheckIcon, UserRoundPlusIcon, UserXIcon, UsersIcon, } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, SearchEmptyState, TableSkeleton, Stagger } from "@/components/shared/States";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SmartImage } from "@/components/shared/SmartImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync, useDebounced } from "@/hooks";
import { MEMBER_FILTER_LABELS, PAYMENT_METHOD_LABELS, formatDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { MemberFormDialog } from "./MemberFormDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
const PAGE_SIZE = 10;
const STATUS_FILTERS = [
    "all",
    "active",
    "expiring_soon",
    "expired",
    "suspended",
    "inactive",
];
/** "kitni class hui / bachi" — attended vs paid quota, shown as a compact stack.
 *  Colour rule: 4+ left green · 2–3 yellow · 1 or 0 red. */
function ClassesCell({ member }) {
    const q = member.quota;
    if (!q || q.status === "none") {
        return <span className="text-xs text-muted-foreground sm:text-sm">—</span>;
    }
    return <span className="text-xs tabular sm:text-sm">{q.attended} / {q.quota}</span>;
}
/** Bachi hui classes (remaining quota) — a tinted chip, same colour rule as
 *  the roster quota: 4+ left green · 2–3 yellow · 0–1 red (over/expired red). */
function ClassLeftCell({ member }) {
    const q = member.quota;
    if (!q || q.status === "none") {
        return <span className="text-muted-foreground">—</span>;
    }
    const tone = q.status === "exceeded" || q.status === "expired" || q.remaining < 2
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : q.remaining < 4
            ? "border-warning/30 bg-warning/10 text-warning"
            : "border-success/30 bg-success/10 text-success";
    const label = q.status === "exceeded"
        ? `${q.exceeded} over`
        : q.status === "expired"
            ? "0 left"
            : `${q.remaining} left`;
    return <Badge variant="outline" className={cn("px-1 py-0 text-[9px] font-medium leading-none tabular sm:px-2.5 sm:py-1 sm:text-xs", tone)}>{label}</Badge>;
}
export function MembersPage() {
    const data = useData();
    const { session } = useAuth();
    const role = session?.profile.role;
    const canCreate = can(role, "members.create");
    const canEdit = can(role, "members.edit");
    const canDelete = can(role, "members.delete");
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebounced(search, 350);
    // Deep link: /members?status=active (dashboard stat cards) presets the filter.
    const [status, setStatus] = useState(() => {
        const preset = searchParams.get("status");
        return preset && STATUS_FILTERS.includes(preset) ? preset : "all";
    });
    const [planId, setPlanId] = useState("all");
    const [page, setPage] = useState(1);
    const [formOpen, setFormOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const plans = useAsync(() => data.listPlans(), [data]);
    /** Staff directory — resolves each student's assigned trainer name. */
    const staff = useAsync(() => data.listStaff(false), [data]);
    const trainerNameById = useMemo(
        () => new Map((staff.data ?? []).map((s) => [String(s.id), s.fullName])),
        [staff.data],
    );
    const members = useAsync(() => data.listMembers({
        search: debouncedSearch.trim() || undefined,
        status,
        planId: planId === "all" ? undefined : planId,
        page,
        pageSize: PAGE_SIZE,
    }), [data, debouncedSearch, status, planId, page]);
    // Reset to the first page whenever the filters change.
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, status, planId]);
    // Deep link: /members?new=1 auto-opens the add dialog (dashboard quick action).
    // The param is kept while the dialog should be open so a page-transition remount
    // re-opens it; it is cleared only once the dialog is dismissed (or not permitted).
    useEffect(() => {
        if (!session)
            return; // auth still restoring — never consume the param early
        if (searchParams.get("new") !== "1")
            return;
        if (canCreate) {
            setEditing(null);
            setFormOpen(true);
        }
        else {
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, setSearchParams, canCreate, session]);
    const handleFormOpenChange = (open) => {
        setFormOpen(open);
        if (!open && searchParams.has("new")) {
            setSearchParams({}, { replace: true });
        }
    };
    const hasFilters = debouncedSearch.trim() !== "" || status !== "all" || planId !== "all";
    const clearFilters = () => {
        setSearch("");
        setStatus("all");
        setPlanId("all");
    };
    const openCreate = () => {
        setEditing(null);
        setFormOpen(true);
    };
    const openEdit = async (member) => {
        try {
            const fullMember = await data.getMember(member.id);
            if (!fullMember) {
                toast.error("Student not found.");
                return;
            }
            setEditing(fullMember);
            setFormOpen(true);
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to load this student.");
        }
    };
    const handleSave = async (payload) => {
        try {
            if (payload.mode === "create") {
                await data.createMember(payload.input);
                toast.success(`${payload.input.fullName} added`);
            }
            else if (editing) {
                await data.updateMember(editing.id, payload.input);
                toast.success(`${payload.input.fullName ?? editing.fullName} updated`);
            }
            members.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save this student.");
            return false;
        }
    };
    const handleToggleStatus = async (member) => {
        const next = member.status === "active" ? "inactive" : "active";
        try {
            await data.setMemberStatus(member.id, next);
            toast.success(next === "active" ? `${member.fullName} reactivated` : `${member.fullName} deactivated`);
            members.reload();
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to change the student status.");
        }
    };
    const handleDelete = async () => {
        if (!deleting)
            return false;
        try {
            await data.deleteMember(deleting.id);
            toast.success(`${deleting.fullName} deleted`);
            members.reload();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to delete this student.");
            return false;
        }
    };
    const rows = members.data?.items ?? [];
    const total = members.data?.total ?? 0;
    const currentPage = members.data?.page ?? page;
    const pageSize = members.data?.pageSize ?? PAGE_SIZE;
    const rangeFrom = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
    const rangeTo = Math.min(total, currentPage * pageSize);
    const header = (<PageHeader title="Students" description="Your student directory — memberships, QR cards and payment history in one place."/>);
    return (<div className="space-y-6">
      {header}

      {/* Toolbar — search and filters in one card, matching the plans page. */}
      <div className="flex flex-col gap-3 rounded-xl border border-km-gold/25 bg-card/70 p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
        {/* Search */}
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"/>
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, phone or Student ID…" className="h-9 border-km-gold/25 bg-background/60 pl-9 focus-visible:border-km-gold" aria-label="Search students"/>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={status} onValueChange={(value) => setStatus(value)}>
            <SelectTrigger size="sm" className="w-full border-km-gold/25 bg-background/60 sm:w-auto" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end" className="min-w-40">
              {STATUS_FILTERS.map((option) => (<SelectItem key={option} value={option}>
                  {MEMBER_FILTER_LABELS[option]}
                </SelectItem>))}
            </SelectContent>
          </Select>

          <Select value={planId} onValueChange={setPlanId}>
            <SelectTrigger size="sm" className="w-full border-km-gold/25 bg-background/60 sm:w-auto" aria-label="Filter by plan">
              <SelectValue placeholder="All plans"/>
            </SelectTrigger>
            <SelectContent position="popper" align="end" className="min-w-44">
              <SelectItem value="all">All plans</SelectItem>
              {(plans.data ?? []).map((plan) => (<SelectItem key={plan.id} value={plan.id}>
                  {plan.name}
                </SelectItem>))}
            </SelectContent>
          </Select>

          {canCreate ? (<Button size="sm" className="ml-auto" onClick={openCreate}>
              <PlusIcon className="size-4"/> Add student
            </Button>) : null}

          {hasFilters ? (<Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearFilters}>
              Clear filters
            </Button>) : null}
        </div>
      </div>

      {/* Table */}
      <Stagger>
        <Card className="graphite-surface gap-0 overflow-hidden border-border/70 py-0">
          {members.error ? (<div className="p-4">
              <ErrorState title="Unable to load students" message={members.error} onRetry={members.reload}/>
            </div>) : members.loading && !members.data ? (<TableSkeleton rows={6} cols={5}/>) : rows.length === 0 ? (<div className="p-4">
              {hasFilters ? (<SearchEmptyState query={debouncedSearch.trim()}/>) : (<EmptyState icon={<UsersIcon className="size-5"/>} title="No students yet" description="Add your first student — their QR membership card is generated automatically." action={canCreate ? (<Button size="sm" onClick={openCreate}>
                        <UserRoundPlusIcon className="size-4"/> Add student
                      </Button>) : undefined}/>)}
            </div>) : (<>
              <div className={cn("transition-opacity", members.loading && "pointer-events-none opacity-60")}>
                <Table className="w-full md:min-w-[900px] table-fixed">
                  <TableHeader>
                    <TableRow className="h-11">
                      <TableHead className="hidden w-[7%] px-3 align-middle sm:table-cell">Sr. no.</TableHead>
                      <TableHead className="w-[44%] px-2 align-middle text-xs md:w-[22%] md:px-3 md:text-sm">Name</TableHead>
                      <TableHead className="hidden w-[30%] px-2 align-middle sm:table-cell sm:w-[10%] sm:px-3">Status</TableHead>
                      <TableHead className="w-[16%] px-2 align-middle text-xs md:px-3 md:w-[10%] md:text-sm">Classes</TableHead>
                      <TableHead className="w-[22%] px-2 align-middle text-xs md:px-3 md:w-[11%] md:text-sm">
                        <span className="md:hidden" title="Remaining classes">Left</span>
                        <span className="hidden md:inline">Remaining Classes</span>
                      </TableHead>
                      <TableHead className="hidden w-[12%] px-3 align-middle text-sm sm:table-cell">Plan</TableHead>
                      <TableHead className="hidden w-[10%] px-3 align-middle lg:table-cell">Trainer</TableHead>
                      <TableHead className="hidden w-[8%] px-3 align-middle lg:table-cell">Payment</TableHead>
                      <TableHead className="w-[12%] px-2 text-right align-middle text-xs sm:w-[10%] sm:px-3 sm:text-sm">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((member, index) => (<TableRow key={member.id} className="h-14 cursor-pointer sm:h-16" onClick={() => navigate(`/members/${member.id}`)}>
                        <TableCell className="hidden px-3 align-middle text-sm tabular text-muted-foreground sm:table-cell">
                          {(currentPage - 1) * pageSize + index + 1}
                        </TableCell>
                        <TableCell className="px-2 align-middle sm:px-3">
                          <div className="flex items-center gap-2 sm:gap-3">
                            <SmartImage src={member.photoUrl} name={member.fullName} className="size-8 shrink-0 sm:size-11"/>
                            <div className="min-w-0">
                              <Link to={`/members/${member.id}`} onClick={(event) => event.stopPropagation()} className="block truncate text-sm font-medium hover:underline">
                                {member.fullName}
                              </Link>
                              <span className="flex items-center gap-1">
                                <p className="truncate text-[11px] text-muted-foreground sm:text-xs">{member.memberCode}</p>
                                {/* Mobile-only: the Status column is hidden below sm,
                                    so the status rides along beside the ID. */}
                                <span className="sm:hidden">
                                  <StatusBadge status={member.effectiveStatus} className="px-1 py-0 text-[9px] leading-none"/>
                                </span>
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="hidden px-2 align-middle sm:table-cell sm:px-3">
                          <StatusBadge status={member.effectiveStatus}/>
                        </TableCell>
                        <TableCell className="px-2 align-middle sm:px-3">
                          <ClassesCell member={member}/>
                        </TableCell>
                        <TableCell className="px-2 align-middle sm:px-3">
                          <ClassLeftCell member={member}/>
                        </TableCell>
                        <TableCell className="hidden px-3 align-middle sm:table-cell">
                          {member.planName ? (<div className="min-w-0">
                              <p className="truncate text-sm leading-tight">{member.planName}</p>
                              <p className="truncate text-xs leading-tight text-muted-foreground">ends {formatDate(member.endDate)}</p>
                            </div>) : (<span className="text-muted-foreground">—</span>)}
                        </TableCell>
                        <TableCell className="hidden px-3 text-sm align-middle text-muted-foreground lg:table-cell">
                          {member.trainerId
                            ? (trainerNameById.get(String(member.trainerId)) ?? "—")
                            : "—"}
                        </TableCell>
                        <TableCell className="hidden px-3 text-sm align-middle text-muted-foreground lg:table-cell">
                          {member.paymentMethod
                            ? (PAYMENT_METHOD_LABELS[member.paymentMethod] ?? member.paymentMethod)
                            : "—"}
                        </TableCell>
                        <TableCell className="px-2 text-right align-middle sm:px-3">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-xs" aria-label={`Actions for ${member.fullName}`} className="ml-auto" onClick={(event) => event.stopPropagation()}>
                                <MoreHorizontalIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" sideOffset={6} onClick={(event) => event.stopPropagation()}>
                              <DropdownMenuItem onSelect={() => navigate(`/members/${member.id}`)}>
                                <EyeIcon /> View profile
                              </DropdownMenuItem>
                              {canEdit ? (<>
                                  <DropdownMenuItem onSelect={() => openEdit(member)}>
                                    <PencilIcon /> Edit student
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onSelect={() => void handleToggleStatus(member)}>
                                    {member.status === "active" ? <UserXIcon /> : <UserCheckIcon />}
                                    {member.status === "active" ? "Deactivate" : "Activate"}
                                  </DropdownMenuItem>
                                </>) : null}
                              {canDelete ? (<>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(member)}>
                                    <Trash2Icon /> Delete student
                                  </DropdownMenuItem>
                                </>) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-3 py-2.5 sm:px-4 sm:py-3">
                <p className="text-xs text-muted-foreground">
                  Showing {rangeFrom}–{rangeTo} of {total} {total === 1 ? "student" : "students"}
                </p>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="outline" size="xs" disabled={currentPage <= 1 || members.loading} onClick={() => setPage(currentPage - 1)}>
                    <ChevronLeftIcon className="size-3"/> Prev
                  </Button>
                  <Button variant="outline" size="xs" disabled={rangeTo >= total || members.loading} onClick={() => setPage(currentPage + 1)}>
                    Next <ChevronRightIcon className="size-3"/>
                  </Button>
                </div>
              </div>
            </>)}
        </Card>
      </Stagger>

      <MemberFormDialog open={formOpen} onOpenChange={handleFormOpenChange} member={editing} plans={plans.data ?? []} onSave={handleSave}/>

      <ConfirmActionDialog open={deleting !== null} onOpenChange={(open) => {
            if (!open)
                setDeleting(null);
        }} icon={Trash2Icon} title={`Delete ${deleting?.fullName ?? "student"}?`} description="This permanently removes the student, their memberships, attendance and payment records. This action cannot be undone." cancelLabel="Keep student" confirmLabel="Delete student" onConfirm={handleDelete}/>
    </div>);
}
