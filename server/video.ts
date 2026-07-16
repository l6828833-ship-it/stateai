/**
 * Server-side video assembly — SERVER-SIDE ONLY.
 *
 * Kling generates each tour as a set of short first/last-frame segments (one
 * per consecutive image pair). This module normalizes and concatenates those
 * segments. When Kling's three-second per-segment minimum exceeds a plan's
 * advertised final duration, every complete segment is sped up proportionally
 * so no uploaded image or transition is dropped.
 *
 * Requires `ffmpeg` and `ffprobe` on PATH (installed via nixpacks.toml aptPkgs).
 */

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MEDIA_PROCESS_TIMEOUT_MS = 180_000;
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

function runMediaCommand(
  command: "ffmpeg" | "ffprobe",
  args: string[]
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderrTail = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(() =>
        reject(new Error(`${command} timed out while assembling the tour video`))
      );
    }, MEDIA_PROCESS_TIMEOUT_MS);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    proc.on("error", error => {
      finish(() =>
        reject(new Error(`${command} is not available: ${error.message}`))
      );
    });
    proc.on("close", code => {
      finish(() => {
        if (code === 0) resolve(stdout);
        else
          reject(
            new Error(
              `${command} exited with code ${code}: ${stderrTail.slice(-500)}`
            )
          );
      });
    });
  });
}

async function probeDuration(path: string): Promise<number> {
  const output = await runMediaCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const duration = Number.parseFloat(output.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine a generated segment's duration");
  }
  return duration;
}

/**
 * Concatenate ordered MP4 segment buffers into one normalized H.264 MP4.
 * `targetDurationSeconds` is a final-output cap, not a provider request; source
 * segments are accelerated uniformly when needed, preserving every segment.
 */
export async function concatMp4Segments(
  segments: Buffer[],
  aspectRatio: string,
  targetDurationSeconds?: number
): Promise<Buffer> {
  if (segments.length === 0) {
    throw new Error("No video segments to concatenate");
  }

  const { width, height } = targetDimensions(aspectRatio);
  const dir = await mkdtemp(join(tmpdir(), "estatetour-concat-"));
  try {
    const inputArgs: string[] = [];
    const inputPaths: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const path = join(dir, `seg-${i}.mp4`);
      await writeFile(path, segments[i]);
      inputPaths.push(path);
      inputArgs.push("-i", path);
    }

    const hasTarget =
      typeof targetDurationSeconds === "number" &&
      Number.isFinite(targetDurationSeconds) &&
      targetDurationSeconds > 0;
    const sourceDurations = hasTarget
      ? await Promise.all(inputPaths.map(probeDuration))
      : [];
    const sourceTotal = sourceDurations.reduce((sum, value) => sum + value, 0);
    const speedFactor =
      hasTarget && sourceTotal > targetDurationSeconds!
        ? targetDurationSeconds! / sourceTotal
        : 1;

    if (segments.length === 1 && speedFactor === 1) {
      return segments[0];
    }

    const normalized = segments
      .map((_, i) => {
        const timing =
          speedFactor < 1
            ? `,setpts=${speedFactor.toFixed(8)}*(PTS-STARTPTS),trim=duration=${(
                sourceDurations[i] * speedFactor
              ).toFixed(6)}`
            : ",setpts=PTS-STARTPTS";
        return (
          `[${i}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1${timing},fps=${OUTPUT_FPS}[v${i}]`
        );
      })
      .join(";");
    const concatInputs = segments.map((_, i) => `[v${i}]`).join("");
    const filter = `${normalized};${concatInputs}concat=n=${segments.length}:v=1:a=0[outv]`;

    const outputPath = join(dir, "tour.mp4");
    await runMediaCommand("ffmpeg", [
      ...inputArgs,
      "-filter_complex",
      filter,
      "-map",
      "[outv]",
      "-an",
      ...(hasTarget ? ["-t", String(targetDurationSeconds)] : []),
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
