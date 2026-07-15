import { describe, expect, it } from "vitest";
import {
  buildKlingImageToVideoRequest,
  decodeKlingProviderTaskId,
  encodeKlingProviderTaskId,
  KlingAmbiguousSubmissionError,
  klingExternalTaskIdForJob,
  verifyKlingKey,
} from "./kling";
import { buildFallbackPrompt } from "./inworld";

const orderedImages = [
  { sequenceIndex: 0, publicUrl: "https://media.example.test/first.jpg" },
  { sequenceIndex: 1, publicUrl: "https://media.example.test/middle.jpg" },
  { sequenceIndex: 2, publicUrl: "https://media.example.test/last.png" },
];

describe("official Kling 3.0 request contract", () => {
  it("uses the documented image-to-video shape and paid-output settings", () => {
    const request = buildKlingImageToVideoRequest({
      prompt: "A smooth cinematic walkthrough of the property.",
      images: orderedImages,
      duration: 10,
      aspectRatio: "16:9",
      externalTaskId: "estatetour-generation-42",
    });

    expect(request.contents).toEqual([
      {
        type: "prompt",
        text: "A smooth cinematic walkthrough of the property. Target output composition: 16:9.",
      },
      { type: "first_frame", url: orderedImages[0].publicUrl },
      { type: "last_frame", url: orderedImages[2].publicUrl },
    ]);
    expect(request.settings).toEqual({
      multi_shot: false,
      audio: "off",
      resolution: "1080p",
      duration: 10,
    });
    expect(request.options).toEqual({
      external_task_id: "estatetour-generation-42",
      watermark_info: { enabled: false },
    });
    expect(request).not.toHaveProperty("model");
    expect(request.settings).not.toHaveProperty("aspect_ratio");
  });

  it("uses only first_frame when the project has one image", () => {
    const request = buildKlingImageToVideoRequest({
      prompt: "Slow push in.",
      images: orderedImages.slice(0, 1),
      duration: 5,
      aspectRatio: "9:16",
      externalTaskId: "estatetour-generation-43",
    });

    expect(request.contents.map((content) => content.type)).toEqual([
      "prompt",
      "first_frame",
    ]);
  });

  it("caps generated prompts at Kling's recommended 2500-character limit", () => {
    const request = buildKlingImageToVideoRequest({
      prompt: "cinematic ".repeat(400),
      images: orderedImages,
      duration: 8,
      aspectRatio: "1:1",
      externalTaskId: "estatetour-generation-44",
    });
    const prompt = request.contents[0];
    expect(prompt.type).toBe("prompt");
    expect("text" in prompt ? prompt.text.length : 0).toBeLessThanOrEqual(2_500);
  });

  it("rejects unsafe or unsupported inputs before spending provider credits", () => {
    expect(() =>
      buildKlingImageToVideoRequest({
        prompt: "Valid prompt",
        images: [
          { sequenceIndex: 0, publicUrl: "https://media.example.test/first.jpg" },
          { sequenceIndex: 2, publicUrl: "https://media.example.test/last.jpg" },
        ],
        duration: 5,
        aspectRatio: "1:1",
        externalTaskId: "estatetour-generation-44",
      }),
    ).toThrow("gapless");

    expect(() =>
      buildKlingImageToVideoRequest({
        prompt: "Valid prompt",
        images: orderedImages,
        duration: 16,
        aspectRatio: "1:1",
        externalTaskId: "estatetour-generation-45",
      }),
    ).toThrow("3 to 15");
  });

  it("encodes and decodes official Kling task ids with an explicit prefix", () => {
    const stored = encodeKlingProviderTaskId("893605946402811985");
    expect(stored).toBe("kling:893605946402811985");
    expect(decodeKlingProviderTaskId(stored)).toBe("893605946402811985");
    expect(decodeKlingProviderTaskId("unprefixed-id")).toBeNull();
    expect(decodeKlingProviderTaskId(null)).toBeNull();
    expect(klingExternalTaskIdForJob(42)).toBe("estatetour-generation-42");
  });

  it("carries the external id on an ambiguous submission for later reconciliation", () => {
    const error = new KlingAmbiguousSubmissionError(
      "estatetour-generation-7",
      new Error("network timeout"),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("KlingAmbiguousSubmissionError");
    expect(error.externalTaskId).toBe("estatetour-generation-7");
  });
});

describe("Kling credentials", () => {
  const key = process.env.KLING_API_KEY ?? "";

  it.runIf(Boolean(key))("accepts the configured server-only Kling key", () => {
    expect(key.trim().length).toBeGreaterThan(0);
  });

  it.runIf(process.env.KLING_LIVE_TEST === "1")(
    "authenticates against the official Kling tasks API without creating media",
    async () => {
      await expect(verifyKlingKey()).resolves.toBe(true);
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
