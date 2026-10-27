import { forwardRef } from "react";
import { Grid2x2Icon, LayoutListIcon, PlusIcon, SearchIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Real, supported plan statuses. `all` is the default. */
const PLAN_STATUS_OPTIONS = [
    { value: "all", label: "Status: All" },
    { value: "active", label: "Active" },
    { value: "inactive", label: "Inactive" },
];

const VIEW_OPTIONS = [
    { value: "list", label: "List view", Icon: LayoutListIcon },
    { value: "grid", label: "Grid view", Icon: Grid2x2Icon },
];

/**
 * Search + status filter + list/grid toggle + Add plan.
 * Pure presentational — the page owns the state so switching views never
 * reloads or clears the search term / status filter.
 */
export const PlansToolbar = forwardRef(function PlansToolbar({ query, onQueryChange, status, onStatusChange, view, onViewChange, canManage, onAdd, resultCount, }, ref) {
    return (<div ref={ref} className="flex flex-col gap-3 rounded-xl border border-km-gold/25 bg-card/70 p-3 sm:flex-row sm:items-center sm:gap-3 sm:p-4">
      {/* Search */}
      <div className="relative flex-1">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"/>
        <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search plans…" aria-label="Search plans by name" className="h-9 border-km-gold/25 bg-background/60 pl-9 focus-visible:border-km-gold"/>
        {resultCount !== undefined ? (<span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-muted-foreground">
            {resultCount}
          </span>) : null}
      </div>

      {/* Status filter */}
      <div className="flex items-center gap-2">
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger size="sm" className="w-[9.5rem] border-km-gold/25 bg-background/60" aria-label="Filter plans by status">
            <SelectValue placeholder="Status"/>
          </SelectTrigger>
          <SelectContent position="popper" align="end" className="min-w-40">
            {PLAN_STATUS_OPTIONS.map((option) => (<SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>))}
          </SelectContent>
        </Select>
      </div>

      {/* List / grid toggle — a real radiogroup with visible active state. */}
      <div role="radiogroup" aria-label="Choose plan view" className="flex items-center gap-1 rounded-lg border border-km-gold/25 bg-background/60 p-1">
        {VIEW_OPTIONS.map(({ value, label, Icon }) => {
            const active = view === value;
            return (<button key={value} type="button" role="radio" aria-checked={active} aria-label={label} title={label} onClick={() => onViewChange(value)} className={cn("inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60", active
                ? "bg-km-burgundy text-km-ivory shadow-xs"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")}>
              <Icon className="size-4"/>
            </button>);
        })}
      </div>

      {/* Add plan */}
      {canManage ? (<Button size="sm" className="h-9 shrink-0 border-km-gold/50 bg-km-burgundy text-km-ivory hover:bg-km-wine" onClick={onAdd}>
          <PlusIcon className="size-4"/> Add plan
        </Button>) : null}
    </div>);
});
