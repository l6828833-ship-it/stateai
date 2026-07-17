/**
 * Inworld AI integration — SERVER-SIDE ONLY.
 *
 * Responsible for the hidden IMAGE ANALYSIS / prompt-optimization step: all
 * project photos (in strict sequence order) are sent to a vision LLM through
 * Inworld's OpenAI-compatible Router in a single multimodal call, returning a
 * structured plan + one optimized prompt that is then handed to Kling's
 * official 3.0 image-to-video API for the actual video generation.
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
import { ENV } from "./_core/env";
import type { OrderedImage } from "./kling";

const INWORLD_BASE = "https://api.inworld.ai/v1";

function getApiKey(): string {
  const key = ENV.inworldApiKey.trim();
  if (!key) throw new Error("INWORLD_API_KEY is not configured");
  return key;
}

/** Fail fast before a paid generation job if required analysis is not configured. */
export function assertInworldConfigured(): void {
  getApiKey();
  getVisionModel();
}

/**
 * Vision model used for image analysis. Override with INWORLD_VISION_MODEL.
 * Default: anthropic/claude-sonnet-4-6 (Inworld model ids use dashes).
 */
function getVisionModel(): string {
  const model = ENV.inworldVisionModel.trim();
  if (!model) throw new Error("INWORLD_VISION_MODEL cannot be empty");
  return model;
}

/** Highest final tour duration offered by any plan. */
export const MIN_CLIP_DURATION = 4;
export const MAX_CLIP_DURATION = 30;

/**
 * Each rendered shot (a per-image transition of a multi-image tour, or the
 * single clip of a one-image tour) has an AI-chosen length within this range.
 * The maximum is a product cap: no individual shot is longer than 6 seconds.
 */
export const SEGMENT_MIN_DURATION = 3; // Kling's minimum clip length
export const SEGMENT_MAX_DURATION = 6; // product cap per shot
export const DEFAULT_SEGMENT_DURATION = 5;

export interface AnalysisResult {
  /** Per-photo structured plan (room type, AI-chosen style, camera move, etc.) */
  sequence: Array<{
    photo_index: number;
    room_type: string;
    /** Cinematic style the AI picked for this specific shot. */
    style: string;
    camera_move: string;
    target: string;
    shot_prompt: string;
  }>;
  /**
   * Shared cinematic style & lighting guide, reused across EVERY shot. This is
   * a style reference, NOT one giant prompt spanning all images. Stored on the
   * job for record-keeping.
   */
  styleGuide: string;
  /**
   * The final Kling prompt for each image's own shot, in image order. Every
   * image is an independent single-frame shot (hard-cut together afterwards),
   * so this always has exactly one entry per image.
   */
  shotPrompts: string[];
  /**
   * AI-chosen length (whole seconds) for each shot, in order. Length equals the
   * number of shots — one per image. Each value is clamped to
   * [SEGMENT_MIN_DURATION, SEGMENT_MAX_DURATION].
   */
  segmentDurations: number[];
  /** Total video length (sum of segmentDurations), for record-keeping. */
  duration: number;
}

/** Clamp any duration into the valid Kling range and round to a whole second. */
export function clampDuration(value: number | undefined | null): number {
  if (!value || !Number.isFinite(value)) return MIN_CLIP_DURATION;
  return Math.max(
    MIN_CLIP_DURATION,
    Math.min(MAX_CLIP_DURATION, Math.round(value))
  );
}

/** Clamp one AI-chosen shot length to [SEGMENT_MIN,SEGMENT_MAX]; default if absent. */
export function clampSegmentDuration(value: number | undefined | null): number {
  if (!value || !Number.isFinite(value)) return DEFAULT_SEGMENT_DURATION;
  return Math.max(
    SEGMENT_MIN_DURATION,
    Math.min(SEGMENT_MAX_DURATION, Math.round(value))
  );
}

/**
 * Keep provider segments in Kling's valid range. When the source minimum is
 * longer than the plan's final cap, post-production speeds every full segment
 * up proportionally so all uploaded images remain represented.
 */
export function normalizeSegmentDurations(
  values: Array<number | undefined | null>,
  segmentCount: number,
  maxTotalDuration = MAX_CLIP_DURATION
): number[] {
  const durations = Array.from({ length: segmentCount }, (_, index) =>
    clampSegmentDuration(values[index])
  );
  let total = durations.reduce((sum, value) => sum + value, 0);
  while (total > maxTotalDuration) {
    const reducibleIndex = durations.findIndex(
      duration => duration > SEGMENT_MIN_DURATION
    );
    if (reducibleIndex === -1) break;
    durations[reducibleIndex] -= 1;
    total -= 1;
  }
  return durations;
}

