/**
 * Server-side video assembly — SERVER-SIDE ONLY.
 *
 * Kling generates each tour as a set of short first/last-frame segments (one
 * per consecutive image pair). This module concatenates those segment MP4s
 * into a single continuous tour video using ffmpeg.
 *
 * Every segment is normalized (scale + pad to a common canvas, constant fps,
 * square pixels) before concatenation so clips derived from photos of slightly
 * different dimensions still join cleanly. Audio is dropped (tours are silent).
 *
 * Requires the `ffmpeg` binary on PATH (installed via nixpacks.toml aptPkgs).
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FFMPEG_TIMEOUT_MS = 180_000;
const OUTPUT_FPS = 30;

/** Target canvas per supported aspect ratio (Full HD long edge). */
function targetDimensions(aspectRatio: string): { width: number; height: number } {
  switch (aspectRatio) {
    case "9:16":
      return { width: 1080, height: 1920 };
    case "1:1":
      return { width: 1080, height: 1080 };
    case "16:9":
    default:
      return { width: 1920, height: 1080 };
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderrTail = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("ffmpeg timed out while assembling the tour video"));
    }, FFMPEG_TIMEOUT_MS);

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg is not available: ${error.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail.slice(-500)}`));
    });
  });
}

/**
 * Concatenate ordered MP4 segment buffers into one MP4. A single segment is
 * returned unchanged. Re-encodes to H.264 (yuv420p) with a normalized canvas
 * and fps so heterogeneous segments join without artifacts.
 */
export async function concatMp4Segments(
  segments: Buffer[],
  aspectRatio: string,
): Promise<Buffer> {
  if (segments.length === 0) {
    throw new Error("No video segments to concatenate");
  }
  if (segments.length === 1) {
    return segments[0];
  }

  const { width, height } = targetDimensions(aspectRatio);
  const dir = await mkdtemp(join(tmpdir(), "estatetour-concat-"));
  try {
    const inputArgs: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const path = join(dir, `seg-${i}.mp4`);
      await writeFile(path, segments[i]);
      inputArgs.push("-i", path);
    }

    // Normalize each input, then concat the normalized video streams.
    const normalized = segments
      .map(
        (_, i) =>
          `[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${OUTPUT_FPS}[v${i}]`,
      )
      .join(";");
    const concatInputs = segments.map((_, i) => `[v${i}]`).join("");
    const filter = `${normalized};${concatInputs}concat=n=${segments.length}:v=1:a=0[outv]`;

    const outputPath = join(dir, "tour.mp4");
    await runFfmpeg([
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      "[outv]",
      "-an",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-y",
      outputPath,
    ]);

    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
