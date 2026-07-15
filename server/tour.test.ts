import { describe, expect, it } from "vitest";
import { TOUR_STYLES, MAX_IMAGES } from "../shared/plans";

describe("tour configuration", () => {
  it("exposes exactly the three required tour styles with exact labels", () => {
    expect([...TOUR_STYLES]).toEqual(["Walkthrough", "Drone", "Cinematic"]);
  });

  it("caps uploads at a sane maximum", () => {
    expect(MAX_IMAGES).toBeGreaterThanOrEqual(10);
    expect(MAX_IMAGES).toBeLessThanOrEqual(30);
  });
});

describe("job status labels", () => {
  it("uses exactly processing/ready/failed in the schema", async () => {
    const schema = await import("../drizzle/schema");
    // Drizzle mysqlEnum stores enumValues on the column config.
    const statusCol = schema.generationJobs.status;
    expect(statusCol.enumValues).toEqual(["processing", "ready", "failed"]);
  });
});

describe("client job serialization hides internal fields", () => {
  it("strips optimizedPrompt and providerTaskId from client payloads", async () => {
    const { toClientJob } = await import("./routers/tour");
    const fakeJob = {
      id: 1,
      userId: 1,
      projectId: 1,
      status: "processing" as const,
      tourStyle: "Walkthrough",
      resolution: "720p",
      aspectRatio: "16:9",
      clipDuration: 5,
      imageCount: 3,
      imageSequence: "[1,2,3]",
      optimizedPrompt: "SECRET internal prompt",
      providerTaskId: "kling:893605946402811985",
      videoUrl: null,
      videoKey: null,
      thumbnailUrl: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const client = toClientJob(fakeJob as never);
    expect(client).not.toHaveProperty("optimizedPrompt");
    expect(client).not.toHaveProperty("providerTaskId");
    expect(client).not.toHaveProperty("imageSequence");
    expect(client.status).toBe("processing");
  });
});

describe("strict image ordering", () => {
  it("db.reorderProjectImages rejects an id set that does not match exactly", async () => {
    const db = await import("./db");
    // No DB connection needed to validate the guard clause shape — call with
    // a project that has no images and expect a validation error.
    await expect(
      db.reorderProjectImages(999999, 999999, [1, 2, 3]),
    ).rejects.toThrow();
  });
});
