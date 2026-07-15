import { describe, expect, it } from "vitest";
import { PLANS, PLAN_BY_ID } from "../shared/plans";

describe("billing plans", () => {
  it("defines the yearly and monthly plans with correct pricing", () => {
    expect(PLANS).toHaveLength(2);
    expect(PLANS.map((plan) => plan.id)).toEqual(["annual", "pro"]);
    expect(PLAN_BY_ID.annual.price).toBe(29);
    expect(PLAN_BY_ID.annual.interval).toBe("year");
    expect(PLAN_BY_ID.annual.videoAllowance).toBe("36 videos per year");
    expect(PLAN_BY_ID.pro.price).toBe(39);
    expect(PLAN_BY_ID.pro.interval).toBe("month");
    expect(PLAN_BY_ID.pro.videoAllowance).toBe("3 videos per month");
  });

  it("places and highlights the yearly plan first", () => {
    expect(PLANS[0].id).toBe("annual");
    expect(PLAN_BY_ID.annual.highlighted).toBe(true);
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
