import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ChevronLeftIcon, ChevronRightIcon, ShieldAlertIcon, SaveIcon, HistoryIcon, Building2Icon, UserIcon } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { PhotoPicker } from "@/components/shared/PhotoPicker";
import { EmptyState, ErrorState, Skeleton, Stagger, TableSkeleton, } from "@/components/shared/States";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { appVersion, gymTimezone } from "@/config/env";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync, useSubmitGuard } from "@/hooks";
import { formatDateTime, titleCase } from "@/lib/format";
import { can, ROLE_LABELS } from "@/lib/permissions";
import { settingsFormSchema } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
/** Audit-trail entity labels — the platform is a "studio", never a "gym". */
const AUDIT_ENTITY_LABELS = {
    gyms: "Studio",
    gym_settings: "Studio Settings",
    gym_classes: "Classes",
};
/** Label an audit entity; unknown codes get a "gym"-free studio fallback too. */
function auditEntityLabel(entity) {
    const mapped = AUDIT_ENTITY_LABELS[entity];
    if (mapped)
        return mapped;
    return titleCase(String(entity ?? "").replace(/gym/gi, "studio"));
}
const COMMON_TIMEZONES = [
    "Asia/Kolkata",
    "Asia/Dubai",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Europe/London",
    "Europe/Berlin",
    "America/New_York",
    "America/Los_Angeles",
    "Australia/Sydney",
];
const DEFAULT_VALUES = {
    gymName: "",
    timezone: gymTimezone,
    checkinCooldownMinutes: 5,
    trackCheckout: true,
    expiringSoonDays: 7,
    expiryReminderDays: "7, 3, 1",
    allowExpiredCheckin: false,
    enableEmail: false,
    enableSms: false,
    enableWhatsapp: false,
    enablePush: true,
};
/** "7, 3, 1" → [1, 3, 7]; drops anything that is not a whole day count. */
function parseReminderDays(raw) {
    const days = new Set();
    for (const part of raw.split(",")) {
        const text = part.trim();
        if (text === "")
            continue;
        const value = Number(text);
        if (Number.isInteger(value) && value >= 0 && value <= 365)
            days.add(value);
    }
    return [...days].sort((a, b) => a - b);
}
function SwitchRow({ id, label, description, checked, onCheckedChange, disabled, }) {
    return (<div className="flex items-start justify-between gap-4 py-2">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        {description ? (<p className="text-xs text-muted-foreground">{description}</p>) : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}/>
    </div>);
}
/** "Your profile" — the signed-in admin can set their display name and avatar here. */
function ProfileCard() {
    const data = useData();
    const { session, refresh } = useAuth();
    const profile = session?.profile;
    const [name, setName] = useState(profile?.fullName ?? "");
    const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? "");
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        setName(profile?.fullName ?? "");
        setAvatarUrl(profile?.avatarUrl ?? "");
    }, [profile?.fullName, profile?.avatarUrl]);
    const nameValid = name.trim().length >= 2;
    const dirty = name.trim() !== (profile?.fullName ?? "") || avatarUrl !== (profile?.avatarUrl ?? "");
    async function handleSave() {
        if (!nameValid || saving)
            return;
        setSaving(true);
        try {
            await data.updateProfile({ fullName: name.trim(), avatarUrl: avatarUrl || null });
            await refresh();
            toast.success("Profile updated");
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to update your profile.");
        }
        finally {
            setSaving(false);
        }
    }
    return (<Card className="graphite-surface border-border/70">
      <CardHeader className="space-y-1">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserIcon className="size-4 text-muted-foreground"/>
          Your profile
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Your avatar and name — shown in the top bar and audit trail.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <PhotoPicker value={avatarUrl} name={name || profile?.fullName || "User"} inputId="settings-avatar" onChange={setAvatarUrl}/>
        <div className="space-y-2">
          <Label htmlFor="settings-profile-name">Full name</Label>
          <Input id="settings-profile-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name"/>
          {!nameValid && name.length > 0 ? <p className="text-xs text-destructive">Name must be at least 2 characters</p> : null}
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Email</p>
          <p className="text-sm">{profile?.email ?? "—"}</p>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Role</p>
          <p className="text-sm">{ROLE_LABELS[profile?.role ?? "front_desk"] ?? "Staff"}</p>
        </div>
        <div className="flex justify-end border-t border-border/60 pt-4">
          <Button size="sm" disabled={!nameValid || !dirty || saving} onClick={() => void handleSave()}>
            {saving ? null : <SaveIcon className="size-4"/>}
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </CardContent>
    </Card>);
}
export function SettingsPage() {
    const data = useData();
    const { session } = useAuth();
    const canManage = can(session?.profile.role, "settings.manage");
    /* One section at a time: General | Profile | Audit. */
    const [tab, setTab] = useState("general");
    const AUDIT_PAGE_SIZE = 10;
    const [auditPage, setAuditPage] = useState(1);
    const settings = useAsync(() => data.getSettings(), [data]);
    const gym = useAsync(() => data.getGym(), [data]);
    const audit = useAsync(() => data.listAuditLogs({ page: auditPage, pageSize: AUDIT_PAGE_SIZE }), [data, auditPage]);
    const auditRows = audit.data?.items ?? [];
    const auditTotal = audit.data?.total ?? 0;
    const auditPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));
    const auditRangeFrom = auditTotal === 0 ? 0 : (auditPage - 1) * AUDIT_PAGE_SIZE + 1;
    const auditRangeTo = Math.min(auditPage * AUDIT_PAGE_SIZE, auditTotal);
    const [saving, runSave] = useSubmitGuard();
    const { register, handleSubmit, control, reset, watch, formState: { errors }, } = useForm({
        resolver: zodResolver(settingsFormSchema),
        defaultValues: DEFAULT_VALUES,
    });
    useEffect(() => {
        if (!settings.data || !gym.data)
            return;
        reset({
            gymName: gym.data.name,
            timezone: gym.data.timezone,
            checkinCooldownMinutes: settings.data.checkinCooldownMinutes,
            trackCheckout: settings.data.trackCheckout,
            expiringSoonDays: settings.data.expiringSoonDays,
            expiryReminderDays: settings.data.expiryReminderDays.join(", "),
            allowExpiredCheckin: settings.data.allowExpiredCheckin,
            enableEmail: settings.data.enableEmail,
            enableSms: settings.data.enableSms,
            enableWhatsapp: settings.data.enableWhatsapp,
            enablePush: settings.data.enablePush,
        });
    }, [settings.data, gym.data, reset]);
    const currentTimezone = watch("timezone");
    const timezoneOptions = currentTimezone && !COMMON_TIMEZONES.includes(currentTimezone)
        ? [currentTimezone, ...COMMON_TIMEZONES]
        : COMMON_TIMEZONES;
    const onSubmit = handleSubmit((values) => {
        const expiryReminderDays = parseReminderDays(values.expiryReminderDays);
        if (expiryReminderDays.length === 0) {
            toast.error("Enter at least one expiry reminder day, e.g. 7, 3, 1");
            return;
        }
        void runSave(async () => {
            try {
                await data.updateSettings({
                    gymName: values.gymName.trim(),
                    timezone: values.timezone,
                    checkinCooldownMinutes: values.checkinCooldownMinutes,
                    trackCheckout: values.trackCheckout,
                    expiringSoonDays: values.expiringSoonDays,
                    expiryReminderDays,
                    allowExpiredCheckin: values.allowExpiredCheckin,
                    enableEmail: values.enableEmail,
                    enableSms: values.enableSms,
                    enableWhatsapp: values.enableWhatsapp,
                    enablePush: values.enablePush,
                });
                toast.success("Settings saved");
                settings.reload();
                gym.reload();
                audit.reload();
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save settings.");
            }
        });
    });
    if (settings.loading || gym.loading) {
        return (<div className="space-y-6">
        <PageHeader title="Settings" description="Institute profile, check-in policy and reminders."/>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-2"/>
          <Skeleton className="h-96"/>
        </div>
        <Skeleton className="h-64"/>
      </div>);
    }
    if (settings.error) {
        return (<div className="space-y-6">
        <PageHeader title="Settings" description="Institute profile, check-in policy and reminders."/>
        <ErrorState title="Unable to load settings" message={settings.error} onRetry={settings.reload}/>
      </div>);
    }
    return (<div className="space-y-6">
      <PageHeader title="Settings" description="Institute profile, check-in policy, reminders and notification channels."/>

      {!canManage ? (<Alert>
          <ShieldAlertIcon className="size-4"/>
          <AlertTitle>Read-only access</AlertTitle>
          <AlertDescription>
            Your role can review these settings but not change them. Ask an admin or the owner to
            make edits.
          </AlertDescription>
        </Alert>) : null}

      {/* ---------------- Tabs: General | Profile | Audit ---------------- */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="general" className="gap-1 px-1.5 sm:gap-1.5 sm:px-2">
            <Building2Icon className="hidden size-4 sm:block"/>
            <span>General</span>
          </TabsTrigger>
          <TabsTrigger value="profile" className="gap-1 px-1.5 sm:gap-1.5 sm:px-2">
            <UserIcon className="hidden size-4 sm:block"/>
            <span>Profile</span>
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1 px-1.5 sm:gap-1.5 sm:px-2">
            <HistoryIcon className="hidden size-4 sm:block"/>
            <span className="sm:hidden">Audit</span><span className="hidden sm:inline">Audit trail</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
        {/* Card 1 — settings form */}
        <Stagger className="h-full">
          <Card className="graphite-surface border-border/70">
            <CardHeader className="space-y-1">
              <CardTitle className="text-base">Institute profile &amp; check-in policy</CardTitle>
              <p className="text-xs text-muted-foreground">
                Applied to QR check-ins, expiry maths and every reminder the app sends.
              </p>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmit} noValidate className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="gym-name">Institute name</Label>
                    <Input id="gym-name" disabled={!canManage} placeholder="Kalamandir Dance Institute" {...register("gymName")}/>
                    {errors.gymName ? (<p className="text-xs text-destructive">{errors.gymName.message}</p>) : null}
                  </div>
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Controller control={control} name="timezone" render={({ field }) => (<Select value={field.value} onValueChange={field.onChange} disabled={!canManage}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Choose a timezone"/>
                          </SelectTrigger>
                          <SelectContent>
                            {timezoneOptions.map((zone) => (<SelectItem key={zone} value={zone}>
                                {zone}
                              </SelectItem>))}
                          </SelectContent>
                        </Select>)}/>
                    {errors.timezone ? (<p className="text-xs text-destructive">{errors.timezone.message}</p>) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="cooldown">Check-in cooldown (minutes)</Label>
                    <Input id="cooldown" type="number" min={0} max={1440} disabled={!canManage} {...register("checkinCooldownMinutes", { valueAsNumber: true })}/>
                    <p className="text-xs text-muted-foreground">
                      Minimum gap between two accepted check-ins for the same member.
                    </p>
                    {errors.checkinCooldownMinutes ? (<p className="text-xs text-destructive">
                        {errors.checkinCooldownMinutes.message}
                      </p>) : null}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="expiring-soon">“Expiring soon” window (days)</Label>
                    <Input id="expiring-soon" type="number" min={1} max={90} disabled={!canManage} {...register("expiringSoonDays", { valueAsNumber: true })}/>
                    {errors.expiringSoonDays ? (<p className="text-xs text-destructive">{errors.expiringSoonDays.message}</p>) : null}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="reminder-days">Expiry reminder days</Label>
                    <Textarea id="reminder-days" rows={2} disabled={!canManage} placeholder="7, 3, 1" {...register("expiryReminderDays")}/>
                    <p className="text-xs text-muted-foreground">
                      Comma-separated days-before-expiry that trigger a reminder.
                    </p>
                    {errors.expiryReminderDays ? (<p className="text-xs text-destructive">{errors.expiryReminderDays.message}</p>) : null}
                  </div>
                </div>

                <Separator />

                <div>
                  <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Check-in behaviour
                  </p>
                  <Controller control={control} name="trackCheckout" render={({ field }) => (<SwitchRow id="track-checkout" label="Track check-outs" description="Ask students to scan out so you can measure dwell time." checked={field.value} onCheckedChange={field.onChange} disabled={!canManage}/>)}/>
                  <Controller control={control} name="allowExpiredCheckin" render={({ field }) => (<SwitchRow id="allow-expired" label="Allow expired check-ins" description="Let expired Students scan in (front desk will see a warning)." checked={field.value} onCheckedChange={field.onChange} disabled={!canManage}/>)}/>
                </div>

                <Separator />

                <div>
                  <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Notification channels
                  </p>
                  <Controller control={control} name="enableEmail" render={({ field }) => (<SwitchRow id="enable-email" label="Email" checked={field.value} onCheckedChange={field.onChange} disabled={!canManage}/>)}/>
                  <Controller control={control} name="enableSms" render={({ field }) => (<SwitchRow id="enable-sms" label="SMS" checked={field.value} onCheckedChange={field.onChange} disabled={!canManage}/>)}/>
                  <Controller control={control} name="enableWhatsapp" render={({ field }) => (<SwitchRow id="enable-whatsapp" label="WhatsApp" checked={field.value} onCheckedChange={field.onChange} disabled={!canManage}/>)}/>
                  <Controller control={control} name="enablePush" render={({ field }) => (<SwitchRow id="enable-push" label="Push notifications" description="In-app alerts on the dashboard and notifications screen." checked={field.value} onCheckedChange={field.onChange} disabled={!canManage}/>)}/>
                </div>

                <div className="flex justify-end border-t border-border/60 pt-4">
                  <Button type="submit" disabled={!canManage || saving}>
                    {saving ? null : <SaveIcon className="size-4"/>}
                    {saving ? "Saving…" : "Save settings"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </Stagger>
        </TabsContent>

        <TabsContent value="profile">
          {/* Signed-in user's own profile (name + avatar) alongside the read-only studio details. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Stagger className="h-full">
              <ProfileCard/>
            </Stagger>
            <Stagger className="h-full" delayIndex={1}>
          <Card className="graphite-surface h-full border-border/70">
            <CardHeader className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2Icon className="size-4 text-muted-foreground"/>
                Studio details
              </CardTitle>
              <p className="text-xs text-muted-foreground">Read-only account information.</p>
            </CardHeader>
            <CardContent>
              {gym.error ? (<ErrorState message={gym.error} onRetry={gym.reload}/>) : gym.data ? (<dl className="space-y-3 text-sm">
                  {[
                ["Name", gym.data.name],
                ["Slug", gym.data.slug],
                ["Timezone", gym.data.timezone],
                ["Currency", gym.data.currency],
                ["Address", gym.data.address ?? "—"],
                ["Phone", gym.data.phone ?? "—"],
                ["Email", gym.data.email ?? "—"],
                ["App version", appVersion],
            ].map(([label, value]) => (<div key={label} className="flex items-start justify-between gap-4 border-b border-border/50 pb-2 last:border-0 last:pb-0">
                      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
                      <dd className={cn("break-words text-right font-medium", value === "—" && "font-normal text-muted-foreground")}>
                        {value}
                      </dd>
                    </div>))}
                </dl>) : (<Skeleton className="h-56"/>)}
            </CardContent>
          </Card>
            </Stagger>
          </div>
        </TabsContent>

        <TabsContent value="audit">
      {/* Audit trail */}
      <Stagger delayIndex={2}>
        <Card className="graphite-surface border-border/70">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <HistoryIcon className="size-4 text-muted-foreground"/>
                Audit trail
              </CardTitle>
              <p className="text-xs text-muted-foreground">Recent changes recorded by the app.</p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {audit.loading ? (<TableSkeleton rows={6} cols={4}/>) : audit.error ? (<ErrorState title="Unable to load the audit trail" message={audit.error} onRetry={audit.reload}/>) : auditRows.length === 0 ? (<EmptyState title="No activity yet" description="Changes to students, payments and settings will appear here." className="py-10"/>) : (<div className="overflow-x-auto rounded-lg border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Actor</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead>Entity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {auditRows.map((log) => (<TableRow key={log.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDateTime(log.createdAt)}
                        </TableCell>
                        <TableCell className="text-sm">{log.actorName ?? "System"}</TableCell>
                        <TableCell className="text-sm">{titleCase(log.action)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {auditEntityLabel(log.entity)}
                        </TableCell>
                      </TableRow>))}
                  </TableBody>
                </Table>
              </div>)}

            {/* Pager */}
            {auditTotal > 0 && !audit.error ? (<div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3">
                <p className="text-xs text-muted-foreground">
                  Showing {auditRangeFrom}–{auditRangeTo} of {auditTotal} changes
                </p>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="outline" size="xs" disabled={auditPage <= 1 || audit.loading} onClick={() => setAuditPage((current) => Math.max(1, current - 1))}>
                    <ChevronLeftIcon className="size-3"/> Prev
                  </Button>
                  <span className="text-xs text-muted-foreground tabular">
                    Page {auditPage} of {auditPages}
                  </span>
                  <Button variant="outline" size="xs" disabled={auditPage >= auditPages || audit.loading} onClick={() => setAuditPage((current) => current + 1)}>
                    Next <ChevronRightIcon className="size-3"/>
                  </Button>
                </div>
              </div>) : null}
          </CardContent>
        </Card>
      </Stagger>
        </TabsContent>
      </Tabs>
    </div>);
}
