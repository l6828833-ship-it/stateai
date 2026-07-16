import Stripe from "stripe";
import type { Request, Response } from "express";
import {
  ADDITIONAL_VIDEO_LOOKUP_KEY,
  ADDITIONAL_VIDEO_PRICE_USD,
  PLAN_BY_ID,
  PLANS,
  type PlanId,
} from "@shared/plans";
import * as db from "./db";

let _stripe: Stripe | null = null;
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/**
 * Products/prices are created lazily on first checkout and cached by
 * lookup_key so we never duplicate them across restarts.
 */
const priceCache = new Map<PlanId, string>();
let additionalVideoPriceId: string | null = null;

const ADDITIONAL_VIDEO_PRICE_CENTS = ADDITIONAL_VIDEO_PRICE_USD * 100;

type LegacyPlanId = "starter" | "annual" | "pro" | "business";
type StoredPlanId = PlanId | LegacyPlanId;
type RecurringInterval = "month" | "year";

type ClassifiedGenerationPrice =
  | {
      planId: PlanId;
      enforceAllowance: true;
      allowance: number;
      usageWindow: "anchored_month";
    }
  | {
      planId: "annual" | "pro";
      enforceAllowance: true;
      allowance: number;
      usageWindow: "stripe_period";
    }
  | {
      planId: LegacyPlanId;
      enforceAllowance: false;
      usageWindow: "stripe_period";
    };

const CURRENT_PRICE_BY_LOOKUP_KEY: Readonly<Record<string, PlanId>> =
  Object.freeze(
    Object.fromEntries(PLANS.map(plan => [plan.lookupKey, plan.id])) as Record<
      string,
      PlanId
    >
  );

const LEGACY_V2_PRICE_BY_LOOKUP_KEY: Readonly<
  Record<
    string,
    {
      planId: "annual" | "pro";
      amount: number;
      interval: RecurringInterval;
      allowance: number;
    }
  >
> = Object.freeze({
  estatetour_annual_v2: {
    planId: "annual",
    amount: 2900,
    interval: "year",
    allowance: 36,
  },
  estatetour_pro_v2: {
    planId: "pro",
    amount: 3900,
    interval: "month",
    allowance: 3,
  },
});

const LEGACY_V1_PRICE_BY_LOOKUP_KEY: Readonly<
  Record<
    string,
    { planId: LegacyPlanId; amount: number; interval: RecurringInterval }
  >
> = Object.freeze({
  estatetour_starter_v1: { planId: "starter", amount: 900, interval: "month" },
  estatetour_annual_v1: { planId: "annual", amount: 2900, interval: "year" },
  estatetour_pro_v1: { planId: "pro", amount: 3900, interval: "month" },
  estatetour_business_v1: {
    planId: "business",
    amount: 9900,
    interval: "month",
  },
});

function isExactRecurringPrice(
  price: Stripe.Price,
  expected: { amount: number; interval: RecurringInterval },
  requireActive: boolean
): boolean {
  return (
    (!requireActive || price.active) &&
    price.type === "recurring" &&
    price.billing_scheme === "per_unit" &&
    price.currency === "usd" &&
    price.unit_amount === expected.amount &&
    price.recurring?.interval === expected.interval &&
    price.recurring.interval_count === 1 &&
    price.recurring.usage_type === "licensed"
  );
}

function isExactPlanPrice(price: Stripe.Price, planId: PlanId): boolean {
  const plan = PLAN_BY_ID[planId];
  return isExactRecurringPrice(
    price,
    { amount: plan.totalPrice * 100, interval: plan.interval },
    true
  );
}

/** Classify only exact prices created by known versions of this application. */
export function classifyGenerationPrice(
  price: Stripe.Price
): ClassifiedGenerationPrice | null {
  const lookupKey = price.lookup_key ?? "";
  const currentPlanId = CURRENT_PRICE_BY_LOOKUP_KEY[lookupKey];
  if (currentPlanId) {
    const plan = PLAN_BY_ID[currentPlanId];
    return isExactPlanPrice(price, currentPlanId)
      ? {
          planId: currentPlanId,
          enforceAllowance: true,
          allowance: plan.includedVideos,
          usageWindow: "anchored_month",
        }
      : null;
  }

  const legacyV2 = LEGACY_V2_PRICE_BY_LOOKUP_KEY[lookupKey];
  if (legacyV2) {
    return isExactRecurringPrice(price, legacyV2, false)
      ? {
          planId: legacyV2.planId,
          enforceAllowance: true,
          allowance: legacyV2.allowance,
          usageWindow: "stripe_period",
        }
      : null;
  }

  const legacyV1 = LEGACY_V1_PRICE_BY_LOOKUP_KEY[lookupKey];
  if (!legacyV1) return null;
  // Archived legacy prices remain valid only for subscriptions that already
  // purchased them; `active` controls new Stripe purchases, not entitlement.
  return isExactRecurringPrice(price, legacyV1, false)
    ? {
        planId: legacyV1.planId,
        enforceAllowance: false,
        usageWindow: "stripe_period",
      }
    : null;
}

