import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon, WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSubmitGuard } from "@/hooks";
import { renewalStartDate, planEndDate } from "@/lib/membership";
import { durationLabel, formatINR, formatDate, PAYMENT_METHOD_LABELS } from "@/lib/format";
import { numericValue, renewalFormSchema } from "@/lib/validation";
const PAYMENT_METHODS = ["cash", "upi", "card", "bank_transfer", "other"];
/**
 * Renew (or first-assign) a membership. Start date defaults to the day after
 * the current membership ends so members never pay for overlapping days.
 */
export function RenewDialog({ open, onOpenChange, member, plans, onSave, }) {
    const [submitting, run] = useSubmitGuard();
    const [recordPayment, setRecordPayment] = useState(false);
    const [paymentMethod, setPaymentMethod] = useState("cash");
    const [paymentAmount, setPaymentAmount] = useState("");
    const [paymentError, setPaymentError] = useState(null);
    const planChoices = useMemo(() => {
        const active = plans.filter((plan) => plan.isActive);
        return active.length > 0 ? active : plans;
    }, [plans]);
    const { register, handleSubmit, control, reset, watch, formState: { errors }, } = useForm({
        resolver: zodResolver(renewalFormSchema),
        defaultValues: {
            planId: member.membership?.planId ?? planChoices[0]?.id ?? "",
            startDate: renewalStartDate(new Date(), member.membership),
            discount: 0,
            notes: "",
        },
    });
    useEffect(() => {
        if (!open)
            return;
        setRecordPayment(false);
        setPaymentMethod("cash");
        setPaymentAmount("");
        setPaymentError(null);
        reset({
            planId: member.membership?.planId ?? planChoices[0]?.id ?? "",
            startDate: renewalStartDate(new Date(), member.membership),
            discount: 0,
            notes: "",
        });
    }, [open, member, planChoices, reset]);
    const watchedPlanId = watch("planId");
    const watchedStart = watch("startDate");
    const watchedDiscount = watch("discount");
    const selectedPlan = planChoices.find((plan) => plan.id === watchedPlanId) ?? null;
    const previewEnd = selectedPlan && watchedStart ? planEndDate(watchedStart, selectedPlan) : null;
    const payable = selectedPlan
        ? Math.max(0, selectedPlan.price - Math.max(0, numericValue(watchedDiscount)))
        : null;
    const submit = handleSubmit((values) => {
        const amount = numericValue(paymentAmount);
        if (recordPayment && !(amount > 0)) {
            setPaymentError("Enter the amount received");
            return;
        }
        setPaymentError(null);
        void run(async () => {
            try {
                const saved = await onSave({
                    memberId: member.id,
                    planId: values.planId,
                    startDate: values.startDate,
                    discount: values.discount,
                    notes: values.notes?.trim() ? values.notes.trim() : null,
                    source: member.membership ? "renewal" : "new",
                    initialPayment: recordPayment && amount > 0 ? { amount, method: paymentMethod } : null,
                });
                if (saved)
                    onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to renew this membership.");
            }
        });
    });
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member.membership ? "Renew membership" : "Assign membership"}</DialogTitle>
          <DialogDescription>
            {member.membership
            ? `Currently on ${member.planName ?? "a plan"} until ${formatDate(member.endDate)}.`
            : `${member.fullName} has no active membership yet.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label>Plan</Label>
              <Controller control={control} name="planId" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a plan"/>
                    </SelectTrigger>
                    <SelectContent>
                      {planChoices.map((plan) => (<SelectItem key={plan.id} value={plan.id}>
                          {plan.name} · {formatINR(plan.price)} ·{" "}
                          {durationLabel(plan.durationValue, plan.durationUnit)}
                        </SelectItem>))}
                    </SelectContent>
                  </Select>)}/>
              {errors.planId ? <p className="text-xs text-destructive">{errors.planId.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="renew-start">Start date</Label>
              <Input id="renew-start" type="date" {...register("startDate")}/>
              {errors.startDate ? (<p className="text-xs text-destructive">{errors.startDate.message}</p>) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="renew-discount">Discount (₹)</Label>
              <Input id="renew-discount" inputMode="decimal" placeholder="0" {...register("discount", { setValueAs: (value) => numericValue(value) })}/>
              {errors.discount ? (<p className="text-xs text-destructive">{errors.discount.message}</p>) : null}
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="renew-notes">Notes</Label>
              <Textarea id="renew-notes" rows={2} placeholder="Paid in full, festival offer…" {...register("notes")}/>
              {errors.notes ? <p className="text-xs text-destructive">{errors.notes.message}</p> : null}
            </div>
          </div>

          {selectedPlan && previewEnd ? (<div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/70 bg-card/60 px-4 py-3 text-sm">
              <span className="font-medium">{selectedPlan.name}</span>
              <span className="text-muted-foreground">
                {formatDate(watchedStart)} → {formatDate(previewEnd)}
              </span>
              {payable !== null ? (<span className="ml-auto font-semibold text-primary">{formatINR(payable)}</span>) : null}
            </div>) : null}

          <div className="flex flex-wrap items-center gap-4">
            <label htmlFor="renew-record-payment" className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox id="renew-record-payment" checked={recordPayment} onCheckedChange={(checked) => setRecordPayment(checked === true)}/>
              Record payment now
            </label>

            {recordPayment ? (<div className="flex items-center gap-2">
                <Input aria-label="Amount received" inputMode="decimal" placeholder="Amount ₹" value={paymentAmount} onChange={(event) => {
                setPaymentAmount(event.target.value);
                if (paymentError)
                    setPaymentError(null);
            }} className="w-28"/>
                <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value)}>
                  <SelectTrigger size="sm" aria-label="Payment method">
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
          {paymentError ? <p className="text-xs text-destructive">{paymentError}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (<Loader2Icon className="size-4 animate-spin"/>) : (<WalletIcon className="size-4"/>)}
              {submitting
            ? "Saving…"
            : member.membership
                ? "Confirm renewal"
                : "Assign membership"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
