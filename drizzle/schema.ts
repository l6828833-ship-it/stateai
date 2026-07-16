import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Postgres enum types. Reused across tables where the same set of values
 * applies (e.g. tourStyle in both projects and generation_jobs).
 */
export const roleEnum = pgEnum("role", ["user", "admin"]);
export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "disabled",
]);
export const tourStyleEnum = pgEnum("tour_style", [
  "Walkthrough",
  "Drone",
  "Cinematic",
]);
export const jobStatusEnum = pgEnum("job_status", [
  "processing",
  "ready",
  "failed",
]);
export const authPurposeEnum = pgEnum("auth_purpose", [
  "signup",
  "login",
  "reset",
]);
export const planEnum = pgEnum("plan", [
  "starter",
  "pro",
  "annual",
  "business",
  "starter_monthly",
  "creator_monthly",
  "studio_monthly",
  "starter_yearly",
  "creator_yearly",
  "studio_yearly",
]);

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = pgTable("users", {
  /** Surrogate primary key (auto-incrementing serial). */
  id: serial("id").primaryKey(),
  /** OAuth identifier (openId), or `email_<id>` for email/password accounts. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  /**
   * scrypt password hash for email/password accounts, in the format
   * `scrypt$<saltHex>$<hashHex>`. Null for OAuth-only users.
   */
  passwordHash: varchar("passwordHash", { length: 255 }),
  /** When the user's email was verified via OTP. Null = unverified. */
  emailVerified: timestamp("emailVerified"),
  role: roleEnum("role").default("user").notNull(),
  accountStatus: accountStatusEnum("accountStatus").default("active").notNull(),
  sessionVersion: integer("sessionVersion").default(0).notNull(),
  mustChangePassword: boolean("mustChangePassword").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Append-only security log for all administrator mutations. */
export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: serial("id").primaryKey(),
    adminId: integer("adminId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    targetUserId: integer("targetUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 96 }).notNull(),
    /** JSON serialized by the server; audit rows are append-only. */
    metadata: text("metadata").notNull().default("{}"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("admin_audit_admin_created_idx").on(table.adminId, table.createdAt),
    index("admin_audit_target_created_idx").on(
      table.targetUserId,
      table.createdAt
    ),
  ]
);

export const usageAdjustments = pgTable(
  "usage_adjustments",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    adminId: integer("adminId")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Positive values consume allowance; negative values restore allowance. */
    delta: integer("delta").notNull(),
    reason: varchar("reason", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("usage_adjustment_user_created_idx").on(
      table.userId,
      table.createdAt
    ),
    index("usage_adjustment_admin_created_idx").on(
      table.adminId,
      table.createdAt
    ),
  ]
);

export const usersRelations = relations(users, ({ many }) => ({
  auditsPerformed: many(adminAuditLogs, { relationName: "auditAdmin" }),
  auditsReceived: many(adminAuditLogs, { relationName: "auditTarget" }),
  usageAdjustmentsMade: many(usageAdjustments, { relationName: "usageAdmin" }),
  usageAdjustmentsReceived: many(usageAdjustments, {
    relationName: "usageUser",
  }),
}));

export const adminAuditLogsRelations = relations(adminAuditLogs, ({ one }) => ({
  admin: one(users, {
    fields: [adminAuditLogs.adminId],
    references: [users.id],
    relationName: "auditAdmin",
  }),
  targetUser: one(users, {
    fields: [adminAuditLogs.targetUserId],
    references: [users.id],
    relationName: "auditTarget",
  }),
}));

export const usageAdjustmentsRelations = relations(
  usageAdjustments,
  ({ one }) => ({
    admin: one(users, {
      fields: [usageAdjustments.adminId],
      references: [users.id],
      relationName: "usageAdmin",
    }),
    user: one(users, {
      fields: [usageAdjustments.userId],
      references: [users.id],
      relationName: "usageUser",
    }),
  })
);

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLogs.$inferInsert;
export type UsageAdjustment = typeof usageAdjustments.$inferSelect;
export type InsertUsageAdjustment = typeof usageAdjustments.$inferInsert;

/**
 * One-time email verification / login codes (OTP). Codes are stored hashed
 * (never in plaintext). A code is valid until `expiresAt`, has a capped number
 * of verification `attempts`, and is single-use (`consumedAt` set on success).
 */
