/** Append-only audit trail (mirrors the Postgres audit_logs triggers). */

import AuditLog from "../models/AuditLog.js";

/**
 * Write an audit row. `actorId` is the authenticated user (nullable);
 * every mutation in the API calls this. Pass `session` inside transactions.
 */
export async function writeAudit(
  { gymId, actorId = null, entity, entityId = null, action, oldValues = null, newValues = null },
  session = null,
) {
  await AuditLog.create(
    [
      {
        gymId,
        actorId: actorId || null,
        entity,
        entityId: entityId || null,
        action,
        oldValues: oldValues ?? null,
        newValues: newValues ?? null,
      },
    ],
    { session },
  );
}

/** Values snapshot helper: pick fields that are safe/interesting to audit. */
export function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj?.[key] !== undefined) out[key] = obj[key];
  }
  return out;
}
