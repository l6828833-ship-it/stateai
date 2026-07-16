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
  type SQL,
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
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { PLAN_BY_ID, isPlanId, type PlanId } from "../shared/plans";

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
    periodStart: Date;
    periodEnd: Date;
    enforceAllowance: boolean;
    planId?: PlanId;
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
              eq(generationJobs.status, "ready")
            )
          )
        );
      const used = Number(usage?.value ?? 0);
      const adjustmentApplies =
        subscription.usageAdjustmentPeriodEnd?.getTime() ===
        billingEntitlement.periodEnd.getTime();
      const allowance = Math.max(
        0,
        PLAN_BY_ID[entitlementPlanId].includedVideos +
          (adjustmentApplies ? (subscription.usageAdjustment ?? 0) : 0)
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
    plan:
      | "starter_monthly"
      | "starter_yearly"
      | "creator_monthly"
      | "creator_yearly"
      | "studio_monthly"
      | "studio_yearly"
      | "starter"
      | "pro"
      | "annual"
      | "business"
      | null;
    status: string;
    usageAdjustment: number;
    usageAdjustmentPeriodEnd: Date;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
  }>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getSubscription(userId);
  if (existing) {
    const periodChanged =
      patch.currentPeriodEnd !== undefined &&
      existing.currentPeriodEnd?.getTime() !== patch.currentPeriodEnd.getTime();
    await db
      .update(subscriptions)
      .set({
        ...patch,
        ...(periodChanged
          ? {
              usageAdjustment: 0,
              usageAdjustmentPeriodEnd: patch.currentPeriodEnd,
            }
          : {}),
      })
      .where(eq(subscriptions.userId, userId));
  } else {
    await db.insert(subscriptions).values({
      userId,
      ...patch,
      usageAdjustmentPeriodEnd: patch.currentPeriodEnd,
    });
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

const CHECKOUT_RESERVATION_RETRY_MS = 24 * 60 * 60 * 1000;

export type SubscriptionCheckoutReservation = {
  key: string;
  planId: PlanId;
  reservedAt: Date;
  expiresAt: Date;
  sessionId: string | null;
  created: boolean;
};

function checkoutReservationFromRow(
  row: typeof subscriptions.$inferSelect,
  created: boolean
): SubscriptionCheckoutReservation | null {
  if (
    !row.checkoutReservationKey ||
    !row.checkoutPlanId ||
    !isPlanId(row.checkoutPlanId) ||
    !row.checkoutReservedAt ||
    !row.checkoutExpiresAt
  ) {
    return null;
  }
  return {
    key: row.checkoutReservationKey,
    planId: row.checkoutPlanId,
    reservedAt: row.checkoutReservedAt,
    expiresAt: row.checkoutExpiresAt,
    sessionId: row.checkoutSessionId,
    created,
  };
}

/**
 * Return one durable checkout reservation per user. Reservation fields are
 * separate from subscription status so Stripe webhooks cannot erase the lock.
 */
export async function reserveSubscriptionCheckout(
  userId: number,
  planId: PlanId
): Promise<SubscriptionCheckoutReservation> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(714003, ${userId})`);
    let [existing] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    if (!existing) {
      [existing] = await tx
        .insert(subscriptions)
        .values({ userId })
        .returning();
    }
    if (!existing) throw new Error("Could not initialize subscription record");

    const current = checkoutReservationFromRow(existing, false);
    if (current) return current;

    const reservedAt = new Date();
    const expiresAt = new Date(reservedAt.getTime() + 35 * 60 * 1000);
    const key = `subscription_checkout_${userId}_${reservedAt.getTime()}`;
    const [reserved] = await tx
      .update(subscriptions)
      .set({
        checkoutReservationKey: key,
        checkoutPlanId: planId,
        checkoutReservedAt: reservedAt,
        checkoutExpiresAt: expiresAt,
        checkoutSessionId: null,
      })
      .where(eq(subscriptions.userId, userId))
      .returning();
    if (!reserved) throw new Error("Could not reserve subscription checkout");
    const reservation = checkoutReservationFromRow(reserved, true);
    if (!reservation) throw new Error("Could not reserve subscription checkout");
    return reservation;
  });
}

/** Replace an expired/reconciled reservation using compare-and-set semantics. */
export async function replaceSubscriptionCheckoutReservation(
  userId: number,
  previousKey: string,
  planId: PlanId
): Promise<SubscriptionCheckoutReservation | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(714003, ${userId})`);
    const reservedAt = new Date();
    const expiresAt = new Date(reservedAt.getTime() + 35 * 60 * 1000);
    const key = `subscription_checkout_${userId}_${reservedAt.getTime()}`;
    const [reserved] = await tx
      .update(subscriptions)
      .set({
        checkoutReservationKey: key,
        checkoutPlanId: planId,
        checkoutReservedAt: reservedAt,
        checkoutExpiresAt: expiresAt,
        checkoutSessionId: null,
      })
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.checkoutReservationKey, previousKey)
        )
      )
      .returning();
    return reserved ? checkoutReservationFromRow(reserved, true) : null;
  });
}

