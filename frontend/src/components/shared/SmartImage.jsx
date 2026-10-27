import { useState } from "react";
import { UserIcon } from "lucide-react";
import { cn } from "@/lib/utils";
/** Remote image with graceful local fallback (user icon) when unset or failed to load. */
export function SmartImage({ src, name, className, alt, }) {
    const [failed, setFailed] = useState(false);
    if (!src || failed) {
        return (<span aria-label={name} className={cn("flex items-center justify-center rounded-full bg-secondary text-muted-foreground select-none", className)}>
        <UserIcon className="size-1/2"/>
      </span>);
    }
    return (<img src={src} alt={alt ?? name} loading="lazy" onError={() => setFailed(true)} className={cn("rounded-full object-cover", className)}/>);
}
