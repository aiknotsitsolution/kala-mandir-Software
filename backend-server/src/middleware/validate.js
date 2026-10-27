import { badRequest } from "../lib/errors.js";

/** Parse+validate a request body with a zod schema; 400 on failure. */
export function parseBody(schema, body) {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issue = result.error.issues?.[0];
    const path = issue?.path?.join(".") || "body";
    throw badRequest(`${path}: ${issue?.message ?? "Invalid value"}`, "validation_error");
  }
  return result.data;
}

/** Parse+validate an query-string with a zod schema; 400 on failure. */
export function parseQuery(schema, query) {
  const result = schema.safeParse(query ?? {});
  if (!result.success) {
    const issue = result.error.issues?.[0];
    const path = issue?.path?.join(".") || "query";
    throw badRequest(`${path}: ${issue?.message ?? "Invalid value"}`, "validation_error");
  }
  return result.data;
}

/** Positive integer query param with default + clamping. */
export function intParam(value, fallback, { min = 1, max = 10_000 } = {}) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Escape user input for a safe RegExp. */
export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
