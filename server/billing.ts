import Stripe from "stripe";
import type { Request, Response } from "express";
import { PLAN_BY_ID, PLANS, type PlanId } from "@shared/plans";
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

export async function ensurePrice(planId: PlanId): Promise<string> {
  const cached = priceCache.get(planId);
  if (cached) return cached;

  const stripe = getStripe();
  const plan = PLAN_BY_ID[planId];
  const lookupKey = `estatetour_${planId}_v1`;

  const existing = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 1 });
  if (existing.data.length > 0) {
    priceCache.set(planId, existing.data[0].id);
    return existing.data[0].id;
  }

  const product = await stripe.products.create({
    name: `EstateTour AI — ${plan.name}`,
    description: `${plan.videosPerMonth} · up to ${plan.maxResolution}`,
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
  priceCache.set(planId, price.id);
  return price.id;
}

function isPlanId(v: string): v is PlanId {
  return PLANS.some((p) => p.id === v);
}

function getOrigin(req: Request): string {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin;
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const host = req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

/** POST /api/billing/checkout?plan=pro — requires authenticated ctx user. */
export async function handleCheckout(
  req: Request,
  res: Response,
  user: { id: number; email: string | null; name: string | null },
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
      customer_email: existingSub?.stripeCustomerId ? undefined : (user.email ?? undefined),
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

/** POST /api/billing/portal — opens the Stripe billing portal. */
export async function handlePortal(req: Request, res: Response, user: { id: number }) {
  try {
    const sub = await db.getSubscription(user.id);
    if (!sub?.stripeCustomerId) {
      res.status(400).json({ error: "No billing account yet — subscribe to a plan first" });
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

/** Resolve plan id from a Stripe subscription's price metadata/lookup key. */
function planFromSubscription(sub: Stripe.Subscription): PlanId | null {
  const item = sub.items.data[0];
  const meta = (sub.metadata?.plan_id || item?.price?.metadata?.plan_id || "") as string;
  if (isPlanId(meta)) return meta;
  const lookup = item?.price?.lookup_key ?? "";
  const m = lookup.match(/^estatetour_(\w+)_v1$/);
  if (m && isPlanId(m[1])) return m[1];
  return null;
}

async function syncSubscriptionToDb(sub: Stripe.Subscription) {
  const userIdRaw = sub.metadata?.user_id;
  let userId = userIdRaw ? Number(userIdRaw) : NaN;

  if (!Number.isFinite(userId)) {
    // Fall back: find user via existing customer mapping.
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
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
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    ...(plan ? { plan } : {}),
    status: sub.status,
    ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000) } : {}),
  });
  console.log(`[Billing] Synced subscription ${sub.id} for user ${userId}: ${sub.status}`);
}

/** POST /api/stripe/webhook — raw body required for signature verification. */
export async function handleWebhook(req: Request, res: Response) {
  const signature = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: Stripe.Event;
  try {
    if (!secret || !signature) throw new Error("Missing webhook secret or signature");
    event = getStripe().webhooks.constructEvent(req.body, signature as string, secret);
  } catch (e) {
    console.error("[Webhook] Signature verification failed:", e);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  // Test events must return the verification response.
  if (event.id.startsWith("evt_test_")) {
    console.log("[Webhook] Test event detected, returning verification response");
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
              metadata: { ...sub.metadata, user_id: session.client_reference_id },
            });
            sub.metadata = { ...sub.metadata, user_id: session.client_reference_id };
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
        const subId = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
        if (subId) {
          const sub = await getStripe().subscriptions.retrieve(
            typeof subId === "string" ? subId : subId.id,
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
