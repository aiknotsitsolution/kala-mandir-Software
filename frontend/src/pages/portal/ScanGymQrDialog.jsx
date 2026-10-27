import { useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CameraScanner } from "@/pages/attendance/CameraScanner";
import { useData } from "@/auth/AuthProvider";
import { useAsync } from "@/hooks";
import { getCurrentCoords } from "@/lib/geo";
import { parseQrPayload } from "@/lib/qr";

/**
 * Member-side scanner for the ONE shared front-desk studio QR.
 * First scan checks the student in (timer starts); the next scan checks out.
 * When the gym requires it, a browser GPS fix rides along with the scan.
 */
export function ScanGymQrDialog({ open, onOpenChange, onScanDone }) {
    const data = useData();
    const [attempt, setAttempt] = useState(0);
    const [status, setStatus] = useState({ state: "starting" });
    const busyRef = useRef(false);
    const lastRef = useRef({ text: "", at: 0 });
    // Fresh gym doc tells us whether the GPS range check is required.
    const gym = useAsync(() => (open ? data.getGymFresh() : Promise.resolve(null)), [data, open]);
    const handleDecoded = (text) => {
        const now = Date.now();
        // html5-qrcode keeps firing for a code held in frame — ignore repeats.
        if (busyRef.current)
            return;
        if (lastRef.current.text === text && now - lastRef.current.at < 2500)
            return;
        lastRef.current = { text, at: now };
        const token = parseQrPayload(text) ?? String(text).trim();
        busyRef.current = true;
        void (async () => {
            try {
                // GPS first when the gym enforces range — best effort; the
                // server explains the rejection if the fix is missing/far.
                let coords = null;
                if (gym.data?.locationRequired) {
                    setStatus({ state: "locating" });
                    coords = await getCurrentCoords();
                }
                const result = await data.gymScan(token, coords);
                toast.success(result.message ?? (result.action === "check_out" ? "Checked out." : "Checked in."));
                onScanDone?.(result);
                onOpenChange(false);
            }
            catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to record attendance.");
                setAttempt((n) => n + 1); // restart the camera for another try
            }
            finally {
                busyRef.current = false;
            }
        })();
    };
    return (<Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Scan the studio QR</DialogTitle>
          <DialogDescription>
            Point your camera at the QR stuck at the front desk. Your first scan starts the timer; scanning again checks you out.
          </DialogDescription>
        </DialogHeader>

        <CameraScanner active={open} attempt={attempt} onDecoded={handleDecoded} onStatus={setStatus}/>

        <p className="text-center text-xs text-muted-foreground">
          {status.state === "starting" ? (<span className="inline-flex items-center gap-1.5">
              <Loader2Icon className="size-3.5 animate-spin"/> Starting camera…
            </span>) : status.state === "locating" ? (<span className="inline-flex items-center gap-1.5">
              <Loader2Icon className="size-3.5 animate-spin"/> Getting your location…
            </span>) : status.state === "scanning" ? ("Point at the front-desk QR — hold steady") : status.state === "error" ? (status.message) : (" ")}
        </p>
      </DialogContent>
    </Dialog>);
}
