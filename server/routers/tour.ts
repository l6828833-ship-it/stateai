import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  MAX_IMAGE_BASE64_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_SIZE_MB,
  MAX_IMAGES,
} from "@shared/plans";
import * as db from "../db";
import {
  analyzeAndOptimizePrompt,
  assertInworldConfigured,
  buildFallbackPrompt,
  buildFallbackShotPrompts,
  defaultDurationFor,
  normalizeSegmentDurations,
  segmentCountFor,
} from "../inworld";
import {
  assertKlingConfigured,
  decodeKlingProviderTaskId,
  downloadKlingVideo,
  isVideoAspectRatio,
  KlingAmbiguousSubmissionError,
  klingSegmentExternalTaskId,
  OUTPUT_RESOLUTION,
  planKlingSegments,
  pollKlingJob,
  pollKlingSegments,
  submitKlingVideo,
  type OrderedImage,
} from "../kling";
import { concatMp4Segments } from "../video";
import { storageGetSignedUrl, storagePut } from "../storage";
import {
  getStripeGenerationEntitlement,
  verifyAdditionalVideoCheckout,
  type GenerationEntitlement,
} from "../billing";
import { appProcedure, router } from "../_core/trpc";

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function isValidJpeg(buffer: Buffer): boolean {
  const endMarker = Buffer.from([0xff, 0xd9]);
  if (
    buffer.length < 64 ||
    buffer[0] !== 0xff ||
    buffer[1] !== 0xd8 ||
    buffer.lastIndexOf(endMarker) < 3
  ) {
    return false;
  }

  let offset = 2;
  let foundFrame = false;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset++;
    if (offset >= buffer.length) return false;
    const marker = buffer[offset++];
    if (marker === 0xd9) return false;
    if (marker === 0xda) {
      if (!foundFrame || offset + 2 > buffer.length) return false;
      const scanHeaderLength = buffer.readUInt16BE(offset);
      const scanDataStart = offset + scanHeaderLength;
      return (
        scanHeaderLength >= 2 &&
        scanDataStart < buffer.length &&
        buffer.lastIndexOf(endMarker) > scanDataStart
      );
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return false;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length)
      return false;
    if (isJpegStartOfFrame(marker)) {
      if (segmentLength < 7) return false;
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width === 0 || height === 0) return false;
      foundFrame = true;
    }
    offset += segmentLength;
  }
  return false;
}

function isValidPng(buffer: Buffer): boolean {
  if (
    buffer.length < 45 ||
    !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  let foundHeader = false;
  let foundImageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) return false;

    if (type === "IHDR") {
      if (foundHeader || offset !== PNG_SIGNATURE.length || length !== 13)
        return false;
      if (
        buffer.readUInt32BE(offset + 8) === 0 ||
        buffer.readUInt32BE(offset + 12) === 0
      ) {
        return false;
      }
      foundHeader = true;
    } else if (type === "IDAT") {
      if (!foundHeader || length === 0) return false;
      foundImageData = true;
    } else if (type === "IEND") {
      return (
        foundHeader &&
        foundImageData &&
        length === 0 &&
        chunkEnd === buffer.length
      );
    }
    offset = chunkEnd;
  }
  return false;
}

function isValidWebp(buffer: Buffer): boolean {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP" ||
    buffer.readUInt32LE(4) + 8 !== buffer.length
  ) {
    return false;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString("ascii", offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const chunkEnd = dataStart + length;
    if (chunkEnd > buffer.length) return false;

    if (type === "VP8 " && length >= 10) {
      const hasFrameHeader =
        buffer[dataStart + 3] === 0x9d &&
        buffer[dataStart + 4] === 0x01 &&
        buffer[dataStart + 5] === 0x2a;
      const width = buffer.readUInt16LE(dataStart + 6) & 0x3fff;
      const height = buffer.readUInt16LE(dataStart + 8) & 0x3fff;
      return hasFrameHeader && width > 0 && height > 0;
    }
    if (type === "VP8L" && length >= 5) return buffer[dataStart] === 0x2f;
    if (type === "VP8X" && length < 10) return false;
    offset = chunkEnd + (length % 2);
  }
  return false;
}

function hasValidImageStructure(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === "image/jpeg") return isValidJpeg(buffer);
  if (mimeType === "image/png") return isValidPng(buffer);
  if (mimeType === "image/webp") return isValidWebp(buffer);
  return false;
}

