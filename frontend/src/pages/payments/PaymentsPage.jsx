import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, IndianRupeeIcon, PlusIcon, ReceiptIcon, RefreshCwIcon, SearchIcon, Undo2Icon, UsersIcon, WalletIcon, } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, SearchEmptyState, Skeleton, Stagger, TableSkeleton, } from "@/components/shared/States";
import { PaymentBadge } from "@/components/shared/StatusBadge";
import { SmartImage } from "@/components/shared/SmartImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync, useDebounced } from "@/hooks";
import { downloadCsv, toCsv } from "@/lib/csv";
import { formatDate, formatINR, formatNumberIN, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, } from "@/lib/format";
import { can } from "@/lib/permissions";
import { CARD_BASE, CardArrow, CountUp, GoldCorner } from "../dashboard/DashboardCards";
import { cn } from "@/lib/utils";
import { PaymentRecordDialog } from "./PaymentRecordDialog";
import { ReceiptDialog } from "./ReceiptDialog";
import { RefundDialog } from "./RefundDialog";
const PAGE_SIZE = 15;
const STATUS_OPTIONS = [
    "all",
    ...Object.keys(PAYMENT_STATUS_LABELS),
];
const METHOD_OPTIONS = [
    "all",
    ...Object.keys(PAYMENT_METHOD_LABELS),
];
/**
 * Payments stat card — same compact look as the dashboard Metric/Financial
 * cards (circular accent icon, eyebrow label, animated value, gold corner).
 * Optional in-place filter behaviour via onClick (dashboard cards navigate
 * instead; here clicking pre-fills the payments table below).
 */
