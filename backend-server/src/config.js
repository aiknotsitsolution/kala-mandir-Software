import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load backend-server/.env regardless of the process cwd (works when run from
// the repo root or from backend-server/). dotenv never overrides existing keys,
// so a real environment always wins.
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const config = {
  env: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  mongoUri: process.env.MONGODB_URI ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "kalamandir-dance-dev-secret",
  jwtExpiresIn: "7d",
  clientOrigin: process.env.CLIENT_ORIGIN ?? "http://localhost:5174",
};

export default config;