export const authCodes = pgTable("auth_codes", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  /** SHA-256 hash (hex) of the 6-digit code. */
  codeHash: varchar("codeHash", { length: 128 }).notNull(),
  purpose: authPurposeEnum("purpose").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  consumedAt: timestamp("consumedAt"),
  attempts: integer("attempts").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuthCode = typeof authCodes.$inferSelect;
export type InsertAuthCode = typeof authCodes.$inferInsert;

/**
 * A tour project groups a user's uploaded photos, settings, and generations.
 * Each user gets one "active" project restored on login (the tool state),
 * but the model supports multiple projects for history.
 */
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  name: varchar("name", { length: 255 }).default("My Property Tour").notNull(),
  /** Tour style — labels exactly: Walkthrough, Drone, Cinematic */
  tourStyle: tourStyleEnum("tourStyle").default("Walkthrough").notNull(),
  /** Optional creative direction text from the user (prompt style) */
  creativeText: text("creativeText"),
  /**
   * Video settings. Resolution is always 1080p (not user-configurable) and
   * clipDuration is decided per-generation by the AI, so these are effectively
   * defaults/record-keeping — the generation path forces 1080p + AI length.
   */
  resolution: varchar("resolution", { length: 16 }).default("1080p").notNull(),
  aspectRatio: varchar("aspectRatio", { length: 8 }).default("16:9").notNull(),
  clipDuration: integer("clipDuration").default(5).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

/**
 * Uploaded property photos. Strict ordering is enforced via sequenceIndex —
 * this index is the single source of truth for photo order and is stored
 * alongside the Supabase Storage key so generation uses the intended order.
 */
export const projectImages = pgTable("project_images", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  userId: integer("userId").notNull(),
  /** 0-based strict ordering index within the project */
  sequenceIndex: integer("sequenceIndex").notNull(),
  /** Supabase Storage object key (the only way to reach the object) */
  fileKey: varchar("fileKey", { length: 512 }).notNull(),
  /** Serving URL (/manus-storage/{key}) */
  url: varchar("url", { length: 768 }).notNull(),
  fileName: varchar("fileName", { length: 255 }),
  mimeType: varchar("mimeType", { length: 64 }),
  /** Room label detected by analysis or set by user, e.g. "Living room" */
  roomTag: varchar("roomTag", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProjectImage = typeof projectImages.$inferSelect;
export type InsertProjectImage = typeof projectImages.$inferInsert;

/**
 * Video generation jobs. Status labels exactly: processing, ready, failed.
 * The optimized prompt (from the hidden LLM analysis step) is stored
 * server-side only and never exposed via any public procedure.
 */
export const generationJobs = pgTable("generation_jobs", {
  id: serial("id").primaryKey(),
  projectId: integer("projectId").notNull(),
  userId: integer("userId").notNull(),
  status: jobStatusEnum("status").default("processing").notNull(),
  tourStyle: tourStyleEnum("tourStyle").notNull(),
  resolution: varchar("resolution", { length: 16 }).notNull(),
  aspectRatio: varchar("aspectRatio", { length: 8 }).notNull(),
  clipDuration: integer("clipDuration").notNull(),
  /** Snapshot of ordered image ids at generation time (JSON array) — order guarantee */
  imageSequence: text("imageSequence"),
  /** Hidden: Inworld-optimized prompt sent to Kling. NEVER exposed to client. */
  optimizedPrompt: text("optimizedPrompt"),
  /**
   * Async video-provider task id. The physical column keeps its historical
   * name for zero-downtime compatibility; official Kling ids use `kling:`.
   */
  providerTaskId: varchar("openrouterJobId", { length: 128 }),
  /** Final video storage */
  videoKey: varchar("videoKey", { length: 512 }),
  videoUrl: varchar("videoUrl", { length: 768 }),
  thumbnailUrl: varchar("thumbnailUrl", { length: 768 }),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type GenerationJob = typeof generationJobs.$inferSelect;
export type InsertGenerationJob = typeof generationJobs.$inferInsert;

/**
 * Current checkout plans use the six v3 plan ids. Legacy enum values remain
 * valid so existing v1/v2 subscriptions continue to deserialize safely.
 */
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  plan: planEnum("plan"),
  status: varchar("status", { length: 32 }).default("inactive").notNull(),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;
