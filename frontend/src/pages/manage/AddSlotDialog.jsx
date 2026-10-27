import { useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { useSubmitGuard } from "@/hooks";
import { format12h } from "@/lib/format";
import { TimeSelect } from "@/components/shared/TimeSelect";

/** A type's window — 15-min TimeSelect picks are limited to these bounds. */
const GROUP_WINDOWS = {
    morning: { min: "08:00", max: "12:00", label: "Morning", range: "8:00 AM – 12:00 PM" },
    afternoon: { min: "12:00", max: "16:00", label: "Afternoon", range: "12:00 PM – 4:00 PM" },
    evening: { min: "16:00", max: "21:00", label: "Evening", range: "4:00 PM – 9:00 PM" },
};
function timesInWindow(min, max) {
    const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
    const out = [];
    for (let m = toMin(min); m <= toMin(max); m += 15) {
        out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
    return out;
}
const TYPE_OPTIONS = Object.entries(GROUP_WINDOWS).map(([id, w]) => ({ value: id, label: w.label, range: w.range }));
/**
 * "Add slot" dialog for Manage Institute — pick the batch type (Morning /
 * Afternoon / Evening), pick the start & end time inside that window, save.
 * The parent's onSave persists the merged slot list.
 */
export function AddSlotDialog({ open, onOpenChange, onSave, }) {
    const [submitting, run] = useSubmitGuard();
    const [type, setType] = useState("morning");
    const [start, setStart] = useState("08:00");
    const [end, setEnd] = useState("09:00");
    const window = GROUP_WINDOWS[type];
    const times = useMemo(() => timesInWindow(window.min, window.max), [window.min, window.max]);
    /* Switching types resets the picks to that window's first hour. */
    useEffect(() => {
        if (!open)
            return;
        const defaults = { morning: ["08:00", "09:00"], afternoon: ["12:00", "13:00"], evening: ["16:00", "17:00"] };
        const [defStart, defEnd] = defaults[type];
        setStart(defStart);
        setEnd(defEnd);
    }, [open, type]);
    const submit = (event) => {
        event.preventDefault();
        if (start >= end) {
            toast.error("End time must be after the start time.");
            return;
        }
        void run(async () => {
            try {
                const saved = await onSave?.({ start, end }) ?? false;
                if (saved)
                    onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save the slot.");
            }
        });
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add slot</DialogTitle>
          <DialogDescription>
            Pick the batch type and its time window — it joins the daily schedule immediately.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label>Slot type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full" aria-label="Slot type">
                <SelectValue placeholder="Choose a type"/>
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (<SelectItem key={option.value} value={option.value}>
                    {option.label} · {option.range}
                  </SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="add-slot-start">Start time</Label>
              <TimeSelect id="add-slot-start" value={start} times={times} ariaLabel="Slot start time" className="w-full" onValueChange={setStart}/>
            </div>
            <div className="space-y-2">
              <Label htmlFor="add-slot-end">End time</Label>
              <TimeSelect id="add-slot-end" value={end} times={times} ariaLabel="Slot end time" className="w-full" onValueChange={setEnd}/>
            </div>
          </div>
          <p className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-center text-xs text-muted-foreground">
            {start && end && start < end ? (<span className="font-medium text-foreground">{format12h(start)} – {format12h(end)}</span>) : "Pick a start before the end time"}
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2Icon className="size-4 animate-spin"/> : null}
              {submitting ? "Saving…" : "Save slot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>);
}
