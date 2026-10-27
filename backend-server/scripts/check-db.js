/** Read-only: prints collection counts for the configured database. */
import mongoose from "mongoose";
import { connectDb, disconnectDb } from "../src/db.js";

const conn = await connectDb();
const db = conn.db;
console.log(`Database: ${db.databaseName}`);
const collections = await db.listCollections().toArray();
if (collections.length === 0) {
  console.log("EMPTY — no collections yet.");
} else {
  for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${name}: ${await db.collection(name).countDocuments()}`);
  }
}
await disconnectDb();
