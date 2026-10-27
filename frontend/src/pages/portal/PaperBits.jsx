import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * A paper cutout that "settles into place" on load — spring y + slight
 * rotation, staggered by the caller. Honours prefers-reduced-motion.
 */
export function Settle({ children, delay = 0, rotate = 0, className }) {
    const reduced = useReducedMotion();
    if (reduced) {
        return <div className={className}>{children}</div>;
    }
    return (<motion.div className={className} initial={{ opacity: 0, y: 24, rotate: rotate - 2.5 }} animate={{ opacity: 1, y: 0, rotate }} transition={{ type: "spring", stiffness: 130, damping: 17, mass: 0.7, delay }}>
      {children}
    </motion.div>);
}

/** Editorial section title: serif heading + dashed rule (+ optional action). */
export function SectionHeading({ title, action, className }) {
    return (<div className={cn("mb-3 flex items-end justify-between gap-4", className)}>
      <div className="flex items-center gap-3">
        <h2 className="font-serif text-2xl leading-none">{title}</h2>
        <span aria-hidden="true" className="editorial-rule w-10 self-center text-muted-foreground sm:w-20"/>
      </div>
      {action}
    </div>);
}

const STAMP_TONES = {
    ok: "pp-stamp-ok",
    warn: "pp-stamp-warn",
    bad: "pp-stamp-bad",
    muted: "pp-stamp-muted",
};

/** Rubber stamp: rotated, double-bordered, ink-coloured label. */
export function Stamp({ label, tone = "ok", className }) {
    return (<span className={cn("pp-stamp text-[11px] sm:text-xs", STAMP_TONES[tone] ?? STAMP_TONES.muted, className)}>
      {label}
    </span>);
}

/** Small volt tape strip pinned to the top edge of a paper sheet. */
export function Tape({ className }) {
    return (<span aria-hidden="true" className={cn("paper-tape", className)}/>);
}
