import Stripe from "stripe";
import type { Request, Response } from "express";
import {
  ADDITIONAL_VIDEO_PRICE_USD,
  PLAN_BY_ID,
  PLANS,
  isPlanId,
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

const CURRENT_PRICE_BY_LOOKUP_KEY: Readonly<Record<string, PlanId>> =
  Object.freeze(
    Object.fromEntries(
      PLANS.map(plan => [`estatetour_${plan.id}_v3`, plan.id])
    ) as Record<string, PlanId>
  );

const LEGACY_PRICE_BY_LOOKUP_KEY: Readonly<
  Record<
    string,
    { planId: LegacyPlanId; amount: number; interval: RecurringInterval }
  >
> = Object.freeze({
  estatetour_annual_v2: { planId: "annual", amount: 2900, interval: "year" },
  estatetour_pro_v2: { planId: "pro", amount: 3900, interval: "month" },
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
    price.transform_quantity === null &&
    price.currency === "usd" &&
    price.unit_amount === expected.amount &&
    price.recurring?.interval === expected.interval &&
    price.recurring.interval_count === 1 &&
    price.recurring.usage_type === "licensed"
  );
}

function isExactPlanPrice(
  price: Stripe.Price,
  planId: PlanId,
  requireActive = true
): boolean {
  const plan = PLAN_BY_ID[planId];
  return isExactRecurringPrice(
    price,
    { amount: plan.price * 100, interval: plan.interval },
    requireActive
  );
}

/** Classify only exact prices created by known versions of this application. */
export function classifyGenerationPrice(
  price: Stripe.Price
):
  | { planId: PlanId; enforceAllowance: true }
  | { planId: LegacyPlanId; enforceAllowance: false }
  | null {
  const lookupKey = price.lookup_key ?? "";
  const currentPlanId = CURRENT_PRICE_BY_LOOKUP_KEY[lookupKey];
  if (currentPlanId) {
    // Archived prices remain valid for subscriptions that already bought them;
    // `active` controls new purchases, not existing entitlements.
    return isExactPlanPrice(price, currentPlanId, false)
      ? { planId: currentPlanId, enforceAllowance: true }
      : null;
  }

  const legacy = LEGACY_PRICE_BY_LOOKUP_KEY[lookupKey];
  if (!legacy) return null;
  return isExactRecurringPrice(price, legacy, false)
    ? { planId: legacy.planId, enforceAllowance: false }
    : null;
}

const ADDITIONAL_VIDEO_LOOKUP_KEY =
  "estatetour_additional_video_v3" as const;
const LEGACY_ADDITIONAL_VIDEO_LOOKUP_KEY =
  "estatetour_additional_video_v2" as const;
const LEGACY_ADDITIONAL_VIDEO_PRICE_CENTS = 1500;

function isExactOneTimePrice(
  price: Stripe.Price,
  amount: number,
  requireActive: boolean
): boolean {
  return (
    (!requireActive || price.active) &&
    price.type === "one_time" &&
    price.billing_scheme === "per_unit" &&
    price.transform_quantity === null &&
    price.currency === "usd" &&
    price.unit_amount === amount &&
    price.recurring === null
  );
}

function isExactAdditionalVideoPrice(price: Stripe.Price): boolean {
  return isExactOneTimePrice(price, ADDITIONAL_VIDEO_PRICE_CENTS, true);
}

/** Recognize exact current and legacy add-on prices for redemption only. */
export function recognizedAdditionalVideoAmount(
  price: Stripe.Price
): number | null {
  if (
    price.lookup_key === ADDITIONAL_VIDEO_LOOKUP_KEY &&
    isExactOneTimePrice(price, ADDITIONAL_VIDEO_PRICE_CENTS, false)
  ) {
    return ADDITIONAL_VIDEO_PRICE_CENTS;
  }
  if (
    price.lookup_key === LEGACY_ADDITIONAL_VIDEO_LOOKUP_KEY &&
    isExactOneTimePrice(price, LEGACY_ADDITIONAL_VIDEO_PRICE_CENTS, false)
  ) {
    return LEGACY_ADDITIONAL_VIDEO_PRICE_CENTS;
  }
  return null;
}

export async function ensurePrice(planId: PlanId): Promise<string> {
  const cached = priceCache.get(planId);
  if (cached) return cached;

  const stripe = getStripe();
  const plan = PLAN_BY_ID[planId];
  const lookupKey = `estatetour_${planId}_v3`;

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
    unit_amount: plan.price * 100,
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
    description: `One additional high-quality 1080p cinematic video for $${ADDITIONAL_VIDEO_PRICE_USD}`,
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

function isCurrentPlanId(value: string): value is PlanId {
  return isPlanId(value);
}

function isTerminalSubscriptionStatus(status: Stripe.Subscription.Status) {
  return status === "canceled" || status === "incomplete_expired";
}

function getOrigin(req: Request): string {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin;
  const proto =
    (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

/** POST /api/billing/checkout?plan=<tier>_<interval> — requires authentication. */
export async function handleCheckout(
  req: Request,
  res: Response,
  user: { id: number; email: string | null; name: string | null }
) {
  try {
    const planParam = String(req.query.plan ?? "");
    if (!isCurrentPlanId(planParam)) {
      res.status(400).json({ error: "Unknown plan" });
      return;
    }
    const stripe = getStripe();
    const priceId = await ensurePrice(planParam);
    const origin = getOrigin(req);

    const existingSub = await db.getSubscription(user.id);
    let checkoutCustomerId = existingSub?.stripeCustomerId ?? null;

    // Checkout always creates a new subscription. Resolve the Stripe customer
    // from the stored subscription when needed, then inspect every subscription
    // for that customer rather than trusting one potentially stale local row.
    if (existingSub?.stripeSubscriptionId) {
      try {
        const stripeSubscription = await stripe.subscriptions.retrieve(
          existingSub.stripeSubscriptionId
        );
        checkoutCustomerId =
          typeof stripeSubscription.customer === "string"
            ? stripeSubscription.customer
            : stripeSubscription.customer.id;
      } catch (error) {
        console.error(
          "[Billing] Refusing checkout because the existing Stripe subscription could not be verified:",
          error
        );
        res.status(409).json({
          error:
            "Your existing subscription could not be verified. Open billing or contact support before starting another plan.",
        });
        return;
      }
    }

    if (checkoutCustomerId) {
      let customerSubscriptions: Stripe.ApiList<Stripe.Subscription>;
      try {
        customerSubscriptions = await stripe.subscriptions.list({
          customer: checkoutCustomerId,
          status: "all",
          limit: 100,
        });
      } catch (error) {
        console.error(
          "[Billing] Refusing checkout because Stripe customer subscriptions could not be verified:",
          error
        );
        res.status(409).json({
          error:
            "Your billing account could not be verified. Open billing or contact support before starting another plan.",
        });
        return;
      }

      // Fail closed instead of overlooking additional subscriptions on another
      // page. More than 100 subscriptions requires manual support review.
      if (customerSubscriptions.has_more) {
        res.status(409).json({
          error:
            "Your billing history requires support review before starting another plan.",
        });
        return;
      }

      if (
        customerSubscriptions.data.some(
          subscription => !isTerminalSubscriptionStatus(subscription.status)
        )
      ) {
        const portal = await stripe.billingPortal.sessions.create({
          customer: checkoutCustomerId,
          return_url: `${origin}/dashboard`,
        });
        res.json({ url: portal.url, existingSubscription: true });
        return;
      }
    } else if (
      existingSub &&
      !["inactive", "canceled", "incomplete_expired"].includes(
        existingSub.status
      )
    ) {
      res.status(409).json({
        error:
          "Your existing subscription could not be verified. Contact support before starting another plan.",
      });
      return;
    }

    let reservation = await db.reserveSubscriptionCheckout(user.id, planParam);
    if (!reservation.created) {
      if (reservation.sessionId) {
        let existingSession: Stripe.Checkout.Session;
        try {
          existingSession = await stripe.checkout.sessions.retrieve(
            reservation.sessionId
          );
        } catch (error) {
          console.error(
            "[Billing] Existing checkout reservation could not be reconciled:",
            error
          );
          res.status(409).json({
            error:
              "An existing checkout could not be verified. Contact support before starting another plan.",
          });
          return;
        }

        const belongsToReservation =
          existingSession.client_reference_id === user.id.toString() &&
          existingSession.metadata?.checkout_reservation_key ===
            reservation.key;
        if (!belongsToReservation) {
          res.status(409).json({
            error:
              "An existing checkout could not be matched to this reservation. Contact support before retrying.",
          });
          return;
        }

        if (existingSession.status === "open") {
          if (reservation.planId !== planParam) {
            res.status(409).json({
              error:
                "A checkout for another plan is already open. Complete it or wait for it to expire.",
            });
            return;
          }
          res.json({ url: existingSession.url, existingCheckout: true });
          return;
        }
        if (existingSession.status === "complete") {
          const subscriptionRef = existingSession.subscription;
          if (!subscriptionRef) {
            res.status(409).json({
              error:
                "A completed checkout could not be reconciled automatically. Contact support before retrying.",
            });
            return;
          }
          const completedSubscription =
            typeof subscriptionRef === "string"
              ? await stripe.subscriptions.retrieve(subscriptionRef)
              : subscriptionRef;
          await syncSubscriptionToDb(completedSubscription);
          await db.clearSubscriptionCheckoutReservation(
            user.id,
            reservation.key
          );
          res.json({
            url: `${origin}/dashboard?checkout=processing`,
            existingCheckout: true,
          });
          return;
        }

        const replaced = await db.replaceSubscriptionCheckoutReservation(
          user.id,
          reservation.key,
          planParam
        );
        if (!replaced) {
          res.status(409).json({
            error: "Checkout state changed. Please try again.",
          });
          return;
        }
        reservation = replaced;
      } else if (db.canReplaceAmbiguousCheckoutReservation(reservation)) {
        const replaced = await db.replaceSubscriptionCheckoutReservation(
          user.id,
          reservation.key,
          planParam
        );
        if (!replaced) {
          res.status(409).json({
            error: "Checkout state changed. Please try again.",
          });
          return;
        }
        reservation = replaced;
      } else if (reservation.planId !== planParam) {
        res.status(409).json({
          error:
            "A checkout for another plan may already be in progress. Try again later or contact support.",
        });
        return;
      }
    }

    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: priceId, quantity: 1 }],
          allow_promotion_codes: true,
          client_reference_id: user.id.toString(),
          customer: checkoutCustomerId || undefined,
          customer_email: checkoutCustomerId
            ? undefined
            : (user.email ?? undefined),
          metadata: {
            user_id: user.id.toString(),
            plan_id: planParam,
            checkout_reservation_key: reservation.key,
          },
          subscription_data: {
            metadata: {
              user_id: user.id.toString(),
              plan_id: planParam,
              checkout_reservation_key: reservation.key,
            },
          },
          expires_at: Math.floor(reservation.expiresAt.getTime() / 1000),
          success_url: `${origin}/dashboard?checkout=success`,
          cancel_url: `${origin}/dashboard?checkout=cancelled`,
        },
        { idempotencyKey: reservation.key }
      );
      const ownsReservation = await db.storeSubscriptionCheckoutSession(
        user.id,
        reservation.key,
        session.id
      );
      if (!ownsReservation) {
        res.status(409).json({
          error:
            "Checkout state changed while the session was created. Please contact support before retrying.",
        });
        return;
      }
      res.json({ url: session.url });
    } catch (error) {
      const definitelyNotCreated =
        error instanceof Stripe.errors.StripeInvalidRequestError ||
        error instanceof Stripe.errors.StripeAuthenticationError ||
        error instanceof Stripe.errors.StripePermissionError;
      if (definitelyNotCreated) {
        await db.releaseSubscriptionCheckout(user.id, reservation.key);
      } else {
        // Ambiguous failures retain the key. A same-plan retry reuses Stripe's
        // idempotency result instead of risking a second subscription.
        console.warn(
          "[Billing] Keeping checkout reservation after ambiguous Stripe failure"
        );
      }
      throw error;
    }
  } catch (e) {
    console.error("[Billing] Checkout error:", e);
    res.status(500).json({ error: "Could not start checkout" });
  }
}

