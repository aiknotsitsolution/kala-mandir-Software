import { useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRoundIcon, Loader2Icon, ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/shared/PageHeader";
import { useData } from "@/auth/AuthProvider";
import { ApiError } from "@/data/api/client";
import { Settle, Stamp } from "./PaperBits";
const passwordChangeSchema = z
    .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Confirm your new password"),
})
    .refine((values) => values.newPassword === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
});
export function ChangePasswordPage() {
    const data = useData();
    const [serverError, setServerError] = useState(null);
    const { register, handleSubmit, reset, formState: { errors, isSubmitting }, } = useForm({
        resolver: zodResolver(passwordChangeSchema),
        defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
    });
    const onSubmit = handleSubmit(async (values) => {
        setServerError(null);
        try {
            await data.changeMyPassword(values.currentPassword, values.newPassword);
            toast.success("Password updated");
            reset({ currentPassword: "", newPassword: "", confirmPassword: "" });
        }
        catch (error) {
            if (error instanceof ApiError && error.status === 403) {
                setServerError("Current password is incorrect.");
            }
            else {
                setServerError(error instanceof Error ? error.message : "Unable to change your password.");
            }
        }
    });
    return (<div className="space-y-6">
      <PageHeader title="Change password" description="Use at least 8 characters you haven't used here before."/>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Settle>
          <Card className="graphite-surface max-w-lg border-border/70">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-base">Your password</CardTitle>
                <p className="text-xs text-muted-foreground">Confirm your current password to continue</p>
              </div>
              <KeyRoundIcon className="size-4 text-muted-foreground"/>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} className="space-y-4" noValidate>
                {serverError ? (<Alert variant="destructive" className="border-destructive/40">
                    <KeyRoundIcon className="size-4"/>
                    <AlertTitle>Unable to change password</AlertTitle>
                    <AlertDescription>{serverError}</AlertDescription>
                  </Alert>) : null}

                <div className="space-y-2">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input id="current-password" type="password" autoComplete="current-password" placeholder="••••••••" {...register("currentPassword")}/>
                  {errors.currentPassword ? (<p className="text-xs text-destructive">{errors.currentPassword.message}</p>) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input id="new-password" type="password" autoComplete="new-password" placeholder="At least 8 characters" {...register("newPassword")}/>
                  {errors.newPassword ? (<p className="text-xs text-destructive">{errors.newPassword.message}</p>) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input id="confirm-password" type="password" autoComplete="new-password" placeholder="Repeat the new password" {...register("confirmPassword")}/>
                  {errors.confirmPassword ? (<p className="text-xs text-destructive">{errors.confirmPassword.message}</p>) : null}
                </div>

                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2Icon className="size-4 animate-spin"/> : null}
                  {isSubmitting ? "Updating…" : "Update password"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </Settle>

        {/* Paper side-note — decorative, keeps the form column from feeling bare */}
        <Settle delay={0.1} className="hidden lg:block">
          <aside className="paper-surface paper-lift relative rotate-[1.4deg] rounded-xl p-5">
            <span aria-hidden="true" className="paper-tape"/>
            <div className="flex items-center justify-between">
              <ShieldCheckIcon className="size-5 text-paper-foreground/70"/>
              <Stamp label="Secure" tone="ok" className="text-[10px]"/>
            </div>
            <h2 className="mt-3 font-serif text-xl leading-tight">Keep your key safe.</h2>
            <ul className="mt-3 space-y-2 text-sm text-paper-foreground/80">
              <li>· Use at least 8 characters — longer is stronger.</li>
              <li>· Mix letters, numbers and a symbol or two.</li>
              <li>· Don’t reuse your studio login password.</li>
              <li>· The front desk can’t see your password — only you can change it.</li>
            </ul>
          </aside>
        </Settle>
      </div>
    </div>);
}
