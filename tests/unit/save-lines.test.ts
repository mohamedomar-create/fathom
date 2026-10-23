import { describe, expect, it } from "vitest";
import { saveStaged } from "@/lib/company/save-lines";

const rows = Array.from({ length: 2500 }, (_, i) => ({ i }));
const instant = { wait: async () => {} };

function fake(opts: { staged?: boolean; failAt?: number } = {}) {
  const log: string[] = [];
  let calls = 0;
  return {
    log,
    open: async () => { log.push("open"); return { ok: true as const, batch: "b", staged: opts.staged ?? true }; },
    add: async (_b: string, part: unknown[]) => {
      calls++;
      if (opts.failAt === calls) return { ok: false as const, error: "Refused by the database" };
      log.push(`add:${part.length}`);
      return { ok: true as const, saved: part.length };
    },
    finish: async () => { log.push("finish"); return { ok: true as const, saved: 2500, sent: 2500 }; },
  };
}

describe("saveStaged (D19: nothing half-saved)", () => {
  it("finishes once, after every chunk has arrived", async () => {
    const f = fake();
    const r = await saveStaged(rows, f, { chunk: instant });
    expect(r).toEqual({ ok: true, saved: 2500 });
    expect(f.log[0]).toBe("open");
    expect(f.log.at(-1)).toBe("finish");
    expect(f.log.filter((x) => x === "finish")).toHaveLength(1);
  });

  it("never finishes when a chunk is refused, so the live months stay as they were", async () => {
    const f = fake({ failAt: 2 });
    const r = await saveStaged(rows, f, { chunk: instant });
    expect(r.ok).toBe(false);
    expect(f.log).not.toContain("finish");
  });

  it("an old database (no staging) adds directly and has nothing to finish", async () => {
    const f = fake({ staged: false });
    const r = await saveStaged(rows, f, { chunk: instant });
    expect(r).toEqual({ ok: true, saved: 2500 });
    expect(f.log).not.toContain("finish");
  });

  it("with no lines, still finishes when asked to clear the months (D4)", async () => {
    const f = fake();
    const r = await saveStaged([], f, { chunk: instant, finishEmpty: true });
    expect(r).toEqual({ ok: true, saved: 2500 });
    expect(f.log).toEqual(["open", "finish"]);
  });

  it("with no lines and nothing to clear, does nothing", async () => {
    const f = fake();
    expect(await saveStaged([], f, { chunk: instant })).toEqual({ ok: true, saved: 0 });
    expect(f.log).toEqual([]);
  });

  it("on a database without staging, a save with no lines discards the empty upload it opened", async () => {
    const f = { ...fake({ staged: false }), discard: async (b: string) => { f.log.push(`discard:${b}`); return { ok: true as const }; } };
    const r = await saveStaged([], f, { finishEmpty: true, chunk: instant });
    expect(r).toEqual({ ok: true, saved: 0 });
    expect(f.log).toEqual(["open", "discard:b"]);
  });
  it("lines saved on that path keep their upload", async () => {
    const f = { ...fake({ staged: false }), discard: async (b: string) => { f.log.push(`discard:${b}`); return { ok: true as const }; } };
    await saveStaged(rows, f, { chunk: instant });
    expect(f.log.some((x) => x.startsWith("discard"))).toBe(false);
  });
});
