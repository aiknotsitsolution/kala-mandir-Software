import { BanIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks";
/**
 * Confirmation dialog used before disabling a staff member.
 * `staff === null` keeps the dialog closed.
 */
export function ArchiveStaffDialog({ staff, onOpenChange, onConfirm, }) {
    const [submitting, run] = useSubmitGuard();
    return (<Dialog open={staff !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BanIcon className="size-4 text-destructive"/>
            Disable {staff?.fullName ?? "staff member"}?
          </DialogTitle>
          <DialogDescription>
            Their portal login will be turned off and they will be hidden from day-to-day screens.
            Existing records and class history stay intact, and you can bring them back at any time
            by editing their status.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep enabled
          </Button>
          <Button variant="destructive" disabled={submitting} onClick={() => {
            void run(async () => {
                if (await onConfirm())
                    onOpenChange(false);
            });
        }}>
            {submitting ? <Loader2Icon className="size-4 animate-spin"/> : <BanIcon className="size-4"/>}
            {submitting ? "Disabling…" : "Disable staff member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
}
