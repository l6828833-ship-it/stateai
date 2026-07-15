/**
 * Official Kling AI integration — SERVER-SIDE ONLY.
 *
 * New paid video generations use Kling's official 3.0 image-to-video API.
 * Inworld still performs the hidden multi-image analysis that produces the
 * prompt; this adapter submits the first and optional last frame exactly as
 * supported by the official endpoint supplied in the API documentation.
 */

import { ENV } from "./_core/env";

const DEFAULT_KLING_API_BASE = "https://api-singapore.klingai.com";
const CREATE_TASK_PATH = "/image-to-video/kling-3.0";
const TASKS_PATH = "/tasks";
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const RECOMMENDED_PROMPT_LENGTH = 2_500;
const PROVIDER_TASK_PREFIX = "kling:";

function getApiBase(): string {
  const value = ENV.klingApiBaseUrl.trim() || DEFAULT_KLING_API_BASE;
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("KLING_API_BASE_URL must use HTTPS");
  }
  return value.replace(/\/+$/, "");
}

function getApiKey(): string {
  const key = ENV.klingApiKey.trim();
  if (!key) throw new Error("KLING_API_KEY is not configured");
  return key;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
}

/** Fail before reserving a paid generation when Kling is not configured. */
export function assertKlingConfigured(): void {
  getApiKey();
  getApiBase();
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

/** Every video is rendered at full HD; resolution is not user-configurable. */
export const OUTPUT_RESOLUTION = "1080p";

export interface KlingImageToVideoRequest {
  contents: Array<
    | { type: "prompt"; text: string }
    | { type: "first_frame" | "last_frame"; url: string }
  >;
  settings: {
    multi_shot: false;
    audio: "off";
    resolution: "1080p";
    duration: number;
  };
  options: {
    external_task_id: string;
    watermark_info: { enabled: false };
  };
}

interface KlingEnvelope<T> {
  code: number;
  message?: string;
  request_id?: string;
  data: T;
}

interface KlingTask {
  id: string;
  status: "submitted" | "processing" | "succeeded" | "failed";
  message?: string;
  external_id?: string;
  outputs?: Array<{
    type: string;
    id?: string;
    url?: string;
    watermark_url?: string;
    duration?: string;
  }>;
}

export interface KlingSubmitResult {
  taskId: string;
  externalTaskId: string;
}

export type KlingPollStatus = "pending" | "processing" | "completed" | "failed";

export interface KlingPollResult {
  status: KlingPollStatus;
  videoUrl: string | null;
  error: string | null;
}

export function klingExternalTaskIdForJob(jobId: number): string {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error("A positive generation job id is required");
  }
  return `estatetour-generation-${jobId}`;
}

/**
 * Deterministic external id for one segment of a multi-image tour. Because it
 * is derived purely from (jobId, segmentIndex), polling can reconcile every
 * segment by external id without persisting each Kling task id.
 */
export function klingSegmentExternalTaskId(
  jobId: number,
  segmentIndex: number,
): string {
  if (!Number.isSafeInteger(jobId) || jobId <= 0) {
    throw new Error("A positive generation job id is required");
  }
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    throw new Error("Segment index must be a non-negative integer");
  }
  return `estatetour-generation-${jobId}-seg-${segmentIndex}`;
}

export interface KlingSegmentPlan {
  index: number;
  /** The 1-2 frames for this segment (first, optional last), re-based to 0/1. */
  images: OrderedImage[];
}

/**
 * Plan the ordered first/last-frame segments that cover EVERY image.
 * - 1 image  → 1 single-frame segment.
 * - N images → N-1 segments, each spanning consecutive images
 *   (segment i: first_frame = image i, last_frame = image i+1).
 * Concatenating the segment videos in order yields a tour that visits every
 * uploaded image, since each image is the last frame of one segment and the
 * first frame of the next.
 */
export function planKlingSegments(images: OrderedImage[]): KlingSegmentPlan[] {
  const ordered = [...images].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
  if (ordered.length === 0) {
    throw new Error("No images to plan Kling segments");
  }
  if (ordered.length === 1) {
    return [
      {
        index: 0,
        images: [
          {
            sequenceIndex: 0,
            publicUrl: ordered[0].publicUrl,
            roomTag: ordered[0].roomTag,
          },
        ],
      },
    ];
  }
  const segments: KlingSegmentPlan[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    segments.push({
      index: i,
      images: [
        {
          sequenceIndex: 0,
          publicUrl: ordered[i].publicUrl,
          roomTag: ordered[i].roomTag,
        },
        {
          sequenceIndex: 1,
          publicUrl: ordered[i + 1].publicUrl,
          roomTag: ordered[i + 1].roomTag,
        },
      ],
    });
  }
  return segments;
}

/**
 * Store official Kling task ids with an explicit `kling:` prefix so the stored
 * value is unambiguous and self-describing.
 */
export function encodeKlingProviderTaskId(taskId: string): string {
  const value = taskId.trim();
  if (!value) throw new Error("Kling returned an empty task id");
  const encoded = `${PROVIDER_TASK_PREFIX}${value}`;
  if (encoded.length > 128) throw new Error("Kling task id is too long to store");
  return encoded;
}

