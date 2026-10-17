import { describe, expect, it } from "vitest";
import { fetchAllPages } from "@/lib/company/paged";

const table = Array.from({ length: 6782 }, (_, i) => i);
const page = (from: number, to: number) => table.slice(from, to + 1);

describe("reading a long table in pages", () => {
  it("asks for the count with the first page, then fetches the rest at the same time, in order", async () => {
    let open = 0, most = 0, calls = 0;
    const rows = await fetchAllPages(async (from, to, withCount) => {
      calls++; open++; most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open--;
      return { rows: page(from, to), count: withCount ? table.length : null };
    });
    expect(rows).toEqual(table);
    expect(calls).toBe(7);
    // The six pages after the first go out together, not one after another.
    expect(most).toBe(6);
  });

  it("still reads everything when the count is not given (page by page until a short page)", async () => {
    const rows = await fetchAllPages(async (from, to) => ({ rows: page(from, to), count: null }));
    expect(rows).toEqual(table);
  });

  it("stops at the first error", async () => {
    await expect(fetchAllPages(async (from, to, withCount) => { if (from === 3000) throw new Error("boom"); return { rows: page(from, to), count: withCount ? table.length : null }; })).rejects.toThrow("boom");
  });
});
