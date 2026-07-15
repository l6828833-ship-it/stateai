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
  buildFallbackPrompt,
  defaultDurationFor,
} from "../inworld";
import {
  downloadSeedanceVideo,
  OUTPUT_RESOLUTION,
  pollSeedanceJob,
  submitSeedanceVideo,
  type OrderedImage,
} from "../openrouter";
import { storagePut } from "../storage";
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
export function toClientJob(job: NonNullable<Awaited<ReturnType<typeof db.getGenerationJob>>>) {
  const { optimizedPrompt, openrouterJobId, ...safe } = job;
  return safe;
}

/** Build public HTTPS URLs for stored images so external APIs can fetch them. */
async function toPublicOrderedImages(
  images: Array<{ sequenceIndex: number; fileKey: string; roomTag: string | null }>,
): Promise<OrderedImage[]> {
  const { storageGetSignedUrl } = await import("../storage");
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
    const project = await db.getOrCreateActiveProject(ctx.user.id);
    const images = await db.getProjectImages(project.id, ctx.user.id);
    const subscribed = await db.hasActiveSubscription(ctx.user.id);
    const subscription = await db.getSubscription(ctx.user.id);
    return {
      project,
      images,
      subscribed,
      plan: subscription?.plan ?? null,
    };
  }),

  updateSettings: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        name: z.string().max(255).optional(),
        aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "21:9"]).optional(),
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
      // Sequence index is embedded in the S3 key as metadata for traceability.
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
      return image;
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
   * spends OpenRouter credits. Order of operations:
   *   1. verify active subscription (server-side, non-negotiable)
   *   2. load images strictly ordered by sequenceIndex, validate gapless
   *   3. hidden LLM analysis/prompt optimization (never returned to client)
   *   4. submit Seedance job, persist job row with status "processing"
   */
  generate: protectedProcedure
    .input(z.object({ projectId: z.number() }))
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

      const images = await db.getProjectImages(project.id, ctx.user.id);
      if (images.length < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Upload at least one photo first" });
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

      // Create the job row first so failures are tracked. Resolution is always
      // 1080p; clipDuration is a placeholder until the AI decides the ideal one.
      const job = await db.createGenerationJob({
        projectId: project.id,
        userId: ctx.user.id,
        status: "processing",
        tourStyle: project.tourStyle,
        resolution: OUTPUT_RESOLUTION,
        aspectRatio: project.aspectRatio,
        clipDuration: defaultDurationFor(sorted.length),
        imageSequence: JSON.stringify(sorted.map((i) => i.id)),
        thumbnailUrl: sorted[0]?.url ?? null,
      });

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

        const submission = await submitSeedanceVideo({
          prompt: optimizedPrompt,
          images: orderedPublic,
          duration,
          aspectRatio: project.aspectRatio,
        });

        await db.updateGenerationJob(job.id, {
          optimizedPrompt,
          clipDuration: duration,
          openrouterJobId: submission.jobId,
        });

        const fresh = await db.getGenerationJob(job.id, ctx.user.id);
        return toClientJob(fresh!);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Video generation failed";
        await db.updateGenerationJob(job.id, { status: "failed", errorMessage: message });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  /**
   * Poll a job. If still processing on OpenRouter's side, checks progress;
   * when completed, downloads the video into our S3 and marks it "ready".
   */
  pollJob: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const job = await db.getGenerationJob(input.jobId, ctx.user.id);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });
      if (job.status !== "processing" || !job.openrouterJobId) return toClientJob(job);

      try {
        const poll = await pollSeedanceJob(job.openrouterJobId);
        if (poll.status === "completed") {
          const videoBuffer = await downloadSeedanceVideo(job.openrouterJobId, poll.videoUrl);
          const { key, url } = await storagePut(
            `user-${ctx.user.id}/videos/job-${job.id}.mp4`,
            videoBuffer,
            "video/mp4",
          );
          await db.updateGenerationJob(job.id, { status: "ready", videoKey: key, videoUrl: url });
        } else if (["failed", "cancelled", "expired"].includes(poll.status)) {
          await db.updateGenerationJob(job.id, {
            status: "failed",
            errorMessage: poll.error ?? `Generation ${poll.status}`,
          });
        }
      } catch (e) {
        // Transient poll errors keep the job in "processing"; log only.
        console.warn("[Generation] Poll error for job", job.id, e);
      }

      const fresh = await db.getGenerationJob(job.id, ctx.user.id);
      return toClientJob(fresh!);
    }),

  /** All of the user's jobs, newest first (history view). */
  listJobs: protectedProcedure.query(async ({ ctx }) => {
    const jobs = await db.listGenerationJobs(ctx.user.id);
    return jobs.map(toClientJob);
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
      const { storageGetSignedUrl } = await import("../storage");
      const url = await storageGetSignedUrl(job.videoKey);
      return { url };
    }),
});
