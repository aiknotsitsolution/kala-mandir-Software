import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// Load backend-server/.env regardless of the process cwd (works when run from
// the repo root or from backend-server/). dotenv never overrides existing keys,
// so a real environment always wins.
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const env = process.env.NODE_ENV ?? "development";
const jwtSecret = process.env.JWT_SECRET ?? (env === "production" ? "" : "kalamandir-dance-dev-secret");
if (env === "production" && jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters in production.");
}

const config = {
  env,
  port: Number(process.env.PORT ?? 8000),
  mongoUri: process.env.MONGODB_URI ?? "",
  jwtSecret,
  accessTokenExpiresIn: "15m",
  accessTokenTtlMs: 15 * 60 * 1000,
  refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
  refreshCookieName: "km_refresh",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5174",
};

export default config;
