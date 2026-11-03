import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadBudgetRows, loadBudgets, loadStockCogsAccounts } from "@/lib/company/budget-load";

type Res = { data?: unknown; error?: { code?: string; message: string } | null; count?: number | null };

/** A stand-in for the Supabase client: each table answers with what `answer` gives for its filters. */
function stub(answer: (table: string, f: Record<string, unknown>, single: boolean) => Res) {
  const from = (table: string) => {
    const f: Record<string, unknown> = {};
    const q = {
      select: (cols: string) => { f.select = cols; return q; },
      eq: (k: string, v: unknown) => { f[`eq:${k}`] = v; return q; },
      neq: (k: string, v: unknown) => { f[`neq:${k}`] = v; return q; },
      order: () => q,
      range: () => q,
      maybeSingle: () => Promise.resolve({ data: null, error: null, ...answer(table, f, true) }),
      then: (ok: (r: Res) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null, ...answer(table, f, false) }).then(ok, bad),
    };
    return q;
  };
  return { from } as never;
}

const missing = (code: string) => ({ data: null, error: { code, message: `missing (${code})` } });
const version = { id: "v1", fy: "2027", name: "B", kind: "original", status: "approved", based_on: null, approved_at: null, created_at: "", updated_at: "" };
const line = { key: "cls:revenue", cls: "revenue", label: "Revenue", month: "2027-01", amount: "10" };

describe("budget load before 0053 is pasted", () => {
  for (const code of ["42P01", "42703", "PGRST204", "PGRST205"]) {
    it(`builder rows and setup read as none when the table or column is missing (${code})`, async () => {
      const sb = stub((t, f) => {
        if (t === "budget_lines") return { data: [line] };
        if (t === "budget_rows") return missing(code);
        if (t === "budget_versions" && String(f.select).includes("setup")) return missing(code);
        if (t === "budget_versions") return { data: [version] };
        return { data: [] };
      });
      const r = await loadBudgetRows(sb, "v1", { builder: true });
      expect(r.rows).toEqual([]);
      expect(r.setup).toBeNull();
      expect(r.lines).toHaveLength(1);
      const set = await loadBudgets(sb, "c1");
      expect(set.current?.id).toBe("v1");
      expect(set.current?.lines[0].amount).toBe(10);
    });
  }
  it("other read errors still fail", async () => {
    const sb = stub((t) => (t === "budget_rows" ? { data: null, error: { code: "57014", message: "timeout" } } : { data: [] }));
    await expect(loadBudgetRows(sb, "v1", { builder: true })).rejects.toThrow("timeout");
  });
  it("expense rows come back with their class from the cost object", async () => {
    const sb = stub((t) => (t === "budget_rows"
      ? { data: [{ view: "expense", key: "exp:500 COGS", label: "500 COGS", mode: "year", basis: null, cost: { kind: "expense", cls: "cos_variable" }, months: Array(12).fill("1") }] }
      : t === "budget_versions" ? { data: { setup: null } } : { data: [] }));
    const r = await loadBudgetRows(sb, "v1", { builder: true });
    expect(r.rows[0]).toMatchObject({ cls: "cos_variable", months: Array(12).fill(1) });
  });
});

describe("stock cost-of-goods accounts", () => {
  it("lists accounts holding only stock postings, and those mixing them with other lines", async () => {
    // [stock lines, all lines]; "510 Mixed" has lines with no supplier at all.
    const counts: Record<string, [number, number]> = { "500 COGS": [4, 4], "510 Mixed": [2, 5], "520 Freight": [0, 5] };
    const sb = stub((_t, f) => {
      const [stock, total] = counts[String(f["eq:account"])];
      return { count: "eq:supplier" in f ? stock : total };
    });
    expect(await loadStockCogsAccounts(sb, "c1", Object.keys(counts))).toEqual({ stock: ["500 COGS"], mixed: ["510 Mixed"] });
  });
});
