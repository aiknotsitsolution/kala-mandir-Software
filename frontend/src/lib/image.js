/**
 * Turn an image File into a compact JPEG data URL before uploading.
 * The server body limit is 1mb and ImageKit likes small payloads, so we
 * downscale to `maxEdge` px and re-encode at a lower quality until the
 * data URL fits `maxChars` (default ~500 KB → base64 well under 1 MB).
 */
export function fileToCompressedDataUrl(file, { maxEdge = 1024, quality = 0.82, maxChars = 500_000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) {
            reject(new Error("Choose a PNG, JPEG, WebP or GIF image."));
            return;
        }
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            try {
                const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
                const width = Math.max(1, Math.round(img.naturalWidth * scale));
                const height = Math.max(1, Math.round(img.naturalHeight * scale));
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (!ctx)
                    throw new Error("Image processing is not supported in this browser.");
                ctx.drawImage(img, 0, 0, width, height);
                let q = quality;
                let edge = maxEdge;
                let dataUrl = canvas.toDataURL("image/jpeg", q);
                // Keep shrinking until the payload fits the size budget.
                while (dataUrl.length > maxChars && (q > 0.5 || edge > 384)) {
                    if (q > 0.5)
                        q = Math.max(0.5, q - 0.12);
                    else {
                        edge = Math.round(edge * 0.8);
                        canvas.width = Math.max(1, Math.round((edge / maxEdge) * width));
                        canvas.height = Math.max(1, Math.round((edge / maxEdge) * height));
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    }
                    dataUrl = canvas.toDataURL("image/jpeg", q);
                }
                if (dataUrl.length > maxChars)
                    throw new Error("That image is too large — pick a smaller photo.");
                resolve(dataUrl);
            }
            catch (error) {
                reject(error instanceof Error ? error : new Error("Unable to process that image."));
            }
            finally {
                URL.revokeObjectURL(objectUrl);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("That file could not be read as an image."));
        };
        img.src = objectUrl;
    });
}
