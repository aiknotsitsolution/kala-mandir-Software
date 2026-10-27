import { PrinterIcon, ReceiptIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import { PaymentBadge } from "@/components/shared/StatusBadge";
import { formatDateTime, formatINR, PAYMENT_METHOD_LABELS } from "@/lib/format";
/** Printable receipt for a single payment (or refund) record. */
export function ReceiptDialog({ payment, gym, onOpenChange, }) {
    return (<Dialog open={payment !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptIcon className="size-4 text-primary"/>
            Receipt
          </DialogTitle>
          <DialogDescription>
            {payment?.refundOf ? "Refund receipt" : "Payment receipt"} — print it or share it with the student.
          </DialogDescription>
        </DialogHeader>

        {payment ? (<div className="rounded-xl border border-border/70 bg-card/60 p-5">
            {/* Gym letterhead */}
            <div className="border-b border-dashed border-border/80 pb-4 text-center">
              <p className="text-base font-semibold tracking-tight">{gym?.name ?? "Kalamandir"}</p>
              {gym?.address ? <p className="mt-1 text-xs text-muted-foreground">{gym.address}</p> : null}
              {gym?.phone || gym?.email ? (<p className="mt-0.5 text-xs text-muted-foreground">
                  {[gym?.phone, gym?.email].filter(Boolean).join(" · ")}
                </p>) : null}
            </div>

            <div className="flex items-center justify-between gap-3 py-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Receipt no.</p>
              <p className="font-mono text-sm font-semibold">{payment.receiptNo}</p>
            </div>

            <dl className="space-y-2 border-t border-dashed border-border/80 pt-3 text-sm">
              <Row label="Student">
                <span className="font-medium">{payment.memberName ?? "Student"}</span>
                {payment.memberCode ? (<span className="ml-1.5 font-mono text-xs text-muted-foreground">{payment.memberCode}</span>) : null}
              </Row>
              {payment.membershipSummary ? <Row label="Membership">{payment.membershipSummary}</Row> : null}
              <Row label="Method">{PAYMENT_METHOD_LABELS[payment.method]}</Row>
              <Row label="Date">{formatDateTime(payment.paymentDate)}</Row>
              <Row label="Status">
                <PaymentBadge status={payment.status}/>
              </Row>
              {payment.transactionRef ? (<Row label="Reference">
                  <span className="font-mono text-xs">{payment.transactionRef}</span>
                </Row>) : null}
            </dl>

            <div className="mt-4 flex items-center justify-between rounded-lg border border-border/70 bg-secondary/40 px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {payment.refundOf ? "Refunded" : "Amount"}
              </p>
              <p className="text-xl font-semibold tracking-tight tabular">{formatINR(payment.amount, { withPaise: true })}</p>
            </div>

            {payment.notes ? <p className="mt-3 text-xs text-muted-foreground">{payment.notes}</p> : null}

            <p className="mt-4 text-center text-[11px] text-muted-foreground">
              Thank you for training with us. Computer-generated receipt — valid without signature.
            </p>
          </div>) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <PrinterIcon className="size-4"/> Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
}
function Row({ label, children }) {
    return (<div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm break-words">{children}</dd>
    </div>);
}
