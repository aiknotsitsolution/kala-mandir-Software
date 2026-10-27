import { useEffect, useState } from "react";
import { Building2Icon, ClockIcon, CrosshairIcon, Loader2Icon, PaletteIcon, PlusIcon, PrinterIcon, QrCodeIcon, RefreshCwIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, ErrorState, Skeleton } from "@/components/shared/States";
import { useAuth, useData } from "@/auth/AuthProvider";
import { useAsync, useSubmitGuard } from "@/hooks";
import { applyTheme, resolveMode, THEME_ACCENTS, THEME_MODES } from "@/lib/theme";
import { getCurrentCoords } from "@/lib/geo";
import { can } from "@/lib/permissions";
import { gymCheckinUrl, renderQrImage } from "@/lib/qr";
import { format12h } from "@/lib/format";
import { HOURLY_SLOTS, SLOT_GROUPS, slotGroupOf } from "@/lib/slots";
import { TimeSelect } from "@/components/shared/TimeSelect";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AddSlotDialog } from "./AddSlotDialog";

/** Ready-made hourly slots (8:00 AM – 9:00 PM), grouped Morning/Afternoon/Evening. */
function defaultSlots() {
    return HOURLY_SLOTS.map((slot) => ({ ...slot }));
}
/**
 * Manage Institute — the front-desk setup: the single studio QR Students scan from
 * their portal, and the daily slot schedule.
 */
