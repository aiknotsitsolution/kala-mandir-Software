import cors from "cors";
import express from "express";
import { pathToFileURL } from "node:url";
import config from "./config.js";
import { connectDb } from "./db.js";
import { ApiError, forbidden } from "./lib/errors.js";
import { requireAuth } from "./middleware/auth.js";

import authRoutes from "./routes/auth.js";
import meRoutes from "./routes/me.js";
import gymRoutes from "./routes/gym.js";
import dashboardRoutes from "./routes/dashboard.js";
import memberRoutes from "./routes/members.js";
import planRoutes from "./routes/plans.js";
import attendanceRoutes from "./routes/attendance.js";
import paymentRoutes from "./routes/payments.js";
import staffRoutes from "./routes/staff.js";
import classRoutes from "./routes/classes.js";
import slotRoutes from "./routes/slots.js";
import notificationRoutes from "./routes/notifications.js";
import auditRoutes from "./routes/audit.js";
import uploadRoutes from "./routes/uploads.js";

export function buildApp() {
  const app = express();

  app.disable("x-powered-by");

  // CORS: exact client origins (comma-separated CLIENT_ORIGIN) for production,
  // plus any local/private-network dev origin (Vite picks the next free port).
  const allowedOrigins = new Set(
    config.clientOrigin
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean),
  );
  const isDevOrigin = (origin) => {
    let host;
    try {
      host = new URL(origin).hostname;
    } catch {
      return false;
    }
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  };
  // Deployed frontends (production + preview URLs) on Vercel.
  const isVercelFrontend = (origin) => {
    let host;
    try {
      host = new URL(origin).hostname;
    } catch {
      return false;
    }
    return /^[\w-]+(\.[\w-]+)*\.vercel\.app$/.test(host);
  };
  app.use(
    cors({
      origin(origin, callback) {
        // Allow server-to-server / same-origin requests (no Origin header).
        if (
          !origin ||
          allowedOrigins.has(origin) ||
          isDevOrigin(origin) ||
          isVercelFrontend(origin)
        )
          return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    }),
  );

  app.use(express.json({ limit: "1mb" }));

  // Request log (method + path only).
  app.use((req, _res, next) => {
    // eslint-disable-next-line no-console
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "kalamandir-api" });
  });

  app.use("/api/auth", authRoutes);
  // Member portal: own profile / QR / attendance / payments / password.
  app.use("/api/me", meRoutes);
  // After /api/me: members are staff-blocked. The exceptions are reading the
  // gym branding (session building) and scanning the front-desk gym QR.
  app.use("/api", requireAuth, (req, _res, next) => {
    if (req.user?.role !== "member") return next();
    if (req.method === "GET" && req.path === "/gym") return next();
    if (req.method === "POST" && req.path === "/attendance/gym-scan") return next();
    return next(forbidden("Student accounts can only access their own portal", "member_forbidden"));
  });

  app.use("/api", gymRoutes);
  app.use("/api", dashboardRoutes);
  app.use("/api", memberRoutes);
  app.use("/api", planRoutes);
  app.use("/api", attendanceRoutes);
  app.use("/api", paymentRoutes);
  app.use("/api", staffRoutes);
  app.use("/api", classRoutes);
  app.use("/api", slotRoutes);
  app.use("/api", notificationRoutes);
  app.use("/api", auditRoutes);
  app.use("/api", uploadRoutes);

  // 404 for unknown API routes.
  app.use("/api", (_req, res) => {
    res.status(404).json({ message: "Endpoint not found", code: "not_found" });
  });

  // Central error handler: ApiError → its status; everything else → 500.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ message: err.message, code: err.code });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message, code: "validation_error" });
    }
    if (err?.name === "CastError") {
      return res.status(400).json({ message: "Invalid identifier", code: "invalid_id" });
    }
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Duplicate value for a unique field", code: "conflict" });
    }
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ message: "Malformed JSON body", code: "bad_json" });
    }
    if (err?.type === "entity.too.large") {
      return res.status(413).json({ message: "That upload is too large — pick a smaller file.", code: "payload_too_large" });
    }
    // eslint-disable-next-line no-console
    console.error("Unhandled error:", err);
    return res.status(500).json({ message: "Internal server error", code: "server_error" });
  });

  return app;
}

async function main() {
  await connectDb();
  const app = buildApp();
  app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`Kalamandir API listening on http://localhost:${config.port}`);
  });
}

// Only start listening when executed directly (imports get buildApp()).
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
