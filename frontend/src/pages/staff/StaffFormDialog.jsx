import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PhotoPicker } from "@/components/shared/PhotoPicker";
import { useSubmitGuard } from "@/hooks";
import { toDateOnly } from "@/lib/datetime";
import { ROLE_LABELS } from "@/lib/permissions";
import { staffFormSchema } from "@/lib/validation";
/** Roles offered in the picker — "owner" is reserved for the account owner. */
const STAFF_ROLES = [
    "admin",
    "front_desk",
    "trainer",
];
const EMPLOYMENT_OPTIONS = [
    { value: "active", label: "Active" },
    { value: "on_leave", label: "On leave" },
    { value: "resigned", label: "Resigned" },
];
const EMPTY_VALUES = {
    fullName: "",
    email: "",
    phone: "",
    role: "trainer",
    specialization: "",
    employmentStatus: "active",
    joiningDate: toDateOnly(new Date()),
    photoUrl: "",
    notes: "",
    loginPassword: "",
};
function toInput(values) {
    const trimOrNull = (value) => {
        const trimmed = value?.trim();
        return trimmed ? trimmed : null;
    };
    return {
        fullName: values.fullName,
        email: trimOrNull(values.email),
        phone: values.phone,
        role: values.role,
        specialization: trimOrNull(values.specialization),
        employmentStatus: values.employmentStatus,
        joiningDate: values.joiningDate,
        photoUrl: trimOrNull(values.photoUrl),
        notes: trimOrNull(values.notes),
        // Empty → omitted, so the backend never touches existing credentials.
        loginPassword: trimOrNull(values.loginPassword) ?? undefined,
    };
}
export function StaffFormDialog({ open, onOpenChange, staff, onSave, }) {
    const [submitting, run] = useSubmitGuard();
    const [showPassword, setShowPassword] = useState(false);
    const { register, handleSubmit, control, reset, watch, setValue, formState: { errors }, } = useForm({
        resolver: zodResolver(staffFormSchema),
        defaultValues: EMPTY_VALUES,
    });
    const staffPhotoValue = watch("photoUrl") ?? "";
    const staffName = watch("fullName") || "Staff";
    useEffect(() => {
        if (!open)
            return;
        if (!staff) {
            reset(EMPTY_VALUES);
            return;
        }
        reset({
            fullName: staff.fullName,
            email: staff.email ?? "",
            phone: staff.phone ?? "",
            role: staff.role === "owner" ? "admin" : staff.role,
            specialization: staff.specialization ?? "",
            employmentStatus: staff.employmentStatus,
            joiningDate: staff.joiningDate,
            photoUrl: staff.photoUrl ?? "",
            notes: staff.notes ?? "",
            // Passwords are never prefilled — empty means "keep theirs".
            loginPassword: "",
        });
    }, [open, staff, reset]);
    const submit = handleSubmit((values) => {
        void run(async () => {
            try {
                const saved = await onSave(toInput(values));
                if (saved)
                    onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save the staff member.");
            }
        });
    });
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{staff ? "Edit staff member" : "Add staff"}</DialogTitle>
          <DialogDescription>
            {staff
            ? "Update role, contact details and employment status."
            : "Add a trainer, front desk member or admin to your team."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="staff-name">Full name</Label>
              <Input id="staff-name" placeholder="Aarav Sharma" {...register("fullName")}/>
              {errors.fullName ? <p className="text-xs text-destructive">{errors.fullName.message}</p> : null}
            </div>

            {/* Right at the top so the photo setter is obvious when the form opens. */}
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="staff-photo">Profile photo</Label>
              <PhotoPicker inputId="staff-photo" value={staffPhotoValue} name={staffName} onChange={(next) => setValue("photoUrl", next, { shouldDirty: true })}/>
              {errors.photoUrl ? <p className="text-xs text-destructive">{errors.photoUrl.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-email">Email</Label>
              <Input id="staff-email" type="email" placeholder="trainer@kalamandir.com" {...register("email")}/>
              {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-phone">Phone</Label>
              <Input id="staff-phone" placeholder="+91 98765 43210" {...register("phone")}/>
              {errors.phone ? <p className="text-xs text-destructive">{errors.phone.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Controller control={control} name="role" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a role"/>
                    </SelectTrigger>
                    <SelectContent>
                      {STAFF_ROLES.map((role) => (<SelectItem key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </SelectItem>))}
                    </SelectContent>
                  </Select>)}/>
              {errors.role ? <p className="text-xs text-destructive">{errors.role.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label>Employment status</Label>
              <Controller control={control} name="employmentStatus" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a status"/>
                    </SelectTrigger>
                    <SelectContent>
                      {EMPLOYMENT_OPTIONS.map((option) => (<SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>))}
                    </SelectContent>
                  </Select>)}/>
              {errors.employmentStatus ? (<p className="text-xs text-destructive">{errors.employmentStatus.message}</p>) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-specialization">Specialization</Label>
              <Input id="staff-specialization" placeholder="Strength & conditioning" {...register("specialization")}/>
              {errors.specialization ? (<p className="text-xs text-destructive">{errors.specialization.message}</p>) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="staff-joining">Joining date</Label>
              <Input id="staff-joining" type="date" {...register("joiningDate")}/>
              {errors.joiningDate ? (<p className="text-xs text-destructive">{errors.joiningDate.message}</p>) : null}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="staff-notes">Notes</Label>
              <Textarea id="staff-notes" rows={3} placeholder="Certifications, shift preferences…" {...register("notes")}/>
              {errors.notes ? <p className="text-xs text-destructive">{errors.notes.message}</p> : null}
            </div>

            {/* Portal login — they sign in on /login with this email + password.
                Empty password keeps an existing login's credentials untouched. */}
            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3 sm:col-span-2">
              <p className="text-sm font-medium">Portal login</p>
              <div className="space-y-2">
                <Label htmlFor="staff-login-password">{staff?.hasLogin ? "New password (reset)" : "Set a password"}</Label>
                <div className="relative">
                  <Input id="staff-login-password" type={showPassword ? "text" : "password"} placeholder="Set a password (min. 6 characters)" autoComplete="new-password" {...register("loginPassword")}/>
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-primary">
                    {showPassword ? <EyeOffIcon className="size-4"/> : <EyeIcon className="size-4"/>}
                  </button>
                </div>
                {errors.loginPassword ? (<p className="text-xs text-destructive">{errors.loginPassword.message}</p>) : null}
                <p className="text-xs text-muted-foreground">
                  {staff?.hasLogin
                  ? "Leave empty to keep their current password — typing a new one resets it. Role-based access applies automatically."
                  : "They sign in with their email + this password and get access based on their role. Leave empty to add a login later."}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2Icon className="size-4 animate-spin"/> : null}
              {submitting ? "Saving…" : staff ? "Save changes" : "Add staff member"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
