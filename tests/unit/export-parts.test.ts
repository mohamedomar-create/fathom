import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { readLinePage, readAllLines, LINE_PAGE } = await import("@/lib/export/parts");

/** A stand-in for the Supabase client: rows with ids 1..n, read the way the export asks. */
function fake(n: number) {
  const calls: string[] = [];
  const from = (table: string) => {
    let after = 0, size = 0;
    const q = {
      select: () => q, eq: () => q,
      gt: (_c: string, v: number) => { after = v; calls.push(`gt ${v}`); return q; },
      order: (c: string) => { calls.push(`order ${c}`); return q; },
      limit: (l: number) => { size = l; return q; },
      range: () => { calls.push("range"); return q; },
      then: (ok: (v: { data: unknown[]; error: null }) => void) => ok({ data: Array.from({ length: Math.max(0, Math.min(size, n - after)) }, (_, i) => ({ id: after + i + 1, period: "2026-01", amount: 1, table })), error: null }),
    };
    return q;
  };
  return { supabase: { from } as never, calls };
}

describe("D5: the export reads lines page by page from where the last page stopped", () => {
  it("a page starts after the last id, in id order, and says where the next one starts", async () => {
    const { supabase, calls } = fake(12_000);
    const p = await readLinePage(supabase, "sales_lines", "co", 0);
    expect(p.rows).toHaveLength(LINE_PAGE);
    expect(p.next).toBe(LINE_PAGE);
    expect(calls).toContain("gt 0");
    expect(calls).toContain("order id");
    expect(calls).not.toContain("range");
  });
  it("an empty page says there is no next", async () => {
    const { supabase } = fake(LINE_PAGE + 10);
    const p = await readLinePage(supabase, "sales_lines", "co", LINE_PAGE + 10);
    expect(p.rows).toHaveLength(0);
    expect(p.next).toBeNull();
  });
  it("reads every line, none cut off", async () => {
    const { supabase } = fake(61_244);
    expect(await readAllLines(supabase, "expense_lines", "co")).toHaveLength(61_244);
  });
});
