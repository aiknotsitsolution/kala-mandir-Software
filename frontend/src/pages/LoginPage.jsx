import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import { EyeIcon, EyeOffIcon, Loader2Icon, LockKeyholeIcon, Music2Icon, QrCodeIcon, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/auth/AuthProvider";
import { getDataService } from "@/data";
import { getCurrentCoords } from "@/lib/geo";
import { GYM_CHECKIN_PARAM } from "@/lib/qr";
import { loginSchema } from "@/lib/validation";

/**
 * Mark attendance for a signed-in member who arrived via the studio QR link.
 * Best-effort GPS first (only when the gym enforces a range), then the server
 * re-validates eligibility/cooldown. Resolves to the CheckInResult.
 */
async function selfCheckIn(data, token) {
    let coords = null;
    try {
        const gym = await data.getGymFresh();
        if (gym?.locationRequired)
            coords = await getCurrentCoords();
    }
    catch {
        /* best effort — the server explains if a location fix is required */
    }
    return data.checkinGym(token, coords);
}

/** Full-screen state shown while a scanned QR is being checked in. */
function MarkingAttendance() {
    return (<div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
      <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"/>
      <p className="text-sm">Marking your attendance…</p>
    </div>);
}

// Local generated hero (palace scene with two classical dancers). If it fails
// to load we fall back to a burgundy arch backdrop — never a broken image.
const HERO_IMAGE = "/images/login page left side.png";

/** Gold arch-and-flame emblem used as the studio mark. */
function KMEmblem({ className }) {
    return (<svg viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <path d="M24 4C14 4 8 11 8 21v23h32V21C40 11 34 4 24 4z" stroke="currentColor" strokeWidth="2.2"/>
      <path d="M24 15c-3.6 2.7-5.5 6-5.5 9.8 0 3.3 1.9 5.7 4.2 6.6-1.2 1.3-2 2.7-2 4.4h6.6c0-1.7-.8-3.1-2-4.4 2.3-.9 4.2-3.3 4.2-6.6 0-3.8-1.9-7.1-5.5-9.8z" fill="currentColor"/>
      <circle cx="24" cy="25" r="1.8" fill="#310d20"/>
    </svg>);
}

/** Restrained gold ornament: a hairline with a central diamond + lotus dot. */
function GoldOrnament({ className }) {
    return (<span aria-hidden="true" className={className}>
      <svg viewBox="0 0 160 12" fill="none" className="h-3 w-40">
        <path d="M0 6h58M102 6h58" stroke="currentColor" strokeWidth="1" opacity="0.7"/>
        <path d="M80 1l4 5-4 5-4-5 4-5z" fill="currentColor"/>
        <circle cx="66" cy="6" r="1.4" fill="currentColor" opacity="0.8"/>
        <circle cx="94" cy="6" r="1.4" fill="currentColor" opacity="0.8"/>
      </svg>
    </span>);
}

export function LoginPage() {
    const { session, signIn, loading } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const reduceMotion = useReducedMotion();
    const [showPassword, setShowPassword] = useState(false);
    const [serverError, setServerError] = useState(null);
    const [heroFailed, setHeroFailed] = useState(false);
    // Set when the page was opened by scanning the studio's shared QR.
    const checkinToken = useMemo(() => new URLSearchParams(location.search).get(GYM_CHECKIN_PARAM), [location.search]);
    const isMember = session?.profile.role === "member";
    const needsCheckin = Boolean(checkinToken) && isMember;
    const [checkinState, setCheckinState] = useState("idle"); // idle | working | done
    const startedRef = useRef(false);
    const from = location.state?.from ?? "/";
    useEffect(() => {
        if (!needsCheckin || startedRef.current)
            return;
        startedRef.current = true;
        setCheckinState("working");
        void (async () => {
            try {
                const result = await selfCheckIn(getDataService(session), checkinToken);
                if (result?.status === "ok")
                    toast.success(result.message ?? "Attendance marked.");
                else
                    toast.info(result?.message ?? "Attendance was not marked.");
            }
            catch (err) {
                toast.error(err instanceof Error ? err.message : "Unable to mark attendance.");
            }
            finally {
                setCheckinState("done");
                navigate("/portal", { replace: true });
            }
        })();
    }, [needsCheckin, session, checkinToken, navigate]);
    const { register, handleSubmit, formState: { errors, isSubmitting }, } = useForm({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            identifier: "",
            phone: "",
            password: "",
        },
    });
    // Already signed in as a member who scanned the studio QR → mark and go to
    // the portal (and drop the ?checkin= query so a refresh can't re-fire it).
    useEffect(() => {
        if (!needsCheckin || checkinState !== "idle")
            return;
        setCheckinState("working");
        let cancelled = false;
        void (async () => {
            try {
                const result = await selfCheckIn(getDataService(session), checkinToken);
                if (cancelled)
                    return;
                if (result?.status === "ok")
                    toast.success(result.message ?? "Attendance marked.");
                else
                    toast.info(result?.message ?? "Attendance was not marked.");
            }
            catch (err) {
                if (!cancelled)
                    toast.error(err instanceof Error ? err.message : "Unable to mark attendance.");
            }
            finally {
                if (!cancelled) {
                    setCheckinState("done");
                    navigate("/portal", { replace: true });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [needsCheckin, checkinState, session, checkinToken, navigate]);
    if (!loading && session) {
        if (needsCheckin && checkinState !== "done")
            return <MarkingAttendance />;
        return <Navigate to={from} replace/>;
    }
    const onSubmit = handleSubmit(async (values) => {
        setServerError(null);
        try {
            // One endpoint for everyone — the server resolves the role from the
            // database and the router sends staff to the dashboard, members to
            // their portal. Sign in with an email / Student ID or a mobile number.
            const next = await signIn({
                identifier: values.identifier,
                phone: values.phone,
                password: values.password,
            });
            // Scanned the studio QR? The ?checkin= effect above marks attendance
            // and redirects to the portal once the member session lands.
            if (checkinToken && next?.profile.role === "member")
                return;
            navigate(from, { replace: true });
        }
        catch (error) {
            setServerError(error instanceof Error ? error.message : "Sign in failed.");
        }
    });
    // Cinematic, barely-there background drift — disabled when reduced motion.
    const heroImgAnimate = reduceMotion
        ? { opacity: 1 }
        : { opacity: 1, scale: [1, 1.06, 1] };
    const heroImgTransition = reduceMotion
        ? { duration: 0.4 }
        : { opacity: { duration: 1.1, ease: [0.22, 1, 0.36, 1] }, scale: { duration: 28, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" } };
    return (<div className="grid min-h-dvh lg:grid-cols-[1.08fr_0.92fr]">
      {/* ===================== LEFT HERO PANEL (desktop) ===================== */}
      <section className="relative hidden overflow-hidden bg-km-burgundy lg:block">
        {/* Cinematic background */}
        {!heroFailed ? (<motion.img src={HERO_IMAGE} alt="Indian classical dancers performing in a palace courtyard" initial={{ opacity: 0 }} animate={heroImgAnimate} transition={heroImgTransition} className="absolute inset-0 size-full object-cover object-[40%_center]" loading="eager" onError={() => setHeroFailed(true)}/>) : (<div className="arch-motif absolute inset-0 bg-gradient-to-br from-km-wine via-km-burgundy to-[#160510]"/>)}
        {/* Contrast scrims — top for the brand, bottom for the headline. The
            dancers sit in the vertical middle, so text never covers a face. */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#170409]/75 via-[#170409]/10 to-[#170409]/95"/>
        <div className="absolute inset-0 bg-gradient-to-r from-[#170409]/45 via-transparent to-[#170409]/35"/>

        <div className="relative z-10 flex h-full flex-col justify-between p-12 xl:p-16">
          {/* Brand */}
          <header className="flex items-center gap-3">
            <span className="gold-halo flex size-11 items-center justify-center rounded-xl border border-km-gold/40 bg-km-gold/10 text-km-gold">
              <KMEmblem className="size-6"/>
            </span>
            <span className="leading-tight">
              <span className="block font-display text-lg font-semibold tracking-[0.14em] text-km-ivory">
                KALA MANDIR
              </span>
              <span className="block text-[11px] font-medium tracking-[0.28em] text-km-gold/85 uppercase">
                Dance N Art Studio
              </span>
            </span>
          </header>

          {/* Headline */}
          <div className="max-w-xl">
            <motion.div initial={{ opacity: 0 }} animate={reduceMotion ? { opacity: 1 } : { opacity: 1 }} transition={{ delay: 0.25, duration: 0.6 }} className="mb-7 flex items-center gap-3 text-[11px] font-medium tracking-[0.28em] text-km-gold/90 uppercase">
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-km-gold/50"/>
              <span>Dance</span>
              <span className="text-[7px] leading-none text-km-gold/70">◆</span>
              <span>Art</span>
              <span className="text-[7px] leading-none text-km-gold/70">◆</span>
              <span>Yoga</span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-km-gold/50"/>
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: reduceMotion ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="text-5xl leading-[1.06] font-semibold tracking-tight text-balance text-km-ivory xl:text-6xl">
              Where Dance Becomes Expression.
            </motion.h1>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.6 }}>
              <GoldOrnament className="mt-6 block text-km-gold"/>
              <p className="mt-5 max-w-md text-base leading-relaxed text-km-ivory/75">
                A beautiful space to learn, create and express through dance and art.
              </p>
            </motion.div>
          </div>

          <footer className="text-xs text-km-ivory/45">
            Attendance, memberships and class quotas — one elegant studio console.
          </footer>
        </div>
      </section>

      {/* ===================== RIGHT LOGIN PANEL ===================== */}
      <section className="relative flex items-center justify-center bg-background px-5 py-10 sm:px-10 lg:px-14">
        {/* Faint arch motif in the corner — brand warmth without clutter */}
        <div aria-hidden="true" className="arch-motif pointer-events-none absolute inset-x-0 top-0 h-56 opacity-[0.35] [mask-image:linear-gradient(to_bottom,black,transparent)]"/>

        <motion.div initial={{ opacity: 0, y: reduceMotion ? 0 : 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="relative z-10 w-full max-w-sm">
          {/* Compact hero — only on mobile / tablet */}
          <div className="relative mb-7 overflow-hidden rounded-2xl border border-km-gold/25 lg:hidden">
            {!heroFailed ? (<img src={HERO_IMAGE} alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover object-[40%_30%]" onError={() => setHeroFailed(true)}/>) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-km-burgundy via-km-burgundy/70 to-km-burgundy/30"/>
            <div className="relative flex items-center gap-3 px-5 py-6">
              <span className="gold-halo flex size-10 items-center justify-center rounded-xl border border-km-gold/40 bg-km-gold/10 text-km-gold">
                <KMEmblem className="size-5"/>
              </span>
              <span className="leading-tight">
                <span className="block font-display text-base font-semibold tracking-[0.12em] text-km-ivory">
                  KALA MANDIR
                </span>
                <span className="block text-[10px] font-medium tracking-[0.24em] text-km-gold/85 uppercase">
                  Dance N Art Studio
                </span>
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <h2 className="font-display text-3xl font-semibold tracking-tight">Welcome to Kala Mandir</h2>
            <p className="text-sm text-muted-foreground">
              Sign in to continue your artistic journey.
            </p>
            <GoldOrnament className="mt-3 block text-km-gold-muted"/>
          </div>

          {checkinToken ? (<Alert className="mt-6 border-km-gold/40 bg-km-gold/10">
              <QrCodeIcon className="size-4 text-km-gold"/>
              <AlertTitle>Studio QR scanned</AlertTitle>
              <AlertDescription>
                Sign in to mark your attendance for today.
              </AlertDescription>
            </Alert>) : null}

          {serverError ? (<Alert variant="destructive" className="mt-6 border-destructive/40">
              <LockKeyholeIcon className="size-4"/>
              <AlertTitle>Sign in failed</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>) : null}

          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="identifier">Student ID / Email</Label>
              <Input id="identifier" type="text" autoComplete="username" placeholder="you@gmail.com or KD-0007" {...register("identifier")}/>
              {errors.identifier ? <p className="text-xs text-destructive">{errors.identifier.message}</p> : null}
            </div>

            <div className="flex items-center gap-3 text-[10px] font-medium tracking-[0.24em] text-muted-foreground/70 uppercase">
              <span className="h-px flex-1 bg-border"/>
              <span>or</span>
              <span className="h-px flex-1 bg-border"/>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Mobile number</Label>
              <Input id="phone" type="tel" inputMode="numeric" autoComplete="tel" placeholder="+91 98765 43210" {...register("phone")}/>
              {errors.phone ? <p className="text-xs text-destructive">{errors.phone.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••" {...register("password")}/>
                <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground transition-colors hover:text-primary">
                  {showPassword ? <EyeOffIcon className="size-4"/> : <EyeIcon className="size-4"/>}
                </button>
              </div>
              {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
            </div>

            {/* Premium burgundy button with a subtle gold hover treatment */}
            <Button type="submit" disabled={isSubmitting} className="group relative h-11 w-full bg-primary font-medium tracking-wide text-primary-foreground shadow-[0_12px_28px_-18px_rgba(49,13,32,0.9)] transition-all duration-300 hover:bg-km-wine hover:text-km-ivory hover:shadow-[0_0_0_1px_rgba(198,164,91,0.55),0_14px_30px_-16px_rgba(198,164,91,0.65)]">
              {isSubmitting ? <Loader2Icon className="size-4 animate-spin"/> : <Music2Icon className="size-4 text-km-gold transition-colors group-hover:text-km-gold"/>}
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
            Staff and students sign in here with email, Student ID or mobile number.
            Student accounts are created at the front desk — no self-registration.
          </p>
        </motion.div>
      </section>
    </div>);
}
