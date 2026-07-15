import { and, count, desc, eq, gt, gte, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  InsertAuthCode,
  InsertGenerationJob,
  InsertProjectImage,
  InsertUser,
  authCodes,
  generationJobs,
  projectImages,
  projects,
  subscriptions,
  users,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { PLAN_BY_ID, type PlanId } from "../shared/plans";

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
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({
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

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ===================== Email / password auth =====================

/** Look up a user by email (case-sensitive; callers should normalize to lower-case). */
export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
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
  await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, userId));
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
  purpose: "signup" | "login" | "reset",
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
        gt(authCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authCodes.createdAt))
    .limit(1);
  return rows[0];
}

/** Increment the verification-attempt counter for a code. */
export async function incrementAuthCodeAttempts(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(authCodes).where(eq(authCodes.id, id)).limit(1);
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
  await db.update(authCodes).set({ consumedAt: new Date() }).where(eq(authCodes.id, id));
}

/** Invalidate any outstanding codes for an email+purpose (e.g. before issuing a new one). */
export async function invalidateAuthCodes(
  email: string,
  purpose: "signup" | "login" | "reset",
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
        isNull(authCodes.consumedAt),
      ),
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
  }>,
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
    .where(and(eq(projectImages.projectId, projectId), eq(projectImages.userId, userId)))
    .orderBy(projectImages.sequenceIndex);
}

export async function getMaxSequenceIndex(projectId: number, userId: number): Promise<number> {
  const images = await getProjectImages(projectId, userId);
  return images.length === 0 ? -1 : Math.max(...images.map((i) => i.sequenceIndex));
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
  orderedImageIds: number[],
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const current = await getProjectImages(projectId, userId);
  const currentIds = new Set(current.map((i) => i.id));
  const incoming = new Set(orderedImageIds);

  if (
    currentIds.size !== incoming.size ||
    orderedImageIds.length !== incoming.size ||
    Array.from(currentIds).some((id) => !incoming.has(id))
  ) {
    throw new Error("Reorder rejected: image id set does not match the project's images");
  }

  // Two-phase update to avoid transient duplicate sequenceIndex values.
  for (let i = 0; i < orderedImageIds.length; i++) {
    await db
      .update(projectImages)
      .set({ sequenceIndex: i + 10000 })
      .where(and(eq(projectImages.id, orderedImageIds[i]), eq(projectImages.userId, userId)));
  }
  for (let i = 0; i < orderedImageIds.length; i++) {
    await db
      .update(projectImages)
      .set({ sequenceIndex: i })
      .where(and(eq(projectImages.id, orderedImageIds[i]), eq(projectImages.userId, userId)));
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
    .where(and(eq(projectImages.id, imageId), eq(projectImages.userId, userId)));

  // Re-compact sequence indexes so order stays gapless.
  const remaining = await getProjectImages(image.projectId, userId);
  for (let i = 0; i < remaining.length; i++) {
    if (remaining[i].sequenceIndex !== i) {
      await db
        .update(projectImages)
        .set({ sequenceIndex: i })
        .where(eq(projectImages.id, remaining[i].id));
    }
  }
}

export async function updateImageRoomTag(imageId: number, userId: number, roomTag: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(projectImages)
    .set({ roomTag })
    .where(and(eq(projectImages.id, imageId), eq(projectImages.userId, userId)));
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
      reason:
        | "inactive"
        | "limit_reached"
        | "period_unavailable";
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
    periodStart: Date;
    enforceAllowance: boolean;
    planId?: PlanId;
  },
): Promise<GenerationReservation> {
  const database = await getDb();
  if (!database) throw new Error("Database not available");

  return database.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${job.userId})`);

    const [subscription] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, job.userId))
      .limit(1);
    const active =
      subscription &&
      (subscription.status === "active" || subscription.status === "trialing") &&
      (!subscription.currentPeriodEnd ||
        subscription.currentPeriodEnd.getTime() >= Date.now() - 24 * 3600 * 1000);
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
            sql`${generationJobs.imageSequence}::jsonb ->> 'additionalCheckoutSessionId' = ${additionalCheckoutSessionId}`,
          ),
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
        // submitted again because OpenRouter offers no verified idempotency key.
        return { ok: true, job: existing, shouldSubmit: false } as const;
      }

      const [created] = await tx
        .insert(generationJobs)
        .values({ ...job, imageSequence })
        .returning();
      return { ok: true, job: created, shouldSubmit: true } as const;
    }

    // Current v2 prices enforce the new limit using the plan classified from
    // Stripe itself. Exact known v1 prices retain their previously sold access.
    if (billingEntitlement.enforceAllowance) {
      const entitlementPlanId = billingEntitlement.planId;
      if (!entitlementPlanId) {
        return { ok: false, reason: "period_unavailable" } as const;
      }
      const [usage] = await tx
        .select({ value: count() })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.userId, job.userId),
            gte(generationJobs.createdAt, billingEntitlement.periodStart),
            sql`not (coalesce(${generationJobs.imageSequence}, 'null')::jsonb ? 'additionalCheckoutSessionId')`,
            or(
              eq(generationJobs.status, "processing"),
              eq(generationJobs.status, "ready"),
            ),
          ),
        );
      const used = Number(usage?.value ?? 0);
      const allowance = PLAN_BY_ID[entitlementPlanId].includedVideos;
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
    openrouterJobId: string;
    videoKey: string;
    videoUrl: string;
    thumbnailUrl: string;
    errorMessage: string;
  }>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(generationJobs).set(patch).where(eq(generationJobs.id, jobId));
}

/** Jobs still processing that have an OpenRouter job id (need polling). */
export async function listProcessingJobs(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.userId, userId), eq(generationJobs.status, "processing")));
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
    plan: "starter" | "pro" | "annual" | "business" | null;
    status: string;
    currentPeriodEnd: Date;
  }>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getSubscription(userId);
  if (existing) {
    await db.update(subscriptions).set(patch).where(eq(subscriptions.userId, userId));
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

/** The single gate for paid features: active subscription required. */
export async function hasActiveSubscription(userId: number): Promise<boolean> {
  const sub = await getSubscription(userId);
  if (!sub) return false;
  if (sub.status !== "active" && sub.status !== "trialing") return false;
  if (sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() < Date.now() - 24 * 3600 * 1000) {
    return false;
  }
  return true;
}

export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}
