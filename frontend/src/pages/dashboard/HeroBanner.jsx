import { Link } from "react-router-dom";
import { ArrowRightIcon, CalendarDaysIcon, PlusIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Dashboard hero — uses the exact supplied artwork `/images/kala-mandir-hero.png`.
 * The image is scaled to full height and anchored right so the dancer (face, hands,
 * costume) is never cropped; a left-to-right burgundy overlay keeps copy readable.
 */
export function HeroBanner({ todayClassCount, canAddStudent, canMarkAttendance }) {
    const reduceMotion = useReducedMotion();
    const showToday = typeof todayClassCount === "number";
    return (<motion.section aria-label="Welcome to Kala Mandir" initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="relative isolate overflow-hidden rounded-[14px] border border-[#4a1629] shadow-[0_2px_5px_rgba(49,13,32,0.12)]" style={{ backgroundColor: "#210714" }}>
      {/* Exact local asset — no remote fallbacks, no generated alternatives */}
      <div aria-hidden="true" className="absolute inset-0 bg-no-repeat" style={{
            backgroundImage: "url('/images/kala-mandir-hero.png')",
            backgroundSize: "auto 100%",
            backgroundPosition: "right center",
            backgroundColor: "#210714",
        }}/>
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-[#210714]/97 via-[#210714]/88 to-[#210714]/45 md:via-[#210714]/72 md:to-transparent"/>
      <div className="relative flex h-full max-w-[620px] flex-col justify-center px-6 py-6 sm:px-8 lg:pl-9">
        <p className="text-[11px] font-semibold tracking-[1.2px] text-km-gold uppercase">
          ✦ WELCOME TO KALA MANDIR
        </p>
        <h1 className="mt-2.5 max-w-[470px] text-[24px] leading-[1.12] font-semibold text-[#FBF7EF] sm:text-[27px] lg:text-[32px]">
          Every class tells a story.
        </h1>
        <p className="mt-3 max-w-[400px] text-[13.5px] leading-[1.6] text-[#FBF7EF]/80 sm:text-[14.5px]">
          Inspiring movement, nurturing creativity, celebrating every student's journey.
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {canMarkAttendance ? (<Link to="/attendance" className="group inline-flex h-[38px] items-center gap-2 rounded-full bg-[#E8D5AD] px-[18px] text-[13px] font-semibold text-[#310D20] transition-colors hover:bg-[#F3E7CB] active:scale-[0.98]">
              Mark attendance
              <ArrowRightIcon aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5"/>
            </Link>) : null}
          {canAddStudent ? (<Link to="/members?new=1" className="inline-flex h-[38px] items-center gap-1.5 rounded-full border border-km-gold/55 bg-[#310D20]/55 px-[18px] text-[13px] font-medium text-[#FBF7EF] transition-colors hover:border-km-gold hover:bg-km-wine/70 active:scale-[0.98]">
              <PlusIcon aria-hidden="true" className="size-3.5"/>
              Add student
            </Link>) : null}
          {showToday ? (<Link to="/classes" className="group hidden h-[38px] items-center gap-2.5 rounded-full border border-km-gold/30 bg-[#210714]/60 px-3.5 sm:inline-flex">
              <CalendarDaysIcon aria-hidden="true" className="size-4 text-km-gold"/>
              <span className="leading-tight">
                <span className="block text-[9px] font-medium tracking-[0.8px] text-[#FBF7EF]/60 uppercase">
                  Today's classes
                </span>
                <span className="block text-[12.5px] font-semibold text-[#E8D5AD]">
                  {todayClassCount} {todayClassCount === 1 ? "class" : "classes"}
                </span>
              </span>
              <ArrowRightIcon className="size-3.5 text-km-gold/70 group-hover:translate-x-0.5 transition-transform"/>
            </Link>) : null}
        </div>
      </div>
    </motion.section>);
}