/** Create a one-time additional-video checkout. */
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

/** Return Stripe's exact period and a fail-closed classification of its price. */
export async function getStripeGenerationEntitlement(userId: number): Promise<{
  periodStart: Date;
  periodEnd: Date;
  enforceAllowance: boolean;
  planId?: PlanId;
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
  if (
    !item ||
    item.quantity !== 1 ||
    !item.current_period_start ||
    !item.current_period_end
  )
    return null;

  const classified = classifyGenerationPrice(item.price);
  if (!classified) return null;
  return {
    periodStart: new Date(item.current_period_start * 1000),
    periodEnd: new Date(item.current_period_end * 1000),
    enforceAllowance: classified.enforceAllowance,
    ...(classified.enforceAllowance ? { planId: classified.planId } : {}),
  };
}

/** Verify an exact paid current $17 or legacy $15 add-on checkout. */
export async function verifyAdditionalVideoCheckout(
  sessionId: string,
  userId: number
): Promise<boolean> {
  if (!sessionId.startsWith("cs_")) return false;

  const stripe = getStripe();
  const [session, lineItems] = await Promise.all([
    stripe.checkout.sessions.retrieve(sessionId),
    stripe.checkout.sessions.listLineItems(sessionId, { limit: 2 }),
  ]);
  const item = lineItems.data[0];
  const itemPrice =
    typeof item?.price === "string"
      ? await stripe.prices.retrieve(item.price)
      : item?.price;
  const recognizedAmount = itemPrice
    ? recognizedAdditionalVideoAmount(itemPrice)
    : null;

  return (
    recognizedAmount !== null &&
    session.mode === "payment" &&
    session.payment_status === "paid" &&
    session.currency === "usd" &&
    session.amount_total === recognizedAmount &&
    lineItems.data.length === 1 &&
    item?.quantity === 1 &&
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

/** Change an existing Stripe subscription to a recognized current plan. */
export async function changeSubscriptionPlan(
  userId: number,
  planId: PlanId
): Promise<void> {
  const stored = await db.getSubscription(userId);
  if (!stored?.stripeSubscriptionId) {
    throw new Error("This user does not have a Stripe subscription to change");
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(
    stored.stripeSubscriptionId
  );
  if (subscription.items.data.length !== 1) {
    throw new Error("Only subscriptions with one plan item can be changed");
  }

  const priceId = await ensurePrice(planId);
  const updated = await stripe.subscriptions.update(subscription.id, {
    items: [{ id: subscription.items.data[0].id, price: priceId, quantity: 1 }],
    proration_behavior: "create_prorations",
    metadata: {
      ...subscription.metadata,
      user_id: userId.toString(),
      plan_id: planId,
    },
  });
  await syncSubscriptionToDb(updated);
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
  const periodStart = sub.items.data[0]?.current_period_start;
  const periodEnd = sub.items.data[0]?.current_period_end;
  await db.upsertSubscription(userId, {
    stripeCustomerId:
      typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    plan,
    status: sub.status,
    ...(periodStart
      ? { currentPeriodStart: new Date(periodStart * 1000) }
      : {}),
    ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
  });
  const checkoutReservationKey = sub.metadata?.checkout_reservation_key;
  if (
    !isTerminalSubscriptionStatus(sub.status) &&
    checkoutReservationKey
  ) {
    await db.clearSubscriptionCheckoutReservation(
      userId,
      checkoutReservationKey
    );
  }
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
          // Ensure user and reservation correlation survive even if Stripe
          // omitted subscription metadata from an older Checkout Session.
          const metadata = { ...sub.metadata };
          let metadataChanged = false;
          if (!metadata.user_id && session.client_reference_id) {
            metadata.user_id = session.client_reference_id;
            metadataChanged = true;
          }
          const reservationKey =
            session.metadata?.checkout_reservation_key;
          if (!metadata.checkout_reservation_key && reservationKey) {
            metadata.checkout_reservation_key = reservationKey;
            metadataChanged = true;
          }
          if (metadataChanged) {
            await getStripe().subscriptions.update(subId, { metadata });
            sub.metadata = metadata;
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
