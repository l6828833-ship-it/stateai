/** Subscription plans shared by pricing UI, generation limits, and Stripe. */

export type BillingInterval = "month" | "year";
export type PlanTier = "starter" | "creator" | "studio";
export type PlanId = `${PlanTier}_${"monthly" | "yearly"}`;

export interface Plan {
  id: PlanId;
  tier: PlanTier;
  name: string;
  price: number;
  originalPrice: number;
  interval: BillingInterval;
  priceLabel: string;
  tagline: string;
  videoAllowance: string;
  includedVideos: number;
  monthlyVideos: number;
  maxImages: number;
  maxDurationSeconds: number;
  additionalVideoPriceUsd: number;
  maxResolution: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
}

const TIER_CONFIG = {
  starter: {
    name: "Starter",
    tagline: "For standout individual listings",
    monthlyPrice: 39,
    yearlyMonthlyPrice: 29,
    videos: 3,
    maxImages: 6,
    maxDurationSeconds: 15,
    additionalVideoPriceUsd: 17,
  },
  creator: {
    name: "Pro",
    tagline: "For active agents and creators",
    monthlyPrice: 69,
    yearlyMonthlyPrice: 49,
    videos: 7,
    maxImages: 12,
    maxDurationSeconds: 25,
    additionalVideoPriceUsd: 14,
  },
  studio: {
    name: "Premium",
    tagline: "For teams and high-volume studios",
    monthlyPrice: 99,
    yearlyMonthlyPrice: 79,
    videos: 15,
    maxImages: 17,
    maxDurationSeconds: 30,
    additionalVideoPriceUsd: 10,
  },
} as const;

const originalPriceFor = (price: number) => Math.ceil(price / 0.38);

function featuresForTier(tier: PlanTier, interval: BillingInterval): string[] {
  const config = TIER_CONFIG[tier];
  const allowance =
    interval === "year"
      ? `${config.videos} videos per month (${config.videos * 12} per annual billing period)`
      : `${config.videos} videos per month`;
  return [
    allowance,
    `${config.maxImages} images per video`,
    ...(tier === "studio" ? ["Team-ready volume"] : []),
    `1080p high quality, up to ${config.maxDurationSeconds} seconds`,
    "All ratios: 9:16, 1:1, and 16:9",
    "Best viral effects per video",
    `$${config.additionalVideoPriceUsd} per additional video`,
    "No watermark",
  ];
}

export const MONTHLY_PLANS: Plan[] = (
  Object.keys(TIER_CONFIG) as PlanTier[]
).map(tier => {
  const config = TIER_CONFIG[tier];
  const price = config.monthlyPrice;
  return {
    id: `${tier}_monthly`,
    tier,
    name: config.name,
    price,
    originalPrice: originalPriceFor(price),
    interval: "month",
    priceLabel: `$${price}/month`,
    tagline: config.tagline,
    videoAllowance: `${config.videos} videos per month`,
    includedVideos: config.videos,
    monthlyVideos: config.videos,
    maxImages: config.maxImages,
    maxDurationSeconds: config.maxDurationSeconds,
    additionalVideoPriceUsd: config.additionalVideoPriceUsd,
    maxResolution: "1080p",
    highlighted: tier === "creator",
    badge: tier === "creator" ? "Most popular" : undefined,
    features: featuresForTier(tier, "month"),
  };
});

export const YEARLY_PLANS: Plan[] = (
  Object.keys(TIER_CONFIG) as PlanTier[]
).map(tier => {
  const config = TIER_CONFIG[tier];
  const price = config.yearlyMonthlyPrice * 12;
  return {
    id: `${tier}_yearly`,
    tier,
    name: config.name,
    price,
    originalPrice: originalPriceFor(config.yearlyMonthlyPrice) * 12,
    interval: "year",
    priceLabel: `$${config.yearlyMonthlyPrice}/month, billed yearly`,
    tagline:
      config.yearlyMonthlyPrice < config.monthlyPrice
        ? `${config.tagline} · save with annual billing`
        : `${config.tagline} · annual billing`,
    videoAllowance: `${config.videos * 12} videos per year`,
    includedVideos: config.videos * 12,
    monthlyVideos: config.videos,
    maxImages: config.maxImages,
    maxDurationSeconds: config.maxDurationSeconds,
    additionalVideoPriceUsd: config.additionalVideoPriceUsd,
    maxResolution: "1080p",
    highlighted: tier === "creator",
    badge: tier === "creator" ? "Best value" : undefined,
    features: featuresForTier(tier, "year"),
  };
});

export const PLANS: Plan[] = [...MONTHLY_PLANS, ...YEARLY_PLANS];

export const PLAN_BY_ID = Object.fromEntries(
  PLANS.map(plan => [plan.id, plan])
) as Record<PlanId, Plan>;

export function plansForInterval(interval: BillingInterval): Plan[] {
  return interval === "year" ? YEARLY_PLANS : MONTHLY_PLANS;
}

export function isPlanId(value: string): value is PlanId {
  return value in PLAN_BY_ID;
}

export function planForStoredId(value: string | null | undefined): Plan | null {
  return value && isPlanId(value) ? PLAN_BY_ID[value] : null;
}

/** Tour styles — labels must be exactly these three. */
export const TOUR_STYLES = ["Walkthrough", "Drone", "Cinematic"] as const;
export type TourStyleId = (typeof TOUR_STYLES)[number];

export const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const DURATIONS = [4, 5, 6, 8, 10, 12, 15, 25, 30] as const;

/** Free/guest fallback; paid plans can allow more through their entitlement. */
export const MAX_IMAGES = 6;
export const MAX_IMAGE_SIZE_MB = 10;
export const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
export const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
export const ADDITIONAL_VIDEO_PRICE_USD = 17;
export const PROMOTIONAL_DISCOUNT_PERCENT = 62;
export const PROMOTIONAL_CYCLE_HOURS = 66;