const TONE_ACCENTS = {
    success: { bg: "var(--km-gold)", fg: "var(--km-burgundy)" },
    warning: { bg: "var(--warning)", fg: "#FFF7EA" },
    danger: { bg: "var(--destructive)", fg: "#FFF3F1" },
    default: { bg: "var(--km-burgundy)", fg: "var(--km-ivory)" },
};
function StatCard({ label, value, icon, hint, tone = "default", format, onClick, active, }) {
    const accent = TONE_ACCENTS[tone] ?? TONE_ACCENTS.default;
    const amountColor = tone === "success"
        ? "var(--primary)"
        : tone === "warning"
            ? "var(--warning)"
            : tone === "danger"
                ? "var(--destructive)"
                : "var(--primary)";
    const clickable = typeof onClick === "function";
    return (<div
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? "button" : undefined}
      aria-pressed={clickable ? Boolean(active) : undefined}
      onClick={clickable ? onClick : undefined}
      onKeyDown={clickable ? (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
            }
        } : undefined}
      className={cn(CARD_BASE + " min-h-[96px] p-3 sm:min-h-[112px] sm:p-4", clickable && "cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60", active && "border-km-gold/70 ring-1 ring-km-gold/40")}>
      <GoldCorner/>
      {clickable ? <CardArrow/> : null}
      <div className="relative flex items-center gap-2 sm:gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full sm:size-10" style={{ backgroundColor: accent.bg, color: accent.fg }} aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{label}</p>
          <p className="mt-1 truncate text-[20px] leading-none font-semibold sm:text-[26px]" style={{ color: amountColor }}>
            <CountUp value={value} format={format}/>
          </p>
        </div>
      </div>
      {hint ? <p className="relative mt-2 hidden text-[11.5px] leading-snug text-muted-foreground sm:mt-2.5 sm:block">{hint}</p> : null}
    </div>);
}
function SectionError({ message, onRetry }) {
    return (<div className="flex h-full flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <p className="max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon className="size-4"/> Retry
      </Button>
    </div>);
}
export function PaymentsPage() {
    const data = useData();
    const { session } = useAuth();
    const role = session?.profile.role;
    const canRecord = can(role, "payments.record");
    const canRefund = can(role, "payments.refund");
    const [searchParams, setSearchParams] = useSearchParams();
    const [search, setSearch] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    // Deep link: /payments?status=paid (dashboard financial cards) presets the filter.
    const [status, setStatus] = useState(() => {
        const preset = searchParams.get("status");
        return preset && STATUS_OPTIONS.includes(preset) ? preset : "all";
    });
    const [method, setMethod] = useState("all");
    const [page, setPage] = useState(1);
    const debouncedSearch = useDebounced(search, 300);
    const [recordOpen, setRecordOpen] = useState(false);
    const [preset, setPreset] = useState(null);
    const [receiptFor, setReceiptFor] = useState(null);
    const [refunding, setRefunding] = useState(null);
    // Below the stat cards: "Pending Payments" (dues table) | "Payment History".
    const [tab, setTab] = useState("pending");
    useEffect(() => {
        setPage(1);
    }, [debouncedSearch, from, to, status, method]);
    const revenue = useAsync(() => data.getRevenueSummary(6), [data]);
    const dues = useAsync(() => data.getDues(), [data]);
    const gym = useAsync(() => data.getGym(), [data]);
    const members = useAsync(() => data.listAllMembers(), [data], { enabled: canRecord });
    const payments = useAsync(() => data.listPayments({
        search: debouncedSearch.trim() || undefined,
        from: from || undefined,
        to: to || undefined,
        status,
        method,
        page,
        pageSize: PAGE_SIZE,
    }), [data, debouncedSearch, from, to, status, method, page]);
    // Clamp the page when the filtered total shrinks below the current page.
    useEffect(() => {
        if (!payments.data)
            return;
        const pages = Math.max(1, Math.ceil(payments.data.total / payments.data.pageSize));
        if (payments.data.page > pages)
            setPage(pages);
    }, [payments.data]);
    const reloadAll = useCallback(() => {
        payments.reload();
        dues.reload();
        revenue.reload();
    }, [payments, dues, revenue]);
    // Auto-open the record dialog when arriving from /payments?new=1 (dashboard link).
    // Keep the param while the dialog should be open (remount-safe); clear on dismiss.
    useEffect(() => {
        if (!session)
            return; // auth still restoring — never consume the param early
        if (searchParams.get("new") !== "1")
            return;
        if (canRecord) {
            setPreset(null);
            setRecordOpen(true);
        }
        else {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("new");
                return next;
            }, { replace: true });
        }
    }, [searchParams, canRecord, setSearchParams, session]);
    const handleRecordOpenChange = (open) => {
        setRecordOpen(open);
        if (!open && searchParams.has("new")) {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("new");
                return next;
            }, { replace: true });
        }
    };
    const months = revenue.data ?? [];
    const latest = months.length > 0 ? months[months.length - 1] : null;
    const duesRows = dues.data ?? [];
    const totalOutstanding = duesRows.reduce((sum, row) => sum + row.balance, 0);
    const duesCount = duesRows.length;
    const statsLoading = revenue.loading || dues.loading;
    const statsError = revenue.error ?? dues.error;
    const retryStats = () => {
        if (revenue.error)
            revenue.reload();
        if (dues.error)
            dues.reload();
    };
    const items = useMemo(() => payments.data?.items ?? [], [payments.data]);
    const total = payments.data?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
    const rangeEnd = Math.min(page * PAGE_SIZE, total);
    const filtersActive = Boolean(debouncedSearch.trim() || from || to || status !== "all" || method !== "all");
    const refundableRemaining = useCallback((payment) => {
        const refunded = items
            .filter((row) => row.refundOf === payment.id && row.status === "refunded")
            .reduce((sum, row) => sum + row.amount, 0);
        return Math.max(0, payment.amount - refunded);
    }, [items]);
    const openRecord = () => {
        setPreset(null);
        setRecordOpen(true);
    };
    const openRecordForDue = (row) => {
        setPreset({ memberId: row.memberId, membershipId: row.membershipId, amount: row.balance });
        setRecordOpen(true);
    };
    // Stat cards: clicking one pre-fills the payments table filters below and
    // scrolls to the matching section (same presets the dashboard links use).
    const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-01`;
    const duesCardRef = useRef(null);
    const paymentsCardRef = useRef(null);
    const applyStatFilter = (nextStatus, scrollTo) => {
        setSearch("");
        setStatus(nextStatus);
        setFrom(monthStart);
        setTo("");
        setMethod("all");
        setTab("history");
        // Wait a tick so the history tab can mount before scrolling to it.
        window.setTimeout(() => scrollTo?.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    };
    const scrollToDues = () => {
        setTab("pending");
        window.setTimeout(() => duesCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    };
    const collectedActive = status === "paid" && from === monthStart;
    const outstandingActive = status === "pending" && from === monthStart;
    const monthPaymentsActive = status === "all" && from === monthStart;
    const clearFilters = () => {
        setSearch("");
        setFrom("");
        setTo("");
        setStatus("all");
        setMethod("all");
    };
    const exportPayments = () => {
        if (items.length === 0)
            return;
        downloadCsv(`payments-page-${page}`, toCsv(items, [
            { header: "Receipt no", accessor: (row) => row.receiptNo },
            { header: "Student", accessor: (row) => row.memberName },
            { header: "Student ID", accessor: (row) => row.memberCode },
            { header: "Amount", accessor: (row) => row.amount },
            { header: "Method", accessor: (row) => PAYMENT_METHOD_LABELS[row.method] },
            { header: "Status", accessor: (row) => PAYMENT_STATUS_LABELS[row.status] },
            { header: "Date", accessor: (row) => row.paymentDate },
            { header: "Transaction ref", accessor: (row) => row.transactionRef },
            { header: "Notes", accessor: (row) => row.notes },
        ]));
    };
    const header = (<PageHeader title="Payments & fees" description="Record fee payments, track outstanding dues and print receipts." actions={canRecord ? (<Button onClick={openRecord}>
            <PlusIcon className="size-4"/> Record payment
          </Button>) : undefined}/>);
    return (<div className="space-y-6">
      {header}

      {/* Stat cards — 2-up on mobile, 4-up on desktop */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {statsLoading ? (Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-28"/>)) : statsError ? (<div className="sm:col-span-2 xl:col-span-4">
            <ErrorState title="Unable to load the revenue numbers" message={statsError} onRetry={retryStats}/>
          </div>) : (<>
            <Stagger delayIndex={0}>
              <StatCard label="Collected this month" value={latest?.collected ?? 0} format={formatINR} icon={<IndianRupeeIcon className="size-4"/>} hint={latest ? `In ${latest.label}` : "No months on record yet"} tone="success" active={collectedActive} onClick={() => applyStatFilter("paid", paymentsCardRef)}/>
            </Stagger>
            <Stagger delayIndex={1}>
              <StatCard label="Outstanding this month" value={latest?.outstanding ?? 0} format={formatINR} icon={<WalletIcon className="size-4"/>} hint={latest ? `Expected ${formatINR(latest.expected)} in ${latest.label}` : "No months on record yet"} tone={(latest?.outstanding ?? 0) > 0 ? "warning" : "default"} active={outstandingActive} onClick={() => applyStatFilter("pending", paymentsCardRef)}/>
            </Stagger>
            <Stagger delayIndex={2}>
              <StatCard label="Payments this month" value={latest?.count ?? 0} icon={<ReceiptIcon className="size-4"/>} hint={latest ? `Transactions in ${latest.label}` : "No months on record yet"} active={monthPaymentsActive} onClick={() => applyStatFilter("all", paymentsCardRef)}/>
            </Stagger>
            <Stagger delayIndex={3}>
              <StatCard label="Outstanding dues" value={totalOutstanding} format={formatINR} icon={<UsersIcon className="size-4"/>} hint={`${duesCount} ${duesCount === 1 ? "member owes" : "members owe"} an open balance`} tone={totalOutstanding > 0 ? "danger" : "default"} onClick={scrollToDues}/>
            </Stagger>
          </>)}
      </div>

      {/* Pending Payments | Payment History tabs */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            <WalletIcon className="size-4"/> Pending Payments
            {duesCount > 0 ? (<span className="ml-1 rounded-full bg-warning/15 px-1.5 text-[11px] font-semibold text-warning tabular">
                {duesCount}
              </span>) : null}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <ReceiptIcon className="size-4"/> Payment History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
      <Card ref={duesCardRef} className="scroll-mt-20 graphite-surface border-border/70">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Outstanding dues</CardTitle>
            <p className="text-xs text-muted-foreground">
              Students with an open balance on their current membership
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Refresh dues" onClick={dues.reload}>
            <RefreshCwIcon className="size-4"/>
          </Button>
        </CardHeader>
        <CardContent>
          {dues.loading ? (<TableSkeleton rows={4} cols={6}/>) : dues.error ? (<SectionError message={dues.error} onRetry={dues.reload}/>) : duesRows.length === 0 ? (<EmptyState title="No outstanding dues" description="Every active membership is fully paid up." className="py-8"/>) : (<div className="overflow-x-auto rounded-lg border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead className="hidden md:table-cell">Plan</TableHead>
                    <TableHead className="hidden md:table-cell">Ends</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Billed</TableHead>
                    <TableHead className="hidden text-right lg:table-cell">Paid</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {duesRows.map((row) => (<TableRow key={row.membershipId}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <SmartImage src={null} name={row.memberName} className="size-8 shrink-0"/>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{row.memberName}</p>
                            <p className="truncate font-mono text-xs text-muted-foreground">{row.memberCode}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-40 truncate md:table-cell">{row.planName}</TableCell>
                      <TableCell className="hidden md:table-cell">{formatDate(row.endDate)}</TableCell>
                      <TableCell className="hidden text-right tabular lg:table-cell">{formatINR(row.billed)}</TableCell>
                      <TableCell className="hidden text-right tabular lg:table-cell">{formatINR(row.paid)}</TableCell>
                      <TableCell className={cn("text-right font-medium tabular", row.balance > 0 && "text-warning")}>
                        {formatINR(row.balance)}
                      </TableCell>
                      <TableCell className="text-right">
                        {canRecord ? (<Button variant="outline" size="xs" onClick={() => openRecordForDue(row)}>
                            <IndianRupeeIcon className="size-3"/> Record payment
                          </Button>) : null}
                      </TableCell>
                    </TableRow>))}
                </TableBody>
              </Table>
            </div>)}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="history">
      <Card ref={paymentsCardRef} className="scroll-mt-20 graphite-surface border-border/70">
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Payments</CardTitle>
            <p className="text-xs text-muted-foreground">
              {payments.loading ? "Loading…" : `${formatNumberIN(total)} ${total === 1 ? "record" : "records"} matched`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={exportPayments} disabled={items.length === 0}>
            <DownloadIcon className="size-4"/> CSV
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-56 flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"/>
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search student, Student ID or receipt no." aria-label="Search payments" className="pl-9"/>
            </div>
            <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="From date" className="w-auto"/>
            <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} aria-label="To date" className="w-auto"/>
            <Select value={status} onValueChange={(value) => setStatus(value)}>
              <SelectTrigger size="sm" className="w-auto" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {STATUS_OPTIONS.map((option) => (<SelectItem key={option} value={option}>
                    {option === "all" ? "All statuses" : PAYMENT_STATUS_LABELS[option]}
                  </SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={method} onValueChange={(value) => setMethod(value)}>
              <SelectTrigger size="sm" className="w-auto" aria-label="Filter by method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {METHOD_OPTIONS.map((option) => (<SelectItem key={option} value={option}>
                    {option === "all" ? "All methods" : PAYMENT_METHOD_LABELS[option]}
                  </SelectItem>))}
              </SelectContent>
            </Select>
            {filtersActive ? (<Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear
              </Button>) : null}
          </div>

          {/* Table / states */}
          {payments.loading ? (<TableSkeleton rows={6} cols={7}/>) : payments.error ? (<ErrorState title="Unable to load payments" message={payments.error} onRetry={payments.reload}/>) : items.length === 0 ? (filtersActive ? (<SearchEmptyState query={debouncedSearch.trim() || undefined}/>) : (<EmptyState icon={<ReceiptIcon className="size-5"/>} title="No payments yet" description="Record your first payment to start tracking revenue and receipts." action={canRecord ? (<Button size="sm" onClick={openRecord}>
                      <PlusIcon className="size-4"/> Record payment
                    </Button>) : undefined}/>)) : (<div className="overflow-x-auto rounded-lg border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="hidden sm:table-cell">Receipt</TableHead>
                    <TableHead>Student</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="hidden md:table-cell">Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden sm:table-cell">Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((payment) => {
                const remaining = refundableRemaining(payment);
                const showRefund = canRefund &&
                    payment.refundOf === null &&
                    (payment.status === "paid" || payment.status === "partial") &&
                    remaining > 0;
                return (<TableRow key={payment.id}>
                        <TableCell className="hidden font-mono text-xs sm:table-cell">{payment.receiptNo}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <SmartImage src={null} name={payment.memberName ?? "Student"} className="size-8 shrink-0"/>
                            <div className="min-w-0">
                              <p className="truncate font-medium">{payment.memberName ?? "Student"}</p>
                              <p className="truncate text-xs text-muted-foreground">
                                <span className="font-mono">{payment.memberCode}</span>
                                {payment.membershipSummary ? ` · ${payment.membershipSummary}` : ""}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular">
                          {formatINR(payment.amount)}
                          {payment.refundOf ? (<span className="ml-1 text-xs font-normal text-muted-foreground">refund</span>) : null}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">{PAYMENT_METHOD_LABELS[payment.method]}</TableCell>
                        <TableCell>
                          <PaymentBadge status={payment.status}/>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{formatDate(payment.paymentDate)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon-xs" aria-label={`View receipt ${payment.receiptNo}`} title="View receipt" onClick={() => setReceiptFor(payment)}>
                              <ReceiptIcon />
                            </Button>
                            {showRefund ? (<Button variant="ghost" size="icon-xs" aria-label={`Refund receipt ${payment.receiptNo}`} title="Refund…" onClick={() => setRefunding(payment)}>
                                <Undo2Icon />
                              </Button>) : null}
                          </div>
                        </TableCell>
                      </TableRow>);
            })}
                </TableBody>
              </Table>
            </div>)}

          {/* Pagination */}
          {total > 0 ? (<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/40 px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Showing {rangeStart}–{rangeEnd} of {formatNumberIN(total)} payments
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1 || payments.loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                  <ChevronLeftIcon className="size-4"/> Prev
                </Button>
                <span className="text-xs text-muted-foreground tabular">
                  Page {page} of {totalPages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= totalPages || payments.loading} onClick={() => setPage((current) => current + 1)}>
                  Next <ChevronRightIcon className="size-4"/>
                </Button>
              </div>
            </div>) : null}
        </CardContent>
      </Card>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <PaymentRecordDialog open={recordOpen} onOpenChange={handleRecordOpenChange} members={members.data ?? []} preset={preset} onSaved={reloadAll}/>
      <ReceiptDialog payment={receiptFor} gym={gym.data ?? session?.gym ?? null} onOpenChange={(open) => {
            if (!open)
                setReceiptFor(null);
        }}/>
      <RefundDialog payment={refunding} remaining={refunding ? refundableRemaining(refunding) : 0} onOpenChange={(open) => {
            if (!open)
                setRefunding(null);
        }} onSaved={reloadAll}/>
    </div>);
}
