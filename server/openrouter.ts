/**
 * OpenRouter integration — SERVER-SIDE ONLY.
 *
 * Two responsibilities:
 * 1. analyzeAndOptimizePrompt(): sends ALL project photos (in strict sequence
 *    order) to a vision LLM in a single multimodal call, and receives a
 *    structured plan + a single optimized Seedance prompt. This step is
 *    completely invisible to the user — the result is stored server-side only.
 * 2. submitSeedanceVideo() / pollSeedanceJob(): async video generation with
 *    bytedance/seedance-2.0 via OpenRouter's /api/v1/videos endpoint.
 *
 * COST SAFETY: every entry point re-validates inputs. Video submission is only
 * ever called from the paid generation path in routers.ts, which checks the
 * subscription first. Image order is snapshotted and passed explicitly.
 */

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const SEEDANCE_MODEL = "bytedance/seedance-2.0";
/** Vision LLM used for the hidden prompt optimization step. */
const OPTIMIZER_MODEL = "anthropic/claude-sonnet-4.5";

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

export interface AnalysisResult {
  /** Per-photo structured plan (room type, camera move, etc.) */
  sequence: Array<{
    photo_index: number;
    room_type: string;
    camera_move: string;
    target: string;
    shot_prompt: string;
  }>;
  /** The single combined, optimized prompt for Seedance. */
  optimizedPrompt: string;
}

const STYLE_DIRECTION: Record<TourStyle, string> = {
  Walkthrough:
    "an interior walkthrough tour: smooth first-person gimbal movement through the home, gentle push-ins and pans, camera always stays inside rooms and never passes through unseen doorways",
  Drone:
    "an aerial drone tour: sweeping cinematic drone shots, slow orbits and reveals, rising establishing movements, smooth altitude changes",
  Cinematic:
    "a cinematic property film: dramatic slow camera moves, shallow depth of field feel, elegant push-ins toward hero details, warm golden-hour grading",
};

/**
 * HIDDEN STEP — analyze all photos together (relational ordering matters) and
 * produce one optimized Seedance prompt. Never expose the output to clients.
 */
export async function analyzeAndOptimizePrompt(params: {
  images: OrderedImage[];
  tourStyle: TourStyle;
  creativeText?: string | null;
  clipDuration: number;
}): Promise<AnalysisResult> {
  const { images, tourStyle, creativeText, clipDuration } = params;
  if (images.length === 0) throw new Error("No images provided for analysis");

  // Enforce strict ordering before anything is sent.
  const ordered = [...images].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  for (const img of ordered) {
    content.push({ type: "image_url", image_url: { url: img.publicUrl } });
    content.push({
      type: "text",
      text: `Photo ${img.sequenceIndex + 1} of ${ordered.length}${img.roomTag ? ` — labeled: ${img.roomTag}` : ""}`,
    });
  }

  content.push({
    type: "text",
    text: [
      `Analyze these real estate photos as ONE property, in the exact order given (the order is fixed and must not be changed).`,
      `The goal is a ${clipDuration}-second AI-generated video presenting the property as ${STYLE_DIRECTION[tourStyle]}.`,
      creativeText?.trim()
        ? `The client added this creative direction, honor it where safe: "${creativeText.trim()}"`
        : ``,
      `For each photo decide the safest, most impressive camera move (push_in, pull_back, pan_left_to_right, pan_right_to_left, orbit, rise, descend) — NEVER a move that would pass through an unseen doorway or invent unseen space.`,
      `Then write ONE combined video-generation prompt ("optimized_prompt") describing the full tour across the photos in order, with concrete motion, lighting and composition language. It must instruct the model to preserve the exact rooms, furniture, materials and layout visible in the reference photos, transitioning between them in the given order.`,
      `Respond ONLY with JSON matching: {"sequence":[{"photo_index":number,"room_type":string,"camera_move":string,"target":string,"shot_prompt":string}],"optimized_prompt":string}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const resp = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPTIMIZER_MODEL,
      max_tokens: 4000,
      messages: [{ role: "user", content }],
      response_format: { type: "json_object" },
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Prompt optimization failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let parsed: { sequence?: AnalysisResult["sequence"]; optimized_prompt?: string };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Fallback: use raw text as the prompt if JSON parsing fails.
    parsed = { sequence: [], optimized_prompt: raw.slice(0, 2000) };
  }

  const optimizedPrompt =
    parsed.optimized_prompt?.trim() ||
    buildFallbackPrompt(ordered.length, tourStyle, creativeText, clipDuration);

  return {
    sequence: parsed.sequence ?? [],
    optimizedPrompt,
  };
}

export function buildFallbackPrompt(
  imageCount: number,
  tourStyle: TourStyle,
  creativeText: string | null | undefined,
  clipDuration: number,
): string {
  return [
    `A ${clipDuration}-second professional real estate video presenting the property in the ${imageCount} reference photos, in their exact given order, as ${STYLE_DIRECTION[tourStyle]}.`,
    `Preserve the exact rooms, furniture, materials, and layout visible in the reference photos. Smooth, slow, stable camera motion with soft natural lighting. No people, no text overlays.`,
    creativeText?.trim() ? `Creative direction: ${creativeText.trim()}` : ``,
  ]
    .filter(Boolean)
    .join(" ");
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
      model: SEEDANCE_MODEL,
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
