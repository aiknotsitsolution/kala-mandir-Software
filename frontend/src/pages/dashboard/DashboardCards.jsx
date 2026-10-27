import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRightIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

/** Animated number that respects prefers-reduced-motion. */
export function CountUp({ value, format }) {
    const [display, setDisplay] = useState(0);
    const previous = useRef(0);
    useEffect(() => {
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (reduceMotion) {
            setDisplay(value);
            previous.current = value;
            return;
        }
        const from = previous.current;
        const start = performance.now();
        const duration = 650;
        let frame = 0;
        const tick = (now) => {
            const progress = Math.min(1, (now - start) / duration);
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(Math.round(from + (value - from) * eased));
            if (progress < 1)
                frame = requestAnimationFrame(tick);
            else
                previous.current = value;
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [value]);
    return <span className="tabular">{format ? format(display) : display.toLocaleString("en-IN")}</span>;
}

export function GoldCorner() {
    return (<svg aria-hidden="true" viewBox="0 0 80 80" fill="none" className="pointer-events-none absolute -right-2 -bottom-2 size-16 text-km-gold opacity-[0.16]">
      <path d="M76 8C50 10 28 30 22 66" stroke="currentColor" strokeWidth="1.4"/>
      <path d="M76 22C56 24 38 40 32 74" stroke="currentColor" strokeWidth="1"/>
      <path d="M63 6c-3 6-3 12 0 18 3-6 3-12 0-18z" fill="currentColor"/>
      <circle cx="69" cy="34" r="3.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>);
}

export const CARD_BASE = "group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_2px_5px_color-mix(in_srgb,var(--km-burgundy)_6%,transparent)] transition-all duration-200 hover:-translate-y-[2px] hover:border-km-gold/45 hover:shadow-[0_6px_16px_color-mix(in_srgb,var(--km-burgundy)_10%,transparent)]";

/** Corner arrow shown only on cards that navigate somewhere. */
export function CardArrow() {
    return <ArrowUpRightIcon aria-hidden="true" className="absolute top-3 right-3 size-4 text-km-gold opacity-0 transition-opacity duration-200 group-hover:opacity-80"/>;
}

/**
 * Card body wrapped as a router link when `to` is set — the whole card becomes
 * one click target with a visible keyboard focus ring.
 */
function CardFrame({ to, baseClass, children }) {
    if (!to)
        return <div className={baseClass}>{children}</div>;
    return (<Link to={to} className={baseClass + " cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60"}>
      {children}
    </Link>);
}

/** Primary metric card — circular icon left, eyebrow label, big burgundy value, hint. */
export function MetricCard({ label, value, icon, hint, accent, format, index = 0, to }) {
    const reduceMotion = useReducedMotion();
    return (<motion.div initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.3), ease: [0.22, 1, 0.36, 1] }} className="h-full">
      <CardFrame to={to} baseClass={CARD_BASE + " min-h-[118px] p-4"}>
        <GoldCorner/>
        {to ? <CardArrow/> : null}
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: accent.bg, color: accent.fg }} aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{label}</p>
            <p className="mt-1 text-[28px] leading-none font-semibold text-primary">
              <CountUp value={value} format={format}/>
            </p>
          </div>
        </div>
        {hint ? <p className="relative mt-2.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
      </CardFrame>
    </motion.div>);
}

/** Financial summary card — icon, coloured INR amount, optional real-share progress bar. */
export function FinancialCard({ label, value, icon, hint, accent, amountColor, barColor, barPct, format, index = 0, to }) {
    const reduceMotion = useReducedMotion();
    const hasBar = typeof barPct === "number" && Number.isFinite(barPct);
    return (<motion.div initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: Math.min(index * 0.05, 0.3), ease: [0.22, 1, 0.36, 1] }} className="h-full">
      <CardFrame to={to} baseClass={CARD_BASE + " min-h-[112px] p-4"}>
        <GoldCorner/>
        {to ? <CardArrow/> : null}
        <div className="relative flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: accent.bg, color: accent.fg }} aria-hidden="true">
            {icon}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-[0.1em] text-muted-foreground uppercase">{label}</p>
            <p className="mt-1 text-[26px] leading-none font-semibold" style={{ color: amountColor }}>
              <CountUp value={value} format={format}/>
            </p>
          </div>
        </div>
        <div className="relative mt-auto pt-3">
          {hasBar ? (<div className="h-1.5 w-full overflow-hidden rounded-full bg-border" aria-hidden="true">
              <div className="h-full rounded-full transition-[width] duration-700" style={{
                    width: `${Math.max(0, Math.min(100, barPct))}%`,
                    backgroundColor: barColor,
                }}/>
            </div>) : null}
          {hint ? <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
        </div>
      </CardFrame>
    </motion.div>);
}
