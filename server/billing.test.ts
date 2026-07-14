import { describe, expect, it } from "vitest";
import { PLANS, PLAN_BY_ID } from "../shared/plans";

describe("billing plans", () => {
  it("defines exactly the 4 required plans with correct pricing", () => {
    expect(PLANS).toHaveLength(4);
    expect(PLAN_BY_ID.starter.price).toBe(9);
    expect(PLAN_BY_ID.starter.interval).toBe("month");
    expect(PLAN_BY_ID.pro.price).toBe(39);
    expect(PLAN_BY_ID.pro.interval).toBe("month");
    expect(PLAN_BY_ID.annual.price).toBe(29);
    expect(PLAN_BY_ID.annual.interval).toBe("year");
    expect(PLAN_BY_ID.business.price).toBe(99);
    expect(PLAN_BY_ID.business.interval).toBe("month");
  });

  it("highlights the Pro plan in the pricing table", () => {
    expect(PLAN_BY_ID.pro.highlighted).toBe(true);
  });

  it("has a Stripe secret key configured in the environment", () => {
    expect(process.env.STRIPE_SECRET_KEY, "STRIPE_SECRET_KEY must be set").toBeTruthy();
    expect(process.env.STRIPE_SECRET_KEY!.startsWith("sk_")).toBe(true);
  });
});

describe("stripe connectivity", () => {
  it("can authenticate with the Stripe API", async () => {
    const { getStripe } = await import("./billing");
    const stripe = getStripe();
    const balance = await stripe.balance.retrieve();
    expect(balance.object).toBe("balance");
  });

  it("can create (or reuse) the price for each plan", async () => {
    const { ensurePrice } = await import("./billing");
    for (const plan of PLANS) {
      const priceId = await ensurePrice(plan.id);
      expect(priceId).toMatch(/^price_/);
    }
  }, 30000);
});
