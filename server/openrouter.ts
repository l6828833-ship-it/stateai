/**
 * Legacy OpenRouter job reader — SERVER-SIDE ONLY.
 *
 * New generations use Kling's official API in server/kling.ts. This adapter is
 * retained only so jobs submitted before the cutover can finish and be
 * archived. OPENROUTER_API_KEY is therefore optional once no legacy processing
 * jobs remain, and this module contains no submission path.
 */

import { ENV } from "./_core/env";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

function getLegacyApiKey(): string {
  const key = ENV.openRouterApiKey.trim();
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is required only to finish a legacy OpenRouter video job",
    );
  }
  return key;
}

export function hasLegacyOpenRouterKey(): boolean {
  return Boolean(ENV.openRouterApiKey.trim());
}

export type LegacyOpenRouterPollStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface LegacyOpenRouterPollResult {
  status: LegacyOpenRouterPollStatus;
  videoUrl: string | null;
  error: string | null;
}

/** Poll a video job that was submitted before the official Kling cutover. */
export async function pollLegacyOpenRouterJob(
  jobId: string,
): Promise<LegacyOpenRouterPollResult> {
  const response = await fetch(
    `${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}`,
    {
      headers: { Authorization: `Bearer ${getLegacyApiKey()}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(`Legacy video poll failed (${response.status}): ${text.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    status: LegacyOpenRouterPollStatus;
    unsigned_urls?: string[];
    error?: string | null;
  };
  return {
    status: data.status,
    videoUrl: data.unsigned_urls?.[0] ?? null,
    error: data.error ?? null,
  };
}

/** Download a completed video submitted through the legacy provider. */
export async function downloadLegacyOpenRouterVideo(
  jobId: string,
  videoUrl: string | null,
): Promise<Buffer> {
  const url =
    videoUrl ??
    `${OPENROUTER_BASE}/videos/${encodeURIComponent(jobId)}/content?index=0`;
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") {
    throw new Error("Legacy video output URL must use HTTPS");
  }
  const needsAuth = url.startsWith(OPENROUTER_BASE);
  const response = await fetch(url, {
    headers: needsAuth
      ? { Authorization: `Bearer ${getLegacyApiKey()}` }
      : undefined,
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    throw new Error(
      `Legacy video download failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