/** Strip server-only fields before returning a job to the client. */
type GenerationJob = NonNullable<
  Awaited<ReturnType<typeof db.getGenerationJob>>
>;

function isAdditionalVideoJob(imageSequence: string | null): boolean {
  if (!imageSequence) return false;
  try {
    const parsed = JSON.parse(imageSequence) as unknown;
    return Boolean(
      parsed &&
      typeof parsed === "object" &&
      "additionalCheckoutSessionId" in parsed &&
      typeof (parsed as { additionalCheckoutSessionId?: unknown })
        .additionalCheckoutSessionId === "string"
    );
  } catch {
    return false;
  }
}

async function canAccessJobMedia(
  userId: number,
  job: GenerationJob
): Promise<boolean> {
  return (
    isAdditionalVideoJob(job.imageSequence) ||
    (await db.hasActiveSubscription(userId))
  );
}

export function toClientJob(job: GenerationJob) {
  const {
    optimizedPrompt,
    providerTaskId,
    videoKey,
    errorMessage,
    imageSequence,
    ...safe
  } = job;
  const additionalVideo = isAdditionalVideoJob(imageSequence);
  return {
    ...safe,
    additionalVideo,
    errorMessage:
      job.status === "failed"
        ? additionalVideo
          ? "Your paid additional video failed and was not resubmitted. Contact support for a refund or replacement."
          : "Video generation failed. Please try again or contact support."
        : null,
  };
}

/** Convert stable storage paths into short-lived URLs for native media elements. */
async function signStoredMediaUrl(url: string | null): Promise<string | null> {
  if (!url?.startsWith("/manus-storage/")) return url;

  const encodedKey = url.slice("/manus-storage/".length).split(/[?#]/, 1)[0];
  if (!encodedKey) return url;

  let key: string;
  try {
    key = decodeURIComponent(encodedKey);
  } catch {
    console.warn("[Storage] Could not decode media path for signing");
    return url;
  }

  try {
    return await storageGetSignedUrl(key);
  } catch (error) {
    // Keep the compatibility URL so one missing legacy object does not make
    // the entire project or history query fail.
    console.error("[Storage] Could not sign client media URL", error);
    return url;
  }
}

async function toClientJobWithMedia(job: GenerationJob, includeVideo: boolean) {
  const safe = toClientJob(job);
  const [thumbnailUrl, videoUrl] = await Promise.all([
    signStoredMediaUrl(safe.thumbnailUrl),
    includeVideo ? signStoredMediaUrl(safe.videoUrl) : Promise.resolve(null),
  ]);
  return { ...safe, thumbnailUrl, videoUrl };
}

/**
 * Safety net for stranded jobs. If a segment submission was ambiguous AND Kling
 * never actually accepted it, that segment stays unknown forever, so the job
 * would never reach ready or failed on its own — silently holding a plan
 * allowance slot. Kling tasks finish in minutes (and segments run in parallel),
 * so a generous ceiling fails a truly stuck job to free the slot without
 * cutting off a legitimately slow generation.
 */
const MAX_PROCESSING_AGE_MS = 45 * 60 * 1000;

const DEFAULT_PLAN_LIMITS = {
  maxImages: MAX_IMAGES,
  maxDurationSeconds: 15,
  additionalVideoPriceUsd: 17,
};

function standaloneVideoEntitlement(): GenerationEntitlement {
  const now = new Date();
  return {
    periodStart: now,
    periodEnd: now,
    enforceAllowance: false,
    includedVideos: 1,
    maxImages: DEFAULT_PLAN_LIMITS.maxImages,
    maxDurationSeconds: DEFAULT_PLAN_LIMITS.maxDurationSeconds,
    additionalVideoPriceUsd: DEFAULT_PLAN_LIMITS.additionalVideoPriceUsd,
  };
}

async function resolvePlanLimits(userId: number) {
  const fallback = DEFAULT_PLAN_LIMITS;
  try {
    const entitlement = await getStripeGenerationEntitlement(userId);
    return entitlement
      ? {
          maxImages: entitlement.maxImages,
          maxDurationSeconds: entitlement.maxDurationSeconds,
          additionalVideoPriceUsd: entitlement.additionalVideoPriceUsd,
        }
      : fallback;
  } catch (error) {
    // Uploads can safely retain Starter limits during a transient Stripe outage;
    // costly generation still verifies the exact entitlement fail-closed.
    console.warn(
      "[Billing] Using safe upload limits while Stripe is unavailable",
      {
        userId,
        error,
      }
    );
    return fallback;
  }
}

/** Recover how many images a job was reserved with, from its stored sequence. */
function imageCountFromSequence(imageSequence: string | null): number {
  if (!imageSequence) return 0;
  try {
    const parsed = JSON.parse(imageSequence) as unknown;
    if (Array.isArray(parsed)) return parsed.length;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { imageIds?: unknown }).imageIds)
    ) {
      return (parsed as { imageIds: unknown[] }).imageIds.length;
    }
  } catch {
    // Fall through to 0 — caller keeps the job processing rather than guessing.
  }
  return 0;
}

