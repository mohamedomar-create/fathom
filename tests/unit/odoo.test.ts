import { describe, expect, it } from "vitest";
import { BS_KEYS, PL_KEYS } from "@/lib/engine";
import { buildMonths } from "@/lib/company/build";
import { OdooClient } from "@/lib/odoo/client";
import { assertPublicOdooUrl } from "@/lib/odoo/net";
import { probe, syncOdoo } from "@/lib/odoo/sync";
import { fakeOdoo } from "../fixtures/fake-odoo";
import { months } from "../fixtures/odoo";

function check(res: Awaited<ReturnType<typeof syncOdoo>>, min = 10) {
  const got = buildMonths(res.accounts.map((a, i) => ({ id: String(i), code: a.code, name: a.name, cls: a.cls, amounts: a.amounts })));
  const want = months.filter((m) => res.periods.includes(m.period));
  expect(want.length).toBeGreaterThanOrEqual(min);
  for (const w of want) {
    const g = got.find((x) => x.period === w.period)!;
    for (const k of PL_KEYS) expect(Math.round(g.pl[k] ?? 0), `${w.period} ${k}`).toBe(Math.round((w.pl as Record<string, number>)[k] ?? 0));
    for (const k of BS_KEYS) expect(Math.round(g.bs[k] ?? 0), `${w.period} ${k}`).toBe(Math.round((w.bs as Record<string, number>)[k] ?? 0));
  }
  expect(Math.abs(res.diagnostics.trialBalanceCheck)).toBeLessThan(0.01);
}

describe("Odoo connector", () => {
  for (const v of [15, 17, 18] as const) {
    it(`syncs Odoo ${v} via read_group and reproduces the books`, async () => {
      const f = fakeOdoo(v);
      const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
      const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" });
      expect(res.diagnostics.method).toBe("read_group");
      expect(res.periods[res.periods.length - 1]).toBe("2026-09");
      check(res);
    });
  }

  it("falls back to search_read when read_group is unavailable (Odoo 19)", async () => {
    const f = fakeOdoo(19);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" });
    expect(res.diagnostics.method).toBe("search_read");
    check(res);
  });

  it("opening balances carry history from before the window", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 6, end: "2026-09" });
    expect(res.periods).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    check(res, 6);
  });

  it("probe lists companies and rejects a bad key", async () => {
    const f = fakeOdoo(17);
    const ok = await probe(new OdooClient("https://x.odoo.com", "db", "me", "secret", f.fetch));
    expect(ok.major).toBe(17);
    expect(ok.companies.map((x) => x.name)).toContain("Sample Trading Co");
    await expect(probe(new OdooClient("https://x.odoo.com", "db", "me", "wrong", f.fetch))).rejects.toThrow(/rejected the login/);
  });

  it("refuses private or non-https URLs", async () => {
    const pub = async () => [{ address: "93.184.216.34", family: 4 }];
    const priv = async () => [{ address: "10.0.0.5", family: 4 }];
    await expect(assertPublicOdooUrl("https://acme.odoo.com/web#action=1", pub as never)).resolves.toBe("https://acme.odoo.com");
    await expect(assertPublicOdooUrl("http://acme.odoo.com", pub as never)).rejects.toThrow(/https/);
    await expect(assertPublicOdooUrl("https://intranet.acme", priv as never)).rejects.toThrow(/public internet/);
    await expect(assertPublicOdooUrl("https://127.0.0.1")).rejects.toThrow(/public internet/);
  });
});
