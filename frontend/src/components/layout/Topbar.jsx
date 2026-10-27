import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOutIcon, Loader2Icon, MenuIcon, DownloadIcon, QrCodeIcon, RefreshCwIcon, SettingsIcon, UserIcon, UserRoundIcon, } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, } from "@/components/ui/dropdown-menu";
import { useAuth } from "@/auth/AuthProvider";
import { NotificationBellPanel } from "@/components/shared/NotificationBellPanel";
import { StudentSearchBox } from "@/components/shared/StudentSearchBox";
import { SmartImage } from "@/components/shared/SmartImage";
import { ROLE_LABELS, can } from "@/lib/permissions";
import { gymCheckinUrl, renderQrImage } from "@/lib/qr";
import { emitLiveNotification } from "@/lib/liveBus";
import { appVersion } from "@/config/env";
export function Topbar({ onOpenMenu }) {
    const { session, data, signOut } = useAuth();
    const navigate = useNavigate();
    const [unread, setUnread] = useState(0);
    const seenIdsRef = useRef(new Set());
    // The very first poll just seeds the badge — popups fire only for events
    // that arrive AFTER the page mounted (otherwise every unread would toast).
    const firstLoadRef = useRef(true);
    useEffect(() => {
        if (!data)
            return;
        let cancelled = false;
        const refresh = () => void data
            .listNotifications({ unreadOnly: true, limit: 5 })
            .then((rows) => {
                if (cancelled)
                    return;
                for (const n of rows) {
                    if (!seenIdsRef.current.has(n.id)) {
                        seenIdsRef.current.add(n.id);
                        if (!firstLoadRef.current) {
                            // Live popup — something arrived while the page was open.
                            toast(n.title, {
                                description: n.body,
                                duration: 6000,
                                action: n.link
                                    ? { label: "View", onClick: () => navigate(n.link) }
                                    : undefined,
                            });
                            // Let open pages (Attendance…) react without a refresh.
                            emitLiveNotification(n);
                        }
                    }
                }
                firstLoadRef.current = false;
                // Keep the seen-set bounded on long sessions.
                if (seenIdsRef.current.size > 200) {
                    seenIdsRef.current = new Set([...seenIdsRef.current].slice(-100));
                }
                setUnread(rows.length);
            })
            .catch(() => undefined);
        refresh();
        // Keep the bell badge fresh without a page reload.
        const timer = window.setInterval(refresh, 10_000);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [data, navigate]);
    const fetchNotifications = useCallback(async () => (await data?.listNotifications({ limit: 12 })) ?? [], [data]);
    const profile = session?.profile;
    const fullName = profile?.fullName?.trim() || "User";
    const roleLabel = ROLE_LABELS[profile?.role ?? "front_desk"] ?? "Staff";
    return (<header className="sticky top-0 z-30 border-b border-border bg-background/85 shadow-[0_1px_0_0_rgba(198,164,91,0.18)] backdrop-blur-md">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
        <Button variant="ghost" size="icon" className="text-foreground/70 hover:bg-secondary hover:text-primary lg:hidden" onClick={onOpenMenu} aria-label="Open navigation">
          <MenuIcon className="size-5"/>
        </Button>

        {/* Live student search — type a letter, pick a result, profile opens. */}
        <StudentSearchBox className="hidden max-w-md flex-1 sm:block"/>

        <div className="ml-auto flex items-center gap-2">
          {/* Studio QR → dialog with the one front-desk QR students scan. */}
          <StudioQrButton />

          {/* Bell → drops-down notification shade (no page jump). */}
          <NotificationBellPanel unreadCount={unread} fetchItems={fetchNotifications} onOpenItem={async (item) => {
            if (!item.isRead) {
                await data.markNotificationRead(item.id);
                setUnread((count) => Math.max(0, count - 1));
            }
            if (item.link)
                navigate(item.link);
        }} onMarkAllRead={async () => {
            await data.markAllNotificationsRead();
            setUnread(0);
        }} onViewAll={() => navigate("/notifications")}/>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* Profile pill — soft gold ring + wine gradient. */}
              <button type="button" className="group flex items-center gap-2.5 rounded-lg border border-km-gold/30 bg-gradient-to-r from-km-wine/10 via-transparent to-km-gold/10 py-1 pr-2.5 pl-1 outline-none ring-km-gold/30 transition-all hover:border-km-gold/60 hover:from-km-wine/20 hover:to-km-gold/20 focus-visible:ring-2" aria-label="Account menu">
                <SmartImage src={profile?.avatarUrl} name={profile?.fullName ?? "User"} className="size-8 shrink-0 rounded-md border border-km-gold/50 ring-1 ring-km-gold/30"/>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-[140px] truncate text-sm font-medium leading-tight" title={profile?.fullName}>
                    {fullName.split(" ")[0] || fullName}
                  </span>
                  <span className="block text-[11px] leading-tight text-km-gold">{roleLabel}</span>
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{profile?.fullName}</p>
                <p className="text-xs font-normal text-muted-foreground">{profile?.email}</p>
                <p className="mt-1 text-[11px] text-primary">{ROLE_LABELS[profile?.role ?? "front_desk"]}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/settings">
                  <UserIcon className="size-4"/> Profile & settings
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings?tab=gym">
                  <SettingsIcon className="size-4"/> Institute configuration
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => {
            void signOut().then(() => navigate("/login"));
        }}>
                <LogOutIcon className="size-4"/> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="sr-only">Kala Mandir — Dance N Art Studio v{appVersion}</p>
      <span className="hidden">
        <UserRoundIcon />
      </span>
    </header>);
}
/**
 * Topbar shortcut for the studio's ONE check-in QR — the same code Students
 * scan from their portal. Admin-only (the API behind it requires
 * `settings.manage`); fetched lazily so it only loads when the dialog opens.
 */
