import { describe, expect, it } from "vitest";
import { PLANS, PLAN_BY_ID } from "../shared/plans";

describe("billing plans", () => {
  it("defines three tiers for monthly and yearly billing", () => {
    expect(PLANS).toHaveLength(6);
    expect(PLANS.map(plan => plan.id)).toEqual([
      "starter_monthly",
      "creator_monthly",
      "studio_monthly",
      "starter_yearly",
      "creator_yearly",
      "studio_yearly",
    ]);
    expect(PLAN_BY_ID.starter_monthly.price).toBe(17);
    expect(PLAN_BY_ID.starter_monthly.interval).toBe("month");
    expect(PLAN_BY_ID.starter_monthly.videoAllowance).toBe(
      "3 videos per month"
    );
    expect(PLAN_BY_ID.starter_yearly.price).toBe(156);
    expect(PLAN_BY_ID.starter_yearly.interval).toBe("year");
    expect(PLAN_BY_ID.starter_yearly.videoAllowance).toBe("36 videos per year");
  });

  it("highlights the Creator tier in both billing intervals", () => {
    expect(PLAN_BY_ID.creator_monthly.highlighted).toBe(true);
    expect(PLAN_BY_ID.creator_yearly.highlighted).toBe(true);
  });

  it("has a Stripe secret key configured in the environment", () => {
    expect(
      process.env.STRIPE_SECRET_KEY,
      "STRIPE_SECRET_KEY must be set"
    ).toBeTruthy();
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
