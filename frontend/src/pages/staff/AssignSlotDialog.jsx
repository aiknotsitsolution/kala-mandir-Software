import { useEffect, useMemo, useState } from "react";
import { CheckIcon, Loader2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useData } from "@/auth/AuthProvider";
import { useAsync, useSubmitGuard } from "@/hooks";
import { format12h } from "@/lib/format";

export function AssignSlotDialog({ staff, open, onOpenChange, onChanged }) {
    const data = useData();
    const slots = useAsync(() => data.listClassSlots(), [data], { enabled: open });
    const [selected, setSelected] = useState(new Set());
    const [query, setQuery] = useState("");
    const [submitting, run] = useSubmitGuard();

    useEffect(() => {
        if (!open || !slots.data) return;
        const ids = new Set(slots.data.filter((s) => String(s.instructorId) === String(staff?.id)).map((s) => s.id));
        setSelected(ids);
    }, [open, slots.data, staff?.id]);

    useEffect(() => {
        if (!open) setQuery("");
    }, [open]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return (slots.data ?? []).filter((s) => !q || (s.name ?? "").toLowerCase().includes(q) || (s.startTime ?? "").includes(q));
    }, [slots.data, query]);

    const toggle = (id) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const save = () => {
        run(async () => {
            try {
                await data.assignStaffSlots(staff.id, [...selected]);
                toast.success("Slots assigned");
                onChanged?.();
                onOpenChange(false);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to assign slots.");
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Assign Slots — {staff?.fullName}</DialogTitle>
                    <DialogDescription>Select the class slots this trainer teaches.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="relative">
                        <UsersIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="Search slots…" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                        {slots.loading ? (
                            <p className="px-1 py-3 text-sm text-muted-foreground">Loading slots…</p>
                        ) : filtered.length === 0 ? (
                            <p className="px-1 py-3 text-sm text-muted-foreground">No slots found.</p>
                        ) : (
                            filtered.map((s) => (
                                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/60">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(s.id)}
                                        onChange={() => toggle(s.id)}
                                        className="size-4 rounded border-input"
                                    />
                                    <span className="text-sm">{format12h(s.startTime)} – {format12h(s.endTime)}</span>
                                </label>
                            ))
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={save} disabled={submitting}>
                        {submitting ? <Loader2Icon className="size-4 animate-spin" /> : <CheckIcon className="size-4" />}
                        {submitting ? "Saving…" : "Save"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}