function isExactAdditionalVideoPrice(price: Stripe.Price): boolean {
  return (
    price.active &&
    price.type === "one_time" &&
    price.billing_scheme === "per_unit" &&
    price.currency === "usd" &&
    price.unit_amount === ADDITIONAL_VIDEO_PRICE_CENTS &&
    price.recurring === null
  );
}

export async function ensurePrice(planId: PlanId): Promise<string> {
  const cached = priceCache.get(planId);
  if (cached) return cached;

  const stripe = getStripe();
  const plan = PLAN_BY_ID[planId];
  const lookupKey = plan.lookupKey;

  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
  });
  if (existing.data.length > 0) {
    if (!isExactPlanPrice(existing.data[0], planId)) {
      throw new Error(`The configured Stripe price for ${planId} is incorrect`);
    }
    priceCache.set(planId, existing.data[0].id);
    return existing.data[0].id;
  }

  const product = await stripe.products.create({
    name: `EstateTour AI — ${plan.name}`,
    description: plan.features.join(" · ").slice(0, 500),
    metadata: { plan_id: planId },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: plan.totalPrice * 100,
    currency: "usd",
    recurring: { interval: plan.interval },
    lookup_key: lookupKey,
    metadata: { plan_id: planId },
  });
  const createdPrice = await stripe.prices.retrieve(price.id);
  if (!isExactPlanPrice(createdPrice, planId)) {
    throw new Error(`Stripe did not create the exact ${plan.priceLabel} price`);
  }
  priceCache.set(planId, price.id);
  return price.id;
}

async function ensureAdditionalVideoPrice(): Promise<string> {
  if (additionalVideoPriceId) return additionalVideoPriceId;

  const stripe = getStripe();
  const lookupKey = ADDITIONAL_VIDEO_LOOKUP_KEY;
  const existing = await stripe.prices.list({
    lookup_keys: [lookupKey],
    limit: 1,
  });
  if (existing.data.length > 0) {
    if (!isExactAdditionalVideoPrice(existing.data[0])) {
      throw new Error(
        `The configured additional-video Stripe price is not exactly USD $${ADDITIONAL_VIDEO_PRICE_USD}`
      );
    }
    additionalVideoPriceId = existing.data[0].id;
    return additionalVideoPriceId;
  }

  const product = await stripe.products.create({
    name: "EstateTour AI — Additional video",
    description: "One additional high-quality 1080p cinematic video",
    metadata: { purchase_type: "additional_video" },
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: ADDITIONAL_VIDEO_PRICE_CENTS,
    currency: "usd",
    lookup_key: lookupKey,
    metadata: { purchase_type: "additional_video" },
  });
  const createdPrice = await stripe.prices.retrieve(price.id);
  if (!isExactAdditionalVideoPrice(createdPrice)) {
    throw new Error(
      `Stripe did not create the exact USD $${ADDITIONAL_VIDEO_PRICE_USD} additional-video price`
    );
  }
  additionalVideoPriceId = price.id;
  return price.id;
}

function isPlanId(v: string): v is PlanId {
  return PLANS.some(p => p.id === v);
}

