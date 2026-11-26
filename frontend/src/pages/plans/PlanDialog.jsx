import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useData } from "@/auth/AuthProvider";
import { useSubmitGuard } from "@/hooks";
import { durationLabel } from "@/lib/format";
import { numericValue, planFormSchema } from "@/lib/validation";
import { cn } from "@/lib/utils";
const DURATION_UNITS = [
    { value: "day", label: "Days" },
    { value: "week", label: "Weeks" },
    { value: "month", label: "Months" },
    { value: "year", label: "Years" },
];
const WEEK_DAYS = [
    { value: 1, label: "Monday", short: "Mon" },
    { value: 2, label: "Tuesday", short: "Tue" },
    { value: 3, label: "Wednesday", short: "Wed" },
    { value: 4, label: "Thursday", short: "Thu" },
    { value: 5, label: "Friday", short: "Fri" },
    { value: 6, label: "Saturday", short: "Sat" },
    { value: 7, label: "Sunday", short: "Sun" },
];

function parseSelectedDays(scheduleLabel) {
    const value = String(scheduleLabel ?? "").trim();
    if (!value)
        return [];

    const lower = value.toLowerCase();
    const rangeMatch = lower.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*(?:-|–|—|to)\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (rangeMatch) {
        const first = WEEK_DAYS.find((day) => day.label.toLowerCase() === rangeMatch[1]);
        const last = WEEK_DAYS.find((day) => day.label.toLowerCase() === rangeMatch[2]);
        if (first && last && last.value >= first.value)
            return WEEK_DAYS.filter((day) => day.value >= first.value && day.value <= last.value).map((day) => day.value);
    }

    return WEEK_DAYS
        .filter((day) => lower.includes(day.label.toLowerCase()))
        .map((day) => day.value);
}

function formatSelectedDays(selected) {
    if (selected.length === 0)
        return "";
    if (selected.length === 7)
        return "Monday – Sunday";
    const sorted = [...selected].sort((a, b) => a - b);
    const consecutive = sorted.every((day, index) => index === 0 || day === sorted[index - 1] + 1);
    if (consecutive && sorted.length > 2) {
        const first = WEEK_DAYS.find((day) => day.value === sorted[0]);
        const last = WEEK_DAYS.find((day) => day.value === sorted.at(-1));
        return `${first.label} – ${last.label}`;
    }
    return sorted
        .map((value) => WEEK_DAYS.find((day) => day.value === value)?.label)
        .filter(Boolean)
        .join(", ");
}

