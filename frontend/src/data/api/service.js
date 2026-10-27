import { DataError } from "@/data/types";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/data/api/client";
import { daysRemaining, effectiveStatus } from "@/lib/membership";
import { gymTimezone } from "@/lib/datetime";
/** The portal contract narrows the derived status union — map into it. */
function toMyEffectiveStatus(status) {
    if (status === "active" || status === "expiring_soon" || status === "expired" || status === "none")
        return status;
    // A deactivated member / cancelled row both read as "not usable" in the portal.
    return "suspended";
}
/* ------------------------------------------------------------------ */
/*  Cached gym (shared by the auth + data services)                    */
/* ------------------------------------------------------------------ */
let gymCache = null;
export function loadGym() {
    if (!gymCache) {
        gymCache = apiGet("/gym").catch((err) => {
            gymCache = null;
            throw err;
        });
    }
    return gymCache;
}
export function invalidateGymCache() {
    gymCache = null;
}
/* ------------------------------------------------------------------ */
/*  Data service                                                       */
/* ------------------------------------------------------------------ */
/**
 * REST implementation of the `DataService` contract.
 *
 * The backend returns camelCase domain shapes; anything the UI derives
 * (effectiveStatus, daysRemaining, planName, endDate) is recomputed here with
 * the same `@/lib/membership` helpers the demo service uses, unless the API
 * already sent it.
 */