/**
 * Number of shots (Kling tasks) for a tour of the given image count. Each image
 * is its own independent single-frame shot; the shots are joined by hard cuts,
 * so the shot count equals the image count (never a between-image transition).
 */
export function segmentCountFor(imageCount: number): number {
  return Math.max(1, imageCount);
}

/** Sensible fallback length when the AI does not return one (scales with photo count). */
export function defaultDurationFor(
  imageCount: number,
  maxDurationSeconds = 15
): number {
  return Math.max(
    MIN_CLIP_DURATION,
    Math.min(maxDurationSeconds, 4 + imageCount * 2)
  );
}

/**
 * HIDDEN STEP — analyze all photos together (relational ordering matters) and
 * produce one optimized Kling prompt. The AI acts as the director and picks
 * the best cinematic style + camera move for EACH scene. Never expose to clients.
 */
export async function analyzeAndOptimizePrompt(params: {
  images: OrderedImage[];
  maxDurationSeconds: number;
}): Promise<AnalysisResult> {
  const { images, maxDurationSeconds } = params;
  if (images.length === 0) throw new Error("No images provided for analysis");

  // Enforce strict ordering before anything is sent.
  const ordered = [...images].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  const segmentCount = segmentCountFor(ordered.length);
  const shotPlan =
    ordered.length <= 1
      ? `The final video is ONE cinematic shot generated from Image 1 alone.`
      : `The final video is ${segmentCount} INDEPENDENT shots — exactly one per image, in order — joined by clean hard cuts. There are NO animated transitions or morphs between different photos. Each shot k is generated from Image k ALONE (a single still frame the camera gently animates within); the camera must never drift toward, pass through, or invent any space not visible in that one photo.`;

  const content: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  > = [];

  for (const img of ordered) {
    content.push({ type: "image_url", image_url: { url: img.publicUrl } });
    content.push({
      type: "text",
      text: `Image ${img.sequenceIndex + 1} of ${ordered.length}${img.roomTag ? ` — labeled: ${img.roomTag}` : ""}`,
    });
  }

  content.push({
    type: "text",
    text: [
      `Analyze these real estate photos as ONE property, in the exact order given (the order is fixed and must not be changed).`,
      `The photos are numbered Image 1, Image 2, … Image ${ordered.length}. Plan the tour strictly in that order — Image 1 first, then Image 2, and so on to Image ${ordered.length} — without skipping, dropping, reordering, or merging any image. Every image becomes EXACTLY ONE shot and must reference its image by number.`,
      `You are the film director. The client chose NO style and NO length — you decide everything creative from what you actually see in each photo.`,
      shotPlan,
      `For EACH image, first identify what it shows (e.g. exterior facade, front yard, aerial/rooftop view, living room, kitchen, bedroom, bathroom, backyard, pool), then choose ONE stable, flattering camera move that stays ENTIRELY within that single photo:`,
      `- Exteriors, aerial and large outdoor shots → a slow push_in, gentle orbit, or subtle rise that keeps the whole structure in frame.`,
      `- Interior rooms → a slow, steady push_in or gentle pan that reveals the room without leaving it; never travel through a doorway or toward unseen space.`,
      `- Hero details and feature spaces → a slow, elegant push_in with warm, filmic lighting.`,
      `Pick exactly one camera_move per image from: push_in, pull_back, pan_left_to_right, pan_right_to_left, orbit, rise, descend, static. Prefer slow, subtle, STABLE motion — small amplitude, no fast or wide moves, no shaking or hand-held wobble. When in doubt, use a gentle push_in.`,
      `For EACH shot choose its IDEAL length in WHOLE seconds between ${SEGMENT_MIN_DURATION} and ${SEGMENT_MAX_DURATION}. The final edit is capped at ${maxDurationSeconds} seconds; when the total is longer, post-production speeds each complete shot proportionally. Return lengths in image order in "segment_durations" as an array of EXACTLY ${segmentCount} whole numbers.`,
      `For EACH image write a focused "shot_prompt": a STANDALONE single-shot video-generation instruction describing ONLY that one photo's scene, its chosen camera move, and its motion & lighting — as if it is the only clip that exists. It must instruct the model to preserve the EXACT room, furniture, materials, textures and layout in that reference photo with no cropping, warping, added or removed objects — keep it pixel-faithful; only the camera moves, slowly and stably. No people, no text overlays.`,
      `Also write ONE short "style_guide" (1–2 sentences) capturing the shared cinematic look — lighting, color, mood, pacing — that applies to every shot. This is a STYLE reference that is reused per shot; it is NOT a single prompt spanning multiple images.`,
      `Respond ONLY with a single JSON object matching: {"sequence":[{"photo_index":number,"room_type":string,"style":string,"camera_move":string,"target":string,"shot_prompt":string}],"style_guide":string,"segment_durations":number[]}. Both "sequence" and "segment_durations" must have EXACTLY ${segmentCount} entries, one per image in order.`,
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
      max_tokens: 6000,
      messages: [
        {
          role: "system",
          content:
            "You are a professional real-estate cinematography planner. Respond with a single valid JSON object only — no prose and no markdown code fences.",
        },
        { role: "user", content },
      ],
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(
      `Inworld prompt optimization failed (${resp.status}): ${text}`
    );
  }

  const data = (await resp.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  let parsed: {
    sequence?: AnalysisResult["sequence"];
    style_guide?: string;
    /** Older schema name — still accepted as the style guide. */
    optimized_prompt?: string;
    segment_durations?: unknown;
  } = {};
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    // A fumbled/incomplete response must never become a broken prompt: fall
    // through to the deterministic per-shot fallbacks below.
    parsed = {};
  }

  const styleGuide =
    (parsed.style_guide ?? parsed.optimized_prompt ?? "").toString().trim() ||
    buildFallbackStyleGuide();

  // AI-chosen per-shot lengths. Always produce exactly `segmentCount` values,
  // each clamped to [SEGMENT_MIN,SEGMENT_MAX]; any missing/invalid entry falls
  // back to the default so a fumbled response never blocks paid generation.
  const rawDurations = Array.isArray(parsed.segment_durations)
    ? (parsed.segment_durations as unknown[])
    : [];
  const segmentDurations = normalizeSegmentDurations(
    rawDurations.map(value => (typeof value === "number" ? value : undefined)),
    segmentCount,
    maxDurationSeconds
  );
  const duration = segmentDurations.reduce((sum, value) => sum + value, 0);

  const sequence = Array.isArray(parsed.sequence) ? parsed.sequence : [];
  const shotPrompts = buildShotPrompts(
    sequence,
    styleGuide,
    ordered.map(img => img.roomTag),
    segmentCount
  );

  return {
    sequence,
    styleGuide,
    shotPrompts,
    segmentDurations,
    duration,
  };
}

/** Pull the first complete JSON object out of a model response. */
function extractJsonObject(raw: string): string {
  const unfenced = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return unfenced.slice(start, end + 1);
  }
  return unfenced;
}

/**
 * Build the final Kling prompt for each image's shot. Each entry combines the
 * image's own single-shot instruction with the shared style guide, so every
 * shot keeps its scene-specific direction instead of a generic whole-tour text.
 */
function buildShotPrompts(
  sequence: AnalysisResult["sequence"],
  styleGuide: string,
  roomTags: Array<string | null | undefined>,
  segmentCount: number
): string[] {
  return Array.from({ length: segmentCount }, (_, index) => {
    const entry =
      sequence.find(item => Number(item?.photo_index) === index + 1) ??
      sequence[index];
    const shot =
      typeof entry?.shot_prompt === "string" ? entry.shot_prompt.trim() : "";
    const base = shot || buildFallbackShotPrompt(roomTags[index]);
    return [base, styleGuide].filter(Boolean).join(" ").trim();
  });
}

/** Shared cinematic style guide used when the model omits one. */
export function buildFallbackStyleGuide(): string {
  return "Soft, natural, filmic lighting with warm neutral color and slow, steady pacing; a calm, premium real-estate look consistent across every shot.";
}

/** Deterministic single-shot fallback for one image (never spans other images). */
export function buildFallbackShotPrompt(roomTag?: string | null): string {
  const subject = roomTag?.trim() ? `the ${roomTag.trim()}` : "this space";
  return [
    `A professional cinematic real estate shot of ${subject}, generated from a single still photo.`,
    `The camera performs ONE slow, stable, subtle move (a gentle push-in) that stays entirely within the frame — it never travels through doorways or into unseen space.`,
    `Preserve the exact room, furniture, materials, textures and layout with no cropping, warping, or added/removed objects — keep it pixel-faithful; only the camera moves. Soft, natural, filmic lighting. No people, no text overlays.`,
  ].join(" ");
}

/** Per-image single-shot prompts for when analysis fails entirely. */
export function buildFallbackShotPrompts(
  imageCount: number,
  roomTags: Array<string | null | undefined> = []
): string[] {
  return Array.from({ length: Math.max(1, imageCount) }, (_, index) =>
    buildFallbackShotPrompt(roomTags[index])
  );
}

/** Shared style guide fallback (kept for the job's stored record). */
export function buildFallbackPrompt(_imageCount: number): string {
  return buildFallbackStyleGuide();
}

/** Lightweight credential check — lists models, costs nothing. */
export async function verifyInworldKey(): Promise<boolean> {
  const resp = await fetch(`${INWORLD_BASE}/models`, {
    headers: { Authorization: `Basic ${getApiKey()}` },
  });
  return resp.ok;
}