function FieldError({ message }) {
    if (!message)
        return null;
    return <p className="text-xs text-destructive">{message}</p>;
}
export function PlanDialog({ plan, open, onOpenChange, onSaved, }) {
    const data = useData();
    const [submitting, run] = useSubmitGuard();
    const [selectedDays, setSelectedDays] = useState(() => parseSelectedDays(plan?.scheduleLabel));
    const defaultValues = {
        name: plan?.name ?? "",
        description: plan?.description ?? "",
        price: plan?.price ?? 0,
        durationValue: plan?.durationValue ?? 1,
        durationUnit: plan?.durationUnit ?? "month",
        classQuota: plan?.classQuota ?? null,
        scheduleLabel: plan?.scheduleLabel ?? "",
        benefits: (plan?.benefits ?? []).join("\n"),
        isActive: plan?.isActive ?? true,
    };
    const { register, handleSubmit, control, watch, setValue, formState: { errors, isSubmitting }, } = useForm({
        resolver: zodResolver(planFormSchema),
        defaultValues,
    });
    const durationValue = numericValue(watch("durationValue"), 1);
    const durationUnit = watch("durationUnit");
    const isActive = watch("isActive");
    const classQuotaValue = watch("classQuota");
    const toggleDay = (dayValue) => {
        setSelectedDays((current) => {
            const next = current.includes(dayValue)
                ? current.filter((value) => value !== dayValue)
                : [...current, dayValue];
            setValue("scheduleLabel", formatSelectedDays(next), { shouldDirty: true });
            return next;
        });
    };
    const onSubmit = handleSubmit((values) => {
        const payload = {
            name: values.name,
            description: values.description?.trim() ? values.description.trim() : null,
            price: values.price,
            durationValue: values.durationValue,
            durationUnit: values.durationUnit,
            // Blank quota = null → duration-only plan (legacy behaviour preserved).
            classQuota: values.classQuota == null || values.classQuota === "" ? null : values.classQuota,
            // Blank schedule = null → the card derives it from duration.
            scheduleLabel: values.scheduleLabel?.trim() ? values.scheduleLabel.trim() : null,
            benefits: values.benefits
                ? values.benefits
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean)
                : [],
            isActive: values.isActive,
        };
        void run(async () => {
            try {
                if (plan) {
                    await data.updatePlan(plan.id, payload);
                    toast.success(`${payload.name} updated`);
                }
                else {
                    await data.createPlan(payload);
                    toast.success(`${payload.name} created`);
                }
                onSaved();
                onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save the plan");
            }
        });
    });
    const busy = submitting || isSubmitting;
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? "Edit plan" : "New membership plan"}</DialogTitle>
          <DialogDescription>
            {plan
            ? "Update pricing, duration and benefits for this plan."
            : "Set the price, duration and perks members get with this plan."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="plan-name">Plan name</Label>
            <Input id="plan-name" placeholder="e.g. Monthly Unlimited" aria-invalid={errors.name ? true : undefined} {...register("name")}/>
            <FieldError message={errors.name?.message}/>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-description">Description</Label>
            <Textarea id="plan-description" rows={2} placeholder="Short line shown under the plan name" {...register("description")}/>
            <FieldError message={errors.description?.message}/>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-price">Price (₹)</Label>
              <Input id="plan-price" type="number" inputMode="decimal" min={0} step="1" placeholder="1500" aria-invalid={errors.price ? true : undefined} {...register("price", { setValueAs: (value) => numericValue(value) })}/>
              <FieldError message={errors.price?.message}/>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-duration">Duration</Label>
              <div className="flex items-center gap-2">
                <Input id="plan-duration" type="number" inputMode="numeric" min={1} step={1} className="w-24" aria-invalid={errors.durationValue ? true : undefined} {...register("durationValue", { setValueAs: (value) => numericValue(value, 1) })}/>
                <Controller control={control} name="durationUnit" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="w-full" aria-invalid={errors.durationUnit ? true : undefined}>
                        <SelectValue placeholder="Unit"/>
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {DURATION_UNITS.map((unit) => (<SelectItem key={unit.value} value={unit.value}>
                            {unit.label}
                          </SelectItem>))}
                      </SelectContent>
                    </Select>)}/>
              </div>
              <p className="text-xs text-muted-foreground">
                Runs for {durationLabel(Math.max(1, durationValue), durationUnit)}
              </p>
              <FieldError message={errors.durationValue?.message ?? errors.durationUnit?.message}/>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-class-quota">Monthly class quota</Label>
            <Input id="plan-class-quota" type="number" inputMode="numeric" min={0} step={1} placeholder="e.g. 12" aria-invalid={errors.classQuota ? true : undefined} {...register("classQuota", { setValueAs: (value) => {
                // Blank field → null (duration-only plan). numericValue would
                // otherwise coerce "" to 0, which means "no classes allowed".
                if (value === "" || value == null)
                    return null;
                const parsed = numericValue(value);
                return Number.isFinite(parsed) ? parsed : null;
            } })}/>
            <p className="text-xs text-muted-foreground">
              {classQuotaValue == null || classQuotaValue === ""
                ? "Leave blank for a duration-only plan with no fixed monthly limit."
                : `Students get ${classQuotaValue} classes each month on this plan.`}
            </p>
            <FieldError message={errors.classQuota?.message}/>
          </div>

          <div className="space-y-1.5">
            <Label>Weekly schedule</Label>
            <Input id="plan-schedule" className="sr-only" tabIndex={-1} aria-label="Weekly schedule" aria-invalid={errors.scheduleLabel ? true : undefined} {...register("scheduleLabel")}/>
            <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Select weekly schedule days">
              {WEEK_DAYS.map((day) => {
                const checked = selectedDays.includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    aria-label={day.label}
                    onClick={() => toggleDay(day.value)}
                    className={cn(
                        "flex h-9 items-center justify-center rounded-md border text-[11px] font-medium transition-colors",
                        checked
                            ? "border-km-gold/60 bg-km-gold/15 text-foreground"
                            : "border-input text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedDays.length
                ? `Selected: ${formatSelectedDays(selectedDays)}`
                : "Select the days included in this plan — leave blank to derive it from the duration."}
            </p>
            <FieldError message={errors.scheduleLabel?.message}/>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-benefits">Benefits</Label>
            <Textarea id="plan-benefits" rows={5} placeholder={"One benefit per line, e.g.\nAll dance batches\n1 performance workshop"} {...register("benefits")}/>
            <p className="text-xs text-muted-foreground">One benefit per line — they are listed on the plan card.</p>
            <FieldError message={errors.benefits?.message}/>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-secondary/40 p-3">
            <div className="space-y-0.5">
              <Label htmlFor="plan-active">{isActive ? "Active plan" : "Archived plan"}</Label>
              <p className="text-xs text-muted-foreground">
                {isActive
            ? "Available when assigning or renewing memberships."
            : "Hidden from new memberships — existing members keep their access."}
              </p>
            </div>
            <Controller control={control} name="isActive" render={({ field }) => (<Switch id="plan-active" checked={field.value} onCheckedChange={field.onChange}/>)}/>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : plan ? "Save changes" : "Create plan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
