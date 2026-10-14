import { describe, expect, it, vi } from "vitest";
import { createLandPrefetchCache, landChunks } from "./land-prefetch";
import type { WorldResponse } from "./types";

const world = (name: string) => ({ regions: [], hidden_concept_count: 0, name }) as unknown as WorldResponse;

describe("land prefetch cache (the cloud dive's readiness)", () => {
  it("fetches once per course, hands the promise out once, then fetches fresh again", async () => {
    const cache = createLandPrefetchCache();
    const fetch = vi.fn(async () => world("a"));
    await Promise.all([cache.warm("c1", fetch), cache.warm("c1", fetch)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.has("c1")).toBe(true);
    const taken = cache.take("c1");
    expect(taken).not.toBeNull();
    await expect(taken).resolves.toMatchObject({ name: "a" });
    expect(cache.has("c1")).toBe(false);
    expect(cache.take("c1")).toBeNull();
    await cache.warm("c1", fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("forgets a failed prefetch so the page runs its own fetch and error path", async () => {
    const cache = createLandPrefetchCache();
    const failing = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(cache.warm("c2", failing)).resolves.toBeNull();
    expect(cache.has("c2")).toBe(false);
    const throwing = () => {
      throw new Error("sync");
    };
    await expect(cache.warm("c3", throwing)).resolves.toBeNull();
    expect(cache.take("c3")).toBeNull();
  });

  it("names the stage-hosted land's chunks for ice-town and the canvas for the rest", () => {
    expect(landChunks("ice-town")).toHaveLength(2);
    expect(landChunks("frontier-town")).toHaveLength(1);
    expect(landChunks("island")).toHaveLength(1);
  });
});
