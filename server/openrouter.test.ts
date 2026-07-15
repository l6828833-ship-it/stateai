import { describe, expect, it } from "vitest";
import { verifyOpenRouterKey } from "./openrouter";
import { buildFallbackPrompt } from "./inworld";

describe("OpenRouter credentials", () => {
  const key = process.env.OPENROUTER_API_KEY ?? "";

  it.runIf(Boolean(key))("OPENROUTER_API_KEY is well-formed when provided", () => {
    expect(key.startsWith("sk-or-"), "OpenRouter keys start with sk-or-").toBe(true);
  });

  // NOTE: The dev sandbox egress IP is blocked by OpenRouter's Cloudflare
  // security policy (403 even on unauthenticated endpoints), so the live
  // auth check only runs when OPENROUTER_LIVE_TEST=1 (e.g. in production).
  it.runIf(process.env.OPENROUTER_LIVE_TEST === "1")(
    "authenticates against the OpenRouter API (lightweight /models call)",
    async () => {
      const ok = await verifyOpenRouterKey();
      expect(ok, "OpenRouter rejected the API key — please provide a valid key").toBe(true);
    },
    30_000,
  );
});

describe("buildFallbackPrompt", () => {
  it("mentions image count, ordering, camera direction, and preservation", () => {
    const prompt = buildFallbackPrompt(4);
    expect(prompt).toContain("4 reference photos");
    expect(prompt).toContain("exact given order");
    expect(prompt).toContain("camera intelligently adapts");
    expect(prompt).toContain("Preserve the exact rooms");
  });
});
