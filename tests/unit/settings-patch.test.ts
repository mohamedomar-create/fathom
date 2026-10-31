// Phase 3a (0044): every settings save sends only its part; the database merges it under a row lock.
import { describe, expect, it } from "vitest";
import { patchSettings } from "@/lib/company/settings-patch";

const fake = (result: { data?: unknown; error?: { code?: string; message: string } | null }) => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return { calls, db: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: result.data ?? null, error: result.error ?? null }; } } };
};

describe("patchSettings", () => {
  it("sends only the patch to update_company_settings", async () => {
    const f = fake({ data: { profile: { vatRate: 0.14 } } });
    const r = await patchSettings(f.db as never, "c1", { profile: { vatRate: 0.14 } });
    expect(r).toEqual({ ok: true, config: { profile: { vatRate: 0.14 } } });
    expect(f.calls).toEqual([{ fn: "update_company_settings", args: { p_company: "c1", p_patch: { profile: { vatRate: 0.14 } }, p_replace_kpis: false } }]);
  });
  it("a refusal says the person can't change it; any other error is a safe message", async () => {
    expect(await patchSettings(fake({ error: { code: "42501", message: "not allowed" } }).db as never, "c1", {})).toEqual({ ok: false, error: "You do not have permission to change this." });
    const other = await patchSettings(fake({ error: { code: "XX000", message: "boom secret" } }).db as never, "c1", {});
    expect(other.ok).toBe(false);
    expect(JSON.stringify(other)).not.toContain("secret");
  });
});
