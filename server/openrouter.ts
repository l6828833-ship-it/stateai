/**
 * OpenRouter integration — SERVER-SIDE ONLY.
 *
 * Responsible for the VIDEO GENERATION step only:
 *   submitKlingVideo() / pollKlingJob() / downloadKlingVideo(): async
 *   video generation with kwaivgi/kling-v3.0-pro (audio disabled) via
 *   OpenRouter's /videos endpoint.
 *
 * NOTE: The image-analysis / prompt-optimization step runs through Inworld
 * (see server/inworld.ts), not OpenRouter.
 *
 * COST SAFETY: every entry point re-validates inputs. Video submission is only
 * ever called from the paid generation path in routers.ts, which checks the
 * subscription first. Image order is snapshotted and passed explicitly.
 */

import { ENV } from "./_core/env";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * Video (animation) model. Override with the OPENROUTER_VIDEO_MODEL env var.
 * Default: kwaivgi/kling-v3.0-pro. Video is always generated without audio.
 */
function getVideoModel(): string {
  const model = ENV.openRouterVideoModel.trim();
  if (!model) throw new Error("OPENROUTER_VIDEO_MODEL cannot be empty");
  return model;
}

function getApiKey(): string {
  const key = ENV.openRouterApiKey.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  return key;
}

/** Fail before creating a paid job when OpenRouter is not configured. */
export function assertOpenRouterConfigured(): void {
  getApiKey();
  getVideoModel();
}

export type TourStyle = "Walkthrough" | "Drone" | "Cinematic";

export interface OrderedImage {
  /** Strict 0-based sequence index — the guaranteed order. */
  sequenceIndex: number;
  /** Publicly fetchable HTTPS URL for the image. */
  publicUrl: string;
  roomTag?: string | null;
}

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export function isVideoAspectRatio(value: string): value is VideoAspectRatio {
  return VIDEO_ASPECT_RATIOS.some((ratio) => ratio === value);
}

export interface KlingSubmitResult {
  jobId: string;
  pollingUrl: string | null;
}

/**
 * Submit a Kling video generation job (default model: kwaivgi/kling-v3.0-pro).
 * Reference images are passed in strict sequence order via input_references,
 * and `generate_audio: false` ensures the output has no audio track.
 */
/** Every video is rendered at full HD; resolution is not user-configurable. */
export const OUTPUT_RESOLUTION = "1080p";

export async function submitKlingVideo(params: {
  prompt: string;
  images: OrderedImage[];
  duration: number;
  aspectRatio: VideoAspectRatio;
}): Promise<KlingSubmitResult> {
  const { prompt, images, duration, aspectRatio } = params;
  if (!prompt.trim()) throw new Error("Empty prompt — refusing to submit paid generation");
  if (images.length === 0) throw new Error("No reference images — refusing to submit paid generation");
  if (!Number.isInteger(duration) || duration < 3 || duration > 15) {
    throw new Error("Kling duration must be a whole number from 3 to 15 seconds");
  }
  if (!VIDEO_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new Error("Kling aspect ratio must be 16:9, 9:16, or 1:1");
  }

  const ordered = [...images].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  for (let index = 0; index < ordered.length; index++) {
    if (ordered[index].sequenceIndex !== index) {
      throw new Error("Reference image sequence must be gapless and start at zero");
    }
    const url = new URL(ordered[index].publicUrl);
    if (url.protocol !== "https:") {
      throw new Error("Reference images must use directly downloadable HTTPS URLs");
    }
  }

  const resp = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getVideoModel(),
      prompt,
      // AI-decided length (Kling max 15s). Always full HD, never with audio.
      duration,
      resolution: OUTPUT_RESOLUTION,
      aspect_ratio: aspectRatio,
      generate_audio: false,
      // Reference images passed in strict user order at their stored quality.
      input_references: ordered.map((img) => ({
        type: "image_url",
        image_url: { url: img.publicUrl },
      })),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Video submission failed (${resp.status}): ${text}`);
  }

  const job = (await resp.json()) as {
    id: string;
    polling_url?: string;
  };
  if (!job.id) throw new Error("Video submission returned no job id");
  return { jobId: job.id, pollingUrl: job.polling_url ?? null };
}

export type KlingPollStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface KlingPollResult {
  status: KlingPollStatus;
  videoUrl: string | null;
  error: string | null;
}

/** Poll an OpenRouter video job once. */
export async function pollKlingJob(jobId: string): Promise<KlingPollResult> {
  const resp = await fetch(`${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Video poll failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    status: KlingPollStatus;
    unsigned_urls?: string[];
    error?: string | null;
  };

  return {
    status: data.status,
    videoUrl: data.unsigned_urls?.[0] ?? null,
    error: data.error ?? null,
  };
}

/** Download the finished video bytes from OpenRouter. */
export async function downloadKlingVideo(jobId: string, videoUrl: string | null): Promise<Buffer> {
  const url = videoUrl ?? `${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}/content?index=0`;
  const needsAuth = url.startsWith(OPENROUTER_BASE);
  const resp = await fetch(url, {
    headers: needsAuth ? { Authorization: `Bearer ${getApiKey()}` } : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Video download failed (${resp.status}): ${text}`);
  }
  return Buffer.from(await resp.arrayBuffer());
}

/** Lightweight credential check — lists models, costs nothing. */
export async function verifyOpenRouterKey(): Promise<boolean> {
  const resp = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  return resp.ok;
}
