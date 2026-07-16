import {
  and,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertAuthCode,
  InsertGenerationJob,
  InsertProjectImage,
  InsertUser,
  adminAuditLogs,
  authCodes,
  generationJobs,
  projectImages,
  projects,
  subscriptions,
  usageAdjustments,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import type { PlanId } from "../shared/plans";

let _db: ReturnType<typeof drizzle> | null = null;
let _client: ReturnType<typeof postgres> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      // `prepare: false` is required for Supabase's transaction pooler (pgBouncer),
      // which does not support prepared statements. Harmless on a direct connection.
      _client = postgres(process.env.DATABASE_URL, { prepare: false });
      _db = drizzle(_client);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ===================== Email / password auth =====================

/** Look up a user by email (case-sensitive; callers should normalize to lower-case). */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return rows[0];
}

/** Create a new email/password user (unverified). Returns the created row. */
export async function createLocalUser(input: {
  openId: string;
  name: string | null;
  email: string;
  passwordHash: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(users).values({
    openId: input.openId,
    name: input.name,
    email: input.email,
    passwordHash: input.passwordHash,
    loginMethod: "email",
    role: input.openId === ENV.ownerOpenId ? "admin" : "user",
  });
  return getUserByOpenId(input.openId);
}

/** Update the scrypt password hash for a user. */
export async function setUserPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
}

/** Mark a user's email as verified (idempotent). */
export async function markEmailVerified(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({ emailVerified: new Date() })
    .where(eq(users.id, userId));
}

// ===================== One-time codes (OTP) =====================

/** Insert a new OTP row. */
export async function createAuthCode(input: InsertAuthCode) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(authCodes).values(input);
}

/**
 * Most recent unconsumed, unexpired code for an email + purpose.
 * Used both to verify a submitted code and to rate-limit resends.
 */
export async function getActiveAuthCode(
  email: string,
  purpose: "signup" | "login" | "reset"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(authCodes)
    .where(
      and(
        eq(authCodes.email, email),
        eq(authCodes.purpose, purpose),
        isNull(authCodes.consumedAt),
        gt(authCodes.expiresAt, new Date())
      )
    )
    .orderBy(desc(authCodes.createdAt))
    .limit(1);
  return rows[0];
}

/** Increment the verification-attempt counter for a code. */
export async function incrementAuthCodeAttempts(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(authCodes)
    .where(eq(authCodes.id, id))
    .limit(1);
  const current = rows[0];
  if (!current) return;
  await db
    .update(authCodes)
    .set({ attempts: current.attempts + 1 })
    .where(eq(authCodes.id, id));
}

/** Mark a code as consumed (single-use). */
export async function consumeAuthCode(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(authCodes)
    .set({ consumedAt: new Date() })
    .where(eq(authCodes.id, id));
}

/** Invalidate any outstanding codes for an email+purpose (e.g. before issuing a new one). */
export async function invalidateAuthCodes(
  email: string,
  purpose: "signup" | "login" | "reset"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(authCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(authCodes.email, email),
        eq(authCodes.purpose, purpose),
        isNull(authCodes.consumedAt)
      )
    );
}

// ===================== Projects =====================

/** Get or create the user's active project (most recently updated). */
export async function getOrCreateActiveProject(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt))
    .limit(1);
  if (existing.length > 0) return existing[0];

  const [created] = await db.insert(projects).values({ userId }).returning();
  return created;
}

