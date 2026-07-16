import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { PLANS, PLAN_BY_ID } from "../shared/plans";
import {
  classifyGenerationPrice,
  recognizedAdditionalVideoAmount,
} from "./billing";

function recurringPrice(input: {
  lookupKey: string;
  amount: number;
  interval: "month" | "year";
  active?: boolean;
}): Stripe.Price {
  return {
    active: input.active ?? true,
    billing_scheme: "per_unit",
    currency: "usd",
    lookup_key: input.lookupKey,
    transform_quantity: null,
    type: "recurring",
    unit_amount: input.amount,
    recurring: {
      interval: input.interval,
      interval_count: 1,
      usage_type: "licensed",
    },
  } as unknown as Stripe.Price;
}

function oneTimePrice(input: {
  lookupKey: string;
  amount: number;
  active?: boolean;
}): Stripe.Price {
  return {
    active: input.active ?? true,
    billing_scheme: "per_unit",
    currency: "usd",
    lookup_key: input.lookupKey,
    transform_quantity: null,
    type: "one_time",
    unit_amount: input.amount,
    recurring: null,
  } as unknown as Stripe.Price;
}

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

describe("exact Stripe price classification", () => {
  it("honors an archived exact current-plan price", () => {
    expect(
      classifyGenerationPrice(
        recurringPrice({
          lookupKey: "estatetour_starter_yearly_v3",
          amount: 15600,
          interval: "year",
          active: false,
        })
      )
    ).toEqual({ planId: "starter_yearly", enforceAllowance: true });
  });

  it("fails closed for malformed current and legacy prices", () => {
    const current = recurringPrice({
      lookupKey: "estatetour_creator_monthly_v3",
      amount: 3900,
      interval: "month",
    });
    expect(classifyGenerationPrice(current)).toEqual({
      planId: "creator_monthly",
      enforceAllowance: true,
    });
    expect(
      classifyGenerationPrice({ ...current, billing_scheme: "tiered" })
    ).toBeNull();
    expect(
      classifyGenerationPrice({
        ...current,
        transform_quantity: { divide_by: 2, round: "up" },
      })
    ).toBeNull();
    expect(
      classifyGenerationPrice({ ...current, unit_amount: 3899 })
    ).toBeNull();
    expect(
      classifyGenerationPrice({
        ...current,
        recurring: { ...current.recurring!, interval_count: 2 },
      })
    ).toBeNull();

    const legacy = recurringPrice({
      lookupKey: "estatetour_pro_v2",
      amount: 3900,
      interval: "month",
      active: false,
    });
    expect(classifyGenerationPrice(legacy)).toEqual({
      planId: "pro",
      enforceAllowance: false,
    });
    expect(
      classifyGenerationPrice({ ...legacy, type: "one_time", recurring: null })
    ).toBeNull();
  });
});

describe("additional-video price compatibility", () => {
  it("honors exact current $17 and legacy $15 purchases only", () => {
    expect(
      recognizedAdditionalVideoAmount(
        oneTimePrice({
          lookupKey: "estatetour_additional_video_v3",
          amount: 1700,
          active: false,
        })
      )
    ).toBe(1700);
    expect(
      recognizedAdditionalVideoAmount(
        oneTimePrice({
          lookupKey: "estatetour_additional_video_v2",
          amount: 1500,
          active: false,
        })
      )
    ).toBe(1500);
    expect(
      recognizedAdditionalVideoAmount(
        oneTimePrice({
          lookupKey: "estatetour_additional_video_v2",
          amount: 1700,
        })
      )
    ).toBeNull();
  });
});
