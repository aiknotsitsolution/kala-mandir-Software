import { motion } from "motion/react";
import { AlertTriangleIcon, InboxIcon, RefreshCwIcon, SearchXIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export function EmptyState({ title, description, icon, action, className, }) {
    return (<div className={cn("flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/80 bg-card/40 px-6 py-14 text-center", className)}>
      <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        {icon ?? <InboxIcon className="size-5"/>}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>);
}
export function ErrorState({ message, onRetry, title = "Something went wrong", }) {
    return (<div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-5"/>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{message ?? "Please try again."}</p>
      </div>
      {onRetry ? (<Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCwIcon className="size-4"/> Retry
        </Button>) : null}
    </div>);
}
export function SearchEmptyState({ query }) {
    return (<EmptyState icon={<SearchXIcon className="size-5"/>} title="No results found" description={query
            ? `Nothing matches “${query}”. Try a different name, phone number or Student ID.`
            : "Try adjusting your search or filters."}/>);
}
export function Skeleton({ className }) {
    return <div className={cn("skeleton-shimmer rounded-md", className)}/>;
}
export function TableSkeleton({ rows = 6, cols = 5 }) {
    return (<div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, rowIndex) => (<div key={rowIndex} className="flex items-center gap-3">
          {Array.from({ length: cols }).map((__, colIndex) => (<Skeleton key={colIndex} className={cn("h-8", colIndex === 0 ? "w-1/4" : "w-1/6")}/>))}
        </div>))}
    </div>);
}
/** Staggered entrance wrapper (respects prefers-reduced-motion via CSS). */
export function Stagger({ children, className, delayIndex = 0, }) {
    return (<motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: Math.min(delayIndex * 0.04, 0.4), ease: [0.22, 1, 0.36, 1] }} className={className}>
      {children}
    </motion.div>);
}