function getOrigin(req: Request): string {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin;
  const proto =
    (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

/** POST /api/billing/checkout?plan=<current PlanId> — requires authentication. */
export async function handleCheckout(
  req: Request,
  res: Response,
  user: { id: number; email: string | null; name: string | null }
) {
  try {
    const planParam = String(req.query.plan ?? "");
    if (!isPlanId(planParam)) {
      res.status(400).json({ error: "Unknown plan" });
      return;
    }
    const stripe = getStripe();
    const priceId = await ensurePrice(planParam);
    const origin = getOrigin(req);

    const existingSub = await db.getSubscription(user.id);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      client_reference_id: user.id.toString(),
      customer: existingSub?.stripeCustomerId || undefined,
      customer_email: existingSub?.stripeCustomerId
        ? undefined
        : (user.email ?? undefined),
      metadata: {
        user_id: user.id.toString(),
        customer_email: user.email ?? "",
        customer_name: user.name ?? "",
        plan_id: planParam,
      },
      subscription_data: {
        metadata: { user_id: user.id.toString(), plan_id: planParam },
      },
      success_url: `${origin}/dashboard?checkout=success`,
      cancel_url: `${origin}/dashboard?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("[Billing] Checkout error:", e);
    res.status(500).json({ error: "Could not start checkout" });
  }
}

/** Create a one-time $17 checkout for one additional generation. */
export async function handleAdditionalVideoCheckout(
  req: Request,
  res: Response,
  user: { id: number; email: string | null }
) {
  try {
    const subscription = await db.getSubscription(user.id);
    const entitlement = await getStripeGenerationEntitlement(user.id);
    if (
      !(await db.hasActiveSubscription(user.id)) ||
      !subscription ||
      !entitlement
    ) {
      res.status(403).json({ error: "A recognized active plan is required" });
      return;
    }

    const stripe = getStripe();
    const priceId = await ensureAdditionalVideoPrice();
    const origin = getOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id.toString(),
      customer: subscription.stripeCustomerId || undefined,
      customer_email: subscription.stripeCustomerId
        ? undefined
        : (user.email ?? undefined),
      metadata: {
        user_id: user.id.toString(),
        purchase_type: "additional_video",
      },
      payment_intent_data: {
        metadata: {
          user_id: user.id.toString(),
          purchase_type: "additional_video",
        },
      },
      success_url: `${origin}/dashboard?additional_video=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard?additional_video=cancelled`,
    });
    res.json({ url: session.url });
  } catch (error) {
    console.error("[Billing] Additional-video checkout error:", error);
    res
      .status(500)
      .json({ error: "Could not start additional-video checkout" });
  }
}

function daysInUtcMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * Return the latest monthly anniversary at or before `asOf`, preserving the
 * subscription's UTC day/time and clamping short months to their final day.
 * Every boundary is calculated directly from the original anchor, so a
 * January 31 subscription does not drift after February.
 */
export function getAnchoredMonthlyUsageWindowStart(
  periodStart: Date,
  asOf: Date = new Date()
): Date | null {
  const anchorMs = periodStart.getTime();
  const asOfMs = asOf.getTime();
  if (
    !Number.isFinite(anchorMs) ||
    !Number.isFinite(asOfMs) ||
    asOfMs < anchorMs
  ) {
    return null;
  }

  const anchoredMonth = (monthOffset: number): Date => {
    const absoluteMonth =
      periodStart.getUTCFullYear() * 12 +
      periodStart.getUTCMonth() +
      monthOffset;
    const year = Math.floor(absoluteMonth / 12);
    const month = absoluteMonth - year * 12;
    const day = Math.min(periodStart.getUTCDate(), daysInUtcMonth(year, month));
    return new Date(
      Date.UTC(
        year,
        month,
        day,
        periodStart.getUTCHours(),
        periodStart.getUTCMinutes(),
        periodStart.getUTCSeconds(),
        periodStart.getUTCMilliseconds()
      )
    );
  };

  let monthOffset =
    (asOf.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 +
    asOf.getUTCMonth() -
    periodStart.getUTCMonth();
  let candidate = anchoredMonth(monthOffset);
  if (candidate.getTime() > asOfMs) {
    monthOffset -= 1;
    candidate = anchoredMonth(monthOffset);
  }
  return candidate;
}

/** Return a fail-closed Stripe entitlement and its exact usage-window start. */
export async function getStripeGenerationEntitlement(userId: number): Promise<{
  usageWindowStart: Date;
  enforceAllowance: boolean;
  allowance?: number;
  planId: StoredPlanId;
} | null> {
  const stored = await db.getSubscription(userId);
  if (!stored?.stripeSubscriptionId) return null;

  const subscription = await getStripe().subscriptions.retrieve(
    stored.stripeSubscriptionId
  );
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    return null;
  }
  if (subscription.items.data.length !== 1) return null;

  const item = subscription.items.data[0];
  if (!item || item.quantity !== 1 || !item.current_period_start) return null;

  const classified = classifyGenerationPrice(item.price);
  if (!classified) return null;

  const stripePeriodStart = new Date(item.current_period_start * 1000);
  const usageWindowStart =
    classified.usageWindow === "anchored_month"
      ? getAnchoredMonthlyUsageWindowStart(stripePeriodStart)
      : stripePeriodStart;
  if (!usageWindowStart) return null;

  return {
    usageWindowStart,
    enforceAllowance: classified.enforceAllowance,
    planId: classified.planId,
    ...(classified.enforceAllowance ? { allowance: classified.allowance } : {}),
  };
}

/** Verify an exact, paid USD $17 checkout before allowing its generation. */
export async function verifyAdditionalVideoCheckout(
  sessionId: string,
  userId: number
): Promise<boolean> {
  if (!sessionId.startsWith("cs_")) return false;

  const stripe = getStripe();
  const expectedPriceId = await ensureAdditionalVideoPrice();
  const [session, lineItems] = await Promise.all([
    stripe.checkout.sessions.retrieve(sessionId),
    stripe.checkout.sessions.listLineItems(sessionId, { limit: 2 }),
  ]);
  const item = lineItems.data[0];
  const itemPriceId =
    typeof item?.price === "string" ? item.price : item?.price?.id;

  return (
    session.mode === "payment" &&
    session.payment_status === "paid" &&
    session.currency === "usd" &&
    session.amount_total === ADDITIONAL_VIDEO_PRICE_CENTS &&
    lineItems.data.length === 1 &&
    item?.quantity === 1 &&
    itemPriceId === expectedPriceId &&
    session.metadata?.purchase_type === "additional_video" &&
    session.metadata?.user_id === userId.toString()
  );
}

/** POST /api/billing/portal — opens the Stripe billing portal. */
export async function handlePortal(
  req: Request,
  res: Response,
  user: { id: number }
) {
  try {
    const sub = await db.getSubscription(user.id);
    if (!sub?.stripeCustomerId) {
      res
        .status(400)
        .json({ error: "No billing account yet — subscribe to a plan first" });
      return;
    }
    const stripe = getStripe();
    const origin = getOrigin(req);
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${origin}/dashboard`,
    });
    res.json({ url: session.url });
  } catch (e) {
    console.error("[Billing] Portal error:", e);
    res.status(500).json({ error: "Billing portal unavailable" });
  }
}