export function decodeKlingProviderTaskId(value: string | null): string | null {
  if (!value?.startsWith(PROVIDER_TASK_PREFIX)) return null;
  const taskId = value.slice(PROVIDER_TASK_PREFIX.length);
  return taskId || null;
}

function validateOrderedImages(images: OrderedImage[]): OrderedImage[] {
  if (images.length === 0) {
    throw new Error("No reference images — refusing to submit paid generation");
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
  return ordered;
}

/** Build the exact documented Kling 3.0 image-to-video request. */
export function buildKlingImageToVideoRequest(params: {
  prompt: string;
  images: OrderedImage[];
  duration: number;
  aspectRatio: VideoAspectRatio;
  externalTaskId: string;
}): KlingImageToVideoRequest {
  const { prompt, images, duration, aspectRatio, externalTaskId } = params;
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt) {
    throw new Error("Empty prompt — refusing to submit paid generation");
  }
  if (!Number.isInteger(duration) || duration < 3 || duration > 15) {
    throw new Error("Kling duration must be a whole number from 3 to 15 seconds");
  }
  if (!VIDEO_ASPECT_RATIOS.includes(aspectRatio)) {
    throw new Error("Kling aspect ratio must be 16:9, 9:16, or 1:1");
  }
  const externalId = externalTaskId.trim();
  if (!externalId || externalId.length > 128) {
    throw new Error("Kling external task id must be 1–128 characters");
  }

  const ordered = validateOrderedImages(images);
  const compositionInstruction = ` Target output composition: ${aspectRatio}.`;
  const promptLimit = RECOMMENDED_PROMPT_LENGTH - compositionInstruction.length;
  const text = `${trimmedPrompt.slice(0, promptLimit)}${compositionInstruction}`;
  const contents: KlingImageToVideoRequest["contents"] = [
    { type: "prompt", text },
    { type: "first_frame", url: ordered[0].publicUrl },
  ];
  if (ordered.length > 1) {
    contents.push({
      type: "last_frame",
      url: ordered[ordered.length - 1].publicUrl,
    });
  }

  return {
    contents,
    settings: {
      multi_shot: false,
      audio: "off",
      resolution: OUTPUT_RESOLUTION,
      duration,
    },
    options: {
      external_task_id: externalId,
      watermark_info: { enabled: false },
    },
  };
}

async function parseEnvelope<T>(response: Response, action: string): Promise<T> {
  const raw = await response.text();
  let envelope: KlingEnvelope<T> | null = null;
  try {
    envelope = JSON.parse(raw) as KlingEnvelope<T>;
  } catch {
    // The HTTP error below includes a bounded response excerpt for diagnosis.
  }

  if (!response.ok) {
    throw new Error(
      `${action} failed (${response.status}): ${(envelope?.message || raw || response.statusText).slice(0, 500)}`,
    );
  }
  if (!envelope || envelope.code !== 0) {
    const requestId = envelope?.request_id ? ` [request ${envelope.request_id}]` : "";
    throw new Error(
      `${action} was rejected by Kling (${envelope?.code ?? "invalid response"})${requestId}: ${(envelope?.message || raw || "Unknown error").slice(0, 500)}`,
    );
  }
  return envelope.data;
}