export function ManageGymPage() {
    const data = useData();
    const { session, refresh } = useAuth();
    const canManage = can(session?.profile.role, "settings.manage");
    const gym = useAsync(() => (canManage ? data.getGymFresh() : Promise.resolve(null)), [data, canManage]);
    const qr = useAsync(() => (canManage ? data.getGymQr() : Promise.resolve(null)), [data, canManage]);
    const [slots, setSlots] = useState(null);
    const [guard, setGuard] = useState(null);
    const [theme, setTheme] = useState({ mode: "light", accent: "burgundy" });
    const [saving, run] = useSubmitGuard();
    const [qrDataUrl, setQrDataUrl] = useState(null);
    const [rotateArmed, setRotateArmed] = useState(false);
    const [rotating, setRotating] = useState(false);
    /* One section at a time: Studio QR | Time Slots | Security | Theme. */
    const [tab, setTab] = useState("qr");
    const [addOpen, setAddOpen] = useState(false);

    useEffect(() => {
        if (gym.data) {
            setSlots(gym.data.timeSlots ?? []);
            setGuard({
                enforceSlotHours: gym.data.enforceSlotHours !== false,
                enforceLocation: Boolean(gym.data.enforceLocation),
                locationLat: gym.data.locationLat ?? "",
                locationLng: gym.data.locationLng ?? "",
                locationRadiusM: gym.data.locationRadiusM ?? 200,
            });
            setTheme({
                mode: gym.data.themeMode ?? "light",
                accent: gym.data.themeAccent ?? "burgundy",
            });
        }
    }, [gym.data]);
    useEffect(() => {
        let cancelled = false;
        setQrDataUrl(null);
        const token = qr.data?.token;
        if (!token)
            return;
        renderQrImage(gymCheckinUrl(token), { width: 480 })
            .then((url) => {
            if (!cancelled)
                setQrDataUrl(url);
        })
            .catch(() => {
            if (!cancelled)
                setQrDataUrl(null);
        });
        return () => {
            cancelled = true;
        };
    }, [qr.data?.token]);

    if (!canManage) {
        return (<div className="py-16">
          <EmptyState title="Institute admins only" description="Batch schedules and the studio QR are managed by the institute owner or an admin."/>
        </div>);
    }

    const updateSlot = (index, patch) => {
        setSlots((prev) => (prev ?? []).map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
    };
    /** The "Add slot" row builder is replaced by the AddSlotDialog flow. */
    const handleAddSlot = async (slot) => {
        const next = [...(slots ?? []), slot].sort((a, b) => (a.start < b.start ? -1 : 1));
        await data.updateTimeSlots(next);
        setSlots(next);
        toast.success(`Slot ${format12h(slot.start)} – ${format12h(slot.end)} added`);
        return true;
    };
    const removeSlot = (index) => setSlots((prev) => (prev ?? []).filter((_, i) => i !== index));
    const handleSave = () => {
        void run(async () => {
            try {
                const cleaned = (slots ?? [])
                    .filter((slot) => slot.start && slot.end)
                    .sort((a, b) => (a.start < b.start ? -1 : 1));
                const incomplete = (slots ?? []).some((slot) => !slot.start || !slot.end);
                if (incomplete) {
                    toast.error("Give every slot a start and end time (or remove the empty row).");
                    return;
                }
                await data.updateTimeSlots(cleaned);
                setSlots(cleaned);
                toast.success("Slot schedule saved");
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save the slots.");
            }
        });
    };
    const handleSaveGuard = () => {
        void run(async () => {
            try {
                const lat = guard.locationLat === "" ? null : Number(guard.locationLat);
                const lng = guard.locationLng === "" ? null : Number(guard.locationLng);
                if (guard.enforceLocation && (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng))) {
                    toast.error("Add the institute's latitude & longitude (or tap Use my location) before requiring GPS.");
                    return;
                }
                await data.updateCheckinSettings({
                    enforceSlotHours: guard.enforceSlotHours,
                    enforceLocation: guard.enforceLocation,
                    locationLat: lat,
                    locationLng: lng,
                    locationRadiusM: Number(guard.locationRadiusM) || 200,
                });
                toast.success("Check-in security saved");
                gym.reload();
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save.");
            }
        });
    };
    const handleSaveTheme = () => {
        void run(async () => {
            try {
                const updated = await data.updateTheme({ themeMode: theme.mode, themeAccent: theme.accent });
                applyTheme({ mode: updated?.themeMode ?? theme.mode, accent: updated?.themeAccent ?? theme.accent });
                gym.reload();
                void refresh();
                toast.success("Theme saved — it will apply across the platform.");
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to save the theme.");
            }
        });
    };
    const handleUseMyLocation = () => {
        void (async () => {
            const coords = await getCurrentCoords();
            if (!coords) {
                toast.error("Couldn't get your location — allow location access, or type the coordinates manually.");
                return;
            }
            setGuard((prev) => ({ ...prev, locationLat: Number(coords.latitude.toFixed(6)), locationLng: Number(coords.longitude.toFixed(6)) }));
            toast.success("Location filled — save to apply.");
        })();
    };
    const handleRotate = () => {
        if (rotating)
            return;
        if (!rotateArmed) {
            setRotateArmed(true);
            toast.info("Click rotate again to confirm — every previously printed QR will stop working.");
            return;
        }
        setRotating(true);
        void (async () => {
            try {
                await data.rotateGymQr();
                setRotateArmed(false);
                qr.reload();
                toast.success("Studio QR regenerated — print the new code and take down the old one.");
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to rotate the QR.");
            }
            finally {
                setRotating(false);
            }
        })();
    };
    const handlePrint = () => {
        if (!qrDataUrl)
            return;
        const w = window.open("", "_blank");
        if (!w) {
            toast.error("Allow pop-ups to print the QR code.");
            return;
        }
        w.document.write(`<html><head><title>Studio QR — front desk</title></head><body style="display:flex;flex-direction:column;align-items:center;gap:12px;font-family:sans-serif;padding:24px"><h2 style="margin:0">${session?.gym?.name ?? "Studio"} — front desk</h2><img src="${qrDataUrl}" style="width:70vmin;max-width:520px"/><p style="margin:0;max-width:520px;text-align:center">Scan with your phone camera, sign in, and your attendance is marked automatically.</p></body></html>`);
        w.document.close();
        w.focus();
        w.print();
    };

    const tokenHint = qr.data?.token ? `${qr.data.token.slice(0, 4).toUpperCase()}…${qr.data.token.slice(-4).toUpperCase()}` : null;

    return (<div className="space-y-6">
      <PageHeader title="Manage Institute" description="The front-desk studio QR and the daily slot schedule — set once, used every day."/>

      {/* ---------------- Tabs: QR | Slots | Security | Theme ---------------- */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="qr" className="gap-1 px-1.5 sm:gap-1.5 sm:px-2">
            <QrCodeIcon className="hidden size-4 sm:block"/>
            <span className="sm:hidden">QR</span><span className="hidden sm:inline">Studio QR</span>
          </TabsTrigger>
          <TabsTrigger value="slots" className="gap-1 px-1.5 sm:gap-1.5 sm:px-2">
            <ClockIcon className="hidden size-4 sm:block"/>
            <span className="sm:hidden">Slots</span><span className="hidden sm:inline">Time Slots</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="gap-1 px-1.5 sm:gap-1.5 sm:px-2">
            <ShieldCheckIcon className="hidden size-4 sm:block"/>
            <span>Security</span>
          </TabsTrigger>
          <TabsTrigger value="theme" className="gap-1 px-1.5 sm:gap-1.5 sm:px-2">
            <PaletteIcon className="hidden size-4 sm:block"/>
            <span>Theme</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="qr">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2Icon className="size-4 text-primary"/> Front-desk studio QR
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              One QR for the whole institute — print it and stick it at the front desk. Students scan it with
              their phone camera, sign in, and their attendance is marked automatically.
            </p>
            {qr.loading && !qr.data ? (<Skeleton className="mx-auto size-56 rounded-lg"/>) : qr.error && !qr.data ? (<ErrorState title="Unable to load the studio QR" message={qr.error} onRetry={qr.reload}/>) : qrDataUrl ? (<div className="flex flex-col items-center gap-2 rounded-xl border border-border/60 bg-white p-4">
                <img src={qrDataUrl} alt="Institute front-desk QR code" className="size-52 rounded-md"/>
                {tokenHint ? (<p className="font-mono text-[10px] tracking-wider text-muted-foreground">Token {tokenHint}</p>) : null}
              </div>) : (<Skeleton className="mx-auto size-56 rounded-lg"/>)}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={!qrDataUrl} onClick={handlePrint}>
                <PrinterIcon className="size-4"/> Print
              </Button>
              <Button variant="outline" size="sm" className={rotateArmed ? "border-destructive text-destructive" : ""} disabled={rotating || !qr.data?.token} onClick={handleRotate}>
                {rotating ? <Loader2Icon className="size-4 animate-spin"/> : <RefreshCwIcon className="size-4"/>}
                {rotateArmed ? "Confirm rotate" : "Rotate QR"}
              </Button>
            </div>
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="slots">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ClockIcon className="size-4 text-primary"/> Daily time slots
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The studio's operating slots (e.g. morning / afternoon / evening batches). These drive scheduling and reporting.
            </p>

            {gym.loading && slots === null ? (<Skeleton className="h-40 rounded-lg"/>) : gym.error && slots === null ? (<ErrorState title="Unable to load the slots" message={gym.error} onRetry={gym.reload}/>) : (<div className="space-y-4">
              {(() => {
                // Keep the original index of each row (update/remove are index-based).
                const rows = (slots ?? []).map((slot, index) => ({ slot, index }));
                const slotRow = ({ slot, index }) => (<li key={index} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-border/60 px-3 py-2 sm:flex-nowrap">
                    <span className="w-5 shrink-0 font-mono text-xs text-muted-foreground">{index + 1}.</span>
                    <TimeSelect value={slot.start} ariaLabel={`Slot ${index + 1} start`} className="h-8 min-w-24 flex-1 text-xs sm:w-32 sm:flex-none" onValueChange={(v) => updateSlot(index, { start: v })}/>
                    <span className="shrink-0 text-xs text-muted-foreground">to</span>
                    <TimeSelect value={slot.end} ariaLabel={`Slot ${index + 1} end`} className="h-8 min-w-24 flex-1 text-xs sm:w-32 sm:flex-none" onValueChange={(v) => updateSlot(index, { end: v })}/>
                    <span className="ml-auto hidden shrink-0 font-mono text-xs text-muted-foreground sm:block">
                      {slot.start && slot.end ? `${format12h(slot.start)} – ${format12h(slot.end)}` : "—"}
                    </span>
                    <Button variant="ghost" size="icon" className="ml-auto size-7 text-muted-foreground hover:text-destructive sm:order-last sm:ml-0" aria-label={`Remove slot ${index + 1}`} onClick={() => removeSlot(index)}>
                      <Trash2Icon className="size-4"/>
                    </Button>
                    {/* Mobile-only read-out — the desktop one sits inline above. */}
                    <p className="w-full text-right font-mono text-[11px] text-muted-foreground sm:hidden">
                      {slot.start && slot.end ? `${format12h(slot.start)} – ${format12h(slot.end)}` : "—"}
                    </p>
                  </li>);
                const bucketOf = (key) => rows.filter((r) => slotGroupOf(r.slot.start) === key);
                const unassigned = rows.filter((r) => !slotGroupOf(r.slot.start));
                return (<>
                  {SLOT_GROUPS.map((g) => {
                    const bucket = bucketOf(g.key);
                    return bucket.length === 0 ? null : (<div key={g.key} className="space-y-2">
                      <p className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {g.label}
                        <span className="font-normal normal-case tracking-normal">{g.range}</span>
                      </p>
                      <ul className="space-y-2">{bucket.map(slotRow)}</ul>
                    </div>);
                  })}
                  {unassigned.length > 0 ? (<div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unassigned</p>
                      <ul className="space-y-2">{unassigned.map(slotRow)}</ul>
                    </div>) : null}
                  {(slots ?? []).length === 0 ? (<p className="rounded-lg border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
                      No slots yet — add one below, or drop in the ready-made hourly schedule.
                    </p>) : null}
                </>);
              })()}
            </div>)}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                <PlusIcon className="size-4"/> Add slot
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSlots(defaultSlots())}>
                Fill hourly slots (8 AM – 9 PM)
              </Button>
              <Button size="sm" className="ml-auto" disabled={saving} onClick={handleSave}>
                {saving ? <Loader2Icon className="size-4 animate-spin"/> : null} Save slots
              </Button>
            </div>
          </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="security">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheckIcon className="size-4 text-primary"/> Check-in security (student scans)
            </CardTitle>
          </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Guard rails for the portal studio QR scan — so a student can't check in from bed at 2 AM or from another city.
            Front-desk check-ins and check-outs are never blocked.
          </p>

          {guard === null ? (<Skeleton className="h-24 rounded-lg"/>) : (<div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium">Enforce studio hours</p>
                <p className="text-xs text-muted-foreground">
                  Member check-ins only during the daily slots above. Check-outs always work.
                </p>
              </div>
              <Switch checked={guard.enforceSlotHours} onCheckedChange={(checked) => setGuard((prev) => ({ ...prev, enforceSlotHours: checked }))}/>
            </div>

            <div className="space-y-3 rounded-lg border border-border/60 px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">GPS range check</p>
                  <p className="text-xs text-muted-foreground">
                    {guard.enforceLocation && guard.locationLat !== "" && guard.locationLng !== ""
            ? `On — scans must be within ${guard.locationRadiusM} m of the studio.`
            : guard.enforceLocation
                ? "On - but the institute's location isn't saved yet."
                : "Off — students can scan from anywhere."}
                  </p>
                </div>
                <Switch checked={guard.enforceLocation} onCheckedChange={(checked) => setGuard((prev) => ({ ...prev, enforceLocation: checked }))}/>
              </div>

              {guard.enforceLocation ? (<div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="gym-lat" className="text-xs">Latitude</Label>
                  <Input id="gym-lat" inputMode="decimal" placeholder="23.2599" value={guard.locationLat} onChange={(e) => setGuard((prev) => ({ ...prev, locationLat: e.target.value }))}/>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gym-lng" className="text-xs">Longitude</Label>
                  <Input id="gym-lng" inputMode="decimal" placeholder="77.4126" value={guard.locationLng} onChange={(e) => setGuard((prev) => ({ ...prev, locationLng: e.target.value }))}/>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="gym-radius" className="text-xs">Allowed radius (m)</Label>
                  <Input id="gym-radius" type="number" min={50} max={5000} value={guard.locationRadiusM} onChange={(e) => setGuard((prev) => ({ ...prev, locationRadiusM: e.target.value }))}/>
                </div>
                <div className="sm:col-span-3">
                  <Button variant="outline" size="sm" onClick={handleUseMyLocation}>
                    <CrosshairIcon className="size-4"/> Use my location
                  </Button>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Stand at the front desk and tap this — the browser fills the coordinates (free, no map API needed).
                  </p>
                </div>
              </div>) : null}
            </div>

            <div className="flex justify-end">
              <Button size="sm" disabled={saving || !guard} onClick={handleSaveGuard}>
                {saving ? <Loader2Icon className="size-4 animate-spin"/> : null} Save security
              </Button>
            </div>
          </div>)}
        </CardContent>
        </Card>
        </TabsContent>

        <TabsContent value="theme">
        <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PaletteIcon className="size-4 text-primary"/> Institute theme
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Choose the colour palette and light/dark mode for the whole platform — staff app, member portal and login screen.
            Changes apply the moment you save.
          </p>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mode</p>
            <div className="flex flex-wrap gap-2">
              {THEME_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setTheme((prev) => ({ ...prev, mode: m.id }))}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    theme.mode === m.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Colour palette</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {THEME_ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setTheme((prev) => ({ ...prev, accent: a.id }))}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    theme.accent === a.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border/60 bg-background text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <span className="flex -space-x-1">
                    <span className="size-4 rounded-full ring-2 ring-background" style={{ backgroundColor: a.swatch[0] }}/>
                    <span className="size-4 rounded-full ring-2 ring-background" style={{ backgroundColor: a.swatch[1] }}/>
                  </span>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          {/* Live preview — uses the tokens of the selected palette/mode without
              touching the rest of the app until Save is clicked. */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</p>
            <div
              data-mode={resolveMode(theme.mode)}
              data-accent={theme.accent}
              className="overflow-hidden rounded-xl border border-border bg-background p-4 text-foreground"
            >
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar text-xs font-bold text-sidebar-foreground">
                  KM
                </span>
                <span className="text-sm font-medium">Institute name</span>
              </div>
              <div className="mt-3 rounded-lg border border-border bg-card p-3">
                <p className="text-xs text-muted-foreground">Sample card with muted text</p>
                <button
                  type="button"
                  className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                >
                  Primary action
                </button>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <Button size="sm" disabled={saving} onClick={handleSaveTheme}>
              {saving ? <Loader2Icon className="size-4 animate-spin"/> : null} Save theme
            </Button>
          </div>
        </CardContent>
        </Card>
        </TabsContent>
      </Tabs>

      <AddSlotDialog open={addOpen} onOpenChange={setAddOpen} onSave={handleAddSlot}/>
    </div>);
}