export async function getProjectById(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function updateProjectSettings(
  projectId: number,
  userId: number,
  settings: Partial<{
    name: string;
    tourStyle: "Walkthrough" | "Drone" | "Cinematic";
    creativeText: string | null;
    resolution: string;
    aspectRatio: string;
    clipDuration: number;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(projects)
    .set(settings)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
}

// ===================== Project Images =====================

export async function addProjectImage(image: InsertProjectImage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db.insert(projectImages).values(image).returning();
  return row;
}

/** Always returned strictly ordered by sequenceIndex. */
export async function getProjectImages(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(projectImages)
    .where(
      and(
        eq(projectImages.projectId, projectId),
        eq(projectImages.userId, userId)
      )
    )
    .orderBy(projectImages.sequenceIndex);
}

export async function getMaxSequenceIndex(
  projectId: number,
  userId: number
): Promise<number> {
  const images = await getProjectImages(projectId, userId);
  return images.length === 0
    ? -1
    : Math.max(...images.map(i => i.sequenceIndex));
}

/**
 * Reorder images atomically: the given array of image ids becomes the new
 * strict order (index in array = sequenceIndex). Every id must belong to the
 * project and the set must be complete, otherwise the reorder is rejected —
 * this guarantees no gaps or duplicates before any paid generation call.
 */
export async function reorderProjectImages(
  projectId: number,
  userId: number,
  orderedImageIds: number[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await getProjectImages(projectId, userId);
  const currentIds = new Set(current.map(i => i.id));
  const incoming = new Set(orderedImageIds);

  if (
    currentIds.size !== incoming.size ||
    orderedImageIds.length !== incoming.size ||
    Array.from(currentIds).some(id => !incoming.has(id))
  ) {
    throw new Error(
      "Reorder rejected: image id set does not match the project's images"
    );
  }

  // Two-phase update to avoid transient duplicate sequenceIndex values.
  for (let i = 0; i < orderedImageIds.length; i++) {
    await db
      .update(projectImages)
      .set({ sequenceIndex: i + 10000 })
      .where(
        and(
          eq(projectImages.id, orderedImageIds[i]),
          eq(projectImages.userId, userId)
        )
      );
  }
  for (let i = 0; i < orderedImageIds.length; i++) {
    await db
      .update(projectImages)
      .set({ sequenceIndex: i })
      .where(
        and(
          eq(projectImages.id, orderedImageIds[i]),
          eq(projectImages.userId, userId)
        )
      );
  }
}

export async function deleteProjectImage(imageId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db
    .select()
    .from(projectImages)
    .where(and(eq(projectImages.id, imageId), eq(projectImages.userId, userId)))
    .limit(1);
  const image = rows[0];
  if (!image) throw new Error("Image not found");

  await db
    .delete(projectImages)
    .where(
      and(eq(projectImages.id, imageId), eq(projectImages.userId, userId))
    );

  // Re-compact sequence indexes so order stays gapless. Issue the updates
  // concurrently (pipelined over one connection) instead of awaiting each in
  // sequence, so deleting from a large plan is not N slow round-trips.
  const remaining = await getProjectImages(image.projectId, userId);
  await Promise.all(
    remaining
      .map((img, i) => ({ img, i }))
      .filter(({ img, i }) => img.sequenceIndex !== i)
      .map(({ img, i }) =>
        db
          .update(projectImages)
          .set({ sequenceIndex: i })
          .where(eq(projectImages.id, img.id))
      )
  );
}

export async function updateImageRoomTag(
  imageId: number,
  userId: number,
  roomTag: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(projectImages)
    .set({ roomTag })
    .where(
      and(eq(projectImages.id, imageId), eq(projectImages.userId, userId))
    );
}

// ===================== Generation Jobs =====================

type GenerationReservation =
  | {
      ok: true;
      job: typeof generationJobs.$inferSelect;
      shouldSubmit: boolean;
    }
  | {
      ok: false;
      reason: "inactive" | "limit_reached" | "period_unavailable";
      allowance?: number;
      used?: number;
    };

/**
 * Atomically reserve a plan allowance and create its processing job. A
 * per-user Postgres advisory lock prevents simultaneous requests from both
 * claiming the final included video. Paid additional-video sessions are
 * permanently associated with one job through the hidden imageSequence JSON.
 */
export async function reserveGenerationJob(
  job: InsertGenerationJob,
  imageIds: number[],
  additionalCheckoutSessionId?: string,
  billingEntitlement?: {
    usageWindowStart: Date;
    enforceAllowance: boolean;
    allowance?: number;
  }
): Promise<GenerationReservation> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  return database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(${job.userId})`);

    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, job.userId))
      .limit(1);
    const active =
      subscription &&
      (subscription.status === "active" ||
        subscription.status === "trialing") &&
      (!subscription.currentPeriodEnd ||
        subscription.currentPeriodEnd.getTime() >=
          Date.now() - 24 * 3600 * 1000);
    if (!active) return { ok: false, reason: "inactive" } as const;
    // The Stripe subscription and exact recurring price must be recognized for
    // every generation path. Never infer entitlement from the denormalized DB plan.
    if (!billingEntitlement) {
      return { ok: false, reason: "period_unavailable" } as const;
    }

    if (additionalCheckoutSessionId) {
      const [existing] = await tx
        .select()
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.userId, job.userId),
            sql`${generationJobs.imageSequence}::jsonb ->> 'additionalCheckoutSessionId' = ${additionalCheckoutSessionId}`
          )
        )
        .limit(1);

      const imageSequence = JSON.stringify({
        imageIds,
        additionalCheckoutSessionId,
      });
      if (existing) {
        // A Checkout Session is an at-most-once entitlement. Returning the
        // permanently associated job is safe after refreshes, lost responses,
        // process crashes, and ambiguous provider timeouts. It must never be
        // submitted again. Official Kling's unique external task id also lets
        // polling recover an accepted task after a lost submission response.
        return { ok: true, job: existing, shouldSubmit: false } as const;
      }

      const [created] = await tx
        .insert(generationJobs)
        .values({ ...job, imageSequence })
        .returning();
      return { ok: true, job: created, shouldSubmit: true } as const;
    }

    // Exact current v3 prices enforce a monthly usage window, including annual
    // subscriptions. Exact v2 prices retain their sold billing-period limits;
    // exact known v1 prices retain their original unlimited behavior.
    if (billingEntitlement.enforceAllowance) {
      const allowance = billingEntitlement.allowance;
      if (!allowance || allowance < 1) {
        return { ok: false, reason: "period_unavailable" } as const;
      }
      const [[usage], [adjustment]] = await Promise.all([
        tx
          .select({ value: count() })
          .from(generationJobs)
          .where(
            and(
              eq(generationJobs.userId, job.userId),
              gte(
                generationJobs.createdAt,
                billingEntitlement.usageWindowStart
              ),
              sql`not (coalesce(${generationJobs.imageSequence}, 'null')::jsonb ? 'additionalCheckoutSessionId')`,
              or(
                eq(generationJobs.status, "processing"),
                eq(generationJobs.status, "ready")
              )
            )
          ),
        tx
          .select({
            value: sql<number>`coalesce(sum(${usageAdjustments.delta}), 0)`,
          })
          .from(usageAdjustments)
          .where(
            and(
              eq(usageAdjustments.userId, job.userId),
              gte(
                usageAdjustments.createdAt,
                billingEntitlement.usageWindowStart
              )
            )
          ),
      ]);
      const used = Math.max(
        0,
        Number(usage?.value ?? 0) + Number(adjustment?.value ?? 0)
      );
      if (used >= allowance) {
        return { ok: false, reason: "limit_reached", allowance, used } as const;
      }
    }

    const [created] = await tx
      .insert(generationJobs)
      .values({ ...job, imageSequence: JSON.stringify(imageIds) })
      .returning();
    return { ok: true, job: created, shouldSubmit: true } as const;
  });
}

export async function getGenerationJob(jobId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.id, jobId), eq(generationJobs.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function listGenerationJobs(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(generationJobs)
    .where(eq(generationJobs.userId, userId))
    .orderBy(desc(generationJobs.createdAt));
}

export async function updateGenerationJob(
  jobId: number,
  patch: Partial<{
    status: "processing" | "ready" | "failed";
    optimizedPrompt: string;
    clipDuration: number;
    providerTaskId: string;
    videoKey: string;
    videoUrl: string;
    thumbnailUrl: string;
    errorMessage: string;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(generationJobs)
    .set(patch)
    .where(eq(generationJobs.id, jobId));
}

/** Jobs still processing and available for provider reconciliation/polling. */
export async function listProcessingJobs(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(generationJobs)
    .where(
      and(
        eq(generationJobs.userId, userId),
        eq(generationJobs.status, "processing")
      )
    );
}

// ===================== Subscriptions =====================

export async function getSubscription(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return rows[0];
}

export async function upsertSubscription(
  userId: number,
  patch: Partial<{
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    plan: PlanId | "starter" | "pro" | "annual" | "business" | null;
    status: string;
    currentPeriodEnd: Date;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getSubscription(userId);
  if (existing) {
    await db
      .update(subscriptions)
      .set(patch)
      .where(eq(subscriptions.userId, userId));
  } else {
    await db.insert(subscriptions).values({ userId, ...patch });
  }
  return getSubscription(userId);
}

export async function findSubscriptionByCustomerId(stripeCustomerId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return rows[0];
}

const CHECKOUT_RESERVATION_TTL_MS = 40 * 60 * 1000;

/**
 * Serialize subscription checkout creation per user. This prevents overlapping
 * requests from creating multiple completable Stripe Checkout Sessions before
 * a webhook has stored the resulting subscription.
 */
export async function reserveSubscriptionCheckout(
  userId: number,
  verifiedTerminalSubscriptionId: string | null
): Promise<
  | { ok: true; reservedAt: Date; previousStatus: string }
  | { ok: false; reason: "existing_subscription" | "checkout_pending" }
> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  return database.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(714003, ${userId})`);
    const [existing] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    if (
      existing?.stripeSubscriptionId &&
      existing.stripeSubscriptionId !== verifiedTerminalSubscriptionId
    ) {
      return { ok: false, reason: "existing_subscription" } as const;
    }
    if (
      existing?.status === "checkout_pending" &&
      Date.now() - existing.updatedAt.getTime() < CHECKOUT_RESERVATION_TTL_MS
    ) {
      return { ok: false, reason: "checkout_pending" } as const;
    }

    const reservedAt = new Date();
    const previousStatus =
      existing?.status === "checkout_pending"
        ? "inactive"
        : (existing?.status ?? "inactive");
    if (existing) {
      await tx
        .update(subscriptions)
        .set({ status: "checkout_pending", updatedAt: reservedAt })
        .where(eq(subscriptions.userId, userId));
    } else {
      await tx.insert(subscriptions).values({
        userId,
        status: "checkout_pending",
        updatedAt: reservedAt,
      });
    }
    return { ok: true, reservedAt, previousStatus } as const;
  });
}

