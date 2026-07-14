import { describe, expect, it } from "vitest";
import { verifyOpenRouterKey } from "./openrouter";
import { buildFallbackPrompt } from "./inworld";

describe("OpenRouter credentials", () => {
  it("OPENROUTER_API_KEY is present and well-formed", () => {
    const key = process.env.OPENROUTER_API_KEY ?? "";
    expect(key, "OPENROUTER_API_KEY must be set").toBeTruthy();
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
  it("mentions image count, style direction, and creative text", () => {
    const p = buildFallbackPrompt(4, "Drone", "sunset vibes", 8);
    expect(p).toContain("4 reference photos");
    expect(p).toContain("drone");
    expect(p).toContain("sunset vibes");
    expect(p).toContain("8-second");
  });

  it("omits creative direction when not provided", () => {
    const p = buildFallbackPrompt(2, "Walkthrough", null, 5);
    expect(p).not.toContain("Creative direction");
  });
});
