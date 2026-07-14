/**
 * OpenRouter integration — SERVER-SIDE ONLY.
 *
 * Responsible for the VIDEO GENERATION step only:
 *   submitSeedanceVideo() / pollSeedanceJob() / downloadSeedanceVideo(): async
 *   video generation with bytedance/seedance-2.0 via OpenRouter's /videos
 *   endpoint.
 *
 * NOTE: The image-analysis / prompt-optimization step runs through Inworld
 * (see server/inworld.ts), not OpenRouter.
 *
 * COST SAFETY: every entry point re-validates inputs. Video submission is only
 * ever called from the paid generation path in routers.ts, which checks the
 * subscription first. Image order is snapshotted and passed explicitly.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * Video (animation) model. Override with the OPENROUTER_VIDEO_MODEL env var.
 * Default: bytedance/seedance-2.0.
 */
function getVideoModel(): string {
  return process.env.OPENROUTER_VIDEO_MODEL || "bytedance/seedance-2.0";
}

function getApiKey(): string {
  const key = process.env.OPENROUTER_API_KEY ?? "";
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  return key;
}

export type TourStyle = "Walkthrough" | "Drone" | "Cinematic";

export interface OrderedImage {
  /** Strict 0-based sequence index — the guaranteed order. */
  sequenceIndex: number;
  /** Publicly fetchable HTTPS URL for the image. */
  publicUrl: string;
  roomTag?: string | null;
}

export interface SeedanceSubmitResult {
  jobId: string;
  pollingUrl: string | null;
}

/**
 * Submit a Seedance 2.0 video generation job. Reference images are passed in
 * strict sequence order via input_references.
 */
export async function submitSeedanceVideo(params: {
  prompt: string;
  images: OrderedImage[];
  duration: number;
  resolution: string;
  aspectRatio: string;
}): Promise<SeedanceSubmitResult> {
  const { prompt, images, duration, resolution, aspectRatio } = params;
  if (!prompt.trim()) throw new Error("Empty prompt — refusing to submit paid generation");
  if (images.length === 0) throw new Error("No reference images — refusing to submit paid generation");

  const ordered = [...images].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  const resp = await fetch(`${OPENROUTER_BASE}/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getVideoModel(),
      prompt,
      duration,
      resolution,
      aspect_ratio: aspectRatio,
      generate_audio: false,
      input_references: ordered.map((img) => ({
        type: "image_url",
        image_url: { url: img.publicUrl },
      })),
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Seedance submission failed (${resp.status}): ${text}`);
  }

  const job = (await resp.json()) as {
    id: string;
    polling_url?: string;
  };
  if (!job.id) throw new Error("Seedance submission returned no job id");
  return { jobId: job.id, pollingUrl: job.polling_url ?? null };
}

export type SeedancePollStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface SeedancePollResult {
  status: SeedancePollStatus;
  videoUrl: string | null;
  error: string | null;
}

/** Poll an OpenRouter video job once. */
export async function pollSeedanceJob(jobId: string): Promise<SeedancePollResult> {
  const resp = await fetch(`${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Seedance poll failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    status: SeedancePollStatus;
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
export async function downloadSeedanceVideo(jobId: string, videoUrl: string | null): Promise<Buffer> {
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