/** Release only the checkout reservation created by the matching request. */
export async function releaseSubscriptionCheckout(
  userId: number,
  reservedAt: Date,
  previousStatus: string
) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  await database
    .update(subscriptions)
    .set({ status: previousStatus })
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.status, "checkout_pending"),
        eq(subscriptions.updatedAt, reservedAt)
      )
    );
}

/** The single gate for paid features: active subscription required. */
export async function hasActiveSubscription(userId: number): Promise<boolean> {
  const sub = await getSubscription(userId);
  if (!sub) return false;
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  if (
    sub.currentPeriodEnd &&
    sub.currentPeriodEnd.getTime() < Date.now() - 24 * 3600 * 1000
  ) {
    return false;
  }
  return true;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0];
}

// ===================== Account/session security & administration =====================

export async function changeOwnPassword(userId: number, passwordHash: string) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const [updated] = await database
    .update(users)
    .set({
      passwordHash,
      mustChangePassword: false,
      sessionVersion: sql`${users.sessionVersion} + 1`,
    })
    .where(and(eq(users.id, userId), eq(users.accountStatus, "active")))
    .returning();
  return updated;
}

export async function listUsersForAdmin(input: {
  page: number;
  pageSize: number;
  search?: string;
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const search = input.search?.trim();
  const where = search
    ? or(
        ilike(users.email, `%${search}%`),
        ilike(users.name, `%${search}%`),
        ilike(users.openId, `%${search}%`)
      )
    : undefined;
  const [rows, totals] = await Promise.all([
    database
      .select({
        id: users.id,
        openId: users.openId,
        name: users.name,
        email: users.email,
        loginMethod: users.loginMethod,
        emailVerified: users.emailVerified,
        role: users.role,
        accountStatus: users.accountStatus,
        mustChangePassword: users.mustChangePassword,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastSignedIn: users.lastSignedIn,
        subscriptionPlan: subscriptions.plan,
        subscriptionStatus: subscriptions.status,
      })
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    database.select({ value: count() }).from(users).where(where),
  ]);
  return { rows, total: Number(totals[0]?.value ?? 0) };
}

export async function getUserDetailsForAdmin(
  userId: number,
  usageWindowStart?: Date
) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  const [user] = await database
    .select({
      id: users.id,
      openId: users.openId,
      name: users.name,
      email: users.email,
      loginMethod: users.loginMethod,
      emailVerified: users.emailVerified,
      role: users.role,
      accountStatus: users.accountStatus,
      sessionVersion: users.sessionVersion,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return undefined;

  const calendarMonthStart = new Date();
  calendarMonthStart.setUTCDate(1);
  calendarMonthStart.setUTCHours(0, 0, 0, 0);
  const windowStart = usageWindowStart ?? calendarMonthStart;
  const [
    subscription,
    totals,
    windowUsage,
    adjustment,
    recentAdjustments,
    recentAudits,
  ] = await Promise.all([
    getSubscription(userId),
    database
      .select({ total: count() })
      .from(generationJobs)
      .where(eq(generationJobs.userId, userId)),
    database
      .select({ value: count() })
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.userId, userId),
          gte(generationJobs.createdAt, windowStart),
          sql`not (coalesce(${generationJobs.imageSequence}, 'null')::jsonb ? 'additionalCheckoutSessionId')`,
          or(
            eq(generationJobs.status, "processing"),
            eq(generationJobs.status, "ready")
          )
        )
      ),
    database
      .select({
        currentWindow: sql<number>`coalesce(sum(${usageAdjustments.delta}) filter (where ${usageAdjustments.createdAt} >= ${windowStart}), 0)`,
      })
      .from(usageAdjustments)
      .where(eq(usageAdjustments.userId, userId)),
    database
      .select()
      .from(usageAdjustments)
      .where(eq(usageAdjustments.userId, userId))
      .orderBy(desc(usageAdjustments.createdAt))
      .limit(25),
    database
      .select()
      .from(adminAuditLogs)
      .where(eq(adminAuditLogs.targetUserId, userId))
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(25),
  ]);
  const adjustmentThisWindow = Number(adjustment[0]?.currentWindow ?? 0);
  return {
    user,
    subscription: subscription ?? null,
    usage: {
      total: Number(totals[0]?.total ?? 0),
      currentWindow: Math.max(
        0,
        Number(windowUsage[0]?.value ?? 0) + adjustmentThisWindow
      ),
      adjustmentCurrentWindow: adjustmentThisWindow,
      windowStart,
    },
    recentAdjustments,
    recentAudits,
  };
}

