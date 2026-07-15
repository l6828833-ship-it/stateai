/** Subscription plans — shared between frontend pricing UI and backend Stripe wiring. */

export type PlanId = "starter" | "pro" | "annual" | "business";

export interface Plan {
  id: PlanId;
  name: string;
  price: number;
  interval: "month" | "year";
  priceLabel: string;
  tagline: string;
  videosPerMonth: string;
  maxResolution: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
}

export const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: 9,
    interval: "month",
    priceLabel: "$9/mo",
    tagline: "For your first listings",
    videosPerMonth: "3 videos / month",
    maxResolution: "480p",
    features: [
      "3 tour videos per month",
      "Up to 6 photos per tour",
      "480p export",
      "Walkthrough style",
      "Email support",
    ],
  },
  {
    id: "annual",
    name: "Annual",
    price: 29,
    interval: "year",
    priceLabel: "$29/yr",
    tagline: "Best value — billed yearly",
    videosPerMonth: "5 videos / month",
    maxResolution: "720p",
    badge: "Best Value",
    features: [
      "5 tour videos per month",
      "Up to 10 photos per tour",
      "720p HD export",
      "All 3 tour styles",
      "Priority queue",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 39,
    interval: "month",
    priceLabel: "$39/mo",
    tagline: "For active agents",
    videosPerMonth: "15 videos / month",
    maxResolution: "1080p",
    highlighted: true,
    badge: "Most Popular",
    features: [
      "15 tour videos per month",
      "Up to 15 photos per tour",
      "1080p Full HD export",
      "All 3 tour styles",
      "Custom creative direction",
      "Priority support",
    ],
  },
  {
    id: "business",
    name: "Business",
    price: 99,
    interval: "month",
    priceLabel: "$99/mo",
    tagline: "For teams & brokerages",
    videosPerMonth: "Unlimited videos",
    maxResolution: "1080p",
    features: [
      "Unlimited tour videos",
      "Up to 20 photos per tour",
      "1080p Full HD export",
      "All 3 tour styles",
      "Custom creative direction",
      "Team seats (up to 5)",
      "Dedicated support",
    ],
  },
];

export const PLAN_BY_ID: Record<PlanId, Plan> = Object.fromEntries(
  PLANS.map(p => [p.id, p])
) as Record<PlanId, Plan>;

/** Tour styles — labels must be exactly these three. */
export const TOUR_STYLES = ["Walkthrough", "Drone", "Cinematic"] as const;
export type TourStyleId = (typeof TOUR_STYLES)[number];

export const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "21:9"] as const;
export const DURATIONS = [4, 5, 6, 8, 10, 12, 15] as const;

export const MAX_IMAGES = 20;
export const MAX_IMAGE_SIZE_MB = 10;
export const MAX_IMAGE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
/** Maximum base64 characters needed to encode MAX_IMAGE_BYTES (without a data-URL prefix). */
export const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
