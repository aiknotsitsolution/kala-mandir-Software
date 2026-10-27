import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2Icon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/shared/States";
import { useAsync, useSubmitGuard } from "@/hooks";
import { classFormSchema } from "@/lib/validation";
import { useData } from "@/auth/AuthProvider";
/** Sentinel used because a Radix Select item cannot carry an empty value. */
const NO_TRAINER = "__none__";
const EMPTY_VALUES = {
    name: "",
    description: "",
    trainerId: "",
    date: format(new Date(), "yyyy-MM-dd"),
    time: "18:00",
    durationMinutes: 60,
    capacity: 20,
};
function toInput(values, startsAt) {
    const trimmed = (value) => {
        const text = value?.trim();
        return text ? text : null;
    };
    return {
        name: values.name,
        description: trimmed(values.description),
        trainerId: trimmed(values.trainerId),
        startsAt,
        durationMinutes: values.durationMinutes,
        capacity: values.capacity,
    };
}
export function ClassFormDialog({ open, onOpenChange, gymClass, onSave, }) {
    const data = useData();
    const [submitting, run] = useSubmitGuard();
    const staff = useAsync(() => data.listStaff(true), [data], { enabled: open });
    const { register, handleSubmit, control, reset, formState: { errors }, } = useForm({
        resolver: zodResolver(classFormSchema),
        defaultValues: EMPTY_VALUES,
    });
    useEffect(() => {
        if (!open)
            return;
        if (!gymClass) {
            reset(EMPTY_VALUES);
            return;
        }
        const start = new Date(gymClass.startsAt);
        reset({
            name: gymClass.name,
            description: gymClass.description ?? "",
            trainerId: gymClass.trainerId ?? "",
            date: format(start, "yyyy-MM-dd"),
            time: format(start, "HH:mm"),
            durationMinutes: gymClass.durationMinutes,
            capacity: gymClass.capacity,
        });
    }, [open, gymClass, reset]);
    const trainers = (staff.data ?? []).filter((member) => member.role === "trainer" && member.employmentStatus !== "resigned");
    const submit = handleSubmit((values) => {
        const start = new Date(`${values.date}T${values.time}:00`);
        if (Number.isNaN(start.getTime())) {
            toast.error("Pick a valid date and time for the class.");
            return;
        }
        void run(async () => {
            try {
                const saved = await onSave(toInput(values, start.toISOString()));
                if (saved)
                    onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save the class.");
            }
        });
    });
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{gymClass ? "Edit class" : "New class"}</DialogTitle>
          <DialogDescription>
            {gymClass
            ? "Update the schedule, trainer or capacity for this session."
            : "Schedule a group class and set how many students can join."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="class-name">Class name</Label>
            <Input id="class-name" placeholder="Power Yoga" {...register("name")}/>
            {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="class-description">Description</Label>
            <Textarea placeholder="What students can expect…" {...register("description")} rows={2}/>
            {errors.description ? (<p className="text-xs text-destructive">{errors.description.message}</p>) : null}
          </div>

          <div className="space-y-2">
            <Label>Trainer</Label>
            {staff.loading ? (<Skeleton className="h-9 w-full"/>) : (<Controller control={control} name="trainerId" render={({ field }) => (<Select value={field.value && field.value.length > 0 ? field.value : NO_TRAINER} onValueChange={(value) => field.onChange(value === NO_TRAINER ? "" : value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a trainer"/>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TRAINER}>No trainer yet</SelectItem>
                      {trainers.map((trainer) => (<SelectItem key={trainer.id} value={trainer.id}>
                          {trainer.fullName}
                        </SelectItem>))}
                    </SelectContent>
                  </Select>)}/>)}
            {errors.trainerId ? (<p className="text-xs text-destructive">{errors.trainerId.message}</p>) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="class-date">Date</Label>
              <Input id="class-date" type="date" {...register("date")}/>
              {errors.date ? <p className="text-xs text-destructive">{errors.date.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="class-time">Start time</Label>
              <Input id="class-time" type="time" {...register("time")}/>
              {errors.time ? <p className="text-xs text-destructive">{errors.time.message}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="class-duration">Duration (minutes)</Label>
              <Input id="class-duration" type="number" min={10} max={480} {...register("durationMinutes", { valueAsNumber: true })}/>
              {errors.durationMinutes ? (<p className="text-xs text-destructive">{errors.durationMinutes.message}</p>) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="class-capacity">Capacity</Label>
              <Input id="class-capacity" type="number" min={1} max={500} {...register("capacity", { valueAsNumber: true })}/>
              {errors.capacity ? (<p className="text-xs text-destructive">{errors.capacity.message}</p>) : null}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2Icon className="size-4 animate-spin"/> : null}
              {submitting ? "Saving…" : gymClass ? "Save changes" : "Create class"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
