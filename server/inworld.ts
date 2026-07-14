/**
 * Inworld AI integration — SERVER-SIDE ONLY.
 *
 * Responsible for the hidden IMAGE ANALYSIS / prompt-optimization step: all
 * project photos (in strict sequence order) are sent to a vision LLM through
 * Inworld's OpenAI-compatible Router in a single multimodal call, returning a
 * structured plan + one optimized prompt that is then handed to Seedance
 * (via OpenRouter) for the actual video generation.
 *
 * The result is stored server-side only and never exposed to clients.
 *
 * Env:
 *   INWORLD_API_KEY      – Base64 credential from platform.inworld.ai (required).
 *   INWORLD_VISION_MODEL – override the model (default: anthropic/claude-sonnet-4-6).
 *
 * Auth: Inworld uses HTTP Basic with the Base64 key copied from the portal:
 *   Authorization: Basic <INWORLD_API_KEY>
 */
import type { OrderedImage, TourStyle } from "./openrouter";

const INWORLD_BASE = "https://api.inworld.ai/v1";

function getApiKey(): string {
  const key = process.env.INWORLD_API_KEY ?? "";
  if (!key) throw new Error("INWORLD_API_KEY is not configured");
  return key;
}

/**
 * Vision model used for image analysis. Override with INWORLD_VISION_MODEL.
 * Default: anthropic/claude-sonnet-4-6 (Inworld model ids use dashes).
 */
function getVisionModel(): string {
  return process.env.INWORLD_VISION_MODEL || "anthropic/claude-sonnet-4-6";
}

/** Kling supports up to 15s clips; the AI picks the ideal length in this range. */
export const MIN_CLIP_DURATION = 4;
export const MAX_CLIP_DURATION = 15;

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
  /** AI-decided ideal clip length in seconds, clamped to [MIN,MAX]. */
  duration: number;
}

/** Clamp any duration into the valid Kling range and round to a whole second. */
export function clampDuration(value: number | undefined | null): number {
  if (!value || !Number.isFinite(value)) return MIN_CLIP_DURATION;
  return Math.max(MIN_CLIP_DURATION, Math.min(MAX_CLIP_DURATION, Math.round(value)));
}

/** Sensible fallback length when the AI does not return one (scales with photo count). */
export function defaultDurationFor(imageCount: number): number {
  return clampDuration(Math.min(MAX_CLIP_DURATION, 4 + imageCount * 2));
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
}): Promise<AnalysisResult> {
  const { images, tourStyle } = params;
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
      `The goal is an AI-generated video presenting the property as ${STYLE_DIRECTION[tourStyle]}.`,
      `You are the director. Decide everything creative yourself from what you see in the photos — the client did NOT provide any creative direction.`,
      `For each photo decide the safest, most impressive camera move (push_in, pull_back, pan_left_to_right, pan_right_to_left, orbit, rise, descend) — NEVER a move that would pass through an unseen doorway or invent unseen space.`,
      `Also decide the IDEAL total video length in whole seconds ("duration"), between ${MIN_CLIP_DURATION} and ${MAX_CLIP_DURATION} seconds (the Kling model's maximum is ${MAX_CLIP_DURATION}s). Base it on how many photos there are and how much each scene needs to breathe — enough time for smooth, unhurried motion across every photo, but never padded.`,
      `Then write ONE combined video-generation prompt ("optimized_prompt") describing the full tour across the photos in order, with concrete motion, lighting and composition language. It must instruct the model to preserve the EXACT rooms, furniture, materials, textures and layout visible in the reference photos with no cropping, warping, added or removed objects — the photos must stay pixel-faithful; only the camera moves. Transition between the photos in the given order.`,
      `Respond ONLY with JSON matching: {"sequence":[{"photo_index":number,"room_type":string,"camera_move":string,"target":string,"shot_prompt":string}],"optimized_prompt":string,"duration":number}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const resp = await fetch(`${INWORLD_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: getVisionModel(),
      max_tokens: 4000,
      messages: [{ role: "user", content }],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Inworld prompt optimization failed (${resp.status}): ${text}`);
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  let parsed: {
    sequence?: AnalysisResult["sequence"];
    optimized_prompt?: string;
    duration?: number;
  };
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // Fallback: use raw text as the prompt if JSON parsing fails.
    parsed = { sequence: [], optimized_prompt: raw.slice(0, 2000) };
  }

  const optimizedPrompt =
    parsed.optimized_prompt?.trim() || buildFallbackPrompt(ordered.length, tourStyle);

  // AI-decided length, clamped to the valid Kling range; fall back to a
  // photo-count-based default if the model omitted or fumbled it.
  const duration =
    typeof parsed.duration === "number"
      ? clampDuration(parsed.duration)
      : defaultDurationFor(ordered.length);

  return {
    sequence: parsed.sequence ?? [],
    optimizedPrompt,
    duration,
  };
}

export function buildFallbackPrompt(imageCount: number, tourStyle: TourStyle): string {
  return [
    `A professional real estate video presenting the property in the ${imageCount} reference photos, in their exact given order, as ${STYLE_DIRECTION[tourStyle]}.`,
    `Preserve the exact rooms, furniture, materials, textures and layout visible in the reference photos with no cropping, warping, or added/removed objects — keep the photos pixel-faithful and only move the camera. Smooth, slow, stable camera motion with soft natural lighting. No people, no text overlays.`,
  ].join(" ");
}

/** Lightweight credential check — lists models, costs nothing. */
export async function verifyInworldKey(): Promise<boolean> {
  const resp = await fetch(`${INWORLD_BASE}/models`, {
    headers: { Authorization: `Basic ${getApiKey()}` },
  });
  return resp.ok;
}
