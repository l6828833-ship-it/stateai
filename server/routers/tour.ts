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
  defaultDurationFor,
} from "../inworld";
import {
  assertKlingConfigured,
  decodeKlingProviderTaskId,
  downloadKlingVideo,
  encodeKlingProviderTaskId,
  findKlingTaskByExternalId,
  isVideoAspectRatio,
  KlingAmbiguousSubmissionError,
  klingExternalTaskIdForJob,
  OUTPUT_RESOLUTION,
  pollKlingJob,
  submitKlingVideo,
  type OrderedImage,
} from "../kling";
import {
  downloadLegacyOpenRouterVideo,
  hasLegacyOpenRouterKey,
  pollLegacyOpenRouterJob,
} from "../openrouter";
import { storageGetSignedUrl, storagePut } from "../storage";
import {
  getStripeGenerationEntitlement,
  verifyAdditionalVideoCheckout,
} from "../billing";
import { protectedProcedure, router } from "../_core/trpc";

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
    if (segmentLength < 2 || offset + segmentLength > buffer.length) return false;
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
      if (foundHeader || offset !== PNG_SIGNATURE.length || length !== 13) return false;
      if (buffer.readUInt32BE(offset + 8) === 0 || buffer.readUInt32BE(offset + 12) === 0) {
        return false;
      }
      foundHeader = true;
    } else if (type === "IDAT") {
      if (!foundHeader || length === 0) return false;
      foundImageData = true;
    } else if (type === "IEND") {
      return foundHeader && foundImageData && length === 0 && chunkEnd === buffer.length;
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
type GenerationJob = NonNullable<Awaited<ReturnType<typeof db.getGenerationJob>>>;

function isAdditionalVideoJob(imageSequence: string | null): boolean {
  if (!imageSequence) return false;
  try {
    const parsed = JSON.parse(imageSequence) as unknown;
    return Boolean(
      parsed &&
        typeof parsed === "object" &&
        "additionalCheckoutSessionId" in parsed &&
        typeof (parsed as { additionalCheckoutSessionId?: unknown })
          .additionalCheckoutSessionId === "string",
    );
  } catch {
    return false;
  }
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

/** Build public HTTPS URLs for stored images so external APIs can fetch them. */
async function toPublicOrderedImages(
  images: Array<{ sequenceIndex: number; fileKey: string; roomTag: string | null }>,
): Promise<OrderedImage[]> {
  return Promise.all(
    images.map(async (img) => ({
      sequenceIndex: img.sequenceIndex,
      publicUrl: await storageGetSignedUrl(img.fileKey),
      roomTag: img.roomTag,
    })),
  );
}

export const tourRouter = router({
  /** Full tool state: active project + strictly ordered images + subscription flag. */
  getState: protectedProcedure.query(async ({ ctx }) => {
    const storedProject = await db.getOrCreateActiveProject(ctx.user.id);
    const project = isVideoAspectRatio(storedProject.aspectRatio)
      ? storedProject
      : { ...storedProject, aspectRatio: "16:9" };
    if (project !== storedProject) {
      await db.updateProjectSettings(project.id, ctx.user.id, {
        aspectRatio: "16:9",
      });
    }
    const images = await db.getProjectImages(project.id, ctx.user.id);
    const clientImages = await Promise.all(
      images.map(async (image) => ({
        ...image,
        url: (await signStoredMediaUrl(image.url)) ?? image.url,
      })),
    );
    const subscribed = await db.hasActiveSubscription(ctx.user.id);
    const subscription = await db.getSubscription(ctx.user.id);
    return {
      project,
      images: clientImages,
      subscribed,
      plan: subscription?.plan ?? null,
    };
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        name: z.string().max(255).optional(),
        aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      const { projectId, ...settings } = input;
      await db.updateProjectSettings(projectId, ctx.user.id, settings);
      return { success: true } as const;
    }),

  /**
   * Upload one image (base64) with strict server-assigned sequenceIndex.
   * The index is appended at the end (max+1) atomically per-request, so the
   * uploaded order can never collide even with concurrent uploads.
   */
  uploadImage: protectedProcedure
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
            `Image is too large. Maximum size is ${MAX_IMAGE_SIZE_MB} MB`,
          ),
        roomTag: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const existing = await db.getProjectImages(project.id, ctx.user.id);
      if (existing.length >= MAX_IMAGES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Maximum ${MAX_IMAGES} photos per tour`,
        });
      }

      const buffer = decodeCanonicalBase64(input.base64Data);
      if (!buffer) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Image data is invalid" });
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
          message: "Image is invalid or its file type does not match its contents",
        });
      }

      const ext = input.mimeType === "image/png" ? "png" : input.mimeType === "image/webp" ? "webp" : "jpg";
      const nextIndex = (await db.getMaxSequenceIndex(project.id, ctx.user.id)) + 1;
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
  reorderImages: protectedProcedure
    .input(z.object({ projectId: z.number(), orderedImageIds: z.array(z.number()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      try {
        await db.reorderProjectImages(project.id, ctx.user.id, input.orderedImageIds);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Reorder failed",
        });
      }
      return { success: true } as const;
    }),

  deleteImage: protectedProcedure
    .input(z.object({ imageId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await db.deleteProjectImage(input.imageId, ctx.user.id);
      return { success: true } as const;
    }),

  updateRoomTag: protectedProcedure
    .input(z.object({ imageId: z.number(), roomTag: z.string().max(64) }))
    .mutation(async ({ ctx, input }) => {
      await db.updateImageRoomTag(input.imageId, ctx.user.id, input.roomTag);
      return { success: true } as const;
    }),

  /**
   * REAL generation — paid subscribers only. This is the ONLY code path that
   * spends official Kling API credits. Order of operations:
   *   1. verify active subscription (server-side, non-negotiable)
   *   2. load images strictly ordered by sequenceIndex, validate gapless
   *   3. hidden LLM analysis/prompt optimization (never returned to client)
   *   4. submit an official Kling 3.0 image-to-video task and persist its id
   */
  generate: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        additionalCheckoutSessionId: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subscribed = await db.hasActiveSubscription(ctx.user.id);
      if (!subscribed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "An active subscription is required to generate videos",
        });
      }

      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });

      const aspectRatio = isVideoAspectRatio(project.aspectRatio)
        ? project.aspectRatio
        : "16:9";
      if (aspectRatio !== project.aspectRatio) {
        await db.updateProjectSettings(project.id, ctx.user.id, { aspectRatio });
      }

      try {
        assertInworldConfigured();
        assertKlingConfigured();
      } catch (error) {
        console.error("[Generation] Provider configuration error", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Video generation is not configured. Please contact support.",
        });
      }

      const images = await db.getProjectImages(project.id, ctx.user.id);
      if (images.length < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Upload at least one photo first" });
      }
      if (images.length > MAX_IMAGES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Use no more than ${MAX_IMAGES} photos per video`,
        });
      }
      // Validate strict, gapless ordering before spending anything.
      const sorted = [...images].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i].sequenceIndex !== i) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Image sequence is inconsistent — please reorder your photos and try again",
          });
        }
      }

      let additionalCheckoutSessionId: string | undefined;
      if (input.additionalCheckoutSessionId) {
        try {
          const paid = await verifyAdditionalVideoCheckout(
            input.additionalCheckoutSessionId,
            ctx.user.id,
          );
          if (!paid) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "The additional-video payment could not be verified",
            });
          }
          additionalCheckoutSessionId = input.additionalCheckoutSessionId;
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          console.error("[Generation] Additional-video verification failed", error);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "The additional-video payment could not be verified",
          });
        }
      }

      let billingEntitlement:
        | { periodStart: Date; enforceAllowance: boolean; planId?: "annual" | "pro" }
        | undefined;
      try {
        billingEntitlement =
          (await getStripeGenerationEntitlement(ctx.user.id)) ?? undefined;
      } catch (error) {
        console.error("[Generation] Could not verify Stripe entitlement", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Your plan allowance could not be verified. Please try again.",
        });
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
          clipDuration: defaultDurationFor(sorted.length),
          thumbnailUrl: sorted[0]?.url ?? null,
        },
        sorted.map((image) => image.id),
        additionalCheckoutSessionId,
        billingEntitlement,
      );
      if (!reservation.ok) {
        if (reservation.reason === "limit_reached") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: `Your plan's ${reservation.allowance}-video allowance is used. Additional videos are $15 each.`,
          });
        }
        if (reservation.reason === "period_unavailable") {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Your plan allowance could not be verified. Please contact support.",
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
        let optimizedPrompt: string;
        let duration: number;
        try {
          const analysis = await analyzeAndOptimizePrompt({ images: orderedPublic });
          optimizedPrompt = analysis.optimizedPrompt;
          duration = analysis.duration;
        } catch (e) {
          console.warn("[Generation] Prompt optimization failed, using fallback:", e);
          optimizedPrompt = buildFallbackPrompt(sorted.length);
          duration = defaultDurationFor(sorted.length);
        }

        // Persist the analysis first so it survives even if the submission
        // response is lost and the task is later reconciled by external id.
        await db.updateGenerationJob(job.id, {
          optimizedPrompt,
          clipDuration: duration,
        });

        let submission: Awaited<ReturnType<typeof submitKlingVideo>>;
        try {
          submission = await submitKlingVideo({
            prompt: optimizedPrompt,
            images: orderedPublic,
            duration,
            aspectRatio,
            externalTaskId: klingExternalTaskIdForJob(job.id),
          });
        } catch (submissionError) {
          if (submissionError instanceof KlingAmbiguousSubmissionError) {
            // The task may already be accepted by Kling. Keep the job
            // processing (no stored task id yet) so pollJob reconciles it by
            // its unique external id. Never fail it here — that would let an
            // included-plan retry submit a second paid task, and it would
            // wrongly consume a paid add-on entitlement.
            console.warn("[Generation] Ambiguous Kling submission; awaiting reconciliation", {
              jobId: job.id,
            });
            const pending = await db.getGenerationJob(job.id, ctx.user.id);
            return toClientJobWithMedia(pending!, false);
          }
          throw submissionError;
        }

        await db.updateGenerationJob(job.id, {
          providerTaskId: encodeKlingProviderTaskId(submission.taskId),
        });

        const fresh = await db.getGenerationJob(job.id, ctx.user.id);
        return toClientJobWithMedia(fresh!, false);
      } catch (error) {
        console.error("[Generation] Submission failed", error);
        const message =
          "Video generation could not be started. Please try again or contact support.";
        await db.updateGenerationJob(job.id, { status: "failed", errorMessage: message });
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
   * Poll an official Kling task. A processing row without a stored task id is
   * reconciled by its unique external id, covering a crash or lost response
   * between provider acceptance and the database update. Unprefixed ids are
   * legacy OpenRouter tasks and can drain while the old key remains configured.
   */
  pollJob: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await db.getGenerationJob(input.jobId, ctx.user.id);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      const includeVideo = await db.hasActiveSubscription(ctx.user.id);
      if (job.status !== "processing") {
        return toClientJobWithMedia(job, includeVideo);
      }

      let storedTaskId = job.providerTaskId;
      let klingTaskId = decodeKlingProviderTaskId(storedTaskId);

      if (!storedTaskId) {
        try {
          const recovered = await findKlingTaskByExternalId(
            klingExternalTaskIdForJob(job.id),
          );
          if (!recovered) return toClientJobWithMedia(job, includeVideo);
          storedTaskId = encodeKlingProviderTaskId(recovered.taskId);
          klingTaskId = recovered.taskId;
          await db.updateGenerationJob(job.id, { providerTaskId: storedTaskId });
        } catch (error) {
          // The task may not be visible immediately after submission. Keep the
          // reservation processing and reconcile it on the next client poll.
          console.warn("[Generation] Kling task reconciliation failed", {
            jobId: job.id,
            error,
          });
          return toClientJobWithMedia(job, includeVideo);
        }
      }

      const provider = klingTaskId ? "kling" : "openrouter-legacy";
      const providerTaskId = klingTaskId ?? storedTaskId;
      if (!providerTaskId) return toClientJobWithMedia(job, includeVideo);
      if (provider === "openrouter-legacy" && !hasLegacyOpenRouterKey()) {
        console.error("[Generation] Legacy OpenRouter job cannot be polled without its key", {
          jobId: job.id,
        });
        return toClientJobWithMedia(job, includeVideo);
      }

      let poll: {
        status: string;
        videoUrl: string | null;
        error: string | null;
      };
      try {
        poll = klingTaskId
          ? await pollKlingJob(klingTaskId)
          : await pollLegacyOpenRouterJob(providerTaskId);
      } catch (error) {
        // Upstream polling failures are usually transient; keep processing.
        console.warn("[Generation] Provider poll error", {
          jobId: job.id,
          provider,
          error,
        });
        return toClientJobWithMedia(job, includeVideo);
      }

      if (poll.status === "completed") {
        try {
          if (!poll.videoUrl && klingTaskId) {
            throw new Error("Kling completed without a downloadable output URL");
          }
          const videoBuffer = klingTaskId
            ? await downloadKlingVideo(poll.videoUrl!)
            : await downloadLegacyOpenRouterVideo(providerTaskId, poll.videoUrl);
          const { key, url } = await storagePut(
            `user-${ctx.user.id}/videos/job-${job.id}.mp4`,
            videoBuffer,
            "video/mp4",
          );
          await db.updateGenerationJob(job.id, {
            status: "ready",
            videoKey: key,
            videoUrl: url,
          });
        } catch (error) {
          // A completed generation that cannot be archived should stop polling;
          // otherwise every five-second poll downloads and uploads it again.
          console.error("[Generation] Archival error for job", job.id, error);
          await db.updateGenerationJob(job.id, {
            status: "failed",
            errorMessage:
              "Your video was generated but could not be saved. Please try again or contact support.",
          });
        }
      } else if (["failed", "cancelled", "expired"].includes(poll.status)) {
        console.error("[Generation] Provider job ended", {
          jobId: job.id,
          provider,
          status: poll.status,
          providerError: poll.error,
        });
        await db.updateGenerationJob(job.id, {
          status: "failed",
          errorMessage: `Video generation ${poll.status}. Please try again or contact support.`,
        });
      }

      const fresh = await db.getGenerationJob(job.id, ctx.user.id);
      return toClientJobWithMedia(fresh!, includeVideo);
    }),

  /** All of the user's jobs, newest first (history view). */
  listJobs: protectedProcedure.query(async ({ ctx }) => {
    const [jobs, subscribed] = await Promise.all([
      db.listGenerationJobs(ctx.user.id),
      db.hasActiveSubscription(ctx.user.id),
    ]);
    return Promise.all(jobs.map((job) => toClientJobWithMedia(job, subscribed)));
  }),

  /** Signed download URL for a ready video — subscription required. */
  getDownloadUrl: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const subscribed = await db.hasActiveSubscription(ctx.user.id);
      if (!subscribed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "An active subscription is required to download videos",
        });
      }
      const job = await db.getGenerationJob(input.jobId, ctx.user.id);
      if (!job || job.status !== "ready" || !job.videoKey) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Video not ready" });
      }
      const url = await storageGetSignedUrl(job.videoKey);
      return { url };
    }),
});
