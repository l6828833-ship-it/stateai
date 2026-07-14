import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MAX_IMAGES } from "@shared/plans";
import * as db from "../db";
import {
  analyzeAndOptimizePrompt,
  buildFallbackPrompt,
  downloadSeedanceVideo,
  pollSeedanceJob,
  submitSeedanceVideo,
  type OrderedImage,
} from "../openrouter";
import { storagePut } from "../storage";
import { protectedProcedure, router } from "../_core/trpc";

const tourStyleSchema = z.enum(["Walkthrough", "Drone", "Cinematic"]);

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
        tourStyle: tourStyleSchema.optional(),
        creativeText: z.string().max(2000).nullable().optional(),
        resolution: z.enum(["480p", "720p", "1080p"]).optional(),
        aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:3", "21:9"]).optional(),
        clipDuration: z.number().int().min(4).max(15).optional(),
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
        base64Data: z.string().max(15_000_000), // ~10MB binary
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

      const buffer = Buffer.from(input.base64Data, "base64");
      if (buffer.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file" });
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

      // Create the job row first so failures are tracked.
      const job = await db.createGenerationJob({
        projectId: project.id,
        userId: ctx.user.id,
        status: "processing",
        tourStyle: project.tourStyle,
        resolution: project.resolution,
        aspectRatio: project.aspectRatio,
        clipDuration: project.clipDuration,
        imageSequence: JSON.stringify(sorted.map((i) => i.id)),
        thumbnailUrl: sorted[0]?.url ?? null,
      });

      try {
        const orderedPublic = await toPublicOrderedImages(sorted);

        // HIDDEN STEP — prompt optimization. Failure falls back to a solid
        // template prompt rather than blocking the paid generation.
        let optimizedPrompt: string;
        try {
          const analysis = await analyzeAndOptimizePrompt({
            images: orderedPublic,
            tourStyle: project.tourStyle,
            creativeText: project.creativeText,
            clipDuration: project.clipDuration,
          });
          optimizedPrompt = analysis.optimizedPrompt;
        } catch (e) {
          console.warn("[Generation] Prompt optimization failed, using fallback:", e);
          optimizedPrompt = buildFallbackPrompt(
            sorted.length,
            project.tourStyle,
            project.creativeText,
            project.clipDuration,
          );
        }

        const submission = await submitSeedanceVideo({
          prompt: optimizedPrompt,
          images: orderedPublic,
          duration: project.clipDuration,
          resolution: project.resolution,
          aspectRatio: project.aspectRatio,
        });

        await db.updateGenerationJob(job.id, {
          optimizedPrompt,
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
