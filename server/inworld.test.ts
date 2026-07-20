import { describe, expect, it } from "vitest";
import {
  clampSegmentDuration,
  DEFAULT_SEGMENT_DURATION,
  SEGMENT_MAX_DURATION,
  SEGMENT_MIN_DURATION,
  segmentCountFor,
} from "./inworld";

describe("per-shot (segment) duration", () => {
  it("caps AI-chosen shot length at the 6s product maximum", () => {
    expect(clampSegmentDuration(6)).toBe(6);
    expect(clampSegmentDuration(9)).toBe(SEGMENT_MAX_DURATION);
    expect(clampSegmentDuration(100)).toBe(6);
  });

  it("enforces the Kling minimum and rounds to whole seconds", () => {
    expect(clampSegmentDuration(1)).toBe(SEGMENT_MIN_DURATION);
    expect(clampSegmentDuration(3)).toBe(3);
    expect(clampSegmentDuration(4.6)).toBe(5);
  });

  it("falls back to the default when the model omits or fumbles a value", () => {
    expect(clampSegmentDuration(undefined)).toBe(DEFAULT_SEGMENT_DURATION);
    expect(clampSegmentDuration(null)).toBe(DEFAULT_SEGMENT_DURATION);
    expect(clampSegmentDuration(Number.NaN)).toBe(DEFAULT_SEGMENT_DURATION);
    expect(clampSegmentDuration(0)).toBe(DEFAULT_SEGMENT_DURATION);
  });

  it("maps image count to one shot per image (hard-cut tour)", () => {
    expect(segmentCountFor(1)).toBe(1); // single image = 1 shot
    expect(segmentCountFor(2)).toBe(2);
    expect(segmentCountFor(5)).toBe(5); // N images -> N independent shots
    expect(segmentCountFor(10)).toBe(10);
  });
});
