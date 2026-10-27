import { ArchiveIcon, ArchiveRestoreIcon, CalendarDaysIcon, MoreHorizontalIcon, PencilIcon, RepeatIcon, SparklesIcon, UsersIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, } from "@/components/ui/dropdown-menu";
import { Stagger } from "@/components/shared/States";
import { formatINR } from "@/lib/format";
import { planQuotaLabel } from "@/lib/quota";
import { cn } from "@/lib/utils";
import { PlanArtwork } from "./PlanArtwork";

/** Short line describing how often the plan's classes run. */
function scheduleLabel(plan) {
    if (plan.scheduleLabel)
        return plan.scheduleLabel;
    const value = Math.max(1, Number(plan.durationValue) || 1);
    const unit = plan.durationUnit;
    if (unit === "month" && value === 1)
        return "Every month";
    if (unit === "week" && value === 1)
        return "Every week";
    return `${value} ${unit}${value === 1 ? "" : "s"}`;
}

/**
 * Period shown under the price. Monthly plans read "/ month" like the
 * reference; other duration plans keep their true period (e.g. "/ 3 months")
 * so a multi-month fee is never misrepresented as a monthly one.
 */
function pricePeriodLabel(plan) {
    const value = Math.max(1, Number(plan.durationValue) || 1);
    if (plan.durationUnit === "month")
        return value === 1 ? "/ month" : `/ ${value} months`;
    if (plan.durationUnit === "week")
        return value === 1 ? "/ week" : `/ ${value} weeks`;
    if (plan.durationUnit === "day")
        return value === 1 ? "/ day" : `/ ${value} days`;
    return value === 1 ? "/ year" : `/ ${value} years`;
}

function PlanStatusBadge({ isActive }) {
    return (<Badge variant="outline" className={cn("gap-1.5 px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase", isActive
            ? "border-success/30 bg-success/10 text-success"
            : "border-border bg-muted text-muted-foreground")}>
      <span className={cn("size-1.5 rounded-full", isActive ? "bg-success" : "bg-muted-foreground/60")}/>
      {isActive ? "Active" : "Archived"}
    </Badge>);
}