/** Resolve the stored plan only from an exact, recognized Stripe price. */
function planFromSubscription(sub: Stripe.Subscription): StoredPlanId | null {
  if (sub.items.data.length !== 1) return null;
  const item = sub.items.data[0];
  if (!item || item.quantity !== 1) return null;
  return classifyGenerationPrice(item.price)?.planId ?? null;
}

async function syncSubscriptionToDb(sub: Stripe.Subscription) {
  const userIdRaw = sub.metadata?.user_id;
  let userId = userIdRaw ? Number(userIdRaw) : NaN;

  if (!Number.isFinite(userId)) {
    // Fall back: find user via existing customer mapping.
    const customerId =
      typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const existing = await db.findSubscriptionByCustomerId(customerId);
    if (!existing) {
      console.warn("[Billing] Cannot map subscription to user:", sub.id);
      return;
    }
    userId = existing.userId;
  }

  const plan = planFromSubscription(sub);
  const periodEnd = sub.items.data[0]?.current_period_end;
  await db.upsertSubscription(userId, {
    stripeCustomerId:
      typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    plan,
    status: sub.status,
    ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
  });
  console.log(
    `[Billing] Synced subscription ${sub.id} for user ${userId}: ${sub.status}`
  );
}

/** POST /api/stripe/webhook — raw body required for signature verification. */
export async function handleWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  try {
    if (!secret || !signature)
      throw new Error("Missing webhook secret or signature");
    event = getStripe().webhooks.constructEvent(
      req.body,
      signature as string,
      secret
    );
  } catch (e) {
    console.error("[Webhook] Signature verification failed:", e);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  // Test events must return the verification response.
  if (event.id.startsWith("evt_test_")) {
    console.log(
      "[Webhook] Test event detected, returning verification response"
    );
    res.json({ verified: true });
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription" && session.subscription) {
          const subId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const sub = await getStripe().subscriptions.retrieve(subId);
          // Ensure user mapping survives even if subscription metadata is missing.
          if (!sub.metadata?.user_id && session.client_reference_id) {
            await getStripe().subscriptions.update(subId, {
              metadata: {
                ...sub.metadata,
                user_id: session.client_reference_id,
              },
            });
            sub.metadata = {
              ...sub.metadata,
              user_id: session.client_reference_id,
            };
          }
          await syncSubscriptionToDb(sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscriptionToDb(event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (
          invoice as unknown as { subscription?: string | { id: string } }
        ).subscription;
        if (subId) {
          const sub = await getStripe().subscriptions.retrieve(
            typeof subId === "string" ? subId : subId.id
          );
          await syncSubscriptionToDb(sub);
        }
        break;
      }
      default:
        break;
    }
    console.log(`[Webhook] Processed ${event.type} (${event.id})`);
    res.json({ received: true });
  } catch (e) {
    console.error("[Webhook] Handler error:", e);
    res.status(500).json({ error: "Webhook processing failed" });
  }
}
