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
    expect(PLAN_BY_ID.starter_monthly.price).toBe(29);
    expect(PLAN_BY_ID.starter_monthly.interval).toBe("month");
    expect(PLAN_BY_ID.starter_monthly.videoAllowance).toBe(
      "3 videos per month"
    );
    expect(PLAN_BY_ID.starter_yearly.price).toBe(348);
    expect(PLAN_BY_ID.starter_yearly.interval).toBe("year");
    expect(PLAN_BY_ID.starter_yearly.videoAllowance).toBe("36 videos per year");
    expect(PLAN_BY_ID.creator_monthly.name).toBe("Pro");
    expect(PLAN_BY_ID.creator_monthly.price).toBe(69);
    expect(PLAN_BY_ID.creator_yearly.price).toBe(588);
    expect(PLAN_BY_ID.creator_monthly.includedVideos).toBe(7);
    expect(PLAN_BY_ID.creator_monthly.maxImages).toBe(12);
    expect(PLAN_BY_ID.creator_monthly.maxDurationSeconds).toBe(25);
    expect(PLAN_BY_ID.creator_monthly.additionalVideoPriceUsd).toBe(14);
    expect(PLAN_BY_ID.studio_monthly.name).toBe("Premium");
    expect(PLAN_BY_ID.studio_monthly.price).toBe(99);
    expect(PLAN_BY_ID.studio_yearly.price).toBe(948);
    expect(PLAN_BY_ID.studio_yearly.includedVideos).toBe(180);
    expect(PLAN_BY_ID.studio_monthly.maxImages).toBe(17);
    expect(PLAN_BY_ID.studio_monthly.maxDurationSeconds).toBe(30);
    expect(PLAN_BY_ID.studio_monthly.additionalVideoPriceUsd).toBe(10);
  });

  it("highlights the Pro tier in both billing intervals", () => {
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
  it("honors archived exact current and v3 contract prices", () => {
    const v4Contracts = [
      ["starter_monthly", 2900, "month", 3, 6, 15, 17],
      ["starter_yearly", 34800, "year", 36, 6, 15, 17],
      ["creator_monthly", 6900, "month", 7, 12, 25, 14],
      ["creator_yearly", 58800, "year", 84, 12, 25, 14],
      ["studio_monthly", 9900, "month", 15, 17, 30, 10],
      ["studio_yearly", 94800, "year", 180, 17, 30, 10],
    ] as const;
    for (const [
      planId,
      amount,
      interval,
      includedVideos,
      maxImages,
      maxDurationSeconds,
      additionalVideoPriceUsd,
    ] of v4Contracts) {
      expect(
        classifyGenerationPrice(
          recurringPrice({
            lookupKey: `estatetour_${planId}_v4`,
            amount,
            interval,
            active: false,
          })
        )
      ).toEqual(
        expect.objectContaining({
          storedPlanId: planId,
          planId,
          enforceAllowance: true,
          includedVideos,
          maxImages,
          maxDurationSeconds,
          additionalVideoPriceUsd,
        })
      );
    }

    expect(
      classifyGenerationPrice(
        recurringPrice({
          lookupKey: "estatetour_creator_monthly_v3",
          amount: 3900,
          interval: "month",
          active: false,
        })
      )
    ).toEqual(
      expect.objectContaining({
        storedPlanId: "creator_monthly",
        enforceAllowance: true,
        includedVideos: 10,
        maxImages: 6,
        maxDurationSeconds: 15,
        additionalVideoPriceUsd: 17,
      })
    );
  });

  it("fails closed for malformed current and legacy prices", () => {
    const current = recurringPrice({
      lookupKey: "estatetour_creator_monthly_v4",
      amount: 6900,
      interval: "month",
    });
    expect(classifyGenerationPrice(current)).toEqual(
      expect.objectContaining({
        storedPlanId: "creator_monthly",
        planId: "creator_monthly",
        enforceAllowance: true,
        includedVideos: 7,
      })
    );
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
    expect(classifyGenerationPrice(legacy)).toEqual(
      expect.objectContaining({
        storedPlanId: "pro",
        enforceAllowance: false,
        maxImages: 6,
        maxDurationSeconds: 15,
      })
    );
    expect(
      classifyGenerationPrice({ ...legacy, type: "one_time", recurring: null })
    ).toBeNull();
  });
});

describe("additional-video price compatibility", () => {
  it("honors exact v4 tier, v3 $17, and legacy $15 purchases only", () => {
    expect(
      recognizedAdditionalVideoAmount(
        oneTimePrice({
          lookupKey: "estatetour_additional_video_premium_v4",
          amount: 1000,
          active: false,
        })
      )
    ).toBe(1000);
    expect(
      recognizedAdditionalVideoAmount(
        oneTimePrice({
          lookupKey: "estatetour_additional_video_pro_v4",
          amount: 1400,
          active: false,
        })
      )
    ).toBe(1400);
    expect(
      recognizedAdditionalVideoAmount(
        oneTimePrice({
          lookupKey: "estatetour_additional_video_starter_v4",
          amount: 1700,
          active: false,
        })
      )
    ).toBe(1700);
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
