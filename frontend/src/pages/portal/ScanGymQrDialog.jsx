import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, Loader2Icon, QrCodeIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CameraScanner } from "@/pages/attendance/CameraScanner";
import { useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { getCurrentCoords } from "@/lib/geo";
import { parseQrPayload } from "@/lib/qr";

/**
 * Scanning only prepares the shared gym token; attendance is recorded after the
 * student confirms with the button. The server resolves their member ID.
 */
export function ScanGymQrDialog({ open, initialToken = null, onOpenChange, onScanDone }) {
    const data = useData();
    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState({ state: "starting" });
    const [scannedToken, setScannedToken] = useState(initialToken);
    const busyRef = useRef(false);
    const lastRef = useRef({ text: "", at: 0 });
    const gym = useAsync(() => (open ? data.getGymFresh() : Promise.resolve(null)), [data, open]);

    useEffect(() => {
        setScannedToken(open ? initialToken : null);
        lastRef.current = { text: "", at: 0 };
        if (!open) setStatus({ state: "starting" });
    }, [open, initialToken]);

    const handleDecoded = (text) => {
        const now = Date.now();
        if (busyRef.current || (lastRef.current.text === text && now - lastRef.current.at < 2500))
            return;
        lastRef.current = { text, at: now };
        const token = parseQrPayload(text);
        if (!token) {
            toast.error("That is not a valid studio QR code.");
            setAttempt((value) => value + 1);
            return;
        }
        setScannedToken(token);
        setStatus({ state: "ready" });
    };

    const handleMarkAttendance = async () => {
        if (!scannedToken || busyRef.current)
            return;
        busyRef.current = true;
        setStatus({ state: "marking" });
        try {
            let coords = null;
            if (gym.data?.locationRequired) {
                setStatus({ state: "locating" });
                coords = await getCurrentCoords();
            }
            const result = await data.gymScan(scannedToken, coords);
            toast.success(result.message ?? (result.action === "check_out" ? "Checked out." : "Attendance marked."));
            onScanDone?.(result);
            onOpenChange(false);
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to record attendance.");
            setStatus({ state: "ready" });
        }
        finally {
            busyRef.current = false;
        }
    };

    const marking = status.state === "marking" || status.state === "locating";

    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan the studio QR</DialogTitle>
          <DialogDescription>
            {scannedToken
              ? "QR scanned. Tap Mark attendance to confirm; scanning alone does not record anything."
              : "Point your camera at the single printed QR at the front desk."}
          </DialogDescription>
        </DialogHeader>

        {scannedToken ? (
          <div className="space-y-4 rounded-xl border border-primary/25 bg-primary/[0.04] p-4 text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <QrCodeIcon className="size-6"/>
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold">Studio QR scanned</p>
              <p className="text-xs text-muted-foreground">Your attendance will be recorded only after you confirm below.</p>
            </div>
            <div className="flex flex-col gap-2">
              <Button type="button" onClick={handleMarkAttendance} disabled={marking}>
                {marking ? <Loader2Icon className="size-4 animate-spin"/> : <CheckCircle2Icon className="size-4"/>}
                {status.state === "locating" ? "Getting your location…" : marking ? "Marking attendance…" : "Mark attendance"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                    setScannedToken(null);
                    lastRef.current = { text: "", at: 0 };
                    setAttempt((value) => value + 1);
                    setStatus({ state: "starting" });
                }}
                disabled={marking}
              >
                Scan again
              </Button>
            </div>
          </div>
        ) : (
          <>
            <CameraScanner active={open} attempt={attempt} onDecoded={handleDecoded} onStatus={setStatus}/>
            <p className="text-center text-xs text-muted-foreground">
              {status.state === "starting" ? (<span className="inline-flex items-center gap-1.5">
                  <Loader2Icon className="size-3.5 animate-spin"/> Starting camera…
                </span>) : status.state === "scanning" ? ("Point at the front-desk QR — hold steady") : status.state === "error" ? (status.message) : (" ")}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>);
}
