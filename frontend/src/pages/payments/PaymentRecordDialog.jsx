import { useEffect, useRef } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/auth/AuthProvider";
import { useSubmitGuard } from "@/hooks";
import { PAYMENT_METHOD_LABELS } from "@/lib/format";
import { ymdInTz } from "@/lib/datetime";
import { numericValue, paymentFormSchema } from "@/lib/validation";
const METHOD_OPTIONS = ["cash", "upi", "card", "bank_transfer", "other"];
const STATUS_OPTIONS = [
    { value: "paid", label: "Paid" },
    { value: "partial", label: "Partially paid" },
    { value: "pending", label: "Pending" },
];
export function PaymentRecordDialog({ open, onOpenChange, members, preset, onSaved, }) {
    const data = useData();
    const [submitting, run] = useSubmitGuard();
    const idempotencyKey = useRef(newKey());
    const { register, handleSubmit, control, reset, formState: { errors, isSubmitting }, } = useForm({
        resolver: zodResolver(paymentFormSchema),
        defaultValues: {
            memberId: "",
            membershipId: "",
            amount: 0,
            paymentDate: ymdInTz(new Date()),
            method: "cash",
            status: "paid",
            transactionRef: "",
            notes: "",
        },
    });
    // Re-seed the form whenever the dialog opens (RHF defaults only apply on mount).
    useEffect(() => {
        if (!open)
            return;
        idempotencyKey.current = newKey();
        reset({
            memberId: preset?.memberId ?? "",
            membershipId: preset?.membershipId ?? "",
            amount: preset?.amount ?? 0,
            paymentDate: ymdInTz(new Date()),
            method: "cash",
            status: "paid",
            transactionRef: "",
            notes: "",
        });
    }, [open, preset, reset]);
    const onSubmit = handleSubmit((values) => {
        void run(async () => {
            try {
                await data.createPayment({
                    memberId: values.memberId,
                    membershipId: values.membershipId?.trim() ? values.membershipId.trim() : null,
                    amount: values.amount,
                    method: values.method,
                    paymentDate: values.paymentDate,
                    status: values.status,
                    transactionRef: values.transactionRef?.trim() ? values.transactionRef.trim() : null,
                    notes: values.notes?.trim() ? values.notes.trim() : null,
                    idempotencyKey: idempotencyKey.current,
                });
                toast.success("Payment recorded");
                onSaved();
                onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to record the payment");
            }
        });
    });
    const busy = submitting || isSubmitting;
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>
            Log a fee payment against A student — cash, UPI, card or bank transfer.
          </DialogDescription>
        </DialogHeader>

        {members.length === 0 ? (<p className="rounded-lg border border-border/70 bg-secondary/40 p-3 text-sm text-muted-foreground">
            No members on record yet. Add A student first, then come back to record their payment.
          </p>) : (<form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="payment-member">Student</Label>
              <Controller control={control} name="memberId" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="payment-member" className="w-full" aria-invalid={errors.memberId ? true : undefined}>
                      <SelectValue placeholder="Choose A student"/>
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {members.map((member) => (<SelectItem key={member.id} value={member.id}>
                          {member.fullName} · {member.memberCode}
                        </SelectItem>))}
                    </SelectContent>
                  </Select>)}/>
              {errors.memberId ? <p className="text-xs text-destructive">{errors.memberId.message}</p> : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="payment-amount">Amount (₹)</Label>
                <Input id="payment-amount" type="number" inputMode="decimal" min={0} step="1" placeholder="1500" aria-invalid={errors.amount ? true : undefined} {...register("amount", { setValueAs: (value) => numericValue(value) })}/>
                {errors.amount ? <p className="text-xs text-destructive">{errors.amount.message}</p> : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payment-date">Payment date</Label>
                <Input id="payment-date" type="date" aria-invalid={errors.paymentDate ? true : undefined} {...register("paymentDate")}/>
                {errors.paymentDate ? <p className="text-xs text-destructive">{errors.paymentDate.message}</p> : null}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="payment-method">Method</Label>
                <Controller control={control} name="method" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="payment-method" className="w-full">
                        <SelectValue placeholder="Method"/>
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {METHOD_OPTIONS.map((method) => (<SelectItem key={method} value={method}>
                            {PAYMENT_METHOD_LABELS[method]}
                          </SelectItem>))}
                      </SelectContent>
                    </Select>)}/>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payment-status">Status</Label>
                <Controller control={control} name="status" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="payment-status" className="w-full">
                        <SelectValue placeholder="Status"/>
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {STATUS_OPTIONS.map((option) => (<SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>))}
                      </SelectContent>
                    </Select>)}/>
                <p className="text-xs text-muted-foreground">
                  Use “Partially paid” when the student still owes part of the billed amount.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment-ref">Transaction reference (optional)</Label>
              <Input id="payment-ref" placeholder="UPI ID, cheque no., last 4 digits…" {...register("transactionRef")}/>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment-notes">Notes (optional)</Label>
              <Textarea id="payment-notes" rows={2} placeholder="Anything the front desk should know" {...register("notes")}/>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Record payment"}
              </Button>
            </DialogFooter>
          </form>)}
      </DialogContent>
    </Dialog>);
}
function newKey() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