async function lockAdminMutation(tx: any) {
  await tx.execute(sql`select pg_advisory_xact_lock(714002)`);
}

async function assertMayRemoveActiveAdmin(
  tx: any,
  target: typeof users.$inferSelect
) {
  if (target.role !== "admin" || target.accountStatus !== "active") return;
  const [remaining] = await tx
    .select({ value: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.accountStatus, "active")));
  if (Number(remaining?.value ?? 0) <= 1) {
    throw new Error("LAST_ACTIVE_ADMIN");
  }
}

async function insertAudit(
  tx: any,
  input: {
    adminId: number;
    targetUserId?: number;
    action: string;
    metadata?: unknown;
  }
) {
  await tx.insert(adminAuditLogs).values({
    adminId: input.adminId,
    targetUserId: input.targetUserId,
    action: input.action,
    metadata: JSON.stringify(input.metadata ?? {}),
  });
}

export async function setUserAccountStatusByAdmin(input: {
  adminId: number;
  targetUserId: number;
  status: "active" | "disabled";
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database.transaction(async tx => {
    await lockAdminMutation(tx);
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.targetUserId))
      .limit(1);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (input.adminId === input.targetUserId && input.status === "disabled") {
      throw new Error("SELF_DISABLE");
    }
    if (input.status === "disabled")
      await assertMayRemoveActiveAdmin(tx, target);
    const sessionPatch =
      input.status === "disabled"
        ? { sessionVersion: sql`${users.sessionVersion} + 1` }
        : {};
    const [updated] = await tx
      .update(users)
      .set({ accountStatus: input.status, ...sessionPatch })
      .where(eq(users.id, input.targetUserId))
      .returning();
    await insertAudit(tx, {
      adminId: input.adminId,
      targetUserId: input.targetUserId,
      action: "user.account_status_changed",
      metadata: { from: target.accountStatus, to: input.status },
    });
    return updated;
  });
}

