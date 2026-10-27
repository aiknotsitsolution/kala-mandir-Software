import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { parseBody } from "../middleware/validate.js";
import { ApiError, asyncHandler, badRequest } from "../lib/errors.js";

const router = Router();

const IMAGEKIT_UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";
// Keep client uploads well under the 1mb JSON body limit (base64 ≈ 4/3 raw).
const MAX_DATA_URL_CHARS = 900_000;

const uploadSchema = z.object({
  // Client downscales/compresses first, then sends a JPEG/PNG/WebP/GIF data URL.
  dataUrl: z
    .string()
    .regex(/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/, "Choose a PNG, JPEG, WebP or GIF image"),
  fileName: z.string().max(120).optional(),
});

/** Strip anything that isn't filename-safe; fall back to a generic name. */
function safeFileName(raw, mime) {
  const cleaned = String(raw ?? "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (cleaned) return cleaned;
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  return `photo.${ext}`;
}

/**
 * POST /api/uploads/photo { dataUrl, fileName? } → { url, name }
 * Real file upload via ImageKit (CDN). The browser sends a compressed data
 * URL; this server forwards it with the PRIVATE key (server-only, from .env)
 * and returns the hosted URL that gets stored as photoUrl/avatarUrl.
 * Members are already blocked from this path by the portal guard in index.js.
 */
router.post(
  "/uploads/photo",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { dataUrl, fileName } = parseBody(uploadSchema, req.body);
    if (dataUrl.length > MAX_DATA_URL_CHARS) {
      throw badRequest("That image is too large — pick a file under 3 MB.", "image_too_large");
    }
    const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
    if (!privateKey) {
      throw new ApiError(502, "Image uploads are not configured on this server.", "upload_not_configured");
    }

    const mime = dataUrl.slice(5, dataUrl.indexOf(";"));
    const form = new FormData();
    form.set("file", dataUrl);
    form.set("fileName", safeFileName(fileName, mime));
    form.set("useUniqueFileName", "true");
    form.set("folder", "/kalamandir/photos");

    const response = await fetch(IMAGEKIT_UPLOAD_URL, {
      method: "POST",
      headers: {
        // ImageKit server-side upload: HTTP Basic with the private key.
        Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`,
      },
      body: form,
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);

    if (!response) {
      throw new ApiError(502, "Could not reach the image service — try again.", "upload_unreachable");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.url) {
      // eslint-disable-next-line no-console
      console.error("ImageKit upload failed:", response.status, JSON.stringify(payload ?? {}).slice(0, 400));
      throw new ApiError(502, "The image service rejected this upload — try a different photo.", "upload_failed");
    }

    res.json({ url: payload.url, name: payload.name ?? null });
  }),
);

export default router;
