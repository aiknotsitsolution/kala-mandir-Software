import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Undo2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/auth/AuthProvider";
import { useSubmitGuard } from "@/hooks";
import { formatINR } from "@/lib/format";
import { numericValue, refundFormSchema } from "@/lib/validation";
export function RefundDialog({ payment, remaining, onOpenChange, onSaved, }) {
    const data = useData();
    const [submitting, run] = useSubmitGuard();
    const schema = useMemo(() => refundFormSchema.superRefine((values, ctx) => {
        if (values.amount > remaining) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["amount"],
                message: `Cannot exceed the refundable balance of ${formatINR(remaining)}`,
            });
        }
    }), [remaining]);
    const { register, handleSubmit, reset, formState: { errors, isSubmitting }, } = useForm({
        resolver: zodResolver(schema),
        defaultValues: { amount: remaining, reason: "" },
    });
    useEffect(() => {
        if (!payment)
            return;
        reset({ amount: remaining, reason: "" });
    }, [payment, remaining, reset]);
    const onSubmit = handleSubmit((values) => {
        if (!payment)
            return;
        void run(async () => {
            try {
                await data.refundPayment(payment.id, values.amount, values.reason);
                toast.success(`Refund of ${formatINR(values.amount)} recorded for ${payment.receiptNo}`);
                onSaved();
                onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to record the refund");
            }
        });
    });
    const busy = submitting || isSubmitting;
    return (<Dialog open={payment !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2Icon className="size-4 text-warning"/>
            Refund {payment?.receiptNo ?? "payment"}
          </DialogTitle>
          <DialogDescription>
            {payment ? `${payment.memberName ?? "Student"} paid ${formatINR(payment.amount)} on this receipt.` : ""}
            {" "}Record a full or partial refund — the original receipt is never changed.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/70 bg-secondary/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Original amount</span>
            <span className="tabular">{formatINR(payment?.amount ?? 0)}</span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">Refundable balance</span>
            <span className="font-medium tabular text-warning">{formatINR(remaining)}</span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="refund-amount">Refund amount (₹)</Label>
            <Input id="refund-amount" type="number" inputMode="decimal" min={0} step="1" aria-invalid={errors.amount ? true : undefined} {...register("amount", { setValueAs: (value) => numericValue(value) })}/>
            {errors.amount ? <p className="text-xs text-destructive">{errors.amount.message}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="refund-reason">Reason</Label>
            <Textarea id="refund-reason" rows={3} placeholder="e.g. Student moved out of the city" aria-invalid={errors.reason ? true : undefined} {...register("reason")}/>
            {errors.reason ? <p className="text-xs text-destructive">{errors.reason.message}</p> : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={busy}>
              <Undo2Icon className="size-4"/> {busy ? "Refunding…" : "Record refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