/** Edit + overflow menu (archive/activate) — shared by both views. */
function PlanActions({ plan, canManage, onEdit, onToggle }) {
    if (!canManage)
        return null;
    return (<div className="flex items-center gap-2">
      <Button variant="outline" size="sm" className="flex-1 border-km-gold/40 text-foreground hover:border-km-gold hover:bg-accent/60" onClick={() => onEdit(plan)} aria-label={`Edit ${plan.name}`}>
        <PencilIcon className="size-3.5"/> Edit
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" className="shrink-0 border-km-gold/40 hover:border-km-gold hover:bg-accent/60" aria-label={`More options for ${plan.name}`} aria-haspopup="menu" title="More options">
            <MoreHorizontalIcon className="size-4"/>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {plan.isActive ? (<>
              <DropdownMenuItem variant="destructive" onSelect={() => onToggle(plan)}>
                <ArchiveIcon className="size-4"/> Archive plan
              </DropdownMenuItem>
              <DropdownMenuSeparator/>
              <DropdownMenuItem onSelect={() => onEdit(plan)}>
                <PencilIcon className="size-4"/> Edit details
              </DropdownMenuItem>
            </>) : (<DropdownMenuItem onSelect={() => onToggle(plan)}>
              <ArchiveRestoreIcon className="size-4"/> Activate plan
            </DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>);
}

/** One plan as a card. `layout="list"` renders the medium reference row. */
export function PlanCard({ plan, memberCount, canManage, index = 0, onEdit, onToggle, layout = "list", }) {
    const quotaLabel = planQuotaLabel(plan);
    const benefits = (plan.benefits ?? []).filter((benefit) => benefit.trim().length > 0);
    const isList = layout === "list";

    return (<Stagger delayIndex={index} className="h-full">
      <Card className={cn("graphite-surface group h-full overflow-hidden border-km-gold/25 transition-all duration-300 hover:-translate-y-0.5 hover:border-km-gold/60 hover:shadow-[0_20px_40px_-28px_rgba(49,13,32,0.45)]", !plan.isActive && "opacity-90", isList ? "rounded-xl" : "rounded-lg")}>
        <CardContent className={cn("flex h-full", isList
            ? "flex-col gap-4 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5"
            : "flex-col gap-4 p-5")}>

          {/* ---- LEFT: illustration (supplied plan1/2/3 art) ---- */}
          <div className={cn("flex items-center justify-center", isList ? "sm:w-36 sm:shrink-0" : "w-full")}>
            <PlanArtwork index={index} className={cn(isList ? "h-24 w-32 sm:h-28 sm:w-40" : "h-24 w-32 sm:h-28 sm:w-40 mx-auto")}/>
          </div>

          {/* ---- MIDDLE: details ---- */}
          <div className={cn("min-w-0 flex-1", isList && "sm:border-l sm:border-km-gold/20 sm:pl-4")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="font-display text-lg leading-tight font-semibold text-km-burgundy sm:text-xl">
                {plan.name}
              </h2>
              {/* Grid shows status here; list has a dedicated right column. */}
              {!isList ? <PlanStatusBadge isActive={plan.isActive}/> : null}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5" title="Weekly schedule">
                <CalendarDaysIcon className="size-3.5 text-km-gold-muted"/>
                {scheduleLabel(plan)}
              </span>
              {quotaLabel ? (<span className="inline-flex items-center gap-1.5" title="Monthly class quota">
                  <UsersIcon className="size-3.5 text-km-gold-muted"/>
                  {quotaLabel.replace("/month", " per month")}
                </span>) : (<span className="inline-flex items-center gap-1.5" title="No fixed monthly quota">
                  <RepeatIcon className="size-3.5 text-km-gold-muted"/>
                  Duration-based access
                </span>)}
            </div>

            <div className="ornament-divider my-2 max-w-32" aria-hidden="true">
              <SparklesIcon className="size-3"/>
            </div>

            {plan.description ? (<p className="text-[13px] text-muted-foreground">{plan.description}</p>) : null}

            {/* Benefits — shown in grid view, where there is room for them. */}
            {!isList && benefits.length > 0 ? (<ul className="mt-3 space-y-1">
                {benefits.slice(0, 4).map((benefit, benefitIndex) => (<li key={`${benefitIndex}-${benefit}`} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="size-1 shrink-0 rounded-full bg-km-gold/70"/>
                    {benefit}
                  </li>))}
              </ul>) : null}
          </div>

          {/* ---- PRICE ---- */}
          <div className={cn("flex shrink-0 items-center justify-between gap-4", isList
            ? "sm:w-32 sm:flex-col sm:items-center sm:justify-center sm:gap-1.5 sm:border-l sm:border-km-gold/20 sm:pl-4"
            : "border-t border-km-gold/20 pt-3 sm:w-auto")}>
            <div className={cn(isList ? "sm:text-center" : "text-left")}>
              <span className="tabular block font-display text-2xl font-semibold text-km-burgundy sm:text-[1.75rem]">
                {formatINR(plan.price)}
              </span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{pricePeriodLabel(plan)}</span>
              <div className={cn("ornament-divider mt-1.5", isList ? "sm:max-w-20" : "max-w-24")} aria-hidden="true"/>
            </div>
            {!isList ? <PlanStatusBadge isActive={plan.isActive}/> : null}
          </div>

          {/* ---- RIGHT: status + actions (list) / actions (grid) ---- */}
          <div className={cn("flex shrink-0 flex-col gap-2.5", isList
            ? "sm:w-36 sm:border-l sm:border-km-gold/20 sm:pl-4"
            : "border-t border-km-gold/20 pt-3")}>
            {isList ? <PlanStatusBadge isActive={plan.isActive}/> : null}
            <PlanActions plan={plan} canManage={canManage} onEdit={onEdit} onToggle={onToggle}/>
            {/* Member count — real data only, never a fake number. */}
            {typeof memberCount === "number" && memberCount > 0 ? (<p className="text-xs text-muted-foreground">
                {memberCount} active {memberCount === 1 ? "student" : "students"}
              </p>) : null}
          </div>
        </CardContent>
      </Card>
    </Stagger>);
}
