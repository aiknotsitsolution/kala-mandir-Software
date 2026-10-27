import { Loader2Icon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks";
/**
 * Confirmation dialog used before permanently deleting a staff member.
 * `staff === null` keeps the dialog closed.
 */
export function DeleteStaffDialog({ staff, onOpenChange, onConfirm }) {
    const [submitting, run] = useSubmitGuard();
    return (<Dialog open={staff !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2Icon className="size-4 text-destructive"/>
            Delete {staff?.fullName ?? "staff member"}?
          </DialogTitle>
          <DialogDescription>
            This will permanently remove their profile and all associated data. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={submitting} onClick={() => {
            void run(async () => {
                if (await onConfirm())
                    onOpenChange(false);
            });
        }}>
            {submitting ? <Loader2Icon className="size-4 animate-spin"/> : <Trash2Icon className="size-4"/>}
            {submitting ? "Deleting…" : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
}