// One chunk engine for every save: small chunks, split on a time-out, retried when the network or database was busy,
// progress in order, the last chunk sent alone after every other one is in, and a stop that can continue with only
// what is still missing.
import { describe, expect, it } from "vitest";
import { ChunkStopped, sendChunks } from "@/lib/chunks";

const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const now = { wait: () => Promise.resolve() };
const BUSY = new Error("The database was busy. Please try again.");

describe("sending in chunks", () => {
  it("sends every item exactly once, in chunks no bigger than asked, and reports progress up to the total", async () => {
    const seen: number[] = [], sizes: number[] = [], progress: number[] = [];
    await sendChunks(items(2500), async (b) => { sizes.push(b.length); seen.push(...b); }, { size: 1000, onProgress: (d) => progress.push(d), ...now });
    expect(seen.sort((a, b) => a - b)).toEqual(items(2500));
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1000);
    expect(progress[progress.length - 1]).toBe(2500);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("sends the last chunk alone, after every other chunk is in (that is when the server finishes the save)", async () => {
    let inFlight = 0, lastSawOthers = -1;
    await sendChunks(items(5000), async (b, { last }) => {
      inFlight++;
      if (last) lastSawOthers = inFlight - 1;
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
    }, { size: 500, parallel: 3, ...now });
    expect(lastSawOthers).toBe(0);
  });

  it("splits a chunk the database was too busy for, down to the smallest size, and still sends everything", async () => {
    const seen = new Set<number>();
    await sendChunks(items(1000), async (b) => { if (b.length > 120) throw BUSY; b.forEach((x) => seen.add(x)); }, { size: 1000, ...now });
    expect(seen.size).toBe(1000);
  });

  it("retries a dropped connection with the same chunk", async () => {
    let fails = 2;
    const seen: number[] = [];
    await sendChunks(items(10), async (b) => { if (fails-- > 0) throw new TypeError("Failed to fetch"); seen.push(...b); }, { size: 10, ...now });
    expect(seen).toEqual(items(10));
  });

  it("stops at a real error, keeps what was sent, and continues with only the items still missing", async () => {
    let refuse = true;
    const seen: number[] = [];
    const send = async (b: number[]) => { if (refuse && b.includes(1500)) throw new Error("You don't have permission to do that."); seen.push(...b); };
    const err = await sendChunks(items(3000), send, { size: 1000, parallel: 1, ...now }).catch((e) => e);
    expect(err).toBeInstanceOf(ChunkStopped);
    expect((err as ChunkStopped).message).toMatch(/permission/);
    expect((err as ChunkStopped).sent).toBe(1000);
    refuse = false;
    await sendChunks((err as ChunkStopped<number>).remaining, send, { size: 1000, ...now });
    expect(seen.sort((a, b) => a - b)).toEqual(items(3000));
  });

  it("nothing to send: nothing is called", async () => {
    let calls = 0;
    await sendChunks([], async () => { calls++; }, now);
    expect(calls).toBe(0);
  });
});
