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
  maxImages: number;
  maxResolution: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
}

const TIER_CONFIG = {
  starter: {
    name: "Starter",
    tagline: "For standout individual listings",
    monthlyPrice: 17,
    yearlyMonthlyPrice: 13,
    videos: 3,
  },
  creator: {
    name: "Creator",
    tagline: "For active agents and creators",
    monthlyPrice: 39,
    yearlyMonthlyPrice: 29,
    videos: 10,
  },
  studio: {
    name: "Studio",
    tagline: "For teams and high-volume studios",
    monthlyPrice: 79,
    yearlyMonthlyPrice: 59,
    videos: 30,
  },
} as const;

const tierFeatures: Record<PlanTier, string[]> = {
  starter: ["3 videos per month", "6 images per video"],
  creator: ["10 videos per month", "6 images per video"],
  studio: ["30 videos per month", "6 images per video", "Team-ready volume"],
};

const sharedFeatures = [
  "1080p high quality, up to 15 seconds",
  "All ratios: 9:16, 1:1, and 16:9",
  "Best viral effects per video",
  "$17 per additional video",
  "No watermark",
] as const;

const originalPriceFor = (price: number) => Math.ceil(price / 0.38);

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
    maxImages: 6,
    maxResolution: "1080p",
    highlighted: tier === "creator",
    badge: tier === "creator" ? "Most popular" : undefined,
    features: [...tierFeatures[tier], ...sharedFeatures],
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
    originalPrice: originalPriceFor(price),
    interval: "year",
    priceLabel: `$${price}/year`,
    tagline: `${config.tagline} · save with annual billing`,
    videoAllowance: `${config.videos * 12} videos per year`,
    includedVideos: config.videos * 12,
    maxImages: 6,
    maxResolution: "1080p",
    highlighted: tier === "creator",
    badge: tier === "creator" ? "Best value" : undefined,
    features: [
      `${config.videos * 12} videos per year`,
      ...tierFeatures[tier].slice(1),
      ...sharedFeatures,
    ],
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

/** Tour styles — labels must be exactly these three. */
export const TOUR_STYLES = ["Walkthrough", "Drone", "Cinematic"] as const;
export type TourStyleId = (typeof TOUR_STYLES)[number];

export const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

export const MAX_IMAGES = 6;
export const MAX_IMAGE_SIZE_MB = 10;
export const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
export const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
export const ADDITIONAL_VIDEO_PRICE_USD = 17;
export const PROMOTIONAL_DISCOUNT_PERCENT = 62;
