import { cn } from "@/lib/utils";

const ROTATIONS = ["-1.6deg", "1.2deg", "-0.8deg", "1.6deg"];

/**
 * A row of paper ticket chips: big serif numbers with a volt highlighter
 * swipe, alternating rotations and punch holes on the edges.
 * Each item: { label, value, sub }.
 */
export function StatsTickets({ items, className }) {
    return (<ul className={cn("grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4", className)}>
      {items.map((item, index) => (<li key={item.label} className="pp-punch pp-stack-sm paper-surface relative rounded-lg px-4 py-3.5 pt-5" style={{ rotate: ROTATIONS[index % ROTATIONS.length] }}>
          <span aria-hidden="true" className="absolute top-2 left-1/2 h-[7px] w-14 -translate-x-1/2 -rotate-1 rounded-[2px] bg-primary/50"/>
          <p className="mt-1 text-[10px] tracking-[0.18em] text-paper-foreground/60 uppercase">
            {item.label}
          </p>
          <p className="mt-1 font-serif text-3xl leading-none sm:text-4xl">
            <span className="pp-mark">{item.value}</span>
          </p>
          {item.sub ? (<p className="mt-1.5 text-[11px] text-paper-foreground/70">{item.sub}</p>) : null}
        </li>))}
    </ul>);
}
