import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, useReducedMotion } from "motion/react";
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, Loader2Icon, LockKeyholeIcon, MailCheckIcon, Music2Icon, QrCodeIcon, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/auth/AuthProvider";
import { GYM_CHECKIN_PARAM } from "@/lib/qr";
import { loginSchema } from "@/lib/validation";

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
    const {
        session,
        requestLoginOtp,
        verifyLoginOtp,
        requestPasswordResetOtp,
        verifyPasswordResetOtp,
        resetPasswordWithOtp,
        loading,
    } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const reduceMotion = useReducedMotion();
    const [showPassword, setShowPassword] = useState(false);
    const [serverError, setServerError] = useState(null);
    const [heroFailed, setHeroFailed] = useState(false);
    const [loginChallenge, setLoginChallenge] = useState(null);
    const [loginCredentials, setLoginCredentials] = useState(null);
    const [otp, setOtp] = useState("");
    const [otpBusy, setOtpBusy] = useState(false);
    const [secondsLeft, setSecondsLeft] = useState(0);
    const [forgotPassword, setForgotPassword] = useState(false);
    const [resetRequested, setResetRequested] = useState(false);
    const [resetEmail, setResetEmail] = useState("");
    const [resetCode, setResetCode] = useState("");
    const [resetToken, setResetToken] = useState("");
    const [resetPassword, setResetPassword] = useState("");
    const [resetConfirmPassword, setResetConfirmPassword] = useState("");
    const [resetBusy, setResetBusy] = useState(false);
    const [resetExpiresAt, setResetExpiresAt] = useState(null);
    const [resetResendAt, setResetResendAt] = useState(null);
    const [resetSecondsLeft, setResetSecondsLeft] = useState(0);
    const [resetResendSecondsLeft, setResetResendSecondsLeft] = useState(0);
    const [successMessage, setSuccessMessage] = useState("");
    // Set when the page was opened by scanning the studio's shared QR.
    const checkinToken = useMemo(() => new URLSearchParams(location.search).get(GYM_CHECKIN_PARAM), [location.search]);
    const from = location.state?.from ?? "/";
    const portalCheckinUrl = checkinToken
        ? `/portal?${GYM_CHECKIN_PARAM}=${encodeURIComponent(checkinToken)}`
        : null;
    const loginChallengeId = loginChallenge?.challengeId;
    const loginChallengeExpiry = loginChallenge?.expiresAt;
    useEffect(() => {
        if (!loginChallengeId || !loginChallengeExpiry)
            return undefined;
        const updateRemaining = () => {
            const expiresAt = Date.parse(loginChallengeExpiry);
            setSecondsLeft(Number.isFinite(expiresAt) ? Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)) : 0);
        };
        updateRemaining();
        const timer = setInterval(updateRemaining, 1000);
        return () => clearInterval(timer);
    }, [loginChallengeId, loginChallengeExpiry]);
    useEffect(() => {
        if (!forgotPassword || !resetRequested || !resetExpiresAt || !resetResendAt)
            return undefined;
        const updateRemaining = () => {
            setResetSecondsLeft(Math.max(0, Math.ceil((resetExpiresAt - Date.now()) / 1000)));
            setResetResendSecondsLeft(Math.max(0, Math.ceil((resetResendAt - Date.now()) / 1000)));
        };
        updateRemaining();
        const timer = setInterval(updateRemaining, 1000);
        return () => clearInterval(timer);
    }, [forgotPassword, resetRequested, resetExpiresAt, resetResendAt]);
    const { register, handleSubmit, getValues, formState: { errors, isSubmitting }, } = useForm({
        resolver: zodResolver(loginSchema),
        defaultValues: {
            identifier: "",
            phone: "",
            password: "",
        },
    });
    if (!loading && session) {
        if (portalCheckinUrl && session.profile.role === "member")
            return <Navigate to={portalCheckinUrl} replace/>;
        return <Navigate to={from} replace/>;
    }
    const onSubmit = handleSubmit(async (values) => {
        setServerError(null);
        setSuccessMessage("");
        try {
            const credentials = {
                identifier: values.identifier,
                phone: values.phone,
                password: values.password,
            };
            const challenge = await requestLoginOtp(credentials);
            setLoginCredentials(credentials);
            setLoginChallenge(challenge);
            setOtp("");
        }
        catch (error) {
            setServerError(error instanceof Error ? error.message : "Sign in failed.");
        }
    });
    const handleOtpSubmit = async (event) => {
        event.preventDefault();
        if (!loginChallenge || secondsLeft <= 0 || otpBusy)
            return;
        setServerError(null);
        setOtpBusy(true);
        try {
            const next = await verifyLoginOtp({ challengeId: loginChallenge.challengeId, code: otp });
            const target = portalCheckinUrl && next?.profile.role === "member"
                ? portalCheckinUrl
                : from;
            navigate(target, { replace: true });
        }
        catch (error) {
            setServerError(error instanceof Error ? error.message : "Code verification failed.");
        } finally {
            setOtpBusy(false);
        }
    };
    const resendOtp = async () => {
        if (!loginCredentials || otpBusy)
            return;
        setServerError(null);
        setOtpBusy(true);
        try {
            setLoginChallenge(await requestLoginOtp(loginCredentials));
            setOtp("");
        } catch (error) {
            setServerError(error instanceof Error ? error.message : "Unable to resend the code.");
        } finally {
            setOtpBusy(false);
        }
    };
    const requestResetCode = async () => {
        const email = resetEmail.trim();
        if (!email) {
            setServerError("Enter the email address linked to your account.");
            return;
        }
        setServerError(null);
        setSuccessMessage("");
        setResetBusy(true);
        try {
            const result = await requestPasswordResetOtp(email);
            const now = Date.now();
            setResetEmail(email);
            setResetRequested(true);
            setResetToken("");
            const serverExpiry = Date.parse(result?.expiresAt);
            setResetExpiresAt(Number.isFinite(serverExpiry) ? serverExpiry : now + 60_000);
            setResetResendAt(now + 30_000);
            setResetCode("");
            setResetPassword("");
            setResetConfirmPassword("");
        } catch (error) {
            setServerError(error instanceof Error ? error.message : "Unable to request a password reset.");
        } finally {
            setResetBusy(false);
        }
    };
    const submitResetRequest = (event) => {
        event.preventDefault();
        void requestResetCode();
    };
    const verifyResetCode = async (event) => {
        event.preventDefault();
        if (resetBusy)
            return;
        setServerError(null);
        if (resetSecondsLeft <= 0) {
            setServerError("The verification code has expired. Request a new code.");
            return;
        }
        setResetBusy(true);
        try {
            const result = await verifyPasswordResetOtp(resetEmail, resetCode);
            setResetToken(result.token);
            setResetPassword("");
            setResetConfirmPassword("");
        } catch (error) {
            setServerError(error instanceof Error ? error.message : "Unable to verify this email.");
        } finally {
            setResetBusy(false);
        }
    };
    const submitPasswordReset = async (event) => {
        event.preventDefault();
        if (resetBusy)
            return;
        setServerError(null);
        if (!resetToken) {
            setServerError("Verify your email before choosing a new password.");
            return;
        }
        if (resetPassword.length < 8) {
            setServerError("Password must be at least 8 characters.");
            return;
        }
        if (resetPassword !== resetConfirmPassword) {
            setServerError("Passwords do not match.");
            return;
        }
        setResetBusy(true);
        try {
            const result = await resetPasswordWithOtp({
                token: resetToken,
                newPassword: resetPassword,
                confirmPassword: resetConfirmPassword,
            });
            setForgotPassword(false);
            setResetRequested(false);
            setResetToken("");
            setResetCode("");
            setResetPassword("");
            setResetConfirmPassword("");
            setSuccessMessage(result?.notificationDelivery === "failed"
                ? "Password updated. Sign in with your new password; the confirmation email could not be sent."
                : "Password updated. Sign in with your new password.");
        } catch (error) {
            setServerError(error instanceof Error ? error.message : "Unable to reset your password.");
        } finally {
            setResetBusy(false);
        }
    };
    const startPasswordReset = () => {
        const identifier = String(getValues("identifier") ?? "").trim();
        setResetEmail(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier) ? identifier : "");
        setResetRequested(false);
        setResetToken("");
        setResetCode("");
        setResetPassword("");
        setResetConfirmPassword("");
        setServerError(null);
        setSuccessMessage("");
        setForgotPassword(true);
    };
    const backToLogin = () => {
        setForgotPassword(false);
        setResetRequested(false);
        setResetToken("");
        setResetCode("");
        setResetPassword("");
        setResetConfirmPassword("");
        setServerError(null);
    };
    const returnToLogin = () => {
        setLoginChallenge(null);
        setLoginCredentials(null);
        setOtp("");
        setServerError(null);
    };
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
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              {forgotPassword ? "Reset your password" : "Welcome to Kala Mandir"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {forgotPassword
                ? "Verify your email and choose a new password."
                : "Sign in to continue your artistic journey."}
            </p>
            <GoldOrnament className="mt-3 block text-km-gold-muted"/>
          </div>

          {checkinToken ? (<Alert className="mt-6 border-km-gold/40 bg-km-gold/10">
              <QrCodeIcon className="size-4 text-km-gold"/>
              <AlertTitle>Studio QR scanned</AlertTitle>
              <AlertDescription>
                Sign in, then confirm attendance in your student portal. Scanning alone does not mark attendance.
              </AlertDescription>
            </Alert>) : null}

          {serverError ? (<Alert variant="destructive" className="mt-6 border-destructive/40">
              <LockKeyholeIcon className="size-4"/>
              <AlertTitle>{loginChallenge ? "Verification failed" : forgotPassword ? "Password reset failed" : "Sign in failed"}</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>) : null}
          {successMessage ? (<Alert className="mt-6 border-success/40 bg-success/5">
              <MailCheckIcon className="size-4 text-success"/>
              <AlertTitle>Password updated</AlertTitle>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>) : null}

          {loginChallenge ? (<form key="login-otp" onSubmit={handleOtpSubmit} className="mt-6 space-y-4" noValidate>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <MailCheckIcon className="size-4 text-primary"/> Check your email
                </div>
                <p className="mt-1 text-muted-foreground">
                  Enter the 6-digit code sent to {loginChallenge.email}. It expires in 1 minute.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {secondsLeft > 0 ? `Code expires in 0:${String(secondsLeft).padStart(2, "0")}` : "This code has expired."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-otp">Email verification code</Label>
                <Input
                  id="login-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                  required
                />
              </div>
              <Button type="submit" disabled={otpBusy || otp.length !== 6 || secondsLeft <= 0} className="h-11 w-full">
                {otpBusy ? <Loader2Icon className="size-4 animate-spin"/> : <MailCheckIcon className="size-4"/>}
                {otpBusy ? "Verifying…" : "Verify and sign in"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button type="button" variant="ghost" size="sm" onClick={returnToLogin} disabled={otpBusy}>
                  <ArrowLeftIcon className="size-4"/> Back to login
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={resendOtp} disabled={otpBusy || secondsLeft > 0}>
                  Resend code
                </Button>
              </div>
            </form>) : forgotPassword ? (!resetRequested ? (<form key="password-reset-request" onSubmit={submitResetRequest} className="mt-6 space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="reset-email">Account email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  onChange={(event) => setResetEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <Button type="submit" disabled={resetBusy || !resetEmail.trim()} className="h-11 w-full">
                {resetBusy ? <Loader2Icon className="size-4 animate-spin"/> : <MailCheckIcon className="size-4"/>}
                {resetBusy ? "Sending code…" : "Send verification code"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={backToLogin} disabled={resetBusy}>
                <ArrowLeftIcon className="size-4"/> Back to sign in
              </Button>
            </form>) : !resetToken ? (<form key="password-reset-verify" onSubmit={verifyResetCode} className="mt-6 space-y-4" noValidate>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  <MailCheckIcon className="size-4 text-primary"/> Check your email
                </div>
                <p className="mt-1 text-muted-foreground">
                  If a verified account uses this email, a 6-digit code has been sent. The code expires in 1 minute.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {resetSecondsLeft > 0 ? `Code expires in 0:${String(resetSecondsLeft).padStart(2, "0")}` : "This code has expired. Request a new one."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-code">Email verification code</Label>
                <Input
                  id="reset-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={resetCode}
                  onChange={(event) => setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                  required
                />
              </div>
              <Button type="submit" disabled={resetBusy || resetCode.length !== 6 || resetSecondsLeft <= 0} className="h-11 w-full">
                {resetBusy ? <Loader2Icon className="size-4 animate-spin"/> : <MailCheckIcon className="size-4"/>}
                {resetBusy ? "Verifying email…" : "Verify email"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button type="button" variant="ghost" size="sm" onClick={backToLogin} disabled={resetBusy}>
                  <ArrowLeftIcon className="size-4"/> Back to sign in
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={requestResetCode} disabled={resetBusy || resetResendSecondsLeft > 0}>
                  {resetResendSecondsLeft > 0 ? `Resend in ${resetResendSecondsLeft}s` : "Resend code"}
                </Button>
              </div>
            </form>) : (<form key="password-reset-complete" onSubmit={submitPasswordReset} className="mt-6 space-y-4" noValidate>
              <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm">
                <div className="flex items-center gap-2 font-medium text-success">
                  <MailCheckIcon className="size-4"/> Email verified
                </div>
                <p className="mt-1 text-muted-foreground">Choose a new password for your account.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-new-password">New password</Label>
                <Input
                  id="reset-new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={72}
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                  required
                />
                {resetPassword && resetPassword.length < 8 ? <p className="text-xs text-destructive">Use at least 8 characters.</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-confirm-password">Confirm new password</Label>
                <Input
                  id="reset-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={72}
                  value={resetConfirmPassword}
                  onChange={(event) => setResetConfirmPassword(event.target.value)}
                  required
                />
                {resetConfirmPassword && resetPassword !== resetConfirmPassword ? <p className="text-xs text-destructive">Passwords do not match.</p> : null}
              </div>
              <Button
                type="submit"
                disabled={resetBusy || resetCode.length !== 6 || resetSecondsLeft <= 0 || resetPassword.length < 8 || resetPassword !== resetConfirmPassword}
                className="h-11 w-full"
              >
                {resetBusy ? <Loader2Icon className="size-4 animate-spin"/> : <LockKeyholeIcon className="size-4"/>}
                {resetBusy ? "Updating password…" : "Update password"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <Button type="button" variant="ghost" size="sm" onClick={backToLogin} disabled={resetBusy}>
                  <ArrowLeftIcon className="size-4"/> Back to sign in
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => {
                    setResetToken("");
                    setResetRequested(false);
                    setResetCode("");
                }} disabled={resetBusy}>
                  Start over
                </Button>
              </div>
            </form>)) : (<form key="login" onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="identifier">Email or account ID</Label>
              <Input id="identifier" type="text" autoComplete="username" placeholder="Email or account ID" {...register("identifier")}/>
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

            <div className="flex justify-end">
              <button type="button" onClick={startPasswordReset} className="text-sm font-medium text-primary underline-offset-4 hover:underline">
                Forgot password?
              </button>
            </div>

            {/* Premium burgundy button with a subtle gold hover treatment */}
            <Button type="submit" disabled={isSubmitting} className="group relative h-11 w-full bg-primary font-medium tracking-wide text-primary-foreground shadow-[0_12px_28px_-18px_rgba(49,13,32,0.9)] transition-all duration-300 hover:bg-km-wine hover:text-km-ivory hover:shadow-[0_0_0_1px_rgba(198,164,91,0.55),0_14px_30px_-16px_rgba(198,164,91,0.65)]">
              {isSubmitting ? <Loader2Icon className="size-4 animate-spin"/> : <Music2Icon className="size-4 text-km-gold transition-colors group-hover:text-km-gold"/>}
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>)}

          <p className="mt-8 text-center text-xs leading-relaxed text-muted-foreground">
            {forgotPassword
              ? "Your password reset code can only be used once and expires in 1 minute."
              : "Admin and students sign in here with email, account ID or mobile number. A verification code is required at every login."}
          </p>
        </motion.div>
      </section>
    </div>);
}