export async function setUserRoleByAdmin(input: {
  adminId: number;
  targetUserId: number;
  role: "user" | "admin";
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database.transaction(async tx => {
    await lockAdminMutation(tx);
    const [target] = await tx
      .select()
      .from(users)
      .where(eq(users.id, input.targetUserId))
      .limit(1);
    if (!target) throw new Error("USER_NOT_FOUND");
    if (input.adminId === input.targetUserId && input.role === "user") {
      throw new Error("SELF_DEMOTION");
    }
    if (input.role === "user") await assertMayRemoveActiveAdmin(tx, target);
    const [updated] = await tx
      .update(users)
      .set({
        role: input.role,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, input.targetUserId))
      .returning();
    await insertAudit(tx, {
      adminId: input.adminId,
      targetUserId: input.targetUserId,
      action: "user.role_changed",
      metadata: { from: target.role, to: input.role },
    });
    return updated;
  });
}

export async function revokeUserSessionsByAdmin(
  adminId: number,
  targetUserId: number
) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database.transaction(async tx => {
    const [updated] = await tx
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, targetUserId))
      .returning();
    if (!updated) throw new Error("USER_NOT_FOUND");
    await insertAudit(tx, {
      adminId,
      targetUserId,
      action: "user.sessions_revoked",
    });
    return updated;
  });
}

