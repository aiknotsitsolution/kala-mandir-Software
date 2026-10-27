import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";
import { AlertCircleIcon, AlertTriangleIcon, BellIcon, CheckCircle2Icon, CheckCheckIcon, InfoIcon, RefreshCcwIcon, } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/States";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync, useSubmitGuard } from "@/hooks";
import { relativeTime } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
const SEVERITY_STYLE = {
    info: {
        icon: InfoIcon,
        container: "bg-info/10 text-info",
        dot: "bg-info",
    },
    success: {
        icon: CheckCircle2Icon,
        container: "bg-primary/10 text-primary",
        dot: "bg-primary",
    },
    warning: {
        icon: AlertTriangleIcon,
        container: "bg-warning/10 text-warning",
        dot: "bg-warning",
    },
    error: {
        icon: AlertCircleIcon,
        container: "bg-destructive/10 text-destructive",
        dot: "bg-destructive",
    },
};
export function NotificationsPage() {
    const data = useData();
    const { session } = useAuth();
    const navigate = useNavigate();
    const reduceMotion = useReducedMotion();
    const canManage = can(session?.profile.role, "notifications.manage");
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [markingAll, runMarkAll] = useSubmitGuard();
    const [rebuilding, runRebuild] = useSubmitGuard();
    const notifications = useAsync(() => data.listNotifications({ unreadOnly, limit: 100 }), [data, unreadOnly]);
    const unread = useAsync(() => data.getUnreadNotificationCount(), [data]);
    const openItem = async (item) => {
        try {
            if (!item.isRead) {
                await data.markNotificationRead(item.id);
                notifications.reload();
                unread.reload();
            }
            if (item.link)
                navigate(item.link);
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to open this notification.");
        }
    };
    const markAllRead = () => {
        void runMarkAll(async () => {
            try {
                await data.markAllNotificationsRead();
                toast.success("All notifications marked as read");
                notifications.reload();
                unread.reload();
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to update notifications.");
            }
        });
    };
    const rebuild = () => {
        void runRebuild(async () => {
            try {
                const created = await data.generateNotifications();
                if (created > 0)
                    toast.success(`Rebuilt — ${created} new notifications`);
                else
                    toast.info("Rebuild finished — no new notifications");
                notifications.reload();
                unread.reload();
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to rebuild notifications.");
            }
        });
    };
    const rows = notifications.data ?? [];
    const unreadCount = unread.data ?? 0;
    const header = (<PageHeader title="Notifications" description="Expiry alerts, pending dues and check-in events for your institute." actions={<>
          <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/60 px-3 py-1.5">
            <Label htmlFor="notif-unread" className="text-xs text-muted-foreground">
              Unread only
            </Label>
            <Switch id="notif-unread" size="sm" checked={unreadOnly} onCheckedChange={setUnreadOnly}/>
          </div>
          {canManage ? (<>
              <Button variant="outline" onClick={rebuild} disabled={rebuilding}>
                <RefreshCcwIcon className={cn("size-4", rebuilding && "animate-spin")}/>
                {rebuilding ? "Rebuilding…" : "Rebuild"}
              </Button>
              <Button variant="outline" onClick={markAllRead} disabled={markingAll}>
                <CheckCheckIcon className="size-4"/> Mark all read
              </Button>
            </>) : null}
          <Badge variant={unreadCount > 0 ? "default" : "secondary"} className="px-2.5 py-1 text-xs">
            {unreadCount} unread
          </Badge>
        </>}/>);
    if (notifications.loading) {
        return (<div className="space-y-6">
        {header}
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (<Skeleton key={index} className="h-20"/>))}
        </div>
      </div>);
    }
    if (notifications.error) {
        return (<div className="space-y-6">
        {header}
        <ErrorState title="Unable to load notifications" message={notifications.error} onRetry={notifications.reload}/>
      </div>);
    }
    return (<div className="space-y-6">
      {header}

      {rows.length === 0 ? (<EmptyState icon={<BellIcon className="size-5"/>} title={unreadOnly ? "No unread notifications" : "Nothing to review"} description={unreadOnly
                ? "You are all caught up — switch off the filter to see read items."
                : "Rebuild notifications to scan memberships and dues, then come back here."} action={canManage ? (<Button size="sm" variant="outline" onClick={rebuild} disabled={rebuilding}>
                <RefreshCcwIcon className={cn("size-4", rebuilding && "animate-spin")}/>
                Rebuild notifications
              </Button>) : undefined}/>) : (<ul className="space-y-2">
          {rows.map((item, index) => {
                const style = SEVERITY_STYLE[item.severity];
                const Icon = style.icon;
                return (<motion.li key={item.id} initial={reduceMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: reduceMotion ? 0 : Math.min(index * 0.03, 0.3) }}>
                <button type="button" onClick={() => void openItem(item)} className={cn("flex w-full items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-4 text-left transition-colors hover:border-border hover:bg-card", !item.isRead && "border-primary/25 bg-primary/[0.04]")}>
                  <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", style.container)}>
                    <Icon className="size-4"/>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{item.title}</span>
                      {!item.isRead ? (<span aria-label="Unread" className={cn("size-2 shrink-0 rounded-full", style.dot)}/>) : null}
                    </span>
                    <span className="mt-0.5 block text-sm text-muted-foreground">{item.body}</span>
                    <span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{relativeTime(item.createdAt)}</span>
                      {item.link ? <span className="text-primary">Open details →</span> : null}
                    </span>
                  </span>
                </button>
              </motion.li>);
            })}
        </ul>)}
    </div>);
}
