import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeftIcon, CalendarDaysIcon, ClockIcon, CreditCardIcon, MailIcon, MapPinIcon, PencilIcon, PhoneIcon, QrCodeIcon, RefreshCwIcon, ShieldAlertIcon, TagIcon, UserRoundXIcon, UserXIcon, UserCheckIcon, WalletIcon, } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, Skeleton, Stagger } from "@/components/shared/States";
import { StatusBadge, PaymentBadge } from "@/components/shared/StatusBadge";
import { SmartImage } from "@/components/shared/SmartImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { durationLabel, formatDateTime, formatDate, formatINR, PAYMENT_METHOD_LABELS, timeSlotLabel, titleCase, } from "@/lib/format";
import { effectiveStatus as deriveEffectiveStatus } from "@/lib/membership";
import { can } from "@/lib/permissions";
import { MemberFormDialog } from "./MemberFormDialog";
import { RenewDialog } from "./RenewDialog";
import { ConfirmActionDialog } from "./ConfirmActionDialog";
function DetailRow({ icon: Icon, label, value }) {
    return (<div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground"/>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{value || "—"}</p>
      </div>
    </div>);
}
export function MemberDetailPage() {
    const { memberId = "" } = useParams();
    const data = useData();
    const { session } = useAuth();
    const role = session?.profile.role;
    const canEdit = can(role, "members.edit");
    const canRotateQr = can(role, "qr.regenerate");
    const member = useAsync(() => data.getMember(memberId), [data, memberId]);
    const plans = useAsync(() => data.listPlans(), [data]);
    const history = useAsync(() => data.getMembershipHistory(memberId), [data, memberId]);
    const attendance = useAsync(() => data.listMemberAttendance(memberId, 20), [data, memberId]);
    const payments = useAsync(() => data.listPayments({ memberId, pageSize: 50 }), [data, memberId]);
    const [editOpen, setEditOpen] = useState(false);
    const [renewOpen, setRenewOpen] = useState(false);
    const [rotateOpen, setRotateOpen] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    const reloadAll = () => {
        member.reload();
        history.reload();
        payments.reload();
    };
    const handleSave = async (payload) => {
        if (payload.mode !== "update" || !member.data)
            return false;
        try {
            await data.updateMember(member.data.id, payload.input);
            toast.success(`${payload.input.fullName ?? member.data.fullName} updated`);
            reloadAll();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save this student.");
            return false;
        }
    };
    const handleRotateQr = async () => {
        if (!member.data)
            return false;
        try {
            await data.rotateQrToken(member.data.id);
            toast.success("QR code rotated — printed copies of the old QR no longer work");
            reloadAll();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to rotate the QR code.");
            return false;
        }
    };
    const handleToggleStatus = async () => {
        if (!member.data)
            return false;
        const next = member.data.status === "active" ? "inactive" : "active";
        try {
            await data.setMemberStatus(member.data.id, next);
            toast.success(next === "active" ? `${member.data.fullName} reactivated` : `${member.data.fullName} deactivated`);
            reloadAll();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to change the student status.");
            return false;
        }
    };
    if (member.loading) {
        return (<div className="min-w-0 space-y-6">
        <Skeleton className="h-16 w-full max-w-sm"/>
        <div className="space-y-4">
          <Skeleton className="h-56"/>
          <Skeleton className="h-44"/>
        </div>
        <Skeleton className="h-64"/>
      </div>);
    }
    if (member.error) {
        return (<ErrorState title="Unable to load this student" message={member.error} onRetry={member.reload}/>);
    }
    if (!member.data) {
        return (<EmptyState icon={<UserRoundXIcon className="size-5"/>} title="Student not found" description="this student may have been deleted, or the link is out of date." action={<Button variant="outline" size="sm" asChild>
            <Link to="/members">
              <ArrowLeftIcon className="size-4"/> Back to students
            </Link>
          </Button>}/>);
    }
    const current = member.data;
    const membership = current.membership;
    const quota = current.quota;
    const isActive = current.status === "active";
    return (<div className="min-w-0 space-y-6">
      <PageHeader breadcrumbs={[{ label: "Students", to: "/members" }, { label: current.fullName }]} title={current.fullName} description={`Joined ${formatDate(current.joinDate)}`} actions={canEdit ? (<>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <PencilIcon className="size-4"/> Edit
              </Button>
              <Button variant="outline" onClick={() => setRenewOpen(true)}>
                <WalletIcon className="size-4"/> {membership ? "Renew" : "Assign plan"}
              </Button>
              {canRotateQr ? (<Button variant="outline" onClick={() => setRotateOpen(true)}>
                  <QrCodeIcon className="size-4"/> Rotate QR
                </Button>) : null}
              <Button variant={isActive ? "destructive" : "default"} onClick={() => setStatusOpen(true)}>
                {isActive ? <UserXIcon className="size-4"/> : <UserCheckIcon className="size-4"/>}
                {isActive ? "Deactivate" : "Reactivate"}
              </Button>
            </>) : null}/>

      <div className="space-y-4">
        <div className="space-y-4">
          {/* Profile */}
          <Stagger>
            <Card className="graphite-surface border-border/70 print:break-inside-avoid">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-start gap-4">
                  <SmartImage src={current.photoUrl} name={current.fullName} className="size-16 shrink-0"/>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-semibold tracking-tight">{current.fullName}</p>
                      <StatusBadge status={current.effectiveStatus}/>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Student since {formatDate(current.joinDate)}
                    </p>
                  </div>
                </div>

                <Separator className="my-4"/>

                <div className="grid gap-4 sm:grid-cols-2">
                  <DetailRow icon={PhoneIcon} label="Phone" value={current.phone}/>
                  <DetailRow icon={MailIcon} label="Email" value={current.email}/>
                  <DetailRow icon={MapPinIcon} label="Address" value={current.address}/>
                  <DetailRow
                    icon={ClockIcon}
                    label="Time slots"
                    value={current.slotDetails?.length
                        ? current.slotDetails.map((slot) => `${slot.classTag} · ${slot.name} · ${timeSlotLabel(`${slot.startTime}-${slot.endTime}`)}`).join(", ")
                        : (current.slotRanges?.length ? current.slotRanges : current.preferredSlot ? [current.preferredSlot] : [])
                            .map((slot) => timeSlotLabel(slot))
                            .join(", ")}
                  />
                  <DetailRow icon={TagIcon} label="Class tags" value={(current.classTags?.length ? current.classTags : current.classTag ? [current.classTag] : []).join(", ")}/>
                  <DetailRow icon={ShieldAlertIcon} label={current.emergencyContactName
            ? `Emergency · ${current.emergencyContactName}`
            : "Emergency contact"} value={current.emergencyContactPhone}/>
                </div>

                {current.notes ? (<>
                    <Separator className="my-4"/>
                    <p className="text-sm text-muted-foreground">{current.notes}</p>
                  </>) : null}
              </CardContent>
            </Card>
          </Stagger>

          {/* Current membership */}
          <Stagger delayIndex={1}>
            <Card className="graphite-surface border-border/70 print:break-inside-avoid">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Current membership</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {membership ? "Live plan and validity" : "No plan assigned yet"}
                  </p>
                </div>
                {membership ? <StatusBadge status={current.effectiveStatus}/> : null}
              </CardHeader>
              <CardContent>
                {membership ? (<div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-xs tracking-wide text-muted-foreground uppercase">Plan</p>
                      <p className="mt-1 text-sm font-medium">
                        {membership.planName ?? current.planName ?? "Plan"}
                      </p>
                      {membership.planDurationValue && membership.planDurationUnit ? (<p className="text-xs text-muted-foreground">
                          {durationLabel(membership.planDurationValue, membership.planDurationUnit)}
                        </p>) : null}
                    </div>
                    <div>
                      <p className="text-xs tracking-wide text-muted-foreground uppercase">Price</p>
                      <p className="mt-1 text-sm font-medium">{formatINR(membership.price)}</p>
                      {membership.discount > 0 ? (<p className="text-xs text-muted-foreground">
                          {formatINR(membership.discount)} discount applied
                        </p>) : null}
                    </div>
                    <div>
                      <p className="text-xs tracking-wide text-muted-foreground uppercase">Start</p>
                      <p className="mt-1 text-sm font-medium">{formatDate(membership.startDate)}</p>
                    </div>
                    <div>
                      <p className="text-xs tracking-wide text-muted-foreground uppercase">End</p>
                      <p className="mt-1 text-sm font-medium">{formatDate(membership.endDate)}</p>
                      <p className="text-xs text-muted-foreground">
                        {current.effectiveStatus === "expired"
                ? "Expired"
                : current.effectiveStatus === "inactive"
                    ? "Inactive"
                    : current.effectiveStatus === "none"
                        ? "Not started"
                        : current.daysRemaining === null
                            ? "—"
                            : current.daysRemaining <= 0
                                ? "Expires today"
                                : `${current.daysRemaining} days remaining`}
                      </p>
                    </div>
                  </div>) : (<EmptyState icon={<CalendarDaysIcon className="size-5"/>} title="No membership assigned" description="Assign a plan to generate a valid QR card for this student." className="py-8" action={canEdit ? (<Button size="sm" onClick={() => setRenewOpen(true)}>
                          <WalletIcon className="size-4"/> Assign plan
                        </Button>) : undefined}/>)}
                {membership ? (<div className="mt-4 rounded-lg border border-border/70 bg-card/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">Class balance</p>
                      {quota && quota.status !== "none" ? (<Badge variant="outline">
                          {quota.remaining} {quota.remaining === 1 ? "class" : "classes"} remaining
                        </Badge>) : null}
                    </div>
                    {quota?.status === "none" ? (<p className="mt-1 text-xs text-muted-foreground">This plan has no class quota.</p>) : quota ? (<>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {quota.attended} attended of {quota.quota} total · {quota.remaining} remaining
                          {quota.exceeded > 0 ? ` · ${quota.exceeded} over quota` : ""}
                        </p>
                        {membership.carriedClasses > 0 ? (<p className="mt-1 text-xs text-muted-foreground">
                            {membership.carriedClasses} unused {membership.carriedClasses === 1 ? "class" : "classes"} carried forward
                          </p>) : null}
                      </>) : (<p className="mt-1 text-xs text-muted-foreground">Class balance is unavailable.</p>)}
                  </div>) : null}
              </CardContent>
            </Card>
          </Stagger>
        </div>

      </div>

      {/* Tabs */}
      <Tabs defaultValue="membership" className="print:hidden">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="membership" className="min-w-0 px-1 text-xs sm:px-2 sm:text-sm">Membership</TabsTrigger>
          <TabsTrigger value="attendance" className="min-w-0 px-1 text-xs sm:px-2 sm:text-sm">Attendance</TabsTrigger>
          <TabsTrigger value="payments" className="min-w-0 px-1 text-xs sm:px-2 sm:text-sm">Payments</TabsTrigger>
        </TabsList>

        {/* Membership history */}
        <TabsContent value="membership">
          <Card className="graphite-surface gap-0 border-border/70 py-0">
            {history.loading && !history.data ? (<div className="space-y-2 p-4">
                {Array.from({ length: 3 }).map((_, index) => (<Skeleton key={index} className="h-10"/>))}
              </div>) : history.error ? (<div className="p-4">
                <ErrorState title="Unable to load membership history" message={history.error} onRetry={history.reload}/>
              </div>) : (history.data ?? []).length === 0 ? (<div className="p-4">
                <EmptyState title="No memberships yet" description="Renew or assign a plan to start the membership timeline." className="py-8"/>
              </div>) : (<Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plan</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead className="hidden sm:table-cell">Charged</TableHead>
                    <TableHead className="hidden md:table-cell">Source</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history.data ?? []).map((entry) => (<TableRow key={entry.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{entry.planName ?? "Plan"}</p>
                        {entry.planDurationValue && entry.planDurationUnit ? (<p className="text-xs text-muted-foreground">
                            {durationLabel(entry.planDurationValue, entry.planDurationUnit)}
                          </p>) : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatDate(entry.startDate)} – {formatDate(entry.endDate)}
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {formatINR(entry.price)}
                        {entry.discount > 0 ? (<span className="text-xs text-muted-foreground"> (−{formatINR(entry.discount)})</span>) : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Badge variant="outline" className="capitalize">{titleCase(entry.source)}</Badge>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={entry.effectiveStatus ?? deriveEffectiveStatus(entry, "active")}/>
                      </TableCell>
                    </TableRow>))}
                </TableBody>
              </Table>)}
          </Card>
        </TabsContent>

        {/* Attendance */}
        <TabsContent value="attendance">
          <Card className="graphite-surface gap-0 border-border/70 py-0">
            {attendance.loading && !attendance.data ? (<div className="space-y-2 p-4">
                {Array.from({ length: 4 }).map((_, index) => (<Skeleton key={index} className="h-10"/>))}
              </div>) : attendance.error ? (<div className="p-4">
                <ErrorState title="Unable to load attendance" message={attendance.error} onRetry={attendance.reload}/>
              </div>) : (attendance.data ?? []).length === 0 ? (<div className="p-4">
                <EmptyState title="No check-ins yet" description="The last 20 visits will appear here after the first QR scan." className="py-8"/>
              </div>) : (<Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Check-in</TableHead>
                    <TableHead>Check-out</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(attendance.data ?? []).map((record) => (<TableRow key={record.id}>
                      <TableCell className="text-sm">
                        {formatDateTime(record.checkIn)}
                        {record.meta?.slotName ? <p className="mt-0.5 text-xs text-muted-foreground">{record.meta.slotName}</p> : null}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {record.checkOut ? formatDateTime(record.checkOut) : "—"}
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
                    </TableRow>))}
                </TableBody>
              </Table>)}
          </Card>
        </TabsContent>

        {/* Payments */}
        <TabsContent value="payments">
          <Card className="graphite-surface gap-0 border-border/70 py-0">
            {payments.loading && !payments.data ? (<div className="space-y-2 p-4">
                {Array.from({ length: 3 }).map((_, index) => (<Skeleton key={index} className="h-10"/>))}
              </div>) : payments.error ? (<div className="p-4">
                <ErrorState title="Unable to load payments" message={payments.error} onRetry={payments.reload}/>
              </div>) : (payments.data?.items ?? []).length === 0 ? (<div className="p-4">
                <EmptyState icon={<CreditCardIcon className="size-5"/>} title="No payments recorded" description="Payments recorded at the front desk or during renewal show up here." className="py-8"/>
              </div>) : (<Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(payments.data?.items ?? []).map((payment) => (<TableRow key={payment.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{payment.receiptNo}</p>
                        {payment.membershipSummary ? (<p className="text-xs text-muted-foreground">{payment.membershipSummary}</p>) : null}
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(payment.paymentDate)}</TableCell>
                      <TableCell className="text-sm font-medium tabular">
                        {formatINR(payment.amount)}
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {PAYMENT_METHOD_LABELS[payment.method]}
                      </TableCell>
                      <TableCell>
                        <PaymentBadge status={payment.status}/>
                      </TableCell>
                    </TableRow>))}
                </TableBody>
              </Table>)}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <MemberFormDialog open={editOpen} onOpenChange={setEditOpen} member={current} plans={plans.data ?? []} onSave={handleSave}/>

      <RenewDialog open={renewOpen} onOpenChange={setRenewOpen} member={current} plans={plans.data ?? []} onSave={async (input) => {
            try {
                await data.renewMembership(input);
                toast.success(membership ? "Membership renewed" : "Membership assigned");
                reloadAll();
                return true;
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to renew this membership.");
                return false;
            }
        }}/>

      <ConfirmActionDialog open={rotateOpen} onOpenChange={setRotateOpen} icon={RefreshCwIcon} title="Rotate QR code?" description="A fresh QR token is generated and the current one stops working immediately. Print the new card for the student." cancelLabel="Keep current QR" confirmLabel="Rotate QR" onConfirm={handleRotateQr}/>

      <ConfirmActionDialog open={statusOpen} onOpenChange={setStatusOpen} icon={isActive ? UserXIcon : UserCheckIcon} title={isActive ? `Deactivate ${current.fullName}?` : `Reactivate ${current.fullName}?`} description={isActive
            ? "Deactivated members cannot check in with QR. Their history and payments stay intact and you can reactivate them at any time."
            : "the student will be able to check in again as long as they have a valid membership."} cancelLabel="Cancel" confirmLabel={isActive ? "Deactivate member" : "Reactivate member"} onConfirm={handleToggleStatus}/>
    </div>);
}