/**
 * Poll + archive a legacy single-task job (created before multi-segment). It
 * polls one Kling task and, on success, downloads and archives its single MP4.
 * Mutates the job row; the caller re-reads and serializes it.
 */
async function pollLegacySingleTaskJob(
  userId: number,
  jobId: number,
  klingTaskId: string
): Promise<void> {
  let poll: Awaited<ReturnType<typeof pollKlingJob>>;
  try {
    poll = await pollKlingJob(klingTaskId);
  } catch (error) {
    console.warn("[Generation] Kling poll error", { jobId, error });
    return;
  }

  if (poll.status === "completed") {
    try {
      if (!poll.videoUrl) {
        throw new Error("Kling completed without a downloadable output URL");
      }
      const videoBuffer = await downloadKlingVideo(poll.videoUrl);
      const { key, url } = await storagePut(
        `user-${userId}/videos/job-${jobId}.mp4`,
        videoBuffer,
        "video/mp4"
      );
      await db.updateGenerationJob(jobId, {
        status: "ready",
        videoKey: key,
        videoUrl: url,
      });
    } catch (error) {
      console.error("[Generation] Archival error for job", jobId, error);
      await db.updateGenerationJob(jobId, {
        status: "failed",
        errorMessage:
          "Your video was generated but could not be saved. Please try again or contact support.",
      });
    }
  } else if (poll.status === "failed") {
    console.error("[Generation] Kling job failed", {
      jobId,
      providerError: poll.error,
    });
    await db.updateGenerationJob(jobId, {
      status: "failed",
      errorMessage:
        "Video generation failed. Please try again or contact support.",
    });
  }
}

/** Build public HTTPS URLs for stored images so external APIs can fetch them. */
async function toPublicOrderedImages(
  images: Array<{
    sequenceIndex: number;
    fileKey: string;
    roomTag: string | null;
  }>
): Promise<OrderedImage[]> {
  return Promise.all(
    images.map(async img => ({
      sequenceIndex: img.sequenceIndex,
      publicUrl: await storageGetSignedUrl(img.fileKey),
      roomTag: img.roomTag,
    }))
  );
}

