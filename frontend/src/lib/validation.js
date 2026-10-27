import { z } from "zod";
/**
 * Reusable Zod schemas shared by React Hook Form screens and the data layer
 * (the demo service re-validates every mutation server-side style).
 */
export const phoneSchema = z
    .string()
    .trim()
    .min(1, "Phone number is required")
    .regex(/^\+?[0-9][0-9\s-]{8,16}$/, "Enter a valid phone number");
/**
 * Class tags — the two streams the studio runs. Shared by the New Class Slot
 * form and the Add/Edit Student form (both required at creation time).
 */
export const CLASS_TAGS = ["Art", "Dance"];
/** Human labels for the CLASS_TAGS values (order matters — keep in sync). */
export const CLASS_TAG_LABELS = { Art: "Art", Dance: "Dance" };
export const emailSchema = z
    .string()
    .trim()
    .email("Enter a valid email address")
    .max(254)
    .optional()
    .or(z.literal(""));
export const dateOnlySchema = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Use a valid date");
export const memberFormSchema = z
    .object({
    fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
    // Optional: students can sign in with their printed Student ID instead.
    email: z
        .string()
        .trim()
        .email("Enter a valid email address")
        .max(254)
        .optional()
        .or(z.literal("")),
    phone: phoneSchema,
    dateOfBirth: z.union([dateOnlySchema, z.literal("")]).optional(),
    /** Age in years (collected at registration; DOB still supported). */
    age: z
        .union([
        z.number().int("Enter a whole number of years").min(1, "Enter a valid age").max(120, "Enter a valid age"),
        z.custom((v) => typeof v === "number" && Number.isNaN(v)),
    ])
        .optional()
        .transform((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null)),
    gender: z.enum(["male", "female", "other", "prefer_not_to_say"]).optional(),
    address: z.string().trim().max(400).optional(),
    emergencyContactName: z.string().trim().max(120).optional(),
    emergencyContactPhone: z.union([phoneSchema, z.literal("")]).optional(),
    joinDate: dateOnlySchema,
    planId: z.string().min(1, "Choose a membership plan"),
    membershipStart: dateOnlySchema,
    // Individually chosen password. Required when CREATING a student (set below
    // via superRefine on `mode`); ignored when editing an existing one.
    loginPassword: z
        .string()
        .optional()
        .refine((v) => !v || v.trim().length >= 6, "Portal password must be at least 6 characters"),
    // Hidden form flag — "create" requires loginPassword, "edit" does not.
    // Never sent to the API.
    mode: z.enum(["create", "edit"]).optional(),
    initialPayment: z
        .number()
        .min(0, "Amount cannot be negative")
        .max(10_000_000, "Amount looks too large")
        .optional(),
    // Roomy: demo uploads store a compressed photo data URL directly.
    photoUrl: z.string().trim().max(800_000).optional(),
    notes: z.string().trim().max(2000).optional(),
    // Empty numeric input arrives as NaN → treated as "not set" (null).
    // z.literal(NaN) never matches in zod 3, so a custom NaN check is used.
    plannedHoursPerDay: z
        .union([
        z.number().min(0.5, "Enter at least 0.5 hours").max(24, "Cannot exceed 24 hours"),
        z.custom((v) => typeof v === "number" && Number.isNaN(v)),
    ])
        .optional()
        .transform((v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null)),
    // Multi-slot picker: array of "HH:mm-HH:mm" from gym slots. The FIRST
    // entry is the preferred/primary slot (""); empty array = no preference.
    preferredSlot: z
        .array(
        z.string().regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/, "Pick a valid time slot"),
    )
        .optional()
        .transform((v) => (Array.isArray(v) ? v : [])),
    // Class stream the student belongs to — required when creating a new
    // student; optional on edit so existing records can be saved without
    // forcing a tag pick (see superRefine below).
    classTag: z
        .union([
        z.enum(CLASS_TAGS, { errorMap: () => ({ message: "Choose a class tag (Art or Dance)" }) }),
        z.literal(""),
    ])
        .optional()
        .transform((v) => (v === "" ? "" : v)),
    // Assigned trainer (StaffProfile id) — "" = none; "" → null before the API.
    trainerId: z
        .union([z.string().trim().min(1), z.literal("")])
        .optional()
        .transform((v) => (v && v.trim() ? v.trim() : null)),
})
    .refine((data) => !data.emergencyContactPhone || data.emergencyContactPhone.length > 0, {
    message: "Enter a valid emergency contact phone or leave it empty",
    path: ["emergencyContactPhone"],
})
    .superRefine((data, ctx) => {
    // New students get an individually chosen password; edits never touch it.
    if (data.mode !== "edit" && !data.loginPassword?.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["loginPassword"],
            message: "Set a portal password for the student",
        });
    }
    // New students must be tagged Art or Dance; edits may leave it unset.
    if (data.mode !== "edit" && !data.classTag) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["classTag"],
            message: "Choose a class tag (Art or Dance)",
        });
    }
});
export const planFormSchema = z.object({
    name: z.string().trim().min(2, "Plan name must be at least 2 characters").max(80),
    description: z.string().trim().max(500).optional(),
    price: z
        .number({ invalid_type_error: "Enter a price" })
        .min(0, "Price cannot be negative")
        .max(10_000_000, "Price looks too large"),
    durationValue: z
        .number({ invalid_type_error: "Enter a duration" })
        .int("Duration must be a whole number")
        .min(1, "Duration must be at least 1")
        .max(120, "Duration looks too large"),
    durationUnit: z.enum(["day", "week", "month", "year"]),
    /** Optional monthly class quota (12 / 20 / 24 …). Blank = duration-only plan. */
    classQuota: z
        .number({ invalid_type_error: "Enter a class quota" })
        .int("Class quota must be a whole number")
        .min(0, "Class quota cannot be negative")
        .max(500, "Class quota looks too large")
        .nullable()
        .optional(),
    /** Optional weekly schedule line shown on the card (e.g. "Monday – Friday"). */
    scheduleLabel: z.string().trim().max(60).optional().or(z.literal("")),
    benefits: z.string().optional(),
    isActive: z.boolean(),
});
export const paymentFormSchema = z.object({
    memberId: z.string().min(1, "Choose A student"),
    membershipId: z.string().optional(),
    amount: z
        .number({ invalid_type_error: "Enter an amount" })
        .positive("Amount must be greater than zero")
        .max(10_000_000, "Amount looks too large"),
    paymentDate: dateOnlySchema,
    method: z.enum(["cash", "upi", "card", "bank_transfer", "other"]),
    status: z.enum(["paid", "partial", "pending"]),
    transactionRef: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(1000).optional(),
});
export const refundFormSchema = z.object({
    amount: z.number().positive("Amount must be greater than zero"),
    reason: z.string().trim().min(3, "Explain the reason for the refund").max(500),
});
export const staffFormSchema = z.object({
    fullName: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
    email: emailSchema,
    phone: phoneSchema,
    role: z.enum(["admin", "front_desk", "trainer"]),
    specialization: z.string().trim().max(160).optional(),
    employmentStatus: z.enum(["active", "on_leave", "resigned"]),
    joiningDate: dateOnlySchema,
    photoUrl: z.string().trim().max(800_000).optional(),
    notes: z.string().trim().max(1000).optional(),
    // Portal login password. Empty on edit → their existing credentials stay
    // untouched; on create it immediately gives them a login.
    loginPassword: z
        .string()
        .trim()
        .optional()
        .refine((v) => !v || v.length >= 6, "Login password must be at least 6 characters"),
});
export const classFormSchema = z
    .object({
    name: z.string().trim().min(2, "Class name must be at least 2 characters").max(120),
    description: z.string().trim().max(500).optional(),
    trainerId: z.string().optional(),
    date: dateOnlySchema,
    time: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm format"),
    durationMinutes: z
        .number({ invalid_type_error: "Enter a duration" })
        .int("Duration must be a whole number")
        .min(10, "Minimum 10 minutes")
        .max(480, "Maximum 8 hours"),
    capacity: z
        .number({ invalid_type_error: "Enter capacity" })
        .int("Capacity must be a whole number")
        .min(1, "Minimum 1 seat")
        .max(500, "Capacity looks too large"),
});
export const renewalFormSchema = z.object({
    planId: z.string().min(1, "Choose a plan"),
    startDate: dateOnlySchema,
    discount: z.number().min(0, "Discount cannot be negative").max(10_000_000),
    notes: z.string().trim().max(500).optional(),
});
export const manualCheckInSchema = z.object({
    memberCode: z.string().trim().min(2, "Enter a Student ID or phone number"),
});
export const settingsFormSchema = z.object({
    gymName: z.string().trim().min(2, "Institute name is required").max(120),
    timezone: z.string().min(3, "Timezone is required"),
    checkinCooldownMinutes: z
        .number()
        .int("Must be a whole number of minutes")
        .min(0, "Cannot be negative")
        .max(1440, "Maximum 24 hours"),
    trackCheckout: z.boolean(),
    expiringSoonDays: z.number().int().min(1).max(90),
    expiryReminderDays: z.string().min(1, "Provide at least one reminder day"),
    allowExpiredCheckin: z.boolean(),
    enableEmail: z.boolean(),
    enableSms: z.boolean(),
    enableWhatsapp: z.boolean(),
    enablePush: z.boolean(),
});
export const loginSchema = z
    .object({
    /** Email address OR printed Student ID (e.g. KD-0007). */
    identifier: z.string().trim().max(254).optional().or(z.literal("")),
    /** Mobile number — an alternative to the identifier (no OTP needed). */
    phone: z.string().trim().optional().or(z.literal("")),
    password: z.string().min(6, "Password must be at least 6 characters"),
})
    .superRefine((data, ctx) => {
    if (!data.identifier && !data.phone) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["identifier"],
            message: "Enter your email, Student ID or mobile number",
        });
    }
    if (data.phone) {
        const digits = data.phone.replace(/\D/g, "");
        const isValid = digits.length === 10 || (digits.length === 12 && digits.startsWith("91"));
        if (!isValid) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ["phone"],
                message: "Enter a valid 10-digit mobile number",
            });
        }
    }
});
/** Coerce an RHF numeric field value (comes back as string) to number. */
export function numericValue(value, fallback = 0) {
    if (typeof value === "number")
        return value;
    if (typeof value === "string") {
        const parsed = Number(value.replace(/[, ]/g, ""));
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    return fallback;
}
