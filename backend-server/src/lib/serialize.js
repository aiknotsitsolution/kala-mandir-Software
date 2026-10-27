/**
 * Doc → API shape serializers. Field names match src/types/index.ts exactly:
 * date-only fields return `YYYY-MM-DD`, timestamps return full ISO strings.
 */

import { effectiveStatus, daysRemaining } from "./membership.js";

export const id = (v) => (v == null ? null : String(v));
export const iso = (v) => (v ? new Date(v).toISOString() : null);
export const ymd = (v) => (v == null ? null : new Date(v).toISOString().slice(0, 10));
const n = (v) => (v == null ? null : v);

export function toGym(doc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    name: doc.name,
    slug: doc.slug,
    timezone: doc.timezone,
    currency: doc.currency,
    logoUrl: doc.logoUrl ?? null,
    address: doc.address ?? null,
    phone: doc.phone ?? null,
    email: doc.email ?? null,
    isActive: Boolean(doc.isActive),
    timeSlots: (doc.timeSlots ?? []).map((slot) => ({ start: slot.start, end: slot.end })),
    /** Self check-in guard rails (portal gym-QR scans). */
    enforceSlotHours: doc.enforceSlotHours !== false,
    locationLat: n(doc.locationLat),
    locationLng: n(doc.locationLng),
    locationRadiusM: doc.locationRadiusM ?? 200,
    enforceLocation: Boolean(doc.enforceLocation),
    /** True when a member's scan must include GPS (toggle on + gym coords saved). */
    locationRequired: Boolean(doc.enforceLocation) && doc.locationLat != null && doc.locationLng != null,
    /** Institute-wide theme (admin picks in Manage Institute). */
    themeMode: doc.themeMode ?? "light",
    themeAccent: doc.themeAccent ?? "burgundy",
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

/* ------------------------------------------------------------------ */
/*  Tags                                                               */
/* ------------------------------------------------------------------ */

/** `Tag` (student label — dance style, batch, event, etc.) → public shape. */
export function toTag(doc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    name: doc.name ?? "",
    color: doc.color ?? "#6b7280",
  };
}

export function toSettings(doc) {
  if (!doc) return null;
  return {
    gymId: id(doc.gymId),
    checkinCooldownMinutes: doc.checkinCooldownMinutes ?? 60,
    trackCheckout: Boolean(doc.trackCheckout),
    expiringSoonDays: doc.expiringSoonDays ?? 7,
    expiryReminderDays: doc.expiryReminderDays ?? [7, 3, 1],
    allowExpiredCheckin: Boolean(doc.allowExpiredCheckin),
    enableEmail: Boolean(doc.enableEmail),
    enableSms: Boolean(doc.enableSms),
    enableWhatsapp: Boolean(doc.enableWhatsapp),
    enablePush: Boolean(doc.enablePush),
    attendanceRetentionDays: doc.attendanceRetentionDays ?? 365,
    updatedAt: iso(doc.updatedAt),
  };
}

export function toPublicUser(doc) {
  if (!doc) return null;
  const isMember = doc.role === "member";
  return {
    id: id(doc._id),
    fullName: doc.fullName,
    // Member logins use a synthetic address — never expose it.
    email: isMember ? null : (doc.email ?? null),
    role: doc.role,
    gymId: id(doc.gymId),
    avatarUrl: doc.avatarUrl ?? null,
    phone: doc.phone ?? null,
    memberId: doc.memberId ? id(doc.memberId) : undefined,
  };
}