export const tourRouter = router({
  /** Full tool state: active project + strictly ordered images + subscription flag. */
  getState: appProcedure.query(async ({ ctx }) => {
    const storedProject = await db.getOrCreateActiveProject(ctx.user.id);
    const project = isVideoAspectRatio(storedProject.aspectRatio)
      ? storedProject
      : { ...storedProject, aspectRatio: "16:9" };
    if (project !== storedProject) {
      await db.updateProjectSettings(project.id, ctx.user.id, {
        aspectRatio: "16:9",
      });
    }
    const [images, subscription] = await Promise.all([
      db.getProjectImages(project.id, ctx.user.id),
      db.getSubscriptionAccess(ctx.user.id),
    ]);
    const clientImages = await Promise.all(
      images.map(async image => ({
        ...image,
        url: (await signStoredMediaUrl(image.url)) ?? image.url,
      }))
    );
    return {
      project,
      images: clientImages,
      subscribed: subscription.subscribed,
      plan: subscription.plan,
    };
  }),

  /** Exact Stripe-backed limits, loaded separately so dashboard startup stays resilient. */
  getPlanEntitlement: appProcedure.query(async ({ ctx }) => {
    const subscription = await db.getSubscriptionAccess(ctx.user.id);
    if (!subscription.subscribed) return null;
    const entitlement = await getStripeGenerationEntitlement(ctx.user.id);
    if (!entitlement) return null;
    return {
      maxImages: entitlement.maxImages,
      maxDurationSeconds: entitlement.maxDurationSeconds,
      additionalVideoPriceUsd: entitlement.additionalVideoPriceUsd,
    };
  }),

  updateSettings: appProcedure
    .input(
      z.object({
        projectId: z.number(),
        name: z.string().max(255).optional(),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      const { projectId, ...settings } = input;
      await db.updateProjectSettings(projectId, ctx.user.id, settings);
      return { success: true } as const;
    }),

  /**
   * Upload one image (base64) with strict server-assigned sequenceIndex.
   * The index is appended at the end (max+1) atomically per-request, so the
   * uploaded order can never collide even with concurrent uploads.
   */
  uploadImage: appProcedure
    .input(
      z.object({
        projectId: z.number(),
        fileName: z.string().max(255),
        mimeType: z.string().regex(/^image\/(jpeg|png|webp)$/),
        base64Data: z
          .string()
          .min(1, "Image data is empty")
          .max(
            MAX_IMAGE_BASE64_LENGTH,
            `Image is too large. Maximum size is ${MAX_IMAGE_SIZE_MB} MB`
          ),
        roomTag: z.string().max(64).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });

      const { maxImages } = await resolvePlanLimits(ctx.user.id);
      const existing = await db.getProjectImages(project.id, ctx.user.id);
      if (existing.length >= maxImages) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Maximum ${maxImages} photos per tour`,
        });
      }

      const buffer = decodeCanonicalBase64(input.base64Data);
      if (!buffer) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Image data is invalid",
        });
      }
      if (buffer.length > MAX_IMAGE_BYTES) {
        throw new TRPCError({
          code: "PAYLOAD_TOO_LARGE",
          message: `Image is too large. Maximum size is ${MAX_IMAGE_SIZE_MB} MB`,
        });
      }
      if (!hasValidImageStructure(buffer, input.mimeType)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Image is invalid or its file type does not match its contents",
        });
      }

      const ext =
        input.mimeType === "image/png"
          ? "png"
          : input.mimeType === "image/webp"
            ? "webp"
            : "jpg";
      const nextIndex =
        (await db.getMaxSequenceIndex(project.id, ctx.user.id)) + 1;
      // Sequence index is embedded in the object key for traceability.
      const relKey = `user-${ctx.user.id}/project-${project.id}/seq-${String(nextIndex).padStart(3, "0")}.${ext}`;
      const { key, url } = await storagePut(relKey, buffer, input.mimeType);

      const image = await db.addProjectImage({
        projectId: project.id,
        userId: ctx.user.id,
        sequenceIndex: nextIndex,
        fileKey: key,
        url,
        fileName: input.fileName,
        mimeType: input.mimeType,
        roomTag: input.roomTag ?? null,
      });
      return {
        ...image,
        url: (await signStoredMediaUrl(image.url)) ?? image.url,
      };
    }),

  /** Reorder: array index = new sequenceIndex. Set must match exactly. */
  reorderImages: appProcedure
    .input(
      z.object({
        projectId: z.number(),
        orderedImageIds: z.array(z.number()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });
      try {
        await db.reorderProjectImages(
          project.id,
          ctx.user.id,
          input.orderedImageIds
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Reorder failed",
        });
      }
      return { success: true } as const;
    }),

  deleteImage: appProcedure
    .input(z.object({ imageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteProjectImage(input.imageId, ctx.user.id);
      return { success: true } as const;
    }),

  updateRoomTag: appProcedure
    .input(z.object({ imageId: z.number(), roomTag: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      await db.updateImageRoomTag(input.imageId, ctx.user.id, input.roomTag);
      return { success: true } as const;
    }),

  /**
   * REAL generation — active subscribers or verified one-video buyers only.
   * This is the ONLY code path that spends official Kling API credits.
   */
  generate: appProcedure
    .input(
      z.object({
        projectId: z.number(),
        additionalCheckoutSessionId: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Lost responses and refresh retries must recover the job already bound
      // to this paid Session without depending on mutable project, plan, or
      // Stripe state. The lookup remains owner-scoped, and first redemption is
      // still serialized inside reserveGenerationJob.
      if (input.additionalCheckoutSessionId) {
        const existing = await db.getGenerationJobByAdditionalCheckoutSession(
          input.additionalCheckoutSessionId,
          ctx.user.id
        );
        if (existing) return toClientJobWithMedia(existing, true);
      }

      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Project not found",
        });

      const aspectRatio = isVideoAspectRatio(project.aspectRatio)
        ? project.aspectRatio
        : "16:9";
      if (aspectRatio !== project.aspectRatio) {
        await db.updateProjectSettings(project.id, ctx.user.id, {
          aspectRatio,
        });
      }

      try {
        assertInworldConfigured();
        assertKlingConfigured();
      } catch (error) {
        console.error("[Generation] Provider configuration error", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Video generation is not configured. Please contact support.",
        });
      }

      const images = await db.getProjectImages(project.id, ctx.user.id);
      if (images.length < 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Upload at least one photo first",
        });
      }
      let additionalCheckoutSessionId: string | undefined;
      let additionalPurchase:
        | Awaited<ReturnType<typeof verifyAdditionalVideoCheckout>>
        | undefined;
      if (input.additionalCheckoutSessionId) {
        try {
          additionalPurchase = await verifyAdditionalVideoCheckout(
            input.additionalCheckoutSessionId,
            ctx.user.id
          );
          if (!additionalPurchase) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "The one-video payment could not be verified",
            });
          }
          additionalCheckoutSessionId = input.additionalCheckoutSessionId;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          console.error(
            "[Generation] One-video payment verification failed",
            error
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The one-video payment could not be verified",
          });
        }
      }

      let billingEntitlement: GenerationEntitlement | undefined;
      try {
        billingEntitlement =
          (await getStripeGenerationEntitlement(ctx.user.id)) ?? undefined;
      } catch (error) {
        console.error(
          "[Generation] Could not verify Stripe subscription entitlement",
          error
        );
        if (additionalPurchase?.scope !== "standalone_starter") {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Your plan allowance could not be verified. Please try again.",
          });
        }
      }
      if (!billingEntitlement && additionalPurchase) {
        if (additionalPurchase.scope !== "standalone_starter") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "This plan add-on requires an active subscription. Buy a $17 standalone video instead.",
          });
        }
        billingEntitlement = standaloneVideoEntitlement();
      }
      if (!billingEntitlement) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Choose a plan or buy one pay-as-you-go video before generating",
        });
      }
      if (images.length > billingEntitlement.maxImages) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Use no more than ${billingEntitlement.maxImages} photos per video`,
        });
      }
      // Validate strict, gapless ordering before spending anything.
      const sorted = [...images].sort(
        (a, b) => a.sequenceIndex - b.sequenceIndex
      );
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].sequenceIndex !== i) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Image sequence is inconsistent — please reorder your photos and try again",
          });
        }
      }

      // Reserve the plan allowance and create the job under one database lock.
      // This prevents concurrent requests from both claiming the final video.
      const reservation = await db.reserveGenerationJob(
        {
          projectId: project.id,
          userId: ctx.user.id,
          status: "processing",
          tourStyle: project.tourStyle,
          resolution: OUTPUT_RESOLUTION,
          aspectRatio,
          clipDuration: defaultDurationFor(
            sorted.length,
            billingEntitlement.maxDurationSeconds
          ),
          thumbnailUrl: sorted[0]?.url ?? null,
        },
        sorted.map(image => image.id),
        additionalCheckoutSessionId,
        billingEntitlement
      );
      if (!reservation.ok) {
        if (reservation.reason === "limit_reached") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Your plan's ${reservation.allowance}-video allowance is used. Additional videos are $${billingEntitlement.additionalVideoPriceUsd} each.`,
          });
        }
        if (reservation.reason === "period_unavailable") {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Your plan allowance could not be verified. Please contact support.",
          });
        }
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "An active subscription is required to generate videos",
        });
      }
      const job = reservation.job;
      if (!reservation.shouldSubmit) {
        return toClientJobWithMedia(job, true);
      }

      try {
        const orderedPublic = await toPublicOrderedImages(sorted);

        // HIDDEN STEP — Claude Sonnet analyzes the photos and decides the camera
        // movement, the optimized prompt AND the ideal clip length. Failure
        // falls back to a solid template rather than blocking paid generation.
        // styleGuide is stored for the record; shotPrompts drive each shot.
        let styleGuide: string;
        let shotPrompts: string[];
        let segmentDurations: number[];
        try {
          const analysis = await analyzeAndOptimizePrompt({
            images: orderedPublic,
            maxDurationSeconds: billingEntitlement.maxDurationSeconds,
          });
          styleGuide = analysis.styleGuide;
          shotPrompts = analysis.shotPrompts;
          segmentDurations = analysis.segmentDurations;
        } catch (e) {
          console.warn(
            "[Generation] Prompt optimization failed, using fallback:",
            e
          );
          styleGuide = buildFallbackPrompt(sorted.length);
          shotPrompts = buildFallbackShotPrompts(
            sorted.length,
            orderedPublic.map(image => image.roomTag)
          );
          segmentDurations = []; // per-segment default applied below
        }

        // One independent single-frame shot per image. Each shot animates the
        // camera within its own photo; the shots are polled, then stitched with
        // hard cuts between them (no morphing between different rooms).
        const segments = planKlingSegments(orderedPublic);
        // Provider segments remain within Kling's valid 3–6 second range.
        // Post-production applies the plan's final-output cap when necessary.
        const durations = normalizeSegmentDurations(
          segments.map(segment => segmentDurations[segment.index]),
          segments.length,
          billingEntitlement.maxDurationSeconds
        );
        const sourceDuration = durations.reduce((sum, value) => sum + value, 0);
        const finalDuration = Math.min(
          sourceDuration,
          billingEntitlement.maxDurationSeconds
        );

        // Persist the analysis and total length first so they survive even if a
        // submission response is lost; segments are reconciled by their
        // deterministic external ids on poll.
        await db.updateGenerationJob(job.id, {
          optimizedPrompt: styleGuide,
          clipDuration: finalDuration,
        });

        // Submit each segment once. The external id is deterministic per
        // (job, segment), so a lost response is recovered on poll rather than
        // re-POSTed. A definitive rejection fails the whole job; an ambiguous
        // (network) outcome is tolerated so we neither double-submit nor
        // wrongly consume a paid add-on entitlement.
        let sawAmbiguousSegment = false;
        for (const segment of segments) {
          try {
            await submitKlingVideo({
              // Each image gets its OWN scene-specific prompt (falling back to
              // the shared style guide only if a shot prompt is missing).
              prompt: shotPrompts[segment.index] ?? styleGuide,
              images: segment.images,
              duration: durations[segment.index],
              aspectRatio,
              externalTaskId: klingSegmentExternalTaskId(job.id, segment.index),
            });
          } catch (segmentError) {
            if (segmentError instanceof KlingAmbiguousSubmissionError) {
              sawAmbiguousSegment = true;
              continue;
            }
            throw segmentError;
          }
        }
        if (sawAmbiguousSegment) {
          console.warn(
            "[Generation] One or more Kling segment submissions were ambiguous; pollJob will reconcile by external id",
            { jobId: job.id }
          );
        }

        const fresh = await db.getGenerationJob(job.id, ctx.user.id);
        return toClientJobWithMedia(fresh!, false);
      } catch (error) {
        console.error("[Generation] Submission failed", error);
        const message =
          "Video generation could not be started. Please try again or contact support.";
        await db.updateGenerationJob(job.id, {
          status: "failed",
          errorMessage: message,
        });
        if (additionalCheckoutSessionId) {
          // The paid Session is already consumed by this at-most-once job.
          // Return the terminal job so the browser can immediately clear its
          // pending Session and show refund/replacement guidance without a
          // misleading second Generate click.
          const failedJob = await db.getGenerationJob(job.id, ctx.user.id);
          if (failedJob) return toClientJobWithMedia(failedJob, false);
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  /**
   * Poll a generation job.
   *
   * - Legacy single-task jobs (a Kling task id stored in providerTaskId) keep
   *   the original single-clip path.
   * - Multi-segment jobs reconcile every consecutive-pair segment by its
   *   deterministic external id in one batch query. When ALL segments have
   *   succeeded, their videos are downloaded in order, concatenated into one
   *   MP4, and archived. A single failed segment fails the whole job.
   */
  pollJob: appProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await db.getGenerationJob(input.jobId, ctx.user.id);
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      const includeVideo = await canAccessJobMedia(ctx.user.id, job);
      if (job.status !== "processing") {
        return toClientJobWithMedia(job, includeVideo);
      }

      // Fail a job that has been processing implausibly long (e.g. an ambiguous
      // submission Kling never actually accepted) so it stops holding a plan
      // allowance slot. Failed jobs are excluded from the allowance count.
      if (Date.now() - job.createdAt.getTime() > MAX_PROCESSING_AGE_MS) {
        console.error(
          "[Generation] Job exceeded max processing age; failing to free allowance",
          {
            jobId: job.id,
          }
        );
        await db.updateGenerationJob(job.id, {
          status: "failed",
          errorMessage:
            "Video generation timed out. Please try again or contact support.",
        });
        const timedOut = await db.getGenerationJob(job.id, ctx.user.id);
        return toClientJobWithMedia(timedOut!, includeVideo);
      }

      // Backward compatibility: jobs created by the earlier single-task flow.
      const legacyTaskId = decodeKlingProviderTaskId(job.providerTaskId);
      if (legacyTaskId) {
        await pollLegacySingleTaskJob(ctx.user.id, job.id, legacyTaskId);
        const refreshed = await db.getGenerationJob(job.id, ctx.user.id);
        return toClientJobWithMedia(refreshed!, includeVideo);
      }

      const imageCount = imageCountFromSequence(job.imageSequence);
      if (imageCount === 0) {
        // Cannot determine the segment plan yet; never guess (that could
        // archive a truncated video). Keep processing and retry next poll.
        return toClientJobWithMedia(job, includeVideo);
      }
      // One shot per image (hard-cut tour), so the shot count equals the image
      // count. Must match planKlingSegments used at submission time.
      const segmentCount = segmentCountFor(imageCount);
      const externalIds = Array.from({ length: segmentCount }, (_, i) =>
        klingSegmentExternalTaskId(job.id, i)
      );

      let segments: Awaited<ReturnType<typeof pollKlingSegments>>;
      try {
        segments = await pollKlingSegments(externalIds);
      } catch (error) {
        console.warn("[Generation] Kling segment poll error", {
          jobId: job.id,
          error,
        });
        return toClientJobWithMedia(job, includeVideo);
      }

      if (segments.some(segment => segment.status === "failed")) {
        console.error("[Generation] A Kling segment failed", {
          jobId: job.id,
          errors: segments
            .filter(segment => segment.status === "failed")
            .map(segment => segment.error),
        });
        await db.updateGenerationJob(job.id, {
          status: "failed",
          errorMessage:
            "Video generation failed. Please try again or contact support.",
        });
        const failed = await db.getGenerationJob(job.id, ctx.user.id);
        return toClientJobWithMedia(failed!, includeVideo);
      }

      const allReady = segments.every(
        segment =>
          segment.found && segment.status === "completed" && segment.videoUrl
      );
      if (!allReady) {
        return toClientJobWithMedia(job, includeVideo); // keep processing
      }

      try {
        // Download every segment in order, then stitch into one continuous MP4.
        const buffers: Buffer[] = [];
        for (const segment of segments) {
          buffers.push(await downloadKlingVideo(segment.videoUrl!));
        }
        const finalVideo = await concatMp4Segments(
          buffers,
          job.aspectRatio,
          job.clipDuration
        );
        const { key, url } = await storagePut(
          `user-${ctx.user.id}/videos/job-${job.id}.mp4`,
          finalVideo,
          "video/mp4"
        );
        await db.updateGenerationJob(job.id, {
          status: "ready",
          videoKey: key,
          videoUrl: url,
        });
      } catch (error) {
        // A generation that cannot be assembled/archived should stop polling;
        // otherwise every five-second poll re-downloads and re-encodes it.
        console.error("[Generation] Segment assembly/archival error", {
          jobId: job.id,
          error,
        });
        await db.updateGenerationJob(job.id, {
          status: "failed",
          errorMessage:
            "Your video was generated but could not be assembled. Please try again or contact support.",
        });
      }

      const fresh = await db.getGenerationJob(job.id, ctx.user.id);
      return toClientJobWithMedia(fresh!, includeVideo);
    }),

  /** All of the user's jobs, newest first (history view). */
  listJobs: appProcedure.query(async ({ ctx }) => {
    const [jobs, subscription] = await Promise.all([
      db.listGenerationJobs(ctx.user.id),
      db.getSubscriptionAccess(ctx.user.id),
    ]);
    return Promise.all(
      jobs.map(job =>
        toClientJobWithMedia(
          job,
          subscription.subscribed || isAdditionalVideoJob(job.imageSequence)
        )
      )
    );
  }),

  /** Signed download URL for a ready subscription or paid one-video job. */
  getDownloadUrl: appProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const job = await db.getGenerationJob(input.jobId, ctx.user.id);
      if (!job || job.status !== "ready" || !job.videoKey) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not ready" });
      }
      if (!(await canAccessJobMedia(ctx.user.id, job))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "A subscription or paid one-video purchase is required to download this video",
        });
      }
      const url = await storageGetSignedUrl(job.videoKey);
      return { url };
    }),
});
