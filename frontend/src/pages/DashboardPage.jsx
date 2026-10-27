import { useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRightIcon, BanknoteIcon, CalendarClockIcon, CameraIcon, IndianRupeeIcon, UserPlusIcon, UserRoundCheckIcon, WalletIcon } from "lucide-react";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/States";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SmartImage } from "@/components/shared/SmartImage";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { formatINR, formatDate, formatTime, relativeTime } from "@/lib/format";
import { endOfDayInTz, startOfDayInTz, ymdInTz } from "@/lib/datetime";
import { can } from "@/lib/permissions";
import { HeroBanner } from "./dashboard/HeroBanner";
import { FinancialCard, MetricCard } from "./dashboard/DashboardCards";

const CHART_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-04-16" → "Apr 16" — compact, readable axis labels. */
const dayTick = (v) => `${MONTH_SHORT[Number(v.slice(5, 7)) - 1]} ${Number(v.slice(8))}`;

function ChartTooltipCard({ active, payload, label, isCurrency }) {
    if (!active || !payload || payload.length === 0)
        return null;
    return (<div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      {payload.map((entry, index) => (<p key={index} className="text-muted-foreground">
          {entry.name}:{" "}
          <span className="font-medium text-foreground">
            {isCurrency ? formatINR(Number(entry.value)) : Number(entry.value).toLocaleString("en-IN")}
          </span>
        </p>))}
    </div>);
}

function PanelHeader({ title, subtitle, action }) {
    return (<div className="flex items-center justify-between gap-3 px-4 pt-4">
      <div className="min-w-0">
        <h2 className="truncate font-sans text-[14px] font-semibold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{subtitle}</p> : null}
      </div>
      {action}
    </div>);
}

function PanelLink({ to, children }) {
    return (<Link to={to} className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-primary transition-colors hover:text-km-wine">
      {children}
      <ArrowRightIcon aria-hidden="true" className="size-3"/>
    </Link>);
}

/** Short fade-and-rise entrance that respects prefers-reduced-motion. */
function FadeIn({ children, delay = 0, className }) {
    const reduceMotion = useReducedMotion();
    return (<motion.div initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }} className={className}>
      {children}
    </motion.div>);
}

const PANEL = "overflow-hidden rounded-xl border border-border bg-card shadow-[0_2px_5px_rgba(49,13,32,0.06)]";