export function toMember(doc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    memberCode: doc.memberCode,
    fullName: doc.fullName,
    email: doc.email ?? null,
    phone: doc.phone,
    photoUrl: doc.photoUrl ?? null,
    dateOfBirth: ymd(doc.dateOfBirth),
    /** Age in years collected at registration (null when only DOB is known). */
    age: doc.age ?? null,
    gender: doc.gender ?? null,
    address: doc.address ?? null,
    emergencyContactName: doc.emergencyContactName ?? null,
    emergencyContactPhone: doc.emergencyContactPhone ?? null,
    joinDate: ymd(doc.joinDate),
    qrToken: doc.qrToken,
    qrStatus: doc.qrStatus,
    qrRotatedAt: iso(doc.qrRotatedAt),
    status: doc.status,
    notes: doc.notes ?? null,
    plannedHoursPerDay: doc.plannedHoursPerDay ?? null,
    /** Preferred front-desk slot ("HH:mm-HH:mm"); null = no preference. */
    preferredSlot: doc.preferredSlot ?? null,
    /** Class stream the student belongs to — "Art" | "Dance". */
    classTag: doc.classTag ?? null,
    /** Assigned tag ids (student labels — styles, batches, events…). */
    tagIds: (doc.tagIds ?? []).map((t) => String(t)),
    /** Assigned trainer id (StaffProfile._id), null = unassigned. */
    trainerId: id(doc.trainerId),
    createdBy: id(doc.createdBy),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

/** Member joined with its current membership + derived status (list/detail view). */
export function toMemberWithMembership(memberDoc, membershipDoc, planDoc, { now = new Date(), tz, expiringSoonDays = 7 } = {}) {
  const member = toMember(memberDoc);
  if (!member) return null;
  const membership = membershipDoc ? toMembership(membershipDoc, planDoc) : null;
  return {
    ...member,
    membership,
    effectiveStatus: effectiveStatus(
      membership ? { startDate: membership.startDate, endDate: membership.endDate, status: membership.status } : null,
      member.status,
      now,
      expiringSoonDays,
      tz,
    ),
    planName: membership?.planName ?? null,
    endDate: membership?.endDate ?? null,
    daysRemaining: daysRemaining(
      membership ? { endDate: membership.endDate } : null,
      now,
      tz,
    ),
  };
}

export function toPlan(doc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    name: doc.name,
    description: doc.description ?? null,
    price: doc.price ?? 0,
    durationValue: doc.durationValue,
    durationUnit: doc.durationUnit,
    /** Monthly dance-class quota baked into the plan; null = duration-only. */
    classQuota: doc.classQuota ?? null,
    /** Weekly schedule line for the card; null = derive from duration. */
    scheduleLabel: doc.scheduleLabel ?? null,
    benefits: doc.benefits ?? [],
    isActive: Boolean(doc.isActive),
    sortOrder: doc.sortOrder ?? 0,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

export function toMembership(doc, planDoc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    memberId: id(doc.memberId),
    planId: id(doc.planId),
    startDate: ymd(doc.startDate),
    endDate: ymd(doc.endDate),
    status: doc.status,
    price: doc.price ?? 0,
    discount: doc.discount ?? 0,
    /** Class quota snapshotted at enrollment; null = no quota. */
    classQuota: doc.classQuota ?? null,
    source: doc.source,
    notes: doc.notes ?? null,
    createdBy: id(doc.createdBy),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    planName: planDoc?.name ?? null,
    planDurationValue: planDoc?.durationValue ?? null,
    planDurationUnit: planDoc?.durationUnit ?? null,
  };
}

export function toAttendance(doc, memberDoc, scannerDoc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    memberId: id(doc.memberId),
    membershipId: id(doc.membershipId),
    checkIn: iso(doc.checkIn),
    checkOut: iso(doc.checkOut),
    status: doc.status,
    method: doc.method,
    scannerId: id(doc.scannerId),
    notes: doc.notes ?? null,
    meta: doc.meta ?? {},
    /* Dance-class quota linkage (nulls for legacy gym visits). */
    classSlotId: id(doc.classSlotId),
    classId: id(doc.classId),
    sessionDate: ymd(doc.sessionDate),
    quotaCounted: doc.quotaCounted ?? null,
    demo: Boolean(doc.demo),
    /** Class-roster marking status ("present"|"absent"|"late"|null). */
    attendanceStatus: doc.attendanceStatus ?? null,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    memberName: memberDoc?.fullName ?? undefined,
    memberCode: memberDoc?.memberCode ?? undefined,
    memberPhoto: memberDoc?.photoUrl ?? null,
    scannerName: scannerDoc?.fullName ?? null,
  };
}