export class ApiDataService {
    mode = "api";
    gymId;
    /** Promise-cached so concurrent callers share ONE request (a null-reset on failure retries next call). */
    settingsPromise = null;
    plansPromise = null;
    constructor(gymId) {
        this.gymId = gymId;
    }
    /* ------------------------------ plumbing --------------------------- */
    async tz() {
        try {
            const gym = await loadGym();
            return gym.timezone || gymTimezone;
        }
        catch {
            return gymTimezone;
        }
    }
    async settings() {
        if (!this.settingsPromise) {
            this.settingsPromise = apiGet("/settings").catch(() => {
                // Never let decoration crash a page — fall back to documented defaults.
                this.settingsPromise = null; // retry on the next call
                return {
                    gymId: this.gymId,
                    checkinCooldownMinutes: 60,
                    trackCheckout: false,
                    expiringSoonDays: 7,
                    expiryReminderDays: [7, 3, 1],
                    allowExpiredCheckin: false,
                    enableEmail: false,
                    enableSms: false,
                    enableWhatsapp: false,
                    enablePush: false,
                    attendanceRetentionDays: 365,
                    updatedAt: new Date().toISOString(),
                };
            });
        }
        return this.settingsPromise;
    }
    async plans() {
        if (!this.plansPromise) {
            this.plansPromise = apiGet("/plans", { includeInactive: 1 }).catch((err) => {
                this.plansPromise = null; // retry on the next call
                throw err;
            });
        }
        return this.plansPromise;
    }
    /** Fill in plan names on a membership row when the API did not join them. */
    async decorateMembership(row) {
        if (!row || row.planName)
            return row;
        try {
            const plans = await this.plans();
            const plan = plans.find((p) => p.id === row.planId);
            if (plan) {
                return {
                    ...row,
                    planName: plan.name,
                    planDurationValue: plan.durationValue,
                    planDurationUnit: plan.durationUnit,
                };
            }
        }
        catch {
            /* plan lookup is best-effort decoration */
        }
        return row;
    }
    async decorateMember(row) {
        const [settings, tz] = await Promise.all([this.settings(), this.tz()]);
        const membership = await this.decorateMembership(row.membership ?? null);
        return {
            ...row,
            membership,
            effectiveStatus: row.effectiveStatus ?? effectiveStatus(membership, row.status, new Date(), settings.expiringSoonDays, tz),
            planName: row.planName ?? membership?.planName ?? null,
            endDate: row.endDate ?? membership?.endDate ?? null,
            daysRemaining: row.daysRemaining ?? daysRemaining(membership, new Date(), tz),
        };
    }
    async decorateMembers(rows) {
        return Promise.all(rows.map((row) => this.decorateMember(row)));
    }
    async decoratePaginatedMembers(payload) {
        const page = this.paginatedOf(payload, 10);
        return { ...page, items: await this.decorateMembers(page.items) };
    }
    /** Accept `{items,total,page,pageSize}` — or a bare array for defensive robustness. */
    paginatedOf(payload, fallbackPageSize) {
        if (Array.isArray(payload)) {
            const items = payload;
            return { items, total: items.length, page: 1, pageSize: items.length || fallbackPageSize };
        }
        const record = (payload ?? {});
        return {
            items: Array.isArray(record.items) ? record.items : [],
            total: typeof record.total === "number" ? record.total : 0,
            page: typeof record.page === "number" ? record.page : 1,
            pageSize: typeof record.pageSize === "number" ? record.pageSize : fallbackPageSize,
        };
    }
    async isNotFound(err) {
        return err instanceof ApiError && err.status === 404;
    }
    notSupported(what) {
        throw new DataError("not_supported", `${what} is not supported by the API yet.`);
    }
    /* ----------------------------- settings ---------------------------- */
    async getGym() {
        return loadGym();
    }
    /* ------------------------------ profile ---------------------------- */
    /** Updates the signed-in user's own profile (name / avatar) → public user. */
    async updateProfile(patch) {
        return apiPatch("/auth/me", patch);
    }
    async getSettings() {
        return this.settings();
    }
    async updateSettings(patch) {
        const updated = await apiPatch("/settings", patch);
        this.settingsPromise = Promise.resolve(updated);
        // Gym-level fields (name/timezone) may have changed too — force a refetch.
        invalidateGymCache();
        return updated;
    }
    /* ----------------------------- dashboard --------------------------- */
    async getDashboardStats() {
        return apiGet("/dashboard/stats");
    }
    async getAttendanceTrend(days) {
        return apiGet("/dashboard/attendance-trend", { days });
    }
    async getRevenueTrend(months) {
        return apiGet("/dashboard/revenue-trend", { months });
    }
    async getPlanDistribution() {
        return apiGet("/dashboard/plan-distribution");
    }
    async getRecentCheckIns(limit) {
        return apiGet("/dashboard/recent-checkins", { limit });
    }
    async getRecentMembers(limit) {
        const rows = await apiGet("/dashboard/recent-members", { limit });
        return this.decorateMembers(rows ?? []);
    }
    async getUpcomingExpiries(limit) {
        const rows = await apiGet("/dashboard/upcoming-expiries", { limit });
        return this.decorateMembers(rows ?? []);
    }
    /* ------------------------------ members ---------------------------- */
    async listMembers(query = {}) {
        const payload = await apiGet("/members", {
            search: query.search,
            status: query.status && query.status !== "all" ? query.status : undefined,
            planId: query.planId,
            sort: query.sort,
            dir: query.dir,
            page: query.page,
            pageSize: query.pageSize,
        });
        return this.decoratePaginatedMembers(payload);
    }
    async listAllMembers() {
        const out = [];
        const pageSize = 100;
        for (let page = 1; page <= 100; page += 1) {
            const payload = await apiGet("/members", { page, pageSize });
            const chunk = await this.decoratePaginatedMembers(payload);
            out.push(...chunk.items);
            if (out.length >= chunk.total || chunk.items.length === 0)
                break;
        }
        return out;
    }
    async getMember(id) {
        try {
            const row = await apiGet(`/members/${encodeURIComponent(id)}`);
            return this.decorateMember(row);
        }
        catch (err) {
            if (await this.isNotFound(err))
                return null;
            throw err;
        }
    }
    async createMember(input) {
        const row = await apiPost("/members", input);
        return this.decorateMember(row);
    }
    async updateMember(id, input) {
        const row = await apiPatch(`/members/${encodeURIComponent(id)}`, input);
        return this.decorateMember(row);
    }
    async deleteMember(id) {
        await apiDelete(`/members/${encodeURIComponent(id)}`);
    }
    async setMemberStatus(id, status) {
        const row = await apiPatch(`/members/${encodeURIComponent(id)}/status`, { status });
        return this.decorateMember(row);
    }
    async getMembershipHistory(memberId) {
        const rows = await apiGet(`/members/${encodeURIComponent(memberId)}/memberships`);
        return Promise.all((rows ?? []).map((row) => this.decorateMembership(row).then((m) => m ?? row)));
    }
    async renewMembership(input) {
        const { memberId, ...body } = input;
        const row = await apiPost(`/members/${encodeURIComponent(memberId)}/renew`, body);
        return this.decorateMembership(row).then((m) => m ?? row);
    }
    async setMembershipStatus(membershipId, status, notes) {
        void membershipId;
        void status;
        void notes;
        // No endpoint exists for this in the REST contract yet.
        return this.notSupported("Changing a membership's stored status");
    }
    async rotateQrToken(memberId) {
        return apiPost(`/members/${encodeURIComponent(memberId)}/rotate-qr`);
    }
    /* ------------------------------- plans ----------------------------- */
    async listPlans(includeInactive = true) {
        const rows = await apiGet("/plans", { includeInactive: includeInactive ? 1 : undefined });
        return rows ?? [];
    }
    async createPlan(input) {
        this.plansPromise = null;
        return apiPost("/plans", input);
    }
    async updatePlan(id, input) {
        this.plansPromise = null;
        return apiPatch(`/plans/${encodeURIComponent(id)}`, input);
    }
    async archivePlan(id, isActive) {
        this.plansPromise = null;
        return apiPatch(`/plans/${encodeURIComponent(id)}/active`, { isActive });
    }
    /* ---------------------------- attendance --------------------------- */
    normalizeCheckIn(payload) {
        const result = payload;
        if (result && (result.status === "ok" || result.status === "rejected")) {
            return result;
        }
        throw new ApiError(500, "server_error", "The server returned an unexpected check-in response.");
    }
    async checkInByToken(token, ctx) {
        const payload = await apiPost("/attendance/checkin", {
            token,
            method: ctx?.method,
            notes: ctx?.notes ?? undefined,
        });
        return this.normalizeCheckIn(payload);
    }
    async checkInByMemberCode(code, ctx) {
        const payload = await apiPost("/attendance/checkin-code", {
            code,
            method: ctx?.method,
            notes: ctx?.notes ?? undefined,
        });
        return this.normalizeCheckIn(payload);
    }
    async recordCheckout(attendanceId) {
        return apiPost(`/attendance/${encodeURIComponent(attendanceId)}/checkout`);
    }
    async listAttendance(query = {}) {
        const payload = await apiGet("/attendance", {
            from: query.from,
            to: query.to,
            memberId: query.memberId,
            status: query.status && query.status !== "all" ? query.status : undefined,
            page: query.page,
            pageSize: query.pageSize,
        });
        return this.paginatedOf(payload, 20);
    }
    async listMemberAttendance(memberId, limit = 30) {
        const rows = await apiGet(`/members/${encodeURIComponent(memberId)}/attendance`, { limit });
        return rows ?? [];
    }
    async correctAttendance(id, patch) {
        return apiPatch(`/attendance/${encodeURIComponent(id)}`, patch);
    }
    async getAttendanceOvertime(from, to) {
        return (await apiGet("/attendance/overtime", { from, to })) ?? [];
    }
    async remindCheckout(memberId) {
        return apiPost("/attendance/remind-checkout", { memberId });
    }
    rangeQuery(range) {
        return { from: range.from.toISOString(), to: range.to.toISOString() };
    }
    async getAttendanceSummary(range) {
        return apiGet("/attendance/summary", this.rangeQuery(range));
    }
    async getPeakHours(range) {
        const rows = await apiGet("/attendance/peak-hours", this.rangeQuery(range));
        // The chart also renders `label`; compute it if the API omitted it.
        return (rows ?? []).map((row) => ({
            ...row,
            label: row.label ?? `${row.hour % 12 === 0 ? 12 : row.hour % 12}${row.hour < 12 ? "a" : "p"}`,
        }));
    }
    async getMemberFrequencies(range, limit) {
        const rows = await apiGet("/attendance/frequencies", { ...this.rangeQuery(range), limit });
        return rows ?? [];
    }
    /* ------------------------------ payments --------------------------- */
    async listPayments(query = {}) {
        const payload = await apiGet("/payments", {
            search: query.search,
            from: query.from,
            to: query.to,
            status: query.status && query.status !== "all" ? query.status : undefined,
            method: query.method && query.method !== "all" ? query.method : undefined,
            memberId: query.memberId,
            page: query.page,
            pageSize: query.pageSize,
        });
        return this.paginatedOf(payload, 15);
    }
    async createPayment(input) {
        return apiPost("/payments", input);
    }
    async refundPayment(paymentId, amount, reason) {
        return apiPost(`/payments/${encodeURIComponent(paymentId)}/refund`, { amount, reason });
    }
    async getDues() {
        return apiGet("/payments/dues");
    }
    async getRevenueSummary(months) {
        return apiGet("/payments/revenue", { months });
    }
    /* ------------------------- member self-service --------------------- */
    /** Fill in plan details when /me did not join them (best-effort: A student token may not list plans). */
    async decorateMyMembership(row) {
        const base = {
            id: row.id,
            planId: row.planId,
            planName: row.planName ?? null,
            planDurationValue: row.planDurationValue ?? null,
            planDurationUnit: row.planDurationUnit ?? null,
            startDate: row.startDate,
            endDate: row.endDate,
            status: row.status,
            price: row.price,
            billed: row.billed ?? null,
            paid: row.paid ?? null,
            balance: row.balance ?? null,
        };
        if (base.planName && base.planDurationValue !== null && base.planDurationUnit)
            return base;
        try {
            const plan = (await this.plans()).find((p) => p.id === base.planId);
            if (!plan)
                return base;
            return {
                ...base,
                planName: base.planName ?? plan.name,
                planDurationValue: base.planDurationValue ?? plan.durationValue,
                planDurationUnit: base.planDurationUnit ?? plan.durationUnit,
            };
        }
        catch {
            return base; // keep whatever the API sent — never fail decoration
        }
    }
    /** Upload a compressed photo (data URL) to the image CDN → { url, name }. */
    async uploadPhoto(dataUrl, fileName) {
        const payload = await apiPost("/uploads/photo", { dataUrl, fileName: fileName ?? undefined });
        if (!payload?.url) {
            throw new ApiError(502, "upload_failed", "The server did not return an image URL.");
        }
        return { url: payload.url, name: payload.name ?? null };
    }
    async getMyMemberProfile() {
        const payload = await apiGet("/me");
        const raw = payload?.member;
        if (!raw || typeof raw.id !== "string") {
            throw new ApiError(500, "server_error", "The server returned an unexpected profile response.");
        }
        const tz = payload.gym?.timezone || (await this.tz());
        const membership = raw.membership ? await this.decorateMyMembership(raw.membership) : null;
        let status = raw.effectiveStatus ?? null;
        if (!status) {
            // /settings is staff-only — its loader already falls back to documented defaults.
            const settings = await this.settings();
            status = toMyEffectiveStatus(effectiveStatus(membership, raw.status, new Date(), settings.expiringSoonDays, tz));
        }
        return {
            id: raw.id,
            memberCode: raw.memberCode,
            fullName: raw.fullName,
            phone: raw.phone ?? null,
            email: raw.email ?? null,
            photoUrl: raw.photoUrl ?? null,
            gender: raw.gender ?? null,
            dateOfBirth: raw.dateOfBirth ?? null,
            joinDate: raw.joinDate,
            status: raw.status,
            plannedHoursPerDay: raw.plannedHoursPerDay ?? null,
            preferredSlot: raw.preferredSlot ?? null,
            qrStatus: raw.qrStatus ?? "active",
            membership,
            effectiveStatus: status,
            daysRemaining: raw.daysRemaining ?? daysRemaining(membership, new Date(), tz),
            quota: raw.quota ?? null,
        };
    }
    async getMyQr() {
        const payload = await apiGet("/me/qr");
        if (!payload?.token) {
            throw new ApiError(500, "server_error", "The server returned an unexpected QR response.");
        }
        return { token: payload.token, status: payload.status === "revoked" ? "revoked" : "active" };
    }
    async listMyAttendance(limit = 30) {
        const rows = await apiGet("/me/attendance", { limit });
        return rows ?? [];
    }
    async listMyPayments() {
        const rows = await apiGet("/me/payments");
        return rows ?? [];
    }
    async listMyClasses() {
        const rows = await apiGet("/me/classes");
        return rows ?? [];
    }
    async changeMyPassword(currentPassword, newPassword) {
        // 204 on success; 403 (wrong current password) surfaces as an ApiError with the server message.
        await apiPost("/me/password", { currentPassword, newPassword });
    }
    async getMyReminders() {
        return (await apiGet("/me/reminders")) ?? [];
    }
    async readMyReminders() {
        return apiPost("/me/reminders/read");
    }
    async readMyReminder(id) {
        return apiPost(`/me/reminders/${encodeURIComponent(id)}/read`);
    }
    /** Fresh gym doc (bypasses the session cache) — Manage Institute page. */
    async getGymFresh() {
        return apiGet("/gym");
    }
    async getGymQr() {
        return apiGet("/gym/qr");
    }
    async rotateGymQr() {
        return apiPost("/gym/qr/rotate");
    }
    async updateTimeSlots(timeSlots) {
        return apiPatch("/gym", { timeSlots });
    }
    /** Guard rails for member self check-ins: slot hours + GPS range. */
    async updateCheckinSettings(input) {
        return apiPatch("/gym", input);
    }
    /** Institute-wide theme (palette + light/dark mode). */
    async updateTheme(patch) {
        const updated = await apiPatch("/gym", patch);
        invalidateGymCache();
        return updated;
    }
    /** student scans the single front-desk studio QR → toggles check-in/out. */
    async gymScan(token, coords) {
        return apiPost("/attendance/gym-scan", {
            token,
            ...(coords
                ? { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }
                : {}),
        });
    }
    /**
     * Scan-the-wall-QR login flow → marks the signed-in member's attendance
     * (check-in only). Returns `{ status, message, attendance?, member? }`.
     */
    async checkinGym(token, coords) {
        return apiPost("/me/checkin-gym", {
            token,
            ...(coords
                ? { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy }
                : {}),
        });
    }
    /* -------------------------------- staff ---------------------------- */
    async listStaff(includeInactive = true) {
        const rows = await apiGet("/staff", { includeInactive: includeInactive ? 1 : undefined });
        return rows ?? [];
    }
    async getStaff(id) {
        return apiGet(`/staff/${encodeURIComponent(id)}`);
    }
    async createStaff(input) {
        return apiPost("/staff", input);
    }
    async updateStaff(id, input) {
        return apiPatch(`/staff/${encodeURIComponent(id)}`, input);
    }
    async archiveStaff(id) {
        return apiPatch(`/staff/${encodeURIComponent(id)}/archive`);
    }
    async deleteStaff(id) {
        return apiDelete(`/staff/${encodeURIComponent(id)}`);
    }
    async assignStaffSlots(staffId, slotIds) {
        return apiPost(`/staff/${encodeURIComponent(staffId)}/assign-slots`, { slotIds });
    }
    async assignStaffStudents(staffId, memberIds) {
        return apiPost(`/staff/${encodeURIComponent(staffId)}/assign-students`, { memberIds });
    }
    /* ------------------------------- classes --------------------------- */
    async listClasses(from, to) {
        const rows = await apiGet("/classes", { from: from.toISOString(), to: to.toISOString() });
        return rows ?? [];
    }
    async getClass(id) {
        try {
            return await apiGet(`/classes/${encodeURIComponent(id)}`);
        }
        catch (err) {
            if (await this.isNotFound(err))
                return null;
            throw err;
        }
    }
    async createClass(input) {
        return apiPost("/classes", input);
    }
    async updateClass(id, input) {
        return apiPatch(`/classes/${encodeURIComponent(id)}`, input);
    }
    async cancelClass(id) {
        return apiPatch(`/classes/${encodeURIComponent(id)}/cancel`);
    }
    async listEnrollments(classId) {
        const rows = await apiGet(`/classes/${encodeURIComponent(classId)}/enrollments`);
        return rows ?? [];
    }
    async enroll(classId, memberId) {
        return apiPost(`/classes/${encodeURIComponent(classId)}/enroll`, { memberId });
    }
    async cancelEnrollment(enrollmentId) {
        await apiDelete(`/enrollments/${encodeURIComponent(enrollmentId)}`);
    }
    async setEnrollmentStatus(enrollmentId, status) {
        return apiPatch(`/enrollments/${encodeURIComponent(enrollmentId)}/status`, { status });
    }
    /* --------------------------- class slots -------------------------- */
    async listClassSlots() {
        const rows = await apiGet("/class-slots");
        return rows ?? [];
    }
    async createClassSlot(input) {
        return apiPost("/class-slots", input);
    }
    async updateClassSlot(id, input) {
        return apiPatch(`/class-slots/${encodeURIComponent(id)}`, input);
    }
    async archiveClassSlot(id) {
        return apiPatch(`/class-slots/${encodeURIComponent(id)}/archive`);
    }
    async listSlotStudents(slotId) {
        const rows = await apiGet(`/class-slots/${encodeURIComponent(slotId)}/students`);
        return rows ?? [];
    }
    async enrollSlotStudent(slotId, memberId) {
        return apiPost(`/class-slots/${encodeURIComponent(slotId)}/students`, { memberId });
    }
    async unenrollSlotStudent(enrollmentId) {
        await apiDelete(`/slot-enrollments/${encodeURIComponent(enrollmentId)}`);
    }
    /* ------------------------ class attendance ------------------------ */
    async getClassRoster(slotId, date) {
        return apiGet("/attendance/class-roster", { slotId, date });
    }
    async markClassAttendance(input) {
        return apiPost("/attendance/class-mark", input);
    }
    async markDemoAttendance(input) {
        return apiPost("/attendance/demo-mark", input);
    }
    /** Set each roster student's status (present/late/absent/leave/holiday) for one slot session. */
    async markRosterAttendance(input) {
        return apiPost("/attendance/class-roster-mark", input);
    }
    /** Per-day stat cards (total students, present/absent today, attendance rate). */
    async getClassDaySummary(date) {
        return apiGet("/attendance/class-day-summary", { date });
    }
    /* --------------------------- notifications ------------------------- */
    async listNotifications(filter = {}) {
        const rows = await apiGet("/notifications", {
            unreadOnly: filter.unreadOnly ? 1 : undefined,
            limit: filter.limit,
        });
        return rows ?? [];
    }
    async getUnreadNotificationCount() {
        const payload = await apiGet("/notifications/unread-count");
        return typeof payload?.count === "number" ? payload.count : 0;
    }
    async markNotificationRead(id) {
        await apiPatch(`/notifications/${encodeURIComponent(id)}/read`);
    }
    async markAllNotificationsRead() {
        await apiPost("/notifications/read-all");
    }
    async generateNotifications() {
        const payload = await apiPost("/notifications/rebuild");
        return typeof payload?.created === "number" ? payload.created : 0;
    }
    /* -------------------------------- audit ---------------------------- */
    async listAuditLogs({ page, pageSize = 50 } = {}) {
        // page given → paginated { items, total, page, pageSize }; otherwise a bare list.
        const payload = await apiGet("/audit", { limit: pageSize, page: page ?? undefined });
        if (page === undefined)
            return payload ?? [];
        if (payload?.items)
            return payload;
        // Defensive: an older backend may still return a bare array.
        const rows = payload ?? [];
        return { items: rows, total: rows.length, page: 1, pageSize };
    }
}
