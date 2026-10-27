import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon, Loader2Icon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { PhotoPicker } from "@/components/shared/PhotoPicker";
import { useData } from "@/auth/AuthProvider";
import { useAsync, useSubmitGuard } from "@/hooks";
import { toDateOnly } from "@/lib/datetime";
import { durationLabel, formatINR, PAYMENT_METHOD_LABELS, timeSlotLabel } from "@/lib/format";
import { SLOT_GROUPS, slotGroupOf } from "@/lib/slots";
import { CLASS_TAGS, memberFormSchema } from "@/lib/validation";
const GENDER_OPTIONS = [
    { value: "male", label: "Male" },
    { value: "female", label: "Female" },
    { value: "other", label: "Other" },
    { value: "prefer_not_to_say", label: "Prefer not to say" },
];
const PAYMENT_METHODS = ["cash", "upi", "card", "bank_transfer", "other"];
function emptyValues() {
    const today = toDateOnly(new Date());
    return {
        fullName: "",
        email: "",
        phone: "",
        dateOfBirth: "",
        // NaN renders an empty number input and validates as "not set".
        age: Number.NaN,
        address: "",
        emergencyContactName: "",
        emergencyContactPhone: "",
        joinDate: today,
        planId: "",
        membershipStart: today,
        // Class stream (Art / Dance) — required; "" forces an explicit pick.
        classTag: "",
        loginPassword: "",
        // Hidden flag: "create" requires a login password, "edit" does not.
        mode: "create",
        photoUrl: "",
        notes: "",
        // NaN renders an empty number input and validates as "not set".
        plannedHoursPerDay: Number.NaN,
        // [] = no slots picked (multi-select; first entry = preferred slot).
        preferredSlot: [],
        // "" = no trainer assigned (zod → null before hitting the API).
        trainerId: "",
    };
}
function trimOrNull(value) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}
/** "2014-05-12" → 12 (whole years as of today); null when empty/junk/future. */
function ageFrom(dob) {
    if (!dob)
        return null;
    const [y, m, d] = String(dob).split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d))
        return null;
    const birth = new Date(y, m - 1, d);
    if (Number.isNaN(birth.getTime()) || birth > new Date())
        return null;
    const today = new Date();
    let age = today.getFullYear() - y;
    if (today.getMonth() < m - 1 || (today.getMonth() === m - 1 && today.getDate() < d))
        age -= 1;
    return age >= 0 ? age : null;
}
/** Concrete identity fields — required by create, all optional on update. */
function toIdentityInput(values) {
    return {
        fullName: values.fullName,
        email: trimOrNull(values.email),
        phone: values.phone,
        photoUrl: trimOrNull(values.photoUrl),
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth : null,
        // Age is derived from the date of birth (never typed by hand). Falls
        // back to the member's stored age only when no DOB is on file.
        age: ageFrom(values.dateOfBirth)
            ?? (typeof values.age === "number" && Number.isFinite(values.age) && values.age > 0
                ? Math.trunc(values.age)
                : null),
        gender: values.gender ?? null,
        address: trimOrNull(values.address),
        emergencyContactName: trimOrNull(values.emergencyContactName),
        plannedHoursPerDay: typeof values.plannedHoursPerDay === "number" && values.plannedHoursPerDay > 0
            ? values.plannedHoursPerDay
            : null,
        // Multi-slot picker — [0] = preferred/primary; every selected range
        // is persisted as a recurring batch enrollment on create and edit.
        slotRanges: Array.isArray(values.preferredSlot) ? values.preferredSlot : [],
        preferredSlot: (Array.isArray(values.preferredSlot) ? values.preferredSlot[0] : values.preferredSlot) ?? null,
        // On edit, omit classTag when empty so the existing value isn't clobbered.
        classTag: values.mode === "edit" ? (values.classTag || undefined) : values.classTag,
        emergencyContactPhone: values.emergencyContactPhone ? values.emergencyContactPhone : null,
        joinDate: values.joinDate,
        notes: trimOrNull(values.notes),
        // Assigned trainer — "" / blank → null (unassigned).
        trainerId: trimOrNull(values.trainerId),
    };
}
function toUpdateInput(values) {
    return toIdentityInput(values);
}
function toCreateInput(values, method, recordPayment) {
    const amount = values.initialPayment;
    const identity = toIdentityInput(values);
    return {
        ...identity,
        // Multi-slot signup — every picked range becomes a batch enrollment
        // on the backend; preferredSlot ([0]) stays the primary row.
        slotRanges: identity.slotRanges,
        planId: values.planId,
        membershipStart: values.membershipStart,
        loginPassword: trimOrNull(values.loginPassword) ?? undefined,
        initialPayment: recordPayment && typeof amount === "number" && amount > 0
            ? { amount, method, paymentDate: toDateOnly(new Date()) }
            : null,
    };
}
/**
 * Add / Edit student dialog.
 *
 * CREATE mode additionally assigns the first membership (plan + start date)
 * and can record the opening payment. EDIT mode only touches the student's
 * personal fields — memberships are managed via renew on the detail page.
 */
