import { useMemo } from "react";
import { ReceiptIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, TableSkeleton } from "@/components/shared/States";
import { PaymentBadge } from "@/components/shared/StatusBadge";
import { useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { formatDate, formatINR, PAYMENT_METHOD_LABELS } from "@/lib/format";
import { Settle, SectionHeading } from "./PaperBits";
import { StatsTickets } from "./StatsTickets";
import { ReceiptStubs } from "./ReceiptStubs";
export function MyPaymentsPage() {
    const data = useData();
    const payments = useAsync(() => data.listMyPayments(), [data]);
    const profile = useAsync(() => data.getMyMemberProfile(), [data]);
    const membership = profile.data?.membership ?? null;
    const rows = useMemo(() => payments.data ?? [], [payments.data]);
    const summary = useMemo(() => {
        const paidTotal = rows
            .filter((row) => row.status === "paid")
            .reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
        const last = rows[0] ?? null;
        return { paidTotal, last };
    }, [rows]);
    return (<div className="space-y-8">
      <PageHeader title="My payments" description="Every payment recorded against your membership."/>

      <Settle>
        <StatsTickets items={[
            { label: "Receipts", value: payments.loading && !payments.data ? "…" : rows.length, sub: "on file" },
            { label: "Paid to date", value: payments.loading && !payments.data ? "…" : formatINR(summary.paidTotal), sub: "settled payments" },
            { label: "Last payment", value: summary.last ? formatDate(summary.last.paymentDate) : "—", sub: summary.last ? (PAYMENT_METHOD_LABELS[summary.last.method] ?? "—") : "nothing yet" },
            { label: "Balance due", value: profile.loading && !profile.data ? "…" : membership?.balance != null ? formatINR(membership.balance) : "—", sub: profile.loading && !profile.data ? "checking…" : membership?.balance > 0 ? "payable at the front desk" : membership ? "nothing owed" : "no active plan" },
        ]}/>
      </Settle>

      <Settle delay={0.08}>
        <section aria-label="Recent receipts" className="space-y-3">
          <SectionHeading title="Recent receipts"/>
          <ReceiptStubs payments={payments}/>
        </section>
      </Settle>

      <Settle delay={0.16}>
        <section aria-labelledby="ledger-heading" className="space-y-3">
          <SectionHeading title={<span id="ledger-heading">Full ledger</span>}/>
          <Card className="graphite-surface gap-0 border-border/70 py-0">
            {payments.loading && !payments.data ? (<TableSkeleton rows={5} cols={5}/>) : payments.error ? (<div className="p-4">
                <ErrorState title="Unable to load your payments" message={payments.error} onRetry={payments.reload}/>
              </div>) : rows.length === 0 ? (<div className="p-4">
                <EmptyState icon={<ReceiptIcon className="size-5"/>} title="No payments yet" description="Payments made at the front desk will appear here with their receipt numbers." className="py-8"/>
              </div>) : (<Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Receipt</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead className="hidden sm:table-cell">Method</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((payment) => (<TableRow key={payment.id}>
                      <TableCell>
                        <p className="text-sm font-medium">{payment.receiptNo}</p>
                        {payment.membershipSummary ? (<p className="text-xs text-muted-foreground">{payment.membershipSummary}</p>) : null}
                      </TableCell>
                      <TableCell className="text-sm">{formatDate(payment.paymentDate)}</TableCell>
                      <TableCell className="text-sm font-medium tabular">
                        {formatINR(payment.amount)}
                      </TableCell>
                      <TableCell className="hidden text-sm sm:table-cell">
                        {PAYMENT_METHOD_LABELS[payment.method]}
                      </TableCell>
                      <TableCell>
                        <PaymentBadge status={payment.status}/>
                      </TableCell>
                    </TableRow>))}
                </TableBody>
              </Table>)}
          </Card>
        </section>
      </Settle>
    </div>);
}