function StudioQrButton() {
    const { session, data } = useAuth();
    const [open, setOpen] = useState(false);
    const [qrDataUrl, setQrDataUrl] = useState(null);
    const [error, setError] = useState(null);
    const [rotateArmed, setRotateArmed] = useState(false);
    const [rotating, setRotating] = useState(false);
    const canView = useMemo(() => can(session?.profile?.role, "settings.manage"), [session?.profile?.role]);
    useEffect(() => {
        if (!open || !canView || !data)
            return;
        let cancelled = false;
        setQrDataUrl(null);
        setError(null);
        data.getGymQr()
            .then(({ token }) => renderQrImage(gymCheckinUrl(token), { width: 480 }))
            .then((url) => {
            if (!cancelled)
                setQrDataUrl(url);
        })
            .catch((err) => {
            if (!cancelled)
                setError(err instanceof Error ? err.message : "Unable to load the studio QR code.");
        });
        return () => {
            cancelled = true;
        };
    }, [open, canView, data]);
    // Reset the destructive-action arm whenever the dialog closes.
    useEffect(() => {
        if (!open) {
            setRotateArmed(false);
            setRotating(false);
        }
    }, [open]);
    const handleDownload = () => {
        if (!qrDataUrl)
            return;
        const link = document.createElement("a");
        link.href = qrDataUrl;
        link.download = "studio-check-in-qr.png";
        document.body.appendChild(link);
        link.click();
        link.remove();
        toast.success("QR code downloaded");
    };
    const handleRotate = () => {
        if (rotating || !data)
            return;
        // Two-step confirm — rotation invalidates every previously printed QR.
        if (!rotateArmed) {
            setRotateArmed(true);
            toast.info("Click rotate again to confirm — every previously printed QR will stop working.");
            return;
        }
        setRotating(true);
        setQrDataUrl(null);
        setError(null);
        void (async () => {
            try {
                const { token } = await data.rotateGymQr();
                const qrUrl = await renderQrImage(gymCheckinUrl(token), { width: 480 });
                setQrDataUrl(qrUrl);
                setRotateArmed(false);
                toast.success("Studio QR regenerated — print the new code and take down the old one.");
            }
            catch (err) {
                setError(err instanceof Error ? err.message : "Unable to rotate the QR.");
            }
            finally {
                setRotating(false);
            }
        })();
    };
    if (!canView)
        return null;
    return (<>
      <Button variant="ghost" size="icon" className="text-foreground/70 hover:bg-secondary hover:text-primary" aria-label="Show studio check-in QR" onClick={() => setOpen(true)}>
        <QrCodeIcon className="size-5"/>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Studio check-in QR</DialogTitle>
            <DialogDescription>
              One QR for the whole institute — students scan it with their phone camera, sign in, and their attendance is marked.
            </DialogDescription>
          </DialogHeader>
          {qrDataUrl ? (<div className="flex justify-center">
              <img src={qrDataUrl} alt="Studio check-in QR code" className="size-60 rounded-lg border border-km-gold/30 bg-white p-2"/>
            </div>) : error ? (<p className="py-8 text-center text-sm text-muted-foreground">{error}</p>) : (<div className="flex items-center justify-center py-10">
              <Loader2Icon className="size-6 animate-spin text-primary"/>
            </div>)}

          <DialogFooter className="sm:justify-center">
            <Button type="button" variant="outline" size="icon" disabled={!qrDataUrl} onClick={handleDownload} aria-label="Download QR code" title="Download QR code">
              <DownloadIcon className="size-4"/>
            </Button>
            <Button type="button" variant={rotateArmed ? "destructive" : "outline"} size="icon" disabled={!qrDataUrl || rotating} onClick={handleRotate} aria-label={rotateArmed ? "Confirm rotate" : "Rotate QR code"} title={rotateArmed ? "Confirm rotate — old QR stops working" : "Rotate QR code"}>
              <RefreshCwIcon className={rotating ? "size-4 animate-spin" : "size-4"}/>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>);
}
