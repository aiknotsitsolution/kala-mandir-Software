import { useRef, useState } from "react";
import { CameraIcon, Loader2Icon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { SmartImage } from "@/components/shared/SmartImage";
import { useData } from "@/auth/AuthProvider";
import { fileToCompressedDataUrl } from "@/lib/image";

/**
 * Profile photo field — the avatar circle IS the upload button.
 * Click the circle → OS file picker → client-side compress → ImageKit upload.
 * No URL field, no separate button. A camera badge shows it's clickable;
 * an × badge (only when a photo exists) removes it.
 */
export function PhotoPicker({ value, onChange, name = "Student", inputId = "member-photo", uploadingLabel = "Uploading…" }) {
    const data = useData();
    const fileRef = useRef(null);
    const [busy, setBusy] = useState(false);

    const handleFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file)
            return;
        setBusy(true);
        try {
            const dataUrl = await fileToCompressedDataUrl(file);
            const result = await data.uploadPhoto(dataUrl, file.name || "photo.jpg");
            onChange(result.url);
            toast.success("Photo uploaded");
        }
        catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to upload that photo.");
        }
        finally {
            setBusy(false);
        }
    };

    return (<div className="flex items-center gap-3">
      <input ref={fileRef} id={inputId} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleFile}/>

      <div className="relative inline-flex">
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} title={busy ? uploadingLabel : "Upload a photo"} aria-label="Upload profile photo"
          className="group block size-14 rounded-full outline-none ring-offset-2 transition-shadow hover:ring-2 hover:ring-primary/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait">
          <SmartImage src={value || null} name={name} className="size-14 rounded-full ring-2 ring-border/60"/>
          {/* Camera badge = the "click me" hint (clicking it also opens the picker). */}
          <span className="absolute -bottom-0.5 -right-0.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background transition-transform group-hover:scale-110">
            {busy ? <Loader2Icon className="size-3 animate-spin"/> : <CameraIcon className="size-3"/>}
          </span>
        </button>

        {value && !busy ? (<button type="button" aria-label="Remove photo" title="Remove photo" onClick={() => onChange("")}
            className="absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground shadow ring-2 ring-background transition-colors hover:bg-destructive hover:text-destructive-foreground">
            <XIcon className="size-3"/>
          </button>) : null}
      </div>

      <p className="min-w-0 text-xs text-muted-foreground">
        {busy ? uploadingLabel : <>Click the photo to upload · JPG, PNG, WebP</>}
      </p>
    </div>);
}
