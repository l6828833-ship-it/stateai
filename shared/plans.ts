/** Subscription plans — shared between frontend pricing UI and backend Stripe wiring. */

export type PlanId = "annual" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  price: number;
  interval: "month" | "year";
  priceLabel: string;
  tagline: string;
  videoAllowance: string;
  includedVideos: number;
  maxResolution: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
}

const SHARED_FEATURES = [
  "Up to 10 images per video",
  "1080p Full HD",
  "High-quality cinematic output",
  "All ratios: 9:16, 1:1, and 16:9",
  "Best viral effects for every video",
  "$15 per additional video",
  "Priority queue",
  "No watermark",
] as const;

/** Customer-facing plans. Yearly is intentionally first and highlighted. */
export const PLANS: Plan[] = [
  {
    id: "annual",
    name: "Yearly",
    price: 29,
    interval: "year",
    priceLabel: "$29/year",
    tagline: "Best value — one yearly payment",
    videoAllowance: "36 videos per year",
    includedVideos: 36,
    maxResolution: "1080p",
    highlighted: true,
    badge: "Best Value",
    features: ["36 videos per year", ...SHARED_FEATURES],
  },
  {
    id: "pro",
    name: "Monthly",
    price: 39,
    interval: "month",
    priceLabel: "$39/month",
    tagline: "Flexible monthly billing",
    videoAllowance: "3 videos per month",
    includedVideos: 3,
    maxResolution: "1080p",
    features: ["3 videos per month", ...SHARED_FEATURES],
  },
];

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map(p => [p.id, p])
) as Record<PlanId, Plan>;

/** Tour styles — labels must be exactly these three. */
export const TOUR_STYLES = ["Walkthrough", "Drone", "Cinematic"] as const;
export type TourStyleId = (typeof TOUR_STYLES)[number];

export const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export const DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

export const MAX_IMAGES = 10;
export const MAX_IMAGE_SIZE_MB = 10;
export const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
/** Maximum base64 characters needed to encode MAX_IMAGE_BYTES (without a data-URL prefix). */
export const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