export function DashboardPage() {
    const data = useData();
    const { session } = useAuth();
    const role = session?.profile.role;
    const canViewPayments = can(role, "payments.view");
    const stats = useAsync(() => data.getDashboardStats(), [data]);
    const [trendDays, setTrendDays] = useState(14);
    const trend = useAsync(() => data.getAttendanceTrend(trendDays), [data, trendDays]);
    // Rupee trend lives behind payments.view — trainers skip the request.
    const revenue = useAsync(() => (canViewPayments ? data.getRevenueTrend(6) : Promise.resolve([])), [data, canViewPayments]);
    const distribution = useAsync(() => data.getPlanDistribution(), [data]);
    const recentCheckIns = useAsync(() => data.getRecentCheckIns(6), [data]);
    const recentMembers = useAsync(() => data.getRecentMembers(5), [data]);
    const expirations = useAsync(() => data.getUpcomingExpiries(5), [data]);
    const todayClasses = useAsync(() => data.listClasses(startOfDayInTz(new Date()), endOfDayInTz(new Date())), [data]);
    const isNewGym = stats.data?.totalMembers === 0;
    // Stat cards link into the matching page — payments only when the role may see it.
    const todayYmd = ymdInTz(new Date());
    const revenueDelta = stats.data && stats.data.previousMonthRevenue > 0
        ? Math.round(((stats.data.monthlyRevenue - stats.data.previousMonthRevenue) / stats.data.previousMonthRevenue) * 100)
        : null;

    if (stats.loading) {
        return (<div className="space-y-3">
        <Skeleton className="h-[240px] rounded-[14px]"/>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (<Skeleton key={index} className="h-[118px]"/>))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (<Skeleton key={index} className="h-[112px]"/>))}
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.85fr_1fr]">
          <Skeleton className="h-[268px]"/>
          <Skeleton className="h-[268px]"/>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (<Skeleton key={index} className="h-[230px]"/>))}
        </div>
      </div>);
    }
    if (stats.error) {
        return <ErrorState message={stats.error} onRetry={stats.reload} title="Unable to load the dashboard"/>;
    }

    const totalThisMonth = (stats.data?.monthlyRevenue ?? 0) + (stats.data?.pendingAmount ?? 0);
    const collected = stats.data?.monthlyRevenue ?? 0;
    const remaining = stats.data?.pendingAmount ?? 0;
    const collectedPct = totalThisMonth > 0 ? (collected / totalThisMonth) * 100 : null;
    const remainingPct = totalThisMonth > 0 ? (remaining / totalThisMonth) * 100 : null;

    const distributionRows = (distribution.data ?? []).filter((d) => d.count > 0);
    const distributionTotal = distributionRows.reduce((sum, d) => sum + d.count, 0);
    const revenueRows = revenue.data ?? [];
    const currentMonthIdx = revenueRows.length - 1;

    return (<div className="space-y-3">
      <HeroBanner todayClassCount={todayClasses.data ? todayClasses.data.length : undefined} canAddStudent={can(role, "members.create")} canMarkAttendance={can(role, "attendance.mark")}/>

      {isNewGym ? (<FadeIn>
          <div className="paper-surface paper-lift relative overflow-hidden rounded-xl border-0">
            <span className="paper-tape" aria-hidden/>
            <div className="p-8">
              <div className="max-w-2xl">
                <p className="font-serif text-sm tracking-wide text-paper-foreground/70">Getting started</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">Two steps to a live studio</h2>
                <ol className="mt-5 space-y-4">
                  {[
                ["Create membership plans", "Set fees, weekly schedule and quotas — 3, 5 and 6 days a week.", "/plans?new=1"],
                ["Add your first student", "Their QR membership card is generated automatically.", "/members?new=1"],
            ].map(([title, description, to], index) => (<li key={title} className="flex gap-4">
                      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-paper-foreground text-xs font-bold text-paper">
                        {index + 1}
                      </span>
                      <div>
                        <Link to={to} className="font-medium underline-offset-4 hover:underline">
                          {title}
                        </Link>
                        <p className="text-sm text-paper-foreground/70">{description}</p>
                      </div>
                    </li>))}
                </ol>
              </div>
            </div>
          </div>
        </FadeIn>) : null}

      {/* Primary metrics — each card opens the matching filtered list. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard index={0} label="Active students" value={stats.data?.activeMembers ?? 0} icon={<UserRoundCheckIcon className="size-[18px]"/>} hint={`${stats.data?.totalMembers ?? 0} total on record`} accent={{ bg: "var(--km-burgundy)", fg: "var(--km-ivory)" }} to="/members?status=active"/>
        <MetricCard index={1} label="New this month" value={stats.data?.newThisMonth ?? 0} icon={<UserPlusIcon className="size-[18px]"/>} hint="Joined in the current month" accent={{ bg: "var(--km-gold)", fg: "var(--km-burgundy)" }} to="/members"/>
        <MetricCard index={2} label="Expiring soon" value={stats.data?.expiringSoon ?? 0} icon={<CalendarClockIcon className="size-[18px]"/>} hint={`${stats.data?.expiredMembers ?? 0} already expired`} accent={{ bg: "var(--warning)", fg: "#FFF7EA" }} to="/members?status=expiring_soon"/>
        <MetricCard index={3} label="Today's check-ins" value={stats.data?.todayAttendance ?? 0} icon={<CameraIcon className="size-[18px]"/>} hint={`${stats.data?.currentCheckIns ?? 0} currently inside`} accent={{ bg: "var(--km-wine)", fg: "var(--km-ivory)" }} to={`/attendance/history?from=${todayYmd}&to=${todayYmd}`}/>
      </div>

      {/* This month: Total | Collected | Remaining — rupee figures are
          financial-role only (trainers never see them). */}
      {canViewPayments ? (<div className="grid gap-3 sm:grid-cols-3">
        <FinancialCard index={0} label="Total this month" value={totalThisMonth} format={(n) => formatINR(n)} icon={<IndianRupeeIcon className="size-[18px]"/>} hint="Collected + remaining" accent={{ bg: "var(--km-burgundy)", fg: "var(--km-ivory)" }} amountColor="var(--km-burgundy)" to="/payments"/>
        <FinancialCard index={1} label="Collected" value={collected} format={(n) => formatINR(n)} icon={<BanknoteIcon className="size-[18px]"/>} hint={revenueDelta !== null
            ? `${revenueDelta >= 0 ? "+" : ""}${revenueDelta}% vs last month`
            : "Payments received this month"} accent={{ bg: "var(--success)", fg: "#F1FAF5" }} amountColor="var(--success)" barColor="var(--success)" barPct={collectedPct} to="/payments?status=paid"/>
        <FinancialCard index={2} label="Remaining" value={remaining} format={(n) => formatINR(n)} icon={<WalletIcon className="size-[18px]"/>} hint={stats.data?.pendingPayments
            ? `${stats.data.pendingPayments} member${stats.data.pendingPayments === 1 ? "" : "s"} with dues`
            : "No outstanding dues"} accent={{ bg: "var(--destructive)", fg: "#FFF3F1" }} amountColor="var(--destructive)" barColor="var(--destructive)" barPct={remainingPct} to="/payments?status=pending"/>
      </div>) : null}

      {/* Analytics: attendance trend + plan mix */}
      <div className="grid gap-3 lg:grid-cols-[1.85fr_1fr]">
        <FadeIn>
          <section className={PANEL} aria-label="Attendance trend">
            <PanelHeader title="Attendance trend" subtitle={`Daily check-ins, last ${trendDays} days`} action={<div className="flex items-center gap-1 rounded-full border border-border bg-secondary p-0.5" role="group" aria-label="Attendance range">
                {[7, 14, 30].map((days) => (<button key={days} type="button" onClick={() => setTrendDays(days)} aria-pressed={trendDays === days} className={trendDays === days
                    ? "rounded-full bg-primary px-2.5 py-1 text-[11px] font-medium text-km-ivory transition-colors"
                    : "rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"}>
                    {days}d
                  </button>))}
              </div>}/>
            <div className="h-[212px] px-2 pt-3 pb-4">
              {trend.loading ? (<Skeleton className="size-full"/>) : trend.data && trend.data.length > 0 ? (<ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend.data} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="attendanceFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--km-gold)" stopOpacity={0.32}/>
                        <stop offset="100%" stopColor="var(--km-burgundy)" stopOpacity={0.03}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" vertical={false}/>
                    <XAxis dataKey="date" tickFormatter={dayTick} tick={{ fontSize: 10.5, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} minTickGap={22}/>
                    <YAxis allowDecimals={false} tick={{ fontSize: 10.5, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={36}/>
                    <Tooltip content={<ChartTooltipCard isCurrency={false}/>} cursor={{ stroke: "var(--border)" }}/>
                    <Area type="monotone" dataKey="count" name="Check-ins" stroke="var(--chart-1)" strokeWidth={2} fill="url(#attendanceFill)" dot={{ r: 2, strokeWidth: 0, fill: "var(--km-gold)" }} activeDot={{ r: 4 }}/>
                  </AreaChart>
                </ResponsiveContainer>) : (<EmptyState title="No attendance yet" description="Check-ins over the selected range will appear here." className="h-full py-6"/>)}
            </div>
          </section>
        </FadeIn>

        <FadeIn delay={0.05}>
          <section className={PANEL} aria-label="Plan mix">
            <PanelHeader title="Plan mix" subtitle="Active memberships"/>
            <div className="px-4 pt-2 pb-4">
              {distribution.loading ? (<Skeleton className="h-[200px] w-full"/>) : distributionRows.length > 0 ? (<div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
                  <div className="relative h-[168px] w-[150px] shrink-0">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={distributionRows} dataKey="count" nameKey="planName" innerRadius={44} outerRadius={66} paddingAngle={3} stroke="none" startAngle={90} endAngle={-270}>
                          {distributionRows.map((entry, index) => (<Cell key={entry.planId} fill={CHART_COLORS[index % CHART_COLORS.length]}/>))}
                        </Pie>
                        <Tooltip content={<ChartTooltipCard isCurrency={false}/>}/>
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <p className="text-[22px] leading-none font-semibold text-primary tabular">{distributionTotal}</p>
                      <p className="mt-1 text-[9.5px] font-medium tracking-[0.12em] text-muted-foreground uppercase">members</p>
                    </div>
                  </div>
                  <ul className="w-full min-w-0 space-y-2">
                    {distributionRows.map((entry, index) => (<li key={entry.planId} className="flex w-full min-w-0 items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} aria-hidden="true"/>
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">{entry.planName}</span>
                        <span className="shrink-0 text-[11.5px] text-muted-foreground tabular">
                          {entry.count} · {Math.round((entry.count / distributionTotal) * 100)}%
                        </span>
                      </li>))}
                  </ul>
                </div>) : (<EmptyState title="No active memberships yet" description="Assign a plan to a student to see the mix." className="h-[200px] py-6"/>)}
            </div>
          </section>
        </FadeIn>
      </div>

      {/* Lower grid: revenue · check-ins · new students · expiring — the
          revenue panel is financial-role only. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {canViewPayments ? (<FadeIn>
          <section className={PANEL + " h-full"} aria-label="Monthly revenue">
            <PanelHeader title="Monthly revenue" subtitle="Last 6 months (INR)"/>
            <div className="h-[188px] px-2 pt-3 pb-4">
              {revenue.loading ? (<Skeleton className="size-full"/>) : revenueRows.length > 0 ? (<ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueRows} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="4 4" stroke="var(--border)" vertical={false}/>
                    <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} interval="preserveStartEnd"/>
                    <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 10.5, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} width={40}/>
                    <Tooltip content={<ChartTooltipCard isCurrency/>} cursor={{ fill: "rgba(198,164,91,0.14)" }}/>
                    <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]} maxBarSize={34}>
                      {revenueRows.map((entry, index) => (<Cell key={entry.month} fill={index === currentMonthIdx ? "var(--chart-1)" : "var(--chart-2)"}/>))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>) : (<EmptyState title="No revenue data yet" description="Recorded payments will appear here." className="h-full py-6"/>)}
            </div>
          </section>
        </FadeIn>) : null}

        <FadeIn delay={0.04}>
          <section className={PANEL + " h-full"} aria-label="Recent check-ins">
            <PanelHeader title="Recent check-ins" subtitle="Latest studio visits" action={<PanelLink to="/attendance/history">View all</PanelLink>}/>
            <div className="px-4 pt-2 pb-3">
              {recentCheckIns.loading ? (<div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11"/>)}</div>) : (recentCheckIns.data ?? []).length === 0 ? (<EmptyState title="No check-ins yet" description="Scan a student QR to record the first visit." className="py-8"/>) : (<ul className="divide-y divide-border/80">
                  {(recentCheckIns.data ?? []).map((record) => (<li key={record.id} className="flex items-center gap-3 py-2">
                      <SmartImage src={record.memberPhoto} name={record.memberName ?? "Student"} className="size-8"/>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{record.memberName}</p>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {record.memberCode} · {formatTime(record.checkIn)}
                        </p>
                      </div>
                      <span className={record.status === "checked_out"
                        ? "rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground"
                        : "rounded-full bg-success/12 px-2 py-0.5 text-[10.5px] font-medium text-success"}>
                        {record.status === "checked_out" ? "Checked out" : "In studio"}
                      </span>
                    </li>))}
                </ul>)}
            </div>
          </section>
        </FadeIn>

        <FadeIn delay={0.08}>
          <section className={PANEL + " h-full"} aria-label="New students">
            <PanelHeader title="New students" subtitle="Recently joined" action={<PanelLink to="/members">View all</PanelLink>}/>
            <div className="px-4 pt-2 pb-3">
              {recentMembers.loading ? (<div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11"/>)}</div>) : (recentMembers.data ?? []).length === 0 ? (<EmptyState title="No students yet" description="Add your first student to get started." className="py-8"/>) : (<ul className="divide-y divide-border/80">
                  {(recentMembers.data ?? []).map((member) => (<li key={member.id} className="flex items-center gap-3 py-2">
                      <SmartImage src={member.photoUrl} name={member.fullName} className="size-8"/>
                      <div className="min-w-0 flex-1">
                        <Link to={`/members/${member.id}`} className="block truncate text-[13px] font-medium text-foreground hover:underline">
                          {member.fullName}
                        </Link>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {member.memberCode} · joined {formatDate(member.joinDate)}
                        </p>
                      </div>
                      <StatusBadge status={member.effectiveStatus}/>
                    </li>))}
                </ul>)}
            </div>
          </section>
        </FadeIn>

        <FadeIn delay={0.12}>
          <section className={PANEL.replace("bg-card", "bg-secondary").replace("border-border", "border-border") + " h-full"} aria-label="Expiring soon">
            <PanelHeader title="Expiring soon" subtitle="Memberships ending soon" action={<PanelLink to="/members">View all</PanelLink>}/>
            <div className="px-4 pt-2 pb-3">
              {expirations.loading ? (<div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-11"/>)}</div>) : (expirations.data ?? []).length === 0 ? (<EmptyState title="Nothing expiring" description="Memberships ending soon will appear here." className="py-8"/>) : (<ul className="divide-y divide-border/80">
                  {(expirations.data ?? []).map((member) => (<li key={member.id} className="flex items-center gap-3 py-2">
                      <div className="min-w-0 flex-1">
                        <Link to={`/members/${member.id}`} className="block truncate text-[13px] font-medium text-foreground hover:underline">
                          {member.fullName}
                        </Link>
                        <p className="truncate text-[11.5px] text-muted-foreground">
                          {member.planName} · ends {formatDate(member.endDate)} · {relativeTime(member.endDate)}
                        </p>
                      </div>
                      <StatusBadge status={member.effectiveStatus}/>
                    </li>))}
                </ul>)}
            </div>
          </section>
        </FadeIn>
      </div>
    </div>);
}
