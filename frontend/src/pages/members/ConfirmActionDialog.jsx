import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks";
/**
 * Generic confirmation dialog for destructive member actions
 * (delete, deactivate, rotate QR). Passing `open={false}` keeps it closed.
 */
export function ConfirmActionDialog({ open, onOpenChange, icon: Icon, title, description, cancelLabel = "Cancel", confirmLabel, onConfirm, }) {
    const [submitting, run] = useSubmitGuard();
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {Icon ? <Icon className="size-4 text-destructive"/> : null}
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" disabled={submitting} onClick={() => {
            void run(async () => {
                if (await onConfirm())
                    onOpenChange(false);
            });
        }}>
            {submitting ? <Loader2Icon className="size-4 animate-spin"/> : null}
            {submitting ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
}
