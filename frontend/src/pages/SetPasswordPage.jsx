import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { KeyRoundIcon, Loader2Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/data/api/client";

export function SetPasswordPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token") ?? "";
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [complete, setComplete] = useState(false);

    const submit = async (event) => {
        event.preventDefault();
        setError(null);
        if (password.length < 6) {
            setError("Password must be at least 6 characters.");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        setSaving(true);
        try {
            await apiPost("/auth/password/setup", { token, password });
            setComplete(true);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "Unable to set your password.");
        } finally {
            setSaving(false);
        }
    };

    return (<main className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <section className="w-full max-w-sm space-y-5 rounded-2xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="space-y-2">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <KeyRoundIcon className="size-5"/>
          </div>
          <h1 className="font-display text-2xl font-semibold">Set student portal password</h1>
          <p className="text-sm text-muted-foreground">Choose a private password for your Kala Mandir account.</p>
        </div>

        {error ? (<Alert variant="destructive">
            <AlertTitle>Password setup failed</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>) : null}
        {complete ? (<Alert>
            <AlertTitle>Password saved</AlertTitle>
            <AlertDescription>Your student portal is ready. Sign in with your email, student ID or phone number.</AlertDescription>
          </Alert>) : null}

        {complete ? (<Button asChild className="w-full">
            <Link to="/login">Go to sign in</Link>
          </Button>) : token ? (<form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" autoComplete="new-password" minLength={6} value={password} onChange={(event) => setPassword(event.target.value)} required/>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" minLength={6} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required/>
            </div>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? <Loader2Icon className="size-4 animate-spin"/> : null}
              {saving ? "Saving…" : "Set password"}
            </Button>
          </form>) : (<p className="text-sm text-destructive">This password setup link is missing or invalid. Ask the studio to send a new one.</p>)}
      </section>
    </main>);
}
