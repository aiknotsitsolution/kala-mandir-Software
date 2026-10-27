import { Link } from "react-router-dom";
import { ArrowRightIcon } from "lucide-react";
import { ErrorState, Skeleton } from "@/components/shared/States";
import { PAYMENT_METHOD_LABELS, formatDate, formatINR } from "@/lib/format";
import { cn } from "@/lib/utils";

const PAPER_CHIPS = {
    paid: "border-[#3f7d51]/40 bg-[#3f7d51]/10 text-[#3f7d51]",
    partial: "border-[#a3601f]/40 bg-[#a3601f]/10 text-[#a3601f]",
    pending: "border-[#a3601f]/40 bg-[#a3601f]/10 text-[#a3601f]",
    refunded: "border-[#4a6a8a]/40 bg-[#4a6a8a]/10 text-[#4a6a8a]",
    failed: "border-[#a33d2a]/40 bg-[#a33d2a]/10 text-[#a33d2a]",
};

const PAPER_TEXT = {
    paid: "Paid",
    partial: "Part paid",
    pending: "Pending",
    refunded: "Refunded",
    failed: "Failed",
};

/** One torn-edge receipt stub. */
function Receipt({ payment, index }) {
    return (<li className="pp-stack-sm relative" style={{ rotate: index % 2 === 0 ? "-0.8deg" : "0.9deg" }}>
      <div className="pp-receipt paper-surface p-4">
        <div className="flex items-center justify-between gap-2 font-mono text-[9px] tracking-[0.22em] text-paper-foreground/60 uppercase">
          <span>Kalamandir Dance Institute</span>
          <span>Receipt</span>
        </div>
        <div className="pp-perf-h mt-2"/>
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <p className="font-mono text-xs font-semibold tracking-wide">{payment.receiptNo ?? "—"}</p>
          <p className="font-mono text-[11px] text-paper-foreground/70">{formatDate(payment.paymentDate)}</p>
        </div>
        <p className="mt-1 font-serif text-3xl leading-none">{formatINR(payment.amount)}</p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-paper-foreground/70">
            {PAYMENT_METHOD_LABELS[payment.method] ?? "Other"}
            {payment.membershipSummary ? ` · ${payment.membershipSummary}` : ""}
          </span>
          <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase", PAPER_CHIPS[payment.status] ?? PAPER_CHIPS.pending)}>
            {PAPER_TEXT[payment.status] ?? payment.status}
          </span>
        </div>
        <div aria-hidden="true" className="pp-barcode mt-3 h-5 w-full rounded-[2px]"/>
      </div>
    </li>);
}

/**
 * Last few payments as torn receipt stubs, with a "view all" link.
 * `linkTo` — when set, renders the footer link (home page snapshot).
 */
export function ReceiptStubs({ payments, linkTo, className }) {
    const rows = Array.isArray(payments?.data) ? payments.data.slice(0, 3) : [];
    if (payments?.loading && !payments?.data) {
        return (<div className="grid gap-4 sm:grid-cols-2">
        {[0, 1, 2].map((index) => (<Skeleton key={index} className="h-28 rounded-xl bg-card"/>))}
      </div>);
    }
    if (payments?.error && !payments?.data) {
        return <ErrorState title="Unable to load your payments" message={payments.error} onRetry={payments.reload}/>;
    }
    if (rows.length === 0) {
        return (<div className="pp-note paper-surface rotate-[0.7deg] px-6 py-8 text-center">
            <p className="font-serif text-lg">No receipts yet</p>
            <p className="mt-1 text-sm text-paper-foreground/70">
              Payments made at the front desk will appear here with their receipt numbers.
            </p>
          </div>);
    }
    return (<div className={cn("space-y-4", className)}>
      <ul className="grid gap-4 sm:grid-cols-2">
        {rows.map((payment, index) => (<Receipt key={payment.id} payment={payment} index={index}/>))}
      </ul>
      {linkTo ? (<div className="flex justify-end">
          <Link to={linkTo} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline">
            View all payments <ArrowRightIcon className="size-3"/>
          </Link>
        </div>) : null}
    </div>);
}