export async function issueTemporaryPasswordByAdmin(input: {
  adminId: number;
  targetUserId: number;
  passwordHash: string;
}) {
  if (input.adminId === input.targetUserId) {
    throw new Error("SELF_PASSWORD_RESET");
  }
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return database.transaction(async tx => {
    const [updated] = await tx
      .update(users)
      .set({
        passwordHash: input.passwordHash,
        mustChangePassword: true,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, input.targetUserId))
      .returning();
    if (!updated) throw new Error("USER_NOT_FOUND");
    await insertAudit(tx, {
      adminId: input.adminId,
      targetUserId: input.targetUserId,
      action: "user.temporary_password_issued",
      metadata: { mustChangePassword: true },
    });
    return updated;
  });
}

export async function createAdminAudit(input: {
  adminId: number;
  targetUserId?: number;
  action: string;
  metadata?: unknown;
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  await insertAudit(database, input);
}

/** Append an auditable usage correction for the user's current usage window. */
export async function adjustUserUsageByAdmin(input: {
  adminId: number;
  targetUserId: number;
  delta: number;
  reason: string;
}) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  if (!Number.isInteger(input.delta) || input.delta === 0) {
    throw new Error("INVALID_USAGE_ADJUSTMENT");
  }
  return database.transaction(async tx => {
    const [target] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, input.targetUserId))
      .limit(1);
    if (!target) throw new Error("USER_NOT_FOUND");

    const [adjustment] = await tx
      .insert(usageAdjustments)
      .values({
        adminId: input.adminId,
        userId: input.targetUserId,
        delta: input.delta,
        reason: input.reason,
      })
      .returning();
    await insertAudit(tx, {
      adminId: input.adminId,
      targetUserId: input.targetUserId,
      action: "user.usage_adjusted",
      metadata: {
        adjustmentId: adjustment.id,
        delta: input.delta,
        reason: input.reason,
      },
    });
    return adjustment;
  });
}
