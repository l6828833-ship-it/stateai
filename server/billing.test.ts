import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_VIDEO_LOOKUP_KEY,
  ADDITIONAL_VIDEO_PRICE_USD,
  PLANS,
  PLAN_BY_ID,
} from "../shared/plans";
import {
  classifyGenerationPrice,
  getAnchoredMonthlyUsageWindowStart,
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
    type: "recurring",
    unit_amount: input.amount,
    recurring: {
      interval: input.interval,
      interval_count: 1,
      meter: null,
      trial_period_days: null,
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
    type: "one_time",
    unit_amount: input.amount,
    recurring: null,
  } as unknown as Stripe.Price;
}

describe("billing catalog", () => {
  it("defines all six immutable v3 plans with exact prices and allowances", () => {
    expect(
      PLANS.map(({ id, lookupKey, totalPrice, interval, includedVideos }) => ({
        id,
        lookupKey,
        totalPrice,
        interval,
        includedVideos,
      }))
    ).toEqual([
      {
        id: "starter_monthly",
        lookupKey: "estatetour_starter_monthly_v3",
        totalPrice: 39,
        interval: "month",
        includedVideos: 3,
      },
      {
        id: "creator_monthly",
        lookupKey: "estatetour_creator_monthly_v3",
        totalPrice: 89,
        interval: "month",
        includedVideos: 8,
      },
      {
        id: "studio_monthly",
        lookupKey: "estatetour_studio_monthly_v3",
        totalPrice: 179,
        interval: "month",
        includedVideos: 20,
      },
      {
        id: "starter_yearly",
        lookupKey: "estatetour_starter_yearly_v3",
        totalPrice: 348,
        interval: "year",
        includedVideos: 3,
      },
      {
        id: "creator_yearly",
        lookupKey: "estatetour_creator_yearly_v3",
        totalPrice: 780,
        interval: "year",
        includedVideos: 8,
      },
      {
        id: "studio_yearly",
        lookupKey: "estatetour_studio_yearly_v3",
        totalPrice: 1620,
        interval: "year",
        includedVideos: 20,
      },
    ]);
    expect(PLAN_BY_ID.creator_monthly.highlighted).toBe(true);
    expect(PLAN_BY_ID.creator_monthly.aLaCarteMonthlyValue).toBe(136);
    expect(PLAN_BY_ID.creator_yearly.yearlyDiscountPercent).toBe(27);
    expect(ADDITIONAL_VIDEO_PRICE_USD).toBe(17);
    expect(ADDITIONAL_VIDEO_LOOKUP_KEY).toBe("estatetour_additional_video_v3");
  });

  it("uses the same feature set for every tier and cadence", () => {
    for (const plan of PLANS) {
      expect(plan.features).toContain(
        `${plan.includedVideos} videos per month`
      );
      expect(plan.features).toContain("$17 per additional video");
      expect(plan.maxResolution).toBe("1080p");
    }
  });
});

describe("exact Stripe price classification", () => {
  it("classifies every current v3 lookup key with its monthly allowance", () => {
    for (const plan of PLANS) {
      expect(
        classifyGenerationPrice(
          recurringPrice({
            lookupKey: plan.lookupKey,
            amount: plan.totalPrice * 100,
            interval: plan.interval,
          })
        )
      ).toEqual({
        planId: plan.id,
        enforceAllowance: true,
        allowance: plan.includedVideos,
        usageWindow: "anchored_month",
      });
    }
  });

  it("preserves exact v2 allowances and exact v1 subscriptions", () => {
    expect(
      classifyGenerationPrice(
        recurringPrice({
          lookupKey: "estatetour_annual_v2",
          amount: 2900,
          interval: "year",
          active: false,
        })
      )
    ).toEqual({
      planId: "annual",
      enforceAllowance: true,
      allowance: 36,
      usageWindow: "stripe_period",
    });
    expect(
      classifyGenerationPrice(
        recurringPrice({
          lookupKey: "estatetour_pro_v2",
          amount: 3900,
          interval: "month",
          active: false,
        })
      )
    ).toEqual({
      planId: "pro",
      enforceAllowance: true,
      allowance: 3,
      usageWindow: "stripe_period",
    });
    expect(
      classifyGenerationPrice(
        recurringPrice({
          lookupKey: "estatetour_business_v1",
          amount: 9900,
          interval: "month",
          active: false,
        })
      )
    ).toEqual({
      planId: "business",
      enforceAllowance: false,
      usageWindow: "stripe_period",
    });
  });

  it("fails closed for unknown or inexact prices while honoring archived subscriptions", () => {
    const exact = recurringPrice({
      lookupKey: "estatetour_starter_yearly_v3",
      amount: 34800,
      interval: "year",
    });
    expect(
      classifyGenerationPrice({ ...exact, lookup_key: "unknown" })
    ).toBeNull();
    expect(classifyGenerationPrice({ ...exact, active: false })).toEqual({
      planId: "starter_yearly",
      enforceAllowance: true,
      allowance: 3,
      usageWindow: "anchored_month",
    });
    expect(
      classifyGenerationPrice({ ...exact, unit_amount: 34799 })
    ).toBeNull();
    expect(
      classifyGenerationPrice({
        ...exact,
        recurring: { ...exact.recurring!, interval_count: 2 },
      })
    ).toBeNull();
  });
});

describe("additional-video price compatibility", () => {
  it("issues v3 at $17 while honoring exact paid v2 $15 sessions", () => {
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

describe("UTC-anchored monthly usage windows", () => {
  it("uses the latest monthly anniversary without local-time ambiguity", () => {
    const anchor = new Date("2026-01-15T10:30:45.123Z");
    expect(
      getAnchoredMonthlyUsageWindowStart(
        anchor,
        new Date("2026-04-15T10:30:45.122Z")
      )?.toISOString()
    ).toBe("2026-03-15T10:30:45.123Z");
    expect(
      getAnchoredMonthlyUsageWindowStart(
        anchor,
        new Date("2026-04-15T10:30:45.123Z")
      )?.toISOString()
    ).toBe("2026-04-15T10:30:45.123Z");
  });

  it("clamps short months directly from the original anchor without drift", () => {
    const anchor = new Date("2024-01-31T23:00:00.000Z");
    expect(
      getAnchoredMonthlyUsageWindowStart(
        anchor,
        new Date("2024-02-29T23:00:00.000Z")
      )?.toISOString()
    ).toBe("2024-02-29T23:00:00.000Z");
    expect(
      getAnchoredMonthlyUsageWindowStart(
        anchor,
        new Date("2024-03-31T23:00:00.000Z")
      )?.toISOString()
    ).toBe("2024-03-31T23:00:00.000Z");
  });

  it("fails closed for invalid or pre-subscription timestamps", () => {
    expect(
      getAnchoredMonthlyUsageWindowStart(
        new Date("2026-05-01T00:00:00.000Z"),
        new Date("2026-04-30T23:59:59.999Z")
      )
    ).toBeNull();
    expect(getAnchoredMonthlyUsageWindowStart(new Date(Number.NaN))).toBeNull();
  });
});
