/**
 * Client-side capability map — server port of src/lib/permissions.ts.
 * The backend enforces these with requireCap() middleware.
 */

export const ROLES = ["owner", "admin", "front_desk", "trainer", "member"];

const OWNER = [
  "members.view", "members.create", "members.edit", "members.delete", "members.export",
  "qr.scan", "qr.regenerate", "attendance.view", "attendance.mark", "attendance.correct",
  "plans.view", "plans.manage", "payments.view", "payments.record", "payments.refund",
  "staff.view", "staff.manage", "classes.view", "classes.manage", "classes.attend",
  "slots.view", "slots.manage", "reports.view",
  "notifications.view", "notifications.manage", "settings.view", "settings.manage",
];

const FRONT_DESK = [
  "members.view", "members.create", "members.edit", "members.export",
  "qr.scan", "attendance.view", "attendance.mark", "attendance.correct",
  "plans.view", "payments.view", "payments.record",
  "staff.view", "classes.view", "classes.manage", "classes.attend",
  "slots.view", "slots.manage", "reports.view",
  "notifications.view",
];

const TRAINER = [
  "members.view", "plans.view", "attendance.view", "attendance.mark", "classes.view",
  "classes.attend", "slots.view", "notifications.view",
];

const ROLE_CAPABILITIES = {
  owner: OWNER,
  /** Admins share owner capabilities except destructive member deletion. */
  admin: OWNER.filter((c) => c !== "members.delete"),
  front_desk: FRONT_DESK,
  trainer: TRAINER,
  /** Members see only their own portal (no staff capabilities). */
  member: [],
};

/** Roles allowed to record money movements or change financial settings. */
const FINANCIAL_ROLES = ["owner", "admin"];

export function can(role, capability) {
  if (!role) return false;
  return (ROLE_CAPABILITIES[role] ?? []).includes(capability);
}

export function capabilitiesFor(role) {
  if (!role) return [];
  return ROLE_CAPABILITIES[role] ?? [];
}

export function isFinancialAdmin(role) {
  return role ? FINANCIAL_ROLES.includes(role) : false;
}
