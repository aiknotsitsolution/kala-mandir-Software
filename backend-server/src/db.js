import dns from "node:dns";
import mongoose from "mongoose";
import config from "./config.js";

mongoose.set("strictQuery", true);

/**
 * Windows quirk: the OS can hand Node a loopback DNS proxy (127.0.0.1) that
 * refuses SRV queries (mongod+srv needs SRV). When that happens we retry with
 * the machines' real resolver addresses. Only applies to this process.
 */
function loopbackDnsInUse() {
  return dns.getServers().some((s) => s === "127.0.0.1" || s === "::1");
}

function isSrvDnsFailure(err) {
  const text = `${err?.code ?? ""} ${err?.syscall ?? ""} ${err?.message ?? ""}`;
  return /querySrv|ECONNREFUSED/i.test(text);
}

function useFallbackDns() {
  dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1", "192.168.1.1"]);
}

export async function connectDb(uri = config.mongoUri) {
  if (!uri) throw new Error("MONGODB_URI is not configured (backend-server/.env)");
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  } catch (err) {
    if (isSrvDnsFailure(err) && loopbackDnsInUse()) {
      console.warn("Loopback DNS failed SRV resolution - retrying with public resolvers...");
      useFallbackDns();
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    } else {
      throw err;
    }
  }
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}

/**
 * Run `fn(session)` inside a MongoDB transaction (Atlas replica set).
 * Commits on success, aborts on error, always ends the session.
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

export default mongoose;