export function toPayment(doc, memberDoc, membershipDoc, planDoc) {
  if (!doc) return null;
  const membershipSummary =
    membershipDoc && planDoc
      ? `${planDoc.name} (${ymd(membershipDoc.startDate)} → ${ymd(membershipDoc.endDate)})`
      : null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    memberId: id(doc.memberId),
    membershipId: id(doc.membershipId),
    amount: doc.amount ?? 0,
    paymentDate: ymd(doc.paymentDate),
    method: doc.method,
    status: doc.status,
    transactionRef: doc.transactionRef ?? null,
    notes: doc.notes ?? null,
    receiptNo: doc.receiptNo,
    recordedBy: id(doc.recordedBy),
    refundOf: id(doc.refundOf),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    memberName: memberDoc?.fullName ?? "—",
    memberCode: memberDoc?.memberCode ?? "—",
    membershipSummary,
  };
}

export function toStaff(doc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    profileId: id(doc.profileId),
    /** Whether a portal login (User row) is linked to this profile. */
    hasLogin: Boolean(id(doc.profileId)),
    fullName: doc.fullName,
    email: doc.email ?? null,
    phone: doc.phone ?? null,
    role: doc.role,
    specialization: doc.specialization ?? null,
    employmentStatus: doc.employmentStatus,
    joiningDate: ymd(doc.joiningDate),
    photoUrl: doc.photoUrl ?? null,
    notes: doc.notes ?? null,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}

export function toClass(doc, trainerDoc, enrolledCount) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    name: doc.name,
    description: doc.description ?? null,
    trainerId: id(doc.trainerId),
    startsAt: iso(doc.startsAt),
    durationMinutes: doc.durationMinutes,
    capacity: doc.capacity,
    status: doc.status,
    kind: doc.kind ?? "regular",
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    trainerName: trainerDoc?.fullName ?? null,
    enrolledCount: enrolledCount ?? 0,
  };
}

export function toEnrollment(doc, memberDoc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    classId: id(doc.classId),
    memberId: id(doc.memberId),
    status: doc.status,
    enrolledAt: iso(doc.enrolledAt),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    memberName: memberDoc?.fullName ?? undefined,
    memberCode: memberDoc?.memberCode ?? undefined,
    memberPhoto: memberDoc?.photoUrl ?? null,
  };
}

export function toClassSlot(doc, instructorDoc, enrolledCount, enrolledMemberIds = []) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    name: doc.name,
    description: doc.description ?? null,
    weekdays: doc.weekdays ?? [],
    startTime: doc.startTime,
    endTime: doc.endTime,
    capacity: doc.capacity ?? null,
    /** Class stream this batch teaches — "Art" | "Dance". */
    classTag: doc.classTag ?? null,
    instructorId: id(doc.instructorId),
    isActive: doc.isActive !== false,
    notes: doc.notes ?? null,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    instructorName: instructorDoc?.fullName ?? null,
    enrolledCount: enrolledCount ?? 0,
    /** Distinct member ids enroled — lets the UI compute student counts that
     *  don't double-count a student enroled across several batches. */
    enrolledMemberIds: Array.isArray(enrolledMemberIds) ? enrolledMemberIds : [],
  };
}

export function toSlotEnrollment(doc, memberDoc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    slotId: id(doc.slotId),
    memberId: id(doc.memberId),
    status: doc.status,
    enrolledAt: iso(doc.enrolledAt),
    notes: doc.notes ?? null,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    memberName: memberDoc?.fullName ?? undefined,
    memberCode: memberDoc?.memberCode ?? undefined,
    memberPhoto: memberDoc?.photoUrl ?? null,
  };
}

export function toNotification(doc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    userId: id(doc.userId),
    memberId: id(doc.memberId),
    type: doc.type,
    title: doc.title,
    body: doc.body,
    severity: doc.severity,
    isRead: Boolean(doc.isRead),
    dedupeKey: doc.dedupeKey ?? null,
    link: doc.link ?? null,
    createdAt: iso(doc.createdAt),
  };
}

export function toAudit(doc, actorDoc) {
  if (!doc) return null;
  return {
    id: id(doc._id),
    gymId: id(doc.gymId),
    actorId: id(doc.actorId),
    entity: doc.entity,
    entityId: doc.entityId ?? null,
    action: doc.action,
    oldValues: doc.oldValues ?? null,
    newValues: doc.newValues ?? null,
    createdAt: iso(doc.createdAt),
    actorName: actorDoc?.fullName ?? null,
  };
}

export { n };
