import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/format";
const STATUS_STYLES = {
    active: "border-primary/30 bg-primary/10 text-primary",
    expiring_soon: "border-warning/30 bg-warning/10 text-warning",
    expired: "border-destructive/30 bg-destructive/10 text-destructive",
    suspended: "border-orange-400/30 bg-orange-400/10 text-orange-300",
    inactive: "border-border bg-muted text-muted-foreground",
    cancelled: "border-border bg-muted text-muted-foreground",
    none: "border-border bg-muted text-muted-foreground",
};
export function StatusBadge({ status, label, className, }) {
    return (<Badge variant="outline" className={cn("font-medium", STATUS_STYLES[status], className)}>
      {label ?? STATUS_LABELS[status]}
    </Badge>);
}
const PAYMENT_STYLES = {
    paid: "border-primary/30 bg-primary/10 text-primary",
    partial: "border-warning/30 bg-warning/10 text-warning",
    pending: "border-destructive/30 bg-destructive/10 text-destructive",
    refunded: "border-info/30 bg-info/10 text-info",
    failed: "border-destructive/30 bg-destructive/10 text-destructive",
};
const PAYMENT_TEXT = {
    paid: "Paid",
    partial: "Partially paid",
    pending: "Pending",
    refunded: "Refunded",
    failed: "Failed",
};
export function PaymentBadge({ status, className }) {
    return (<Badge variant="outline" className={cn("font-medium", PAYMENT_STYLES[status], className)}>
      {PAYMENT_TEXT[status]}
    </Badge>);
}
