import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { useSubmitGuard } from "@/hooks";
/** Generic destructive confirmation used for cancelling classes / enrolments. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, }) {
    const [submitting, run] = useSubmitGuard();
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep it
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
