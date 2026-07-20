import {
  boolean,
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
export const blogPostStatusEnum = pgEnum("blog_post_status", [
  "draft",
  "published",
]);
export const planEnum = pgEnum("plan", [
  // Current customer-facing plans (three tiers × monthly/yearly).
  "starter_monthly",
  "starter_yearly",
  "creator_monthly",
  "creator_yearly",
  "studio_monthly",
  "studio_yearly",
  // Legacy values remain valid for existing Stripe subscriptions.
  "starter",
  "pro",
  "annual",
  "business",
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
  /** Disabled accounts cannot create or continue sessions. */
  disabledAt: timestamp("disabledAt"),
  /** Admin-issued temporary passwords must be replaced after sign-in. */
  forcePasswordChange: boolean("forcePasswordChange").default(false).notNull(),
  /** Included in session JWTs; incrementing it revokes every existing session. */
  sessionVersion: integer("sessionVersion").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

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
 * Stripe subscription state per user. Current customer-facing plans use three
 * tiers with monthly/yearly variants; legacy enum values remain readable.
 */
export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 128 }),
  /** Stripe subscriptions and complimentary admin grants have different authority. */
  billingSource: varchar("billingSource", {
    length: 16,
    enum: ["stripe", "admin"],
  })
    .default("stripe")
    .notNull(),
  plan: planEnum("plan"),
  status: varchar("status", { length: 32 }).default("inactive").notNull(),
  /** Durable checkout reservation state, isolated from webhook-managed status. */
  checkoutReservationKey: varchar("checkoutReservationKey", { length: 128 }),
  checkoutPlanId: varchar("checkoutPlanId", { length: 64 }),
  checkoutReservedAt: timestamp("checkoutReservedAt"),
  checkoutExpiresAt: timestamp("checkoutExpiresAt"),
  checkoutSessionId: varchar("checkoutSessionId", { length: 128 }),
  /** Admin-granted or removed generations for the active billing period. */
  usageAdjustment: integer("usageAdjustment").default(0).notNull(),
  /** Period this adjustment belongs to; prevents grants leaking into renewals. */
  usageAdjustmentPeriodEnd: timestamp("usageAdjustmentPeriodEnd"),
  currentPeriodStart: timestamp("currentPeriodStart"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

/**
 * Append-only history of every privileged admin action. The migration installs
 * a database trigger that rejects UPDATE and DELETE, making this immutable even
 * if a future application bug attempts to alter history.
 */
export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: serial("id").primaryKey(),
  actorUserId: integer("actorUserId").notNull(),
  targetUserId: integer("targetUserId"),
  action: varchar("action", { length: 64 }).notNull(),
  details: text("details").notNull(),
  ipAddress: varchar("ipAddress", { length: 64 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type InsertAdminAuditLog = typeof adminAuditLogs.$inferInsert;


/**
 * Blog categories. The category `slug` is the first path segment of a public
 * article URL: `/{category.slug}/{post.slug}`. Slugs are globally unique and
 * validated against a reserved list so a category can never shadow an app
 * route (e.g. "dashboard", "admin", "login").
 */
export const blogCategories = pgTable("blog_categories", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 160 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  /** Optional SEO overrides for the category listing page. */
  seoTitle: varchar("seoTitle", { length: 200 }),
  seoDescription: varchar("seoDescription", { length: 320 }),
  /** Lower numbers appear first in navigation. */
  sortOrder: integer("sortOrder").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type BlogCategory = typeof blogCategories.$inferSelect;
export type InsertBlogCategory = typeof blogCategories.$inferInsert;

/**
 * Blog posts. Content is admin-authored HTML (rendered server-side for full
 * SEO / AdSense crawlability). The `slug` is globally unique so every article
 * has exactly one canonical URL even if its category changes.
 */
export const blogPosts = pgTable("blog_posts", {
  id: serial("id").primaryKey(),
  categoryId: integer("categoryId").notNull(),
  slug: varchar("slug", { length: 200 }).notNull().unique(),
  title: varchar("title", { length: 300 }).notNull(),
  /** Short summary used in listings, meta description fallback, and RSS. */
  excerpt: text("excerpt"),
  /** Full article body as sanitized HTML. */
  content: text("content").notNull(),
  coverImageUrl: varchar("coverImageUrl", { length: 768 }),
  coverImageAlt: varchar("coverImageAlt", { length: 300 }),
  authorName: varchar("authorName", { length: 160 }),
  status: blogPostStatusEnum("status").default("draft").notNull(),
  /** SEO overrides — fall back to title/excerpt/cover when empty. */
  seoTitle: varchar("seoTitle", { length: 200 }),
  seoDescription: varchar("seoDescription", { length: 320 }),
  canonicalUrl: varchar("canonicalUrl", { length: 768 }),
  ogImageUrl: varchar("ogImageUrl", { length: 768 }),
  metaKeywords: varchar("metaKeywords", { length: 500 }),
  /** Comma-separated tags for display + article:tag meta. */
  tags: text("tags"),
  views: integer("views").default(0).notNull(),
  /** Set when first published; drives ordering and sitemap lastmod. */
  publishedAt: timestamp("publishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type BlogPost = typeof blogPosts.$inferSelect;
export type InsertBlogPost = typeof blogPosts.$inferInsert;

/**
 * Singleton blog configuration (always id = 1). Holds the AdSense code blocks,
 * custom CSS, and site-level SEO defaults an admin manages from the dashboard.
 * The AdSense/custom fields are injected raw into server-rendered blog pages,
 * so only admins can edit them.
 */
export const blogSettings = pgTable("blog_settings", {
  id: integer("id").primaryKey().default(1),
  siteName: varchar("siteName", { length: 200 }).default("EstateTour Blog").notNull(),
  siteDescription: text("siteDescription"),
  /** Absolute site origin (e.g. https://example.com) used for canonical/OG. */
  siteUrl: varchar("siteUrl", { length: 512 }),
  blogTitle: varchar("blogTitle", { length: 200 }),
  /** AdSense publisher id "ca-pub-XXXX" — powers /ads.txt when set. */
  adsenseClientId: varchar("adsenseClientId", { length: 64 }),
  /** Raw HTML injected into <head> (AdSense loader / auto-ads / verification). */
  adsenseHeaderCode: text("adsenseHeaderCode"),
  /** Raw HTML injected before </body>. */
  adsenseFooterCode: text("adsenseFooterCode"),
  /** Extra raw HTML for <head> (e.g. GA, search-console verification). */
  customHeadHtml: text("customHeadHtml"),
  /** Custom CSS injected into a <style> tag on every blog page. */
  customCss: text("customCss"),
  defaultAuthorName: varchar("defaultAuthorName", { length: 160 }),
  /** Postgres-side raw HTML placed inside <article>, after the content. */
  postFooterHtml: text("postFooterHtml"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type BlogSettings = typeof blogSettings.$inferSelect;
export type InsertBlogSettings = typeof blogSettings.$inferInsert;
