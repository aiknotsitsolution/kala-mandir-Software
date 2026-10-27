import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { PlusIcon, TagsIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, SearchEmptyState, Skeleton } from "@/components/shared/States";
import { Button } from "@/components/ui/button";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { can } from "@/lib/permissions";
import { PlanCard } from "./PlanCard";
import { PlanDialog } from "./PlanDialog";
import { PlansToolbar } from "./PlansToolbar";
import { TogglePlanDialog } from "./TogglePlanDialog";

/** List view is the default, matching the studio's reference layout. */
const DEFAULT_VIEW = "list";

/** Small gold lotus ornament shown beside the page title (reference layout). */
function LotusOrnament({ className }) {
    return (<svg viewBox="0 0 48 34" className={className ?? "h-6 w-8"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M24 30c-7-3.5-11-9.5-11-17 4.5 1 8 4 11 9 3-5 6.5-8 11-9 0 7.5-4 13.5-11 17z"/>
      <path d="M24 31c-9-1.5-16-7-18.5-15 5.5 0 10.5 2.5 14 7.5M24 31c9-1.5 16-7 18.5-15-5.5 0-10.5 2.5-14 7.5"/>
      <path d="M24 32c-4.5-.5-8.5-3-11-7M24 32c4.5-.5 8.5-3 11-7" strokeWidth="1.3" opacity="0.7"/>
    </svg>);
}

export function PlansPage() {
    const data = useData();
    const { session } = useAuth();
    const role = session?.profile.role;
    const canManage = can(role, "plans.manage");
    const reduceMotion = useReducedMotion();

    const [searchParams, setSearchParams] = useSearchParams();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editing, setEditing] = useState(null);
    const [toggling, setToggling] = useState(null);

    /* View + filter state lives here (not in the toolbar) so switching views
       never reloads the page or clears the search term / status filter. */
    const [view, setView] = useState(DEFAULT_VIEW);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("all");

    const plans = useAsync(() => data.listPlans(true), [data]);
    const distribution = useAsync(() => data.getPlanDistribution(), [data]);
    const reloadAll = useCallback(() => {
        plans.reload();
        distribution.reload();
    }, [plans, distribution]);

    // Auto-open the "new plan" dialog when arriving from /plans?new=1 (dashboard link).
    // Keep the param while the dialog should be open (remount-safe); clear on dismiss.
    useEffect(() => {
        if (!session)
            return; // auth still restoring — never consume the param early
        if (searchParams.get("new") !== "1")
            return;
        if (canManage) {
            setEditing(null);
            setDialogOpen(true);
        }
        else {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("new");
                return next;
            }, { replace: true });
        }
    }, [searchParams, canManage, setSearchParams, session]);
    const handleDialogOpenChange = (open) => {
        setDialogOpen(open);
        if (!open && searchParams.has("new")) {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete("new");
                return next;
            }, { replace: true });
        }
    };

    const openCreate = () => {
        setEditing(null);
        setDialogOpen(true);
    };
    const openEdit = (plan) => {
        setEditing(plan);
        setDialogOpen(true);
    };
    const handleToggle = async () => {
        if (!toggling)
            return false;
        try {
            await data.archivePlan(toggling.id, !toggling.isActive);
            toast.success(toggling.isActive ? `${toggling.name} archived` : `${toggling.name} activated`);
            reloadAll();
            return true;
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to update this plan.");
            return false;
        }
    };

    const rows = useMemo(() => plans.data ?? [], [plans.data]);
    const memberCounts = useMemo(() => {
        const map = new Map();
        for (const entry of distribution.data ?? [])
            map.set(entry.planId, entry.count);
        return map;
    }, [distribution.data]);

    /* Search + status filter — applied once, shared by both views. */
    const filtered = useMemo(() => {
        const term = query.trim().toLowerCase();
        return rows.filter((plan) => {
            const matchesQuery = term.length === 0 || plan.name.toLowerCase().includes(term);
            const matchesStatus = status === "all" || (status === "active" ? plan.isActive : !plan.isActive);
            return matchesQuery && matchesStatus;
        });
    }, [rows, query, status]);

    const activeCount = rows.filter((plan) => plan.isActive).length;
    const filtersActive = query.trim().length > 0 || status !== "all";

    const header = (<PageHeader icon={<LotusOrnament/>} title="Dance fee plans" description="Manage membership plans and class packages for your students."/>);

    if (plans.loading) {
        return (<div className="space-y-6">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (<Skeleton key={index} className="h-72"/>))}
        </div>
      </div>);
    }
    if (plans.error) {
        return (<div className="space-y-6">
        {header}
        <ErrorState title="Unable to load plans" message={plans.error} onRetry={plans.reload}/>
      </div>);
    }

    /* Keyed so the dialog remounts when the target plan changes — react-hook-form
       only reads defaultValues on mount, so without this an edit dialog would
       open with the previous/empty values instead of the plan's own. */
    return (<div className="space-y-6">
      {header}

      <PlansToolbar query={query} onQueryChange={setQuery} status={status} onStatusChange={setStatus} view={view} onViewChange={setView} canManage={canManage} onAdd={openCreate} resultCount={filtersActive ? `${filtered.length}/${rows.length}` : undefined}/>

      {rows.length === 0 ? (<EmptyState icon={<TagsIcon className="size-5"/>} title="No plans yet" description="Create your first dance fee plan — set a schedule, a monthly class quota and the fee." action={canManage ? (<Button size="sm" onClick={openCreate}>
                <PlusIcon className="size-4"/> Add plan
              </Button>) : undefined}/>) : filtered.length === 0 ? (<SearchEmptyState query={query.trim()}/>) : (<>
          {/* Layout switch — same data, same handlers, different arrangement. */}
          <motion.div key={view} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }} className={view === "list"
            ? "space-y-4"
            : "grid gap-4 sm:grid-cols-2 xl:grid-cols-3"}>
            {filtered.map((plan, index) => (<PlanCard key={plan.id} plan={plan} memberCount={memberCounts.get(plan.id) ?? 0} canManage={canManage} index={index} layout={view} onEdit={openEdit} onToggle={setToggling}/>))}
          </motion.div>

          <p className="text-xs text-muted-foreground">
            {filtered.length} {filtered.length === 1 ? "plan" : "plans"}
            {filtersActive ? ` of ${rows.length}` : ""} on record · {activeCount} active
          </p>
        </>)}

      <PlanDialog key={editing?.id ?? "new-plan"} plan={editing} open={dialogOpen} onOpenChange={handleDialogOpenChange} onSaved={reloadAll}/>
      <TogglePlanDialog plan={toggling} onOpenChange={(open) => {
            if (!open)
                setToggling(null);
        }} onConfirm={handleToggle}/>
    </div>);
}