export function MemberFormDialog({ open, onOpenChange, member, plans, onSave, }) {
    const [submitting, run] = useSubmitGuard();
    const navigate = useNavigate();
    const [recordPayment, setRecordPayment] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState("cash");
    const [showPassword, setShowPassword] = useState(false);
    const { register, handleSubmit, control, reset, watch, setValue, formState: { errors }, } = useForm({
        resolver: zodResolver(memberFormSchema),
        defaultValues: emptyValues(),
    });
    const photoValue = watch("photoUrl") ?? "";
    const memberName = watch("fullName") || "Student";
    const isEdit = member !== null;
    /** Plans offered in the picker — active first; fall back to everything. */
    const planChoices = useMemo(() => {
        const active = plans.filter((plan) => plan.isActive);
        return active.length > 0 ? active : plans;
    }, [plans]);
    /** Currently picked plan — powers the "total" read-out under the picker. */
    const watchedPlanId = watch("planId");
    const selectedPlan = useMemo(
        () => planChoices.find((plan) => plan.id === watchedPlanId) ?? null,
        [planChoices, watchedPlanId],
    );
    const data = useData();
    /** Gym slot schedule — drives the preferred-slot picker (hidden when empty). */
    const gym = useAsync(() => data.getGymFresh(), [data]);
    const slots = useMemo(() => (gym.data?.timeSlots ?? []).filter((slot) => slot.start && slot.end), [gym.data]);
    /** Active staff — drives the "Assigned trainer" picker. */
    const staffList = useAsync(() => data.listStaff(false), [data]);
    const trainerChoices = useMemo(
        () => [...(staffList.data ?? [])].sort((a, b) => a.fullName.localeCompare(b.fullName)),
        [staffList.data],
    );
    useEffect(() => {
        if (!open)
            return;
        setRecordPayment(false);
        setPaymentMethod("cash");
        setShowPassword(false);
        if (!member) {
            reset(emptyValues());
            return;
        }
        reset({
            ...emptyValues(),
            fullName: member.fullName,
            email: member.email ?? "",
            phone: member.phone,
            dateOfBirth: member.dateOfBirth ? toDateOnly(member.dateOfBirth) : "",
            gender: member.gender ?? undefined,
            address: member.address ?? "",
            emergencyContactName: member.emergencyContactName ?? "",
            emergencyContactPhone: member.emergencyContactPhone ?? "",
            joinDate: toDateOnly(member.joinDate),
            photoUrl: member.photoUrl ?? "",
            notes: member.notes ?? "",
            plannedHoursPerDay: member.plannedHoursPerDay ?? Number.NaN,
            // Multi-slot picker reflects all active batch enrollments; older
            // records fall back to their preferred slot.
            preferredSlot: member.slotRanges?.length
                ? member.slotRanges
                : member.preferredSlot ? [member.preferredSlot] : [],
            trainerId: member.trainerId ?? "",
            classTag: member.classTag ?? "",
            age: typeof member.age === "number" && member.age > 0 ? member.age : Number.NaN,
            // Hidden in edit mode; the schema only requires it on create.
            mode: "edit",
            // Hidden in edit mode, but the schema still requires non-empty values.
            // They are never sent to `updateMember`, so a placeholder is safe.
            planId: member.membership?.planId ?? member.id,
            membershipStart: member.membership?.startDate ?? toDateOnly(member.joinDate),
            loginPassword: "",
        });
    }, [open, member, reset]);
    const submit = handleSubmit((values) => {
        void run(async () => {
            try {
                const saved = await onSave(member
                    ? { mode: "update", input: toUpdateInput(values) }
                    : { mode: "create", input: toCreateInput(values, paymentMethod, recordPayment) });
                if (saved)
                    onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save this student.");
            }
        });
    }, (errors) => {
        const firstKey = Object.keys(errors)[0];
        const msg = (firstKey && errors[firstKey]?.message) || "Please fix the highlighted fields before saving.";
        toast.error(msg);
    });
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit student" : "Add student"}</DialogTitle>
          <DialogDescription>
            {isEdit
            ? "Update personal details, contact information, emergency contact and class slots."
            : "Create A student profile and assign their first membership."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="member-name">Full name</Label>
              <Input id="member-name" placeholder="Aarav Sharma" {...register("fullName")}/>
              {errors.fullName ? <p className="text-xs text-destructive">{errors.fullName.message}</p> : null}
            </div>

            {/* Right at the top so the photo setter is obvious when the form opens. */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="member-photo">Profile photo</Label>
              <PhotoPicker value={photoValue} name={memberName} onChange={(next) => setValue("photoUrl", next, { shouldDirty: true })}/>
              {errors.photoUrl ? (<p className="text-xs text-destructive">{errors.photoUrl.message}</p>) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-email">Email</Label>
              <Input id="member-email" type="email" placeholder="student@kalamandir.com" {...register("email")}/>
              {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-phone">Phone</Label>
              <Input id="member-phone" placeholder="+91 98765 43210" {...register("phone")}/>
              {errors.phone ? <p className="text-xs text-destructive">{errors.phone.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-dob">Date of birth</Label>
              <Input id="member-dob" type="date" max={toDateOnly(new Date())} {...register("dateOfBirth")}/>
              {(() => {
                const derived = ageFrom(watch("dateOfBirth"));
                return derived !== null
                    ? (<p className="text-[11px] text-muted-foreground">Age: <span className="font-medium text-foreground">{derived} years</span> (calculated automatically)</p>)
                    : (<p className="text-[11px] text-muted-foreground">Age is calculated from the date of birth.</p>);
            })()}
              {errors.dateOfBirth ? (<p className="text-xs text-destructive">{errors.dateOfBirth.message}</p>) : null}
            </div>

            <div className="space-y-2">
              <Label>Gender</Label>
              <Controller control={control} name="gender" render={({ field }) => (<Select value={field.value ?? "prefer_not_to_say"} onValueChange={(value) => field.onChange(value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose"/>
                    </SelectTrigger>
                    <SelectContent>
                      {GENDER_OPTIONS.map((option) => (<SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>))}
                    </SelectContent>
                  </Select>)}/>
              {errors.gender ? <p className="text-xs text-destructive">{errors.gender.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-join">Join date</Label>
              <Input id="member-join" type="date" {...register("joinDate")}/>
              {errors.joinDate ? (<p className="text-xs text-destructive">{errors.joinDate.message}</p>) : null}
            </div>

            {/* Class stream — Art or Dance; required on both add & edit. */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Class tag</Label>
              <Controller control={control} name="classTag" render={({ field }) => (<div className="flex gap-2">
                  {CLASS_TAGS.map((tag) => {
                    const active = field.value === tag;
                    return (<button key={tag} type="button" onClick={() => field.onChange(tag)} aria-pressed={active} className={`rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/60 bg-background text-muted-foreground hover:bg-accent"}`}>
                        {tag}
                      </button>);
                  })}
                </div>)}/>
              {errors.classTag ? (<p className="text-xs text-destructive">{errors.classTag.message}</p>) : null}
            </div>

            {/* Preferred slot — the batch the student chose at joining (gym slots from Manage Institute). */}
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between">
                <Label>Time slots (student's batches)</Label>
                <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => navigate("/manage-gym")}>
                  <PlusIcon className="size-3.5"/> Add More Slots
                </Button>
              </div>
              {slots.length > 0 ? (<Controller control={control} name="preferredSlot" render={({ field }) => (<div className="space-y-3">
                  {SLOT_GROUPS.map((group) => {
                    const groupSlots = slots.filter((slot) => slotGroupOf(slot.start) === group.key);
                    if (groupSlots.length === 0) return null;
                    return (<div key={group.key}>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                      <div className="flex flex-wrap gap-2">
                        {groupSlots.map((slot) => {
                          const key = `${slot.start}-${slot.end}`;
                          const active = Array.isArray(field.value) && field.value.includes(key);
                          return (<button key={key} type="button" onClick={() => {
                            // Multi-select toggle — pick order matters: the
                            // FIRST chosen slot is the preferred/primary one.
                            const list = Array.isArray(field.value) ? field.value : [];
                            field.onChange(active ? list.filter((k) => k !== key) : [...list, key]);
                          }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/60 bg-background text-muted-foreground hover:bg-accent"}`}>
                              {timeSlotLabel(slot)}
                            </button>);
                        })}
                      </div>
                    </div>);
                  })}
                  {slots.some((slot) => !slotGroupOf(slot.start)) ? (<div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Other</p>
                      <div className="flex flex-wrap gap-2">
                        {slots.filter((slot) => !slotGroupOf(slot.start)).map((slot) => {
                          const key = `${slot.start}-${slot.end}`;
                          const active = Array.isArray(field.value) && field.value.includes(key);
                          return (<button key={key} type="button" onClick={() => {
                            // Multi-select toggle — pick order matters: the
                            // FIRST chosen slot is the preferred/primary one.
                            const list = Array.isArray(field.value) ? field.value : [];
                            field.onChange(active ? list.filter((k) => k !== key) : [...list, key]);
                          }} className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${active
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border/60 bg-background text-muted-foreground hover:bg-accent"}`}>
                              {timeSlotLabel(slot)}
                            </button>);
                        })}
                      </div>
                    </div>) : null}
                  {(() => {
                    const picked = Array.isArray(field.value) ? field.value : [];
                    if (picked.length === 0) return null;
                    const format = (key) => {
                      const slot = slots.find((s) => `${s.start}-${s.end}` === key);
                      return slot ? timeSlotLabel(slot) : key;
                    };
                    return (<p className="text-[11px] text-muted-foreground">
                      {picked.length} slot{picked.length === 1 ? "" : "s"} selected — each gets its own batch
                      enrollment. <span className="font-medium text-foreground">{format(picked[0])}</span> is the
                      preferred (primary) slot.
                    </p>);
                  })()}
                </div>)} />) : (<p className="text-[11px] text-muted-foreground">No time slots configured yet — add them from Manage Institute.</p>)}
              {errors.preferredSlot ? (<p className="text-xs text-destructive">{errors.preferredSlot.message}</p>) : null}
            </div>

            {/* Assigned trainer — the staff member responsible for this student. */}
            <div className="space-y-2 sm:col-span-2">
              <Label>Assigned trainer</Label>
              {trainerChoices.length > 0 ? (<Controller control={control} name="trainerId" render={({ field }) => (<Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a trainer (optional)"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">No trainer assigned</SelectItem>
                      {trainerChoices.map((staff) => (<SelectItem key={staff.id} value={staff.id}>
                          {staff.fullName}
                          {staff.role === "trainer" ? "" : ` · ${staff.role}`}
                        </SelectItem>))}
                    </SelectContent>
                  </Select>)}/>) : null}
              <p className="text-[11px] text-muted-foreground">Shows next to this student on the attendance sheet.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-emergency-name">Emergency contact name</Label>
              <Input id="member-emergency-name" placeholder="Meera Sharma" {...register("emergencyContactName")}/>
              {errors.emergencyContactName ? (<p className="text-xs text-destructive">{errors.emergencyContactName.message}</p>) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="member-emergency-phone">Emergency contact phone</Label>
              <Input id="member-emergency-phone" placeholder="+91 98765 43210" {...register("emergencyContactPhone")}/>
              {errors.emergencyContactPhone ? (<p className="text-xs text-destructive">{errors.emergencyContactPhone.message}</p>) : null}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="member-address">Address</Label>
              <Input id="member-address" placeholder="Flat 4B, Palm Grove, Indiranagar" {...register("address")}/>
              {errors.address ? <p className="text-xs text-destructive">{errors.address.message}</p> : null}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="member-notes">Notes</Label>
              <Textarea id="member-notes" rows={2} placeholder="Injuries, goals, preferred slot…" {...register("notes")}/>
              {errors.notes ? <p className="text-xs text-destructive">{errors.notes.message}</p> : null}
            </div>
          </div>

          {!isEdit ? (<>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <p className="text-sm font-medium sm:col-span-2">First membership</p>

                <div className="space-y-2 sm:col-span-2">
                  <Label>Plan</Label>
                  <Controller control={control} name="planId" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a plan"/>
                        </SelectTrigger>
                        <SelectContent>
                          {planChoices.map((plan) => (<SelectItem key={plan.id} value={plan.id}>
                              {plan.name} · {durationLabel(plan.durationValue, plan.durationUnit)}
                            </SelectItem>))}
                        </SelectContent>
                      </Select>)}/>
                  {selectedPlan ? (<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-xs">
                      <span className="flex items-baseline gap-1.5">
                        <span className="text-muted-foreground">Total</span>
                        <span className="text-sm font-semibold text-foreground">{formatINR(selectedPlan.price)}</span>
                      </span>
                      <span className="text-muted-foreground">
                        {durationLabel(selectedPlan.durationValue, selectedPlan.durationUnit)}
                      </span>
                      {selectedPlan.classQuota ? (<span className="text-muted-foreground">
                          {selectedPlan.classQuota} classes
                        </span>) : null}
                    </div>) : null}
                  {errors.planId ? <p className="text-xs text-destructive">{errors.planId.message}</p> : null}
                </div>

                <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                  <label htmlFor="member-record-payment" className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox id="member-record-payment" checked={recordPayment} onCheckedChange={(checked) => setRecordPayment(checked === true)}/>
                    Record a payment with this membership
                  </label>

                  {recordPayment ? (<div className="flex items-center gap-2">
                      <Label htmlFor="member-payment-method" className="text-xs text-muted-foreground">
                        Method
                      </Label>
                      <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value)}>
                        <SelectTrigger id="member-payment-method" size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_METHODS.map((method) => (<SelectItem key={method} value={method}>
                              {PAYMENT_METHOD_LABELS[method]}
                            </SelectItem>))}
                        </SelectContent>
                      </Select>
                    </div>) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="member-start">Membership starts</Label>
                  <Input id="member-start" type="date" {...register("membershipStart")}/>
                  {errors.membershipStart ? (<p className="text-xs text-destructive">{errors.membershipStart.message}</p>) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="member-payment-amount">Initial payment (₹)</Label>
                  <Input id="member-payment-amount" inputMode="decimal" placeholder="0" disabled={!recordPayment} {...register("initialPayment", {
            setValueAs: (value) => {
                if (value === "" || value === null || value === undefined)
                    return undefined;
                const parsed = Number(String(value).replace(/[^0-9.-]/g, ""));
                return Number.isFinite(parsed) ? parsed : Number.NaN;
            },
        })}/>
                  {errors.initialPayment ? (<p className="text-xs text-destructive">{errors.initialPayment.message}</p>) : null}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <p className="text-sm font-medium sm:col-span-2">Student portal login</p>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="member-login-password">Portal password</Label>
                  <div className="relative">
                    <Input id="member-login-password" type={showPassword ? "text" : "password"} placeholder="Set a password (min. 6 characters)" autoComplete="new-password" {...register("loginPassword")}/>
                    <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-primary">
                      {showPassword ? <EyeOffIcon className="size-4"/> : <EyeIcon className="size-4"/>}
                    </button>
                  </div>
                  {errors.loginPassword ? (<p className="text-xs text-destructive">{errors.loginPassword.message}</p>) : null}
                </div>
              </div>
            </>) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2Icon className="size-4 animate-spin"/> : null}
              {submitting ? "Saving…" : isEdit ? "Save changes" : "Add student"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
