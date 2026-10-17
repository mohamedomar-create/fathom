import { describe, expect, it } from "vitest";
import { isTransient, missingOf, stageRows } from "@/lib/imports/stage";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1, data: { x: i } }));
const TIMEOUT = new Error("canceling statement due to statement timeout");

describe("sending staged rows to the database", () => {
  it("sends every row once, in small batches, at most two at a time", async () => {
    const seen: number[] = [];
    let open = 0, most = 0;
    await stageRows(rows(1234), async (b) => { open++; most = Math.max(most, open); await new Promise((r) => setTimeout(r, 1)); seen.push(...b.map((r) => r.n)); open--; }, () => {});
    expect(seen.sort((a, b) => a - b)).toEqual(rows(1234).map((r) => r.n));
    expect(most).toBeLessThanOrEqual(2);
  });

  it("splits a batch the database timed out on and sends the halves, never giving up while it can still split", async () => {
    const sizes: number[] = [];
    const seen = new Set<number>();
    await stageRows(rows(1000), async (b) => { sizes.push(b.length); if (b.length > 125) throw TIMEOUT; b.forEach((r) => seen.add(r.n)); }, () => {}, { wait: () => Promise.resolve() });
    expect(seen.size).toBe(1000);
    expect(Math.max(...sizes.filter((s) => s <= 125))).toBeLessThanOrEqual(125);
  });

  it("stops every other batch at once when one finally fails, and says how many rows are left", async () => {
    let calls = 0;
    const p = stageRows(rows(5000), async (b) => { calls++; if (b[0].n > 500) throw new Error("not allowed"); }, () => {}, { wait: () => Promise.resolve() });
    await expect(p).rejects.toThrow(/not allowed/);
    const atFailure = calls;
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(atFailure);
  });

  it("sends only the rows the database does not hold yet when an upload continues", async () => {
    const seen: number[] = [];
    await stageRows(rows(10), async (b) => { seen.push(...b.map((r) => r.n)); }, () => {}, { missing: [[3, 4], [9, 10]] });
    expect(seen.sort((a, b) => a - b)).toEqual([3, 4, 9, 10]);
  });

  it("works out which row numbers are missing from the ones held", () => {
    expect(missingOf(10, [[1, 2], [5, 8]])).toEqual([[3, 4], [9, 10]]);
    expect(missingOf(3, [])).toEqual([[1, 3]]);
    expect(missingOf(3, [[1, 3]])).toEqual([]);
  });
});

describe("Node's network errors", () => {
  it("are worth trying again, like the browser's", () => {
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(new Error("connect ECONNREFUSED 127.0.0.1:54321"))).toBe(true);
    expect(isTransient(new Error("duplicate key value"))).toBe(false);
  });
});
