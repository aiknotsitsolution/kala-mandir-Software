import { useCallback, useEffect, useState } from "react";
import { AlertCircleIcon, AlertTriangleIcon, BellIcon, CheckCircle2Icon, CheckCheckIcon, InfoIcon, RefreshCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const SEVERITY_STYLE = {
    info: { icon: InfoIcon, container: "bg-info/10 text-info" },
    success: { icon: CheckCircle2Icon, container: "bg-primary/10 text-primary" },
    warning: { icon: AlertTriangleIcon, container: "bg-warning/10 text-warning" },
    error: { icon: AlertCircleIcon, container: "bg-destructive/10 text-destructive" },
};

/**
 * Bell + mobile-style notification shade: clicking the bell opens a panel
 * that drops straight DOWN from the top bar (no page navigation). Used in
 * both the staff topbar and the Student portal navbar.
 *
 * Features: unread badge, refresh, per-row mark-as-read (with link routing
 * via onOpenItem), mark-all-read, "view all" link, loading skeletons,
 * error retry and an empty state.
 */
export function NotificationBellPanel({ unreadCount = 0, fetchItems, onOpenItem, onMarkAllRead, onViewAll, label = "Notifications", viewAllLabel = "View all notifications", emptyTitle = "No notifications", emptyBody = "You're all caught up.", className, }) {
    const [open, setOpen] = useState(false);
    const [items, setItems] = useState(null); // null = not fetched yet
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [markingAll, setMarkingAll] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setItems((await fetchItems?.()) ?? []);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Unable to load notifications.");
        }
        finally {
            setLoading(false);
        }
    }, [fetchItems]);

    useEffect(() => {
        if (open)
            void load();
    }, [open, load]);

    const rows = items ?? [];
    const unread = items ? rows.filter((row) => !row.isRead).length : unreadCount;

    const openRow = async (item) => {
        if (!item.isRead) {
            setItems((prev) => (prev ?? []).map((row) => (row.id === item.id ? { ...row, isRead: true } : row)));
        }
        try {
            await onOpenItem?.(item);
        }
        catch (e) {
            toast.error(e instanceof Error ? e.message : "Unable to update notifications.");
        }
        setOpen(false);
    };
    const markAll = async () => {
        setMarkingAll(true);
        try {
            await onMarkAllRead?.();
            setItems((prev) => (prev ?? []).map((row) => ({ ...row, isRead: true })));
        }
        catch (e) {
            toast.error(e instanceof Error ? e.message : "Unable to update notifications.");
        }
        finally {
            setMarkingAll(false);
        }
    };

    return (<DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread > 0 ? `${label}, ${unread} unread` : label} className={cn("relative", className)}>
          <BellIcon className="size-4.5"/>
          {unread > 0 ? (<span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-[360px] max-w-[94vw] p-0">
        {/* header: title + refresh + mark all read */}
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold">{label}</p>
            {unread > 0 ? (<span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-bold text-primary">
                {unread}
              </span>) : null}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="icon" className="size-7" aria-label="Refresh notifications" disabled={loading} onClick={() => void load()}>
              <RefreshCcwIcon className={cn("size-3.5", loading && "animate-spin")}/>
            </Button>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={markingAll || unread === 0} onClick={() => void markAll()}>
              <CheckCheckIcon className="size-3.5"/> Mark all read
            </Button>
          </div>
        </div>

        {/* body */}
        {loading && items === null ? (<div className="space-y-1 py-1">
            {[0, 1, 2].map((i) => (<div key={i} className="flex items-start gap-3 px-4 py-3">
                <span className="size-7 shrink-0 animate-pulse rounded-full bg-muted"/>
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block h-3 w-2/3 animate-pulse rounded bg-muted"/>
                  <span className="block h-2.5 w-5/6 animate-pulse rounded bg-muted"/>
                </span>
              </div>))}
          </div>) : error ? (<div className="px-6 py-8 text-center">
            <p className="text-xs text-destructive">{error}</p>
            <Button variant="outline" size="sm" className="mt-3 h-7" onClick={() => void load()}>
              Retry
            </Button>
          </div>) : rows.length === 0 ? (<div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-muted">
              <BellIcon className="size-5 text-muted-foreground"/>
            </span>
            <p className="text-sm font-medium">{emptyTitle}</p>
            <p className="text-xs text-muted-foreground">{emptyBody}</p>
          </div>) : (<div className="max-h-[420px] overflow-y-auto py-1">
            {rows.map((item) => {
            const style = SEVERITY_STYLE[item.severity] ?? SEVERITY_STYLE.info;
            const Icon = style.icon;
            return (<button key={item.id} type="button" onClick={() => void openRow(item)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50", !item.isRead && "bg-primary/[0.04]")}>
                <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", style.container)}>
                  <Icon className="size-3.5"/>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate text-xs", item.isRead ? "text-muted-foreground" : "font-semibold")}>
                      {item.title}
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(item.createdAt)}</span>
                  </span>
                  {item.body ? (<span className="mt-0.5 block line-clamp-2 text-[11px] text-muted-foreground">
                      {item.body}
                    </span>) : null}
                </span>
                {!item.isRead ? <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"/> : null}
              </button>);
        })}
          </div>)}

        {onViewAll ? (<div className="border-t border-border/70 p-1.5">
            <Button variant="ghost" size="sm" className="w-full justify-center text-xs text-muted-foreground hover:text-foreground" onClick={() => {
            setOpen(false);
            onViewAll();
        }}>
              {viewAllLabel}
            </Button>
          </div>) : null}
      </DropdownMenuContent>
    </DropdownMenu>);
}
