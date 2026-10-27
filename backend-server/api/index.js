// Vercel serverless entry — wraps the Express app as a (req, res) handler.
// The Mongo connection promise is cached so warm invocations reuse it and
// cold ones connect once per instance.
import { connectDb } from "../src/db.js";
import { buildApp } from "../src/index.js";

const app = buildApp();

let dbPromise = null;
function ensureDb() {
  if (!dbPromise) {
    dbPromise = connectDb().catch((err) => {
      dbPromise = null; // retry on the next invocation
      throw err;
    });
  }
  return dbPromise;
}

export default async function handler(req, res) {
  await ensureDb();
  return app(req, res);
}
