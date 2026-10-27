import { ArchiveIcon, ArchiveRestoreIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks";
/**
 * Confirmation dialog used before archiving / activating a plan.
 * `plan === null` keeps the dialog closed.
 */
export function TogglePlanDialog({ plan, onOpenChange, onConfirm, }) {
    const [submitting, run] = useSubmitGuard();
    const archiving = plan?.isActive ?? true;
    return (<Dialog open={plan !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {archiving ? (<ArchiveIcon className="size-4 text-destructive"/>) : (<ArchiveRestoreIcon className="size-4 text-primary"/>)}
            {archiving ? `Archive ${plan?.name ?? "this plan"}?` : `Activate ${plan?.name ?? "this plan"}?`}
          </DialogTitle>
          <DialogDescription>
            {archiving
            ? "Archived plans stay attached to past memberships but can no longer be assigned to new or renewing members. You can bring it back at any time."
            : "The plan becomes available again when creating or renewing memberships."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={archiving ? "destructive" : "default"} disabled={submitting} onClick={() => {
            void run(async () => {
                if (await onConfirm())
                    onOpenChange(false);
            });
        }}>
            {submitting ? (<Loader2Icon className="size-4 animate-spin"/>) : archiving ? (<ArchiveIcon className="size-4"/>) : (<ArchiveRestoreIcon className="size-4"/>)}
            {submitting ? "Working…" : archiving ? "Archive plan" : "Activate plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
}