async function queryKlingTasks(query: {
  taskIds?: string;
  externalTaskIds?: string;
}): Promise<KlingTask[]> {
  if (Boolean(query.taskIds) === Boolean(query.externalTaskIds)) {
    throw new Error("Query exactly one Kling task identifier type");
  }
  const params = new URLSearchParams();
  if (query.taskIds) params.set("task_ids", query.taskIds);
  if (query.externalTaskIds) params.set("external_task_ids", query.externalTaskIds);

  const response = await fetch(`${getApiBase()}${TASKS_PATH}?${params}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return parseEnvelope<KlingTask[]>(response, "Kling task query");
}

export async function findKlingTaskByExternalId(
  externalTaskId: string,
): Promise<KlingSubmitResult | null> {
  const tasks = await queryKlingTasks({ externalTaskIds: externalTaskId });
  const task = tasks.find((candidate) => candidate.external_id === externalTaskId);
  if (!task?.id) return null;
  return { taskId: task.id, externalTaskId };
}

async function recoverSubmittedTask(
  externalTaskId: string,
): Promise<KlingSubmitResult | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 750));
    try {
      const recovered = await findKlingTaskByExternalId(externalTaskId);
      if (recovered) return recovered;
    } catch {
      // Preserve the original submission error if recovery cannot be queried.
    }
  }
  return null;
}

/**
 * Raised when a submission's outcome is genuinely unknown: the network call
 * failed or timed out and the task could not (yet) be found by its external id.
 * Kling may still have accepted the task, so the caller MUST keep the job
 * processing and let polling reconcile it by external id — it must never mark
 * the job failed (which would allow a second paid submission) or re-POST.
 */
export class KlingAmbiguousSubmissionError extends Error {
  readonly externalTaskId: string;
  constructor(externalTaskId: string, cause: unknown) {
    super(
      "Kling submission outcome is unknown; the task may still be processing and will be reconciled by its external id",
    );
    this.name = "KlingAmbiguousSubmissionError";
    this.externalTaskId = externalTaskId;
    this.cause = cause;
  }
}

/** Submit one official Kling 3.0 image-to-video task. Never retries the POST. */
export async function submitKlingVideo(params: {
  prompt: string;
  images: OrderedImage[];
  duration: number;
  aspectRatio: VideoAspectRatio;
  externalTaskId: string;
}): Promise<KlingSubmitResult> {
  const body = buildKlingImageToVideoRequest(params);

  let response: Response;
  try {
    response = await fetch(`${getApiBase()}${CREATE_TASK_PATH}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (networkError) {
    // The request never produced a server response, but Kling may still have
    // accepted the task before the timeout/drop. Try to recover by external id
    // rather than issuing a duplicate POST; if not yet visible, surface an
    // AMBIGUOUS error so the caller keeps polling instead of failing the job.
    const recovered = await recoverSubmittedTask(params.externalTaskId);
    if (recovered) return recovered;
    throw new KlingAmbiguousSubmissionError(params.externalTaskId, networkError);
  }

  // The server responded. A rejection here is DEFINITIVE — no task was created.
  const task = await parseEnvelope<KlingTask>(response, "Kling video submission");
  if (!task.id) throw new Error("Kling video submission returned no task id");
  if (task.status === "failed") {
    throw new Error(`Kling rejected the video task: ${task.message || "Unknown error"}`);
  }
  return { taskId: task.id, externalTaskId: params.externalTaskId };
}

/** Normalize one Kling task record into the application's status shape. */
function normalizeKlingTask(task: KlingTask): KlingPollResult {
  if (task.status === "submitted") {
    return { status: "pending", videoUrl: null, error: null };
  }
  if (task.status === "processing") {
    return { status: "processing", videoUrl: null, error: null };
  }
  if (task.status === "failed") {
    return {
      status: "failed",
      videoUrl: null,
      error: task.message || "Kling task failed",
    };
  }

  const video = task.outputs?.find((output) => output.type === "video" && output.url);
  if (!video?.url) {
    return {
      status: "failed",
      videoUrl: null,
      error: "Kling task succeeded without a downloadable video output",
    };
  }
  return { status: "completed", videoUrl: video.url, error: null };
}

/** Query one official Kling task and normalize its status for the application. */
export async function pollKlingJob(taskId: string): Promise<KlingPollResult> {
  const tasks = await queryKlingTasks({ taskIds: taskId });
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error("Kling task query returned no matching task");
  return normalizeKlingTask(task);
}

export interface KlingSegmentStatus extends KlingPollResult {
  externalTaskId: string;
  /** False when Kling has no task yet for this external id (not submitted/visible). */
  found: boolean;
}

/**
 * Poll many segments in a single batch query by their external ids. A segment
 * that Kling does not (yet) know about is returned as `found: false` /
 * `pending`, so the caller keeps waiting instead of failing the whole job.
 */
export async function pollKlingSegments(
  externalTaskIds: string[],
): Promise<KlingSegmentStatus[]> {
  if (externalTaskIds.length === 0) {
    throw new Error("No segment external task ids to poll");
  }
  // Keep commas literal (batch separator); each id is already URL-safe.
  const query = externalTaskIds.map((id) => encodeURIComponent(id)).join(",");
  const response = await fetch(
    `${getApiBase()}${TASKS_PATH}?external_task_ids=${query}`,
    {
      headers: authHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  const tasks = await parseEnvelope<KlingTask[]>(response, "Kling segment status query");

  const byExternalId = new Map<string, KlingTask>();
  for (const task of tasks) {
    if (task.external_id) byExternalId.set(task.external_id, task);
  }

  return externalTaskIds.map((externalTaskId) => {
    const task = byExternalId.get(externalTaskId);
    if (!task) {
      return {
        externalTaskId,
        found: false,
        status: "pending",
        videoUrl: null,
        error: null,
      };
    }
    return { externalTaskId, found: true, ...normalizeKlingTask(task) };
  });
}

/** Download Kling's temporary output immediately for permanent private storage. */
export async function downloadKlingVideo(videoUrl: string): Promise<Buffer> {
  const url = new URL(videoUrl);
  if (url.protocol !== "https:") {
    throw new Error("Kling output URL must use HTTPS");
  }

  // Never forward the Kling API credential to a provider-controlled CDN host.
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Kling video download failed (${response.status}): ${text.slice(0, 500)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Optional no-cost credential probe using the documented task-list query. */
export async function verifyKlingKey(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}${TASKS_PATH}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ limit: 1, filters: [{ key: "product_type", values: ["video"] }] }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await parseEnvelope<unknown>(response, "Kling credential verification");
    return true;
  } catch {
    return false;
  }
}
