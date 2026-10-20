// Summaries that take a second to add up are kept per company and handed back while nothing they depend on changed
// (the same stamp): a new upload changes the stamp and the summary is added up again. Never kept for long, never many.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forget, remember } from "@/lib/company/summary-cache";

describe("remembered summaries", () => {
  beforeEach(() => forget());
  it("the same stamp hands back the kept summary without adding it up again", async () => {
    const load = vi.fn(async () => ({ total: 1 }));
    expect(await remember("sales", "co", "s1", load)).toEqual({ total: 1 });
    expect(await remember("sales", "co", "s1", load)).toEqual({ total: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("a new stamp (an upload, a cleared module, a new class) adds it up again", async () => {
    let n = 0;
    const load = vi.fn(async () => ++n);
    await remember("sales", "co", "s1", load);
    expect(await remember("sales", "co", "s2", load)).toBe(2);
  });
  it("each company and each summary is kept apart", async () => {
    await remember("sales", "a", "s", async () => "a-sales");
    expect(await remember("sales", "b", "s", async () => "b-sales")).toBe("b-sales");
    expect(await remember("expenses", "a", "s", async () => "a-exp")).toBe("a-exp");
  });
  it("an old summary is added up again after the time limit", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => 1);
    await remember("sales", "co", "s", load);
    vi.advanceTimersByTime(11 * 60_000);
    await remember("sales", "co", "s", load);
    expect(load).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
  it("a failed load is not kept", async () => {
    await expect(remember("sales", "co", "s", async () => { throw new Error("down"); })).rejects.toThrow("down");
    expect(await remember("sales", "co", "s", async () => 5)).toBe(5);
  });
});