/** Attach the Stripe Session only if this request still owns the reservation. */
export async function storeSubscriptionCheckoutSession(
  userId: number,
  reservationKey: string,
  sessionId: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updated = await db
    .update(subscriptions)
    .set({ checkoutSessionId: sessionId })
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.checkoutReservationKey, reservationKey)
      )
    )
    .returning({ id: subscriptions.id });
  return updated.length === 1;
}

/** Release only the reservation owned by the matching failed request. */
export async function releaseSubscriptionCheckout(
  userId: number,
  reservationKey: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(subscriptions)
    .set({
      checkoutReservationKey: null,
      checkoutPlanId: null,
      checkoutReservedAt: null,
      checkoutExpiresAt: null,
      checkoutSessionId: null,
    })
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.checkoutReservationKey, reservationKey)
      )
    );
}

export async function clearSubscriptionCheckoutReservation(
  userId: number,
  reservationKey: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(subscriptions)
    .set({
      checkoutReservationKey: null,
      checkoutPlanId: null,
      checkoutReservedAt: null,
      checkoutExpiresAt: null,
      checkoutSessionId: null,
    })
    .where(
      and(
        eq(subscriptions.userId, userId),
        eq(subscriptions.checkoutReservationKey, reservationKey)
      )
    );
}

export function canReplaceAmbiguousCheckoutReservation(
  reservation: SubscriptionCheckoutReservation
) {
  return (
    Date.now() - reservation.reservedAt.getTime() >=
    CHECKOUT_RESERVATION_RETRY_MS
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

// ===================== Admin console =====================

export type AdminAuditContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export async function listUsersForAdmin(input: {
  page: number;
  pageSize: number;
  search?: string;
  role?: "all" | "user" | "admin";
  accountStatus?: "all" | "active" | "disabled";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const filters: SQL[] = [];
  if (input.search) {
    const pattern = `%${input.search}%`;
    const search = or(
      ilike(users.name, pattern),
      ilike(users.email, pattern),
      ilike(users.openId, pattern)
    );
    if (search) filters.push(search);
  }
  if (input.role && input.role !== "all")
    filters.push(eq(users.role, input.role));
  if (input.accountStatus === "active") filters.push(isNull(users.disabledAt));
  if (input.accountStatus === "disabled")
    filters.push(sql`${users.disabledAt} is not null`);
  const where = filters.length ? and(...filters) : undefined;

  const [rows, totalRows, overviewRows] = await Promise.all([
    db
      .select({
        id: users.id,
        openId: users.openId,
        name: users.name,
        email: users.email,
        loginMethod: users.loginMethod,
        emailVerified: users.emailVerified,
        role: users.role,
        disabledAt: users.disabledAt,
        forcePasswordChange: users.forcePasswordChange,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        lastSignedIn: users.lastSignedIn,
        plan: subscriptions.plan,
        subscriptionStatus: subscriptions.status,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        usageAdjustment: subscriptions.usageAdjustment,
        usageAdjustmentPeriodEnd: subscriptions.usageAdjustmentPeriodEnd,
        stripeCustomerId: subscriptions.stripeCustomerId,
        stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      })
      .from(users)
      .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ value: count() }).from(users).where(where),
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${users.disabledAt} is null)`,
        disabled: sql<number>`count(*) filter (where ${users.disabledAt} is not null)`,
        admins: sql<number>`count(*) filter (where ${users.role} = 'admin')`,
      })
      .from(users),
  ]);

  const items = await Promise.all(
    rows.map(async row => {
      const periodStart = row.currentPeriodStart;
      const usageFilters: SQL[] = [
        eq(generationJobs.userId, row.id),
        sql`not (coalesce(${generationJobs.imageSequence}, 'null')::jsonb ? 'additionalCheckoutSessionId')`,
      ];
      if (periodStart)
        usageFilters.push(gte(generationJobs.createdAt, periodStart));
      else usageFilters.push(sql`false`);
      const [periodUsageRows, totalUsageRows] = await Promise.all([
        db
          .select({ value: count() })
          .from(generationJobs)
          .where(
            and(
              ...usageFilters,
              or(
                eq(generationJobs.status, "processing"),
                eq(generationJobs.status, "ready")
              )
            )
          ),
        db
          .select({ value: count() })
          .from(generationJobs)
          .where(eq(generationJobs.userId, row.id)),
      ]);
      const currentPlan =
        row.plan && row.plan in PLAN_BY_ID
          ? PLAN_BY_ID[row.plan as PlanId]
          : null;
      return {
        ...row,
        usageUsed: Number(periodUsageRows[0]?.value ?? 0),
        totalGenerated: Number(totalUsageRows[0]?.value ?? 0),
        usageAllowance: currentPlan
          ? Math.max(
              0,
              currentPlan.includedVideos +
                (row.currentPeriodEnd &&
                row.usageAdjustmentPeriodEnd?.getTime() ===
                  row.currentPeriodEnd.getTime()
                  ? (row.usageAdjustment ?? 0)
                  : 0)
            )
          : null,
      };
    })
  );

  const total = Number(totalRows[0]?.value ?? 0);
  const overview = overviewRows[0];
  return {
    items,
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    },
    overview: {
      total: Number(overview?.total ?? 0),
      active: Number(overview?.active ?? 0),
      disabled: Number(overview?.disabled ?? 0),
      admins: Number(overview?.admins ?? 0),
    },
  };
}

export async function getUserForAdmin(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [row] = await db
    .select({
      id: users.id,
      openId: users.openId,
      name: users.name,
      email: users.email,
      loginMethod: users.loginMethod,
      emailVerified: users.emailVerified,
      role: users.role,
      disabledAt: users.disabledAt,
      forcePasswordChange: users.forcePasswordChange,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
      lastSignedIn: users.lastSignedIn,
      plan: subscriptions.plan,
      subscriptionStatus: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      usageAdjustment: subscriptions.usageAdjustment,
      usageAdjustmentPeriodEnd: subscriptions.usageAdjustmentPeriodEnd,
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(users)
    .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return undefined;

  const [jobs, jobCounts, projectCounts, imageCounts] = await Promise.all([
    db
      .select({
        id: generationJobs.id,
        status: generationJobs.status,
        resolution: generationJobs.resolution,
        aspectRatio: generationJobs.aspectRatio,
        createdAt: generationJobs.createdAt,
      })
      .from(generationJobs)
      .where(eq(generationJobs.userId, userId))
      .orderBy(desc(generationJobs.createdAt))
      .limit(8),
    db
      .select({ value: count() })
      .from(generationJobs)
      .where(eq(generationJobs.userId, userId)),
    db
      .select({ value: count() })
      .from(projects)
      .where(eq(projects.userId, userId)),
    db
      .select({ value: count() })
      .from(projectImages)
      .where(eq(projectImages.userId, userId)),
  ]);
  const periodStart = row.currentPeriodStart;
  const periodFilters: SQL[] = [
    eq(generationJobs.userId, userId),
    sql`not (coalesce(${generationJobs.imageSequence}, 'null')::jsonb ? 'additionalCheckoutSessionId')`,
  ];
  if (periodStart)
    periodFilters.push(gte(generationJobs.createdAt, periodStart));
  else periodFilters.push(sql`false`);
  const periodUsage = await db
    .select({ value: count() })
    .from(generationJobs)
    .where(
      and(
        ...periodFilters,
        or(
          eq(generationJobs.status, "processing"),
          eq(generationJobs.status, "ready")
        )
      )
    );
  const currentPlan =
    row.plan && row.plan in PLAN_BY_ID ? PLAN_BY_ID[row.plan as PlanId] : null;

  return {
    ...row,
    recentJobs: jobs,
    totalGenerated: Number(jobCounts[0]?.value ?? 0),
    projectCount: Number(projectCounts[0]?.value ?? 0),
    imageCount: Number(imageCounts[0]?.value ?? 0),
    usageUsed: Number(periodUsage[0]?.value ?? 0),
    usageAllowance: currentPlan
      ? Math.max(
          0,
          currentPlan.includedVideos +
            (row.currentPeriodEnd &&
            row.usageAdjustmentPeriodEnd?.getTime() ===
              row.currentPeriodEnd.getTime()
              ? (row.usageAdjustment ?? 0)
              : 0)
        )
      : null,
  };
}

export async function createAdminAuditLog(input: {
  actorUserId: number;
  targetUserId?: number | null;
  action: string;
  details: Record<string, unknown>;
  context?: AdminAuditContext;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [created] = await db
    .insert(adminAuditLogs)
    .values({
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId ?? null,
      action: input.action,
      details: JSON.stringify(input.details),
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
    })
    .returning();
  return created;
}

export async function listAdminAuditLogs(input: {
  page: number;
  pageSize: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(adminAuditLogs)
      .orderBy(desc(adminAuditLogs.createdAt))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    db.select({ value: count() }).from(adminAuditLogs),
  ]);
  const usersById = new Map<
    number,
    { name: string | null; email: string | null }
  >();
  await Promise.all(
    Array.from(
      new Set(
        rows.flatMap(row =>
          [row.actorUserId, row.targetUserId].filter(
            (id): id is number => id !== null
          )
        )
      )
    ).map(async id => {
      const user = await getUserById(id);
      usersById.set(id, {
        name: user?.name ?? null,
        email: user?.email ?? null,
      });
    })
  );
  const total = Number(totals[0]?.value ?? 0);
  return {
    items: rows.map(row => ({
      ...row,
      actor: usersById.get(row.actorUserId) ?? null,
      target: row.targetUserId
        ? (usersById.get(row.targetUserId) ?? null)
        : null,
    })),
    pagination: {
      page: input.page,
      pageSize: input.pageSize,
      total,
      pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    },
  };
}

async function assertTargetUser(tx: any, targetUserId: number) {
  const [target] = await tx
    .select()
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) throw new Error("User not found");
  return target;
}

export async function setAccountDisabledByAdmin(input: {
  actorUserId: number;
  targetUserId: number;
  disabled: boolean;
  context?: AdminAuditContext;
}) {
  if (input.actorUserId === input.targetUserId) {
    throw new Error("You cannot disable your own administrator account");
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(81726354)`);
    const target = await assertTargetUser(tx, input.targetUserId);
    if (input.disabled && target.role === "admin") {
      const [admins] = await tx
        .select({ value: count() })
        .from(users)
        .where(and(eq(users.role, "admin"), isNull(users.disabledAt)));
      if (Number(admins?.value ?? 0) <= 1) {
        throw new Error("The last active administrator cannot be disabled");
      }
    }
    await tx
      .update(users)
      .set({
        disabledAt: input.disabled ? new Date() : null,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, input.targetUserId));
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.disabled ? "user.disabled" : "user.enabled",
      details: JSON.stringify({ previousDisabledAt: target.disabledAt }),
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
    });
  });
}

