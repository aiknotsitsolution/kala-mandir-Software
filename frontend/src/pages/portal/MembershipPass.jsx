import { useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import { SmartImage } from "@/components/shared/SmartImage";
import { formatDate, formatINR, timeSlotLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import { membershipProgress } from "./paper";
import { Stamp } from "./PaperBits";

/** Faded artwork printed behind the pass (public/images/…). */
const PASS_ART = "/images/Person_dancing_inside_palace_20261020004636.gif";

const STAMP_TONES = {
    active: { tone: "ok", label: "Active" },
    expiring_soon: { tone: "warn", label: "Expiring" },
    expired: { tone: "bad", label: "Expired" },
    suspended: { tone: "bad", label: "Suspended" },
    inactive: { tone: "muted", label: "Inactive" },
    none: { tone: "muted", label: "No plan" },
};

/**
 * The hero: a compact paper "membership pass" in real 3D — the tilt follows
 * the pointer (fine pointers only, disabled for reduced motion). Check-in no
 * longer needs a personal QR: Students scan the gym's front-desk QR from the
 * "Scan QR code" button in the portal navbar.
 */
export function MembershipPass({ profile }) {
    const reduced = useReducedMotion();
    const [canTilt] = useState(() => typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    const tiltEnabled = canTilt && !reduced;

    const rotateXInput = useMotionValue(0);
    const rotateYInput = useMotionValue(0);
    const spring = { stiffness: 170, damping: 18, mass: 0.6 };
    const rotateX = useSpring(useTransform(rotateXInput, [-0.5, 0.5], [8, -8]), spring);
    const rotateY = useSpring(useTransform(rotateYInput, [-0.5, 0.5], [-11, 11]), spring);

    const handleMove = (event) => {
        if (!tiltEnabled)
            return;
        const rect = event.currentTarget.getBoundingClientRect();
        rotateYInput.set((event.clientX - rect.left) / rect.width - 0.5);
        rotateXInput.set((event.clientY - rect.top) / rect.height - 0.5);
    };
    const handleLeave = () => {
        rotateYInput.set(0);
        rotateXInput.set(0);
    };

    const me = profile ?? null;
    const membership = me?.membership ?? null;
    const slotLabel = timeSlotLabel(me?.preferredSlot);
    const stamp = STAMP_TONES[me?.effectiveStatus] ?? STAMP_TONES.none;
    const progress = membershipProgress(membership);

    return (<div className="pp-scene mx-auto max-w-2xl">
      <motion.div className="relative min-h-[210px] w-full sm:min-h-[225px]" style={{ rotateX: tiltEnabled ? rotateX : 0, rotateY: tiltEnabled ? rotateY : 0, transformStyle: "preserve-3d" }} onMouseMove={handleMove} onMouseLeave={handleLeave}>
        <div className="pp-face paper-surface paper-lift relative overflow-hidden rounded-2xl">
          {/* dancer artwork, faded into the paper */}
          <img src={PASS_ART} alt="" aria-hidden="true" loading="eager" className="pointer-events-none absolute inset-0 size-full object-cover opacity-[0.16] grayscale" onError={(event) => {
            event.currentTarget.style.display = "none";
        }}/>
          <span aria-hidden="true" className="paper-tape"/>

          <div className="relative z-10 flex h-full flex-col justify-between gap-3 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] tracking-[0.3em] text-paper-foreground/60 uppercase">
                  Kalamandir Dance Institute
                </p>
                <p className="font-serif text-lg leading-tight">Membership pass</p>
              </div>
              <Stamp label={stamp.label} tone={stamp.tone} className="mt-1 mr-2"/>
            </div>

            <div className="flex items-center gap-3">
              <SmartImage src={me?.photoUrl} name={me?.fullName ?? "Student"} className="size-11 shrink-0 rounded-full text-[11px] ring-2 ring-paper-edge sm:size-12"/>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold tracking-tight sm:text-xl">
                  {me?.fullName ?? "Student"}
                </p>
                <p className="truncate font-mono text-[11px] tracking-wide text-paper-foreground/70">
                  {me?.memberCode ?? "—"}
                  {membership?.planName ? ` · ${membership.planName}` : ""}
                </p>
              </div>
            </div>

            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                {progress !== null ? (<div aria-label={`${Math.round(progress * 100)}% of membership elapsed`} className="h-1.5 w-28 overflow-hidden rounded-full bg-paper-2 sm:w-36">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }}/>
                  </div>) : null}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className="font-mono text-xs tracking-wide text-paper-foreground/60">
                  {formatDate(membership?.startDate)} — {formatDate(membership?.endDate)}
                </p>
                {slotLabel ? (<p className="font-mono text-[11px] font-semibold tracking-wide text-paper-foreground/80">
                    Slot · {slotLabel}
                  </p>) : null}
                {membership?.balance != null ? (<p className={cn("font-mono text-[10px] font-semibold tracking-wide", membership.balance > 0 ? "text-[#a3601f]" : "text-[#3f7d51]")}>
                    {membership.balance > 0 ? `Due ${formatINR(membership.balance)}` : "Paid in full"}
                  </p>) : null}
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <p className="mt-3 text-center text-[11px] text-muted-foreground">
        Checked in yet? Tap “Scan QR code” above to start your timer.
      </p>
    </div>);
}
