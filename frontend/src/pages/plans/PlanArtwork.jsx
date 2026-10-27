import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Plan artwork — the studio's supplied plan illustrations served from
 * `/public/images/plan{1,2,3}.png`, one per dance plan (3 / 5 / 6 days a week).
 * If an image fails to load we gracefully fall back to a neutral gold
 * medallion so a broken file never breaks the card.
 *
 * The whole block is `pointer-events-none` + `aria-hidden` so the art can
 * never swallow a click meant for the card or pollute the accessibility tree.
 */

/** Illustration file for each plan, by position in the plan list. */
const PLAN_IMAGES = ["/images/plan1.png", "/images/plan2.png", "/images/plan3.png"];

/** Neutral gold medallion used only when the supplied image fails to load. */
function FallbackMedallion() {
    return (<svg viewBox="0 0 120 120" className="h-full w-full text-km-gold-muted" role="presentation" focusable="false">
      <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55"/>
      <circle cx="60" cy="60" r="47" fill="none" stroke="currentColor" strokeWidth="0.6" opacity="0.32" strokeDasharray="1.5 3"/>
      <circle cx="60" cy="60" r="40" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.35"/>
      <path d="M60 74c-9-6-13.5-16-12-27 6 3 9.6 8 12 14 2.4-6 6-11 12-14 1.5 11-3 21-12 27z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
      <path d="M60 76c-13-3-21-12-22-24 8 1 15 5 19 12M60 76c13-3 21-12 22-24-8 1-15 5-19 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
      <path d="M44 80c5 2.6 11 4 16 4s11-1.4 16-4" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
    </svg>);
}

/**
 * Plan illustration for a card's left section. `index` maps to the supplied
 * plan1/2/3 artwork in plan order; out-of-range indexes wrap around.
 */
export function PlanArtwork({ index = 0, className }) {
    const [failed, setFailed] = useState(false);
    const src = PLAN_IMAGES[Math.abs(index) % PLAN_IMAGES.length];

    return (<div className={cn("pointer-events-none relative flex shrink-0 items-center justify-center overflow-hidden", className)} aria-hidden="true">
      {failed ? (<div className="h-full w-full p-1">
          <FallbackMedallion/>
        </div>) : (<img src={src} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="h-full w-full object-contain"/>)}
    </div>);
}
