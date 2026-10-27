import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/auth/AuthProvider";
import { useSubmitGuard } from "@/hooks";
import { formatDateTime } from "@/lib/format";
const correctionSchema = z
    .object({
    checkIn: z.string().min(1, "Check-in time is required"),
    checkOut: z.string(),
    notes: z.string().trim().max(500, "Keep notes under 500 characters"),
})
    .superRefine((values, ctx) => {
    const checkIn = new Date(values.checkIn).getTime();
    if (!Number.isFinite(checkIn)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["checkIn"],
            message: "Enter a valid check-in date and time",
        });
        return;
    }
    if (values.checkOut.length === 0)
        return;
    const checkOut = new Date(values.checkOut).getTime();
    if (!Number.isFinite(checkOut)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["checkOut"],
            message: "Enter a valid check-out date and time",
        });
        return;
    }
    if (checkOut <= checkIn) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["checkOut"],
            message: "Check-out must be after check-in",
        });
    }
});
const EMPTY_VALUES = { checkIn: "", checkOut: "", notes: "" };
/** ISO → value for `<input type="datetime-local">` (local wall-clock, no seconds). */
function toLocalInput(iso) {
    if (!iso)
        return "";
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime()))
        return "";
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function AttendanceCorrectionDialog({ record, open, onOpenChange, onSaved, }) {
    const data = useData();
    const [submitting, run] = useSubmitGuard();
    const { register, handleSubmit, reset, formState: { errors }, } = useForm({
        resolver: zodResolver(correctionSchema),
        defaultValues: EMPTY_VALUES,
    });
    useEffect(() => {
        if (!open || !record)
            return;
        reset({
            checkIn: toLocalInput(record.checkIn),
            checkOut: toLocalInput(record.checkOut),
            notes: record.notes ?? "",
        });
    }, [open, record, reset]);
    const submit = handleSubmit((values) => {
        if (!record)
            return;
        void run(async () => {
            const patch = {
                checkIn: new Date(values.checkIn).toISOString(),
                checkOut: values.checkOut ? new Date(values.checkOut).toISOString() : null,
                notes: values.notes.trim() ? values.notes.trim() : null,
            };
            try {
                await data.correctAttendance(record.id, patch);
                toast.success("Attendance corrected", {
                    description: `${record.memberName ?? "Student"} · ${formatDateTime(patch.checkIn)}`,
                });
                onSaved();
                onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save this correction.");
            }
        });
    });
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Correct attendance</DialogTitle>
          <DialogDescription>
            {record
            ? `${record.memberName ?? "Student"}${record.memberCode ? ` · ${record.memberCode}` : ""} · checked in ${formatDateTime(record.checkIn)}`
            : "Adjust the recorded times or add a note."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="correction-check-in">Check-in</Label>
            <Input id="correction-check-in" type="datetime-local" {...register("checkIn")}/>
            {errors.checkIn ? (<p className="text-xs text-destructive">{errors.checkIn.message}</p>) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="correction-check-out">Check-out</Label>
            <Input id="correction-check-out" type="datetime-local" {...register("checkOut")} aria-invalid={errors.checkOut ? true : undefined}/>
            {errors.checkOut ? (<p className="text-xs text-destructive">{errors.checkOut.message}</p>) : null}
            <p className="text-xs text-muted-foreground">
              Leave empty to mark the student as still checked in.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="correction-notes">Notes</Label>
            <Textarea id="correction-notes" rows={3} placeholder="Why is this being corrected?" {...register("notes")}/>
            {errors.notes ? (<p className="text-xs text-destructive">{errors.notes.message}</p>) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !record}>
              {submitting ? <Loader2Icon className="animate-spin"/> : null}
              {submitting ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
