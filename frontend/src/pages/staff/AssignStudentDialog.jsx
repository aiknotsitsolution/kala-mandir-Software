import { useEffect, useMemo, useState } from "react";
import { CheckIcon, Loader2Icon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useData } from "@/auth/AuthProvider";
import { useAsync, useDebounced, useSubmitGuard } from "@/hooks";

export function AssignStudentDialog({ staff, open, onOpenChange, onChanged }) {
    const data = useData();
    const members = useAsync(() => data.listAllMembers(), [data], { enabled: open });
    const [selected, setSelected] = useState(new Set());
    const [query, setQuery] = useState("");
    const debounced = useDebounced(query, 250);
    const [submitting, run] = useSubmitGuard();

    useEffect(() => {
        if (!open || !members.data) return;
        const ids = new Set(members.data.filter((m) => String(m.trainerId) === String(staff?.id)).map((m) => m.id));
        setSelected(ids);
    }, [open, members.data, staff?.id]);

    useEffect(() => {
        if (!open) setQuery("");
    }, [open]);

    const filtered = useMemo(() => {
        const q = debounced.trim().toLowerCase();
        return (members.data ?? [])
            .filter((m) => m.status === "active")
            .filter((m) => !q || (m.fullName ?? "").toLowerCase().includes(q) || (m.memberCode ?? "").toLowerCase().includes(q))
            .slice(0, 50);
    }, [members.data, debounced]);

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
                await data.assignStaffStudents(staff.id, [...selected]);
                toast.success("Students assigned");
                onChanged?.();
                onOpenChange(false);
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to assign students.");
            }
        });
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Assign Students — {staff?.fullName}</DialogTitle>
                    <DialogDescription>Select the students assigned to this trainer.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                    <div className="relative">
                        <UsersIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <Input placeholder="Search students…" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
                    </div>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                        {members.loading ? (
                            <p className="px-1 py-3 text-sm text-muted-foreground">Loading students…</p>
                        ) : filtered.length === 0 ? (
                            <p className="px-1 py-3 text-sm text-muted-foreground">No students found.</p>
                        ) : (
                            filtered.map((m) => (
                                <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-secondary/60">
                                    <input
                                        type="checkbox"
                                        checked={selected.has(m.id)}
                                        onChange={() => toggle(m.id)}
                                        className="size-4 rounded border-input"
                                    />
                                    <span className="text-sm">{m.fullName} · {m.memberCode ?? "—"}</span>
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