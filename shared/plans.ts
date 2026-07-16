/** Immutable subscription catalog shared by pricing UI and Stripe wiring. */

export type PlanTier = "starter" | "creator" | "studio";
export type BillingCadence = "month" | "year";
export type PlanId =
  | "starter_monthly"
  | "creator_monthly"
  | "studio_monthly"
  | "starter_yearly"
  | "creator_yearly"
  | "studio_yearly";

export interface Plan {
  readonly id: PlanId;
  readonly lookupKey: string;
  readonly name: string;
  readonly tier: PlanTier;
  readonly cadence: BillingCadence;
  /** Compatibility alias used by existing Stripe/UI code. */
  readonly interval: BillingCadence;
  /** Total amount charged each billing cadence, in whole USD. */
  readonly totalPrice: number;
  /** Compatibility alias for totalPrice. */
  readonly price: number;
  readonly monthlyEquivalent: number;
  /** Rounded savings for yearly billing versus twelve monthly payments. */
  readonly yearlyDiscountPercent: number;
  /** Monthly allowance priced à la carte at the flat additional-video rate. */
  readonly aLaCarteMonthlyValue: number;
  /** Rounded monthly-plan savings versus buying the same videos à la carte. */
  readonly discountVsALaCartePercent: number;
  readonly priceLabel: string;
  readonly tagline: string;
  readonly videoAllowance: string;
  /** Generations available in each monthly usage window, including yearly plans. */
  readonly includedVideos: number;
  readonly maxResolution: "1080p";
  readonly features: readonly string[];
  readonly highlighted?: boolean;
  readonly badge?: string;
}

export const ADDITIONAL_VIDEO_PRICE_USD = 17 as const;
export const ADDITIONAL_VIDEO_LOOKUP_KEY =
  "estatetour_additional_video_v3" as const;

export const SHARED_PLAN_FEATURES = Object.freeze([
  "6 images per video",
  "1080p, high quality",
  "Up to 15 seconds",
  "All ratios: 9:16, 1:1, and 16:9",
  "Best viral effects per video",
  "No watermark",
  `$${ADDITIONAL_VIDEO_PRICE_USD} per additional video`,
] as const);

const TIER_DATA = Object.freeze({
  starter: {
    name: "Starter",
    includedVideos: 3,
    monthly: 39,
    yearly: 348,
    equivalent: 29,
    yearlyDiscountPercent: 26,
    aLaCarteMonthlyValue: 51,
    discountVsALaCartePercent: 24,
  },
  creator: {
    name: "Creator",
    includedVideos: 8,
    monthly: 89,
    yearly: 780,
    equivalent: 65,
    yearlyDiscountPercent: 27,
    aLaCarteMonthlyValue: 136,
    discountVsALaCartePercent: 35,
  },
  studio: {
    name: "Studio",
    includedVideos: 20,
    monthly: 179,
    yearly: 1620,
    equivalent: 135,
    yearlyDiscountPercent: 25,
    aLaCarteMonthlyValue: 340,
    discountVsALaCartePercent: 47,
  },
} as const);

function makePlan(tier: PlanTier, cadence: BillingCadence): Plan {
  const data = TIER_DATA[tier];
  const id = `${tier}_${cadence === "month" ? "monthly" : "yearly"}` as PlanId;
  const totalPrice = cadence === "month" ? data.monthly : data.yearly;
  const monthlyEquivalent =
    cadence === "month" ? data.monthly : data.equivalent;
  return Object.freeze({
    id,
    lookupKey: `estatetour_${id}_v3`,
    name: data.name,
    tier,
    cadence,
    interval: cadence,
    totalPrice,
    price: totalPrice,
    monthlyEquivalent,
    yearlyDiscountPercent: data.yearlyDiscountPercent,
    aLaCarteMonthlyValue: data.aLaCarteMonthlyValue,
    discountVsALaCartePercent: data.discountVsALaCartePercent,
    priceLabel:
      cadence === "month"
        ? `$${totalPrice}/month`
        : `$${totalPrice}/year ($${monthlyEquivalent}/mo)`,
    tagline:
      cadence === "month"
        ? "Flexible monthly billing"
        : "Save with annual billing",
    videoAllowance: `${data.includedVideos} videos per month`,
    includedVideos: data.includedVideos,
    maxResolution: "1080p",
    features: Object.freeze([
      `${data.includedVideos} videos per month`,
      ...SHARED_PLAN_FEATURES,
    ]),
    ...(tier === "creator" ? { highlighted: true, badge: "Most Popular" } : {}),
  });
}

export const PLANS: readonly Plan[] = Object.freeze([
  makePlan("starter", "month"),
  makePlan("creator", "month"),
  makePlan("studio", "month"),
  makePlan("starter", "year"),
  makePlan("creator", "year"),
  makePlan("studio", "year"),
]);

export const PLAN_BY_ID: Readonly<Record<PlanId, Plan>> = Object.freeze(
  Object.fromEntries(PLANS.map(plan => [plan.id, plan])) as Record<PlanId, Plan>
);

/** Tour styles — labels must be exactly these three. */
export const TOUR_STYLES = ["Walkthrough", "Drone", "Cinematic"] as const;
export type TourStyleId = (typeof TOUR_STYLES)[number];

export const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

export const MAX_IMAGES = 6;
export const MAX_IMAGE_SIZE_MB = 10;
export const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
/** Maximum base64 characters needed to encode MAX_IMAGE_BYTES (without a data-URL prefix). */
export const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