export async function setUserRoleByAdmin(input: {
  actorUserId: number;
  targetUserId: number;
  role: "user" | "admin";
  context?: AdminAuditContext;
}) {
  if (input.actorUserId === input.targetUserId) {
    throw new Error("You cannot change your own administrator role");
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(81726354)`);
    const target = await assertTargetUser(tx, input.targetUserId);
    if (target.role === "admin" && input.role === "user") {
      const [admins] = await tx
        .select({ value: count() })
        .from(users)
        .where(eq(users.role, "admin"));
      if (Number(admins?.value ?? 0) <= 1) {
        throw new Error("The last administrator cannot be demoted");
      }
    }
    await tx
      .update(users)
      .set({
        role: input.role,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, input.targetUserId));
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: "user.role_changed",
      details: JSON.stringify({ from: target.role, to: input.role }),
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
    });
  });
}

export async function resetUserPasswordByAdmin(input: {
  actorUserId: number;
  targetUserId: number;
  passwordHash: string;
  context?: AdminAuditContext;
}) {
  if (input.actorUserId === input.targetUserId) {
    throw new Error(
      "Use your account password screen to change your own password"
    );
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const target = await assertTargetUser(tx, input.targetUserId);
    if (!target.email)
      throw new Error("This account has no email address for password sign-in");
    const [matchingEmails] = await tx
      .select({ value: count() })
      .from(users)
      .where(eq(users.email, target.email));
    if (Number(matchingEmails?.value ?? 0) !== 1) {
      throw new Error(
        "Password reset is unavailable because this email maps to multiple identities"
      );
    }
    await tx
      .update(users)
      .set({
        passwordHash: input.passwordHash,
        forcePasswordChange: true,
        sessionVersion: sql`${users.sessionVersion} + 1`,
      })
      .where(eq(users.id, input.targetUserId));
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: "user.password_reset",
      details: JSON.stringify({ forcedChange: true }),
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
    });
  });
}

export async function revokeUserSessionsByAdmin(input: {
  actorUserId: number;
  targetUserId: number;
  context?: AdminAuditContext;
}) {
  if (input.actorUserId === input.targetUserId) {
    throw new Error(
      "You cannot revoke your own sessions from the admin console"
    );
  }
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await assertTargetUser(tx, input.targetUserId);
    await tx
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, input.targetUserId));
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: "user.sessions_revoked",
      details: JSON.stringify({ scope: "all" }),
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
    });
  });
}

export async function setUsageAdjustmentByAdmin(input: {
  actorUserId: number;
  targetUserId: number;
  adjustment: number;
  context?: AdminAuditContext;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    await assertTargetUser(tx, input.targetUserId);
    const [existing] = await tx
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, input.targetUserId))
      .limit(1);
    if (!existing) throw new Error("This user has no subscription record");
    await tx
      .update(subscriptions)
      .set({
        usageAdjustment: input.adjustment,
        usageAdjustmentPeriodEnd: existing.currentPeriodEnd,
      })
      .where(eq(subscriptions.userId, input.targetUserId));
    await tx.insert(adminAuditLogs).values({
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: "subscription.usage_adjusted",
      details: JSON.stringify({
        from: existing.usageAdjustment,
        to: input.adjustment,
      }),
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
    });
  });
}

export async function changeOwnPassword(userId: number, passwordHash: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({
      passwordHash,
      forcePasswordChange: false,
      sessionVersion: sql`${users.sessionVersion} + 1`,
    })
    .where(eq(users.id, userId));
  return getUserById(userId);
}

export async function incrementUserSessionVersion(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId));
}
