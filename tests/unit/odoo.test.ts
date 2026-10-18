import { describe, expect, it } from "vitest";
import { BS_KEYS, PL_KEYS } from "@/lib/engine";
import { buildMonths } from "@/lib/company/build";
import { OdooClient } from "@/lib/odoo/client";
import { assertPublicOdooUrl, isPrivateAddress, pinnedFetch, resolvePublicOdoo } from "@/lib/odoo/net";
import { MAX_SYNC_LINES, probe, syncLedgerLines, syncOdoo } from "@/lib/odoo/sync";
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

  it("an off-balance account with posted lines is kept (by its name) and named, never dropped", async () => {
    const f = fakeOdoo(17, { offBalance: true });
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" });
    expect(res.diagnostics.offBalance).toEqual(["999100 Petty cash (off balance)"]);
    expect(res.accounts.find((a) => a.code === "999100")?.cls).toBe("cash");
    expect(res.notes.join(" ")).toMatch(/999100 Petty cash \(off balance\).*kept as Cash/);
  });

  it("an employee's custody account typed off-balance is kept with its chart neighbours, so the balance sheet still balances", async () => {
    const f = fakeOdoo(17, { custody: true });
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" });
    const acc = res.accounts.find((a) => a.code === "101400");
    expect(acc?.cls).toBe("cash");
    expect(res.notes.join(" ")).toMatch(/101400 Hossam Hassan.*kept as Cash.*101/);
    check(res);
  });

  it("entries posted after the last import but dated inside months already imported are counted and named", async () => {
    const f = fakeOdoo(17, { late: true });
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09", since: { at: "2026-10-17T12:00:00.000Z", through: "2026-09-30" } });
    expect(res.diagnostics.latePostings).toBe(2);
    expect(res.notes.join(" ")).toMatch(/2 posted lines dated up to 30 Sep 2026 were entered in Odoo after the last import \(17 Oct 2026\)/);
    const plain = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" });
    expect(plain.diagnostics.latePostings).toBeUndefined();
  });

  it("without a books start, Odoo's opening date proposes it (its opening entry is dated the day before)", async () => {
    const f = fakeOdoo(17, { openingDate: "2026-01-01" });
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" });
    expect(res.booksStart).toEqual({ day: "2025-12-31", suggested: "2026-01-01" });
    expect(res.periods[0]).toBe("2026-01");
    expect(res.notes.join(" ")).toMatch(/books start on 1 Jan 2026.*opening entry/);
    check(res, 9);
  });

  it("a books start the company already has wins over Odoo's", async () => {
    const f = fakeOdoo(17, { openingDate: "2026-01-01" });
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09", booksStart: "2025-10-01" });
    expect(res.periods[0]).toBe("2025-10");
    expect(res.booksStart).toBeUndefined();
  });

  it("a books start inside the months asked for: nothing before it is a month, and the books still agree", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09", booksStart: "2026-01-01" });
    expect(res.periods[0]).toBe("2026-01");
    expect(res.accounts.flatMap((a) => Object.keys(a.amounts)).filter((p) => p < "2025-12")).toEqual([]);
    check(res, 9);
  });

  it("'everything since the books start' (240 months) syncs from the books start to the end, and the books agree", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 240, end: "2026-09", booksStart: "2024-10-01" });
    expect([res.periods[0], res.periods.at(-1), res.periods.length]).toEqual(["2024-10", "2026-09", 24]);
    check(res, 14);
  });

  it("falls back to search_read when read_group is unavailable (Odoo 19)", async () => {
    const f = fakeOdoo(19);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const res = await syncOdoo(c, { companyId: 1, includeBranches: false, months: 25, end: "2026-09" });
    expect(res.diagnostics.method).toBe("search_read");
    check(res);
  });

  it("the same posted lines fill Sales and Expenses, tying to revenue and costs every month", async () => {
    const f = fakeOdoo(17);
    const c = new OdooClient("https://x.odoo.com", "db", "me@x.com", "secret", f.fetch);
    const opts = { companyId: 1, includeBranches: false, months: 25, end: "2026-09" };
    const res = await syncOdoo(c, opts);
    const ls = await syncLedgerLines(c, opts, res);
    expect(ls.note).toBeNull();
    expect(ls.sales[0]).toMatchObject({ customer: "Northside Hospital", series: "INV" });
    expect(ls.expenses[0]).toMatchObject({ supplier: "Medline Supply", series: "BILL" });
    const months = buildMonths(res.accounts.map((a, i) => ({ id: String(i), code: a.code, name: a.name, cls: a.cls, amounts: a.amounts })));
    const COST = ["cos_variable", "cos_fixed", "cos_depreciation", "exp_variable", "exp_fixed", "exp_depreciation", "other_expenses", "interest_expenses", "tax_expenses", "adjustments"] as const;
    for (const m of months.filter((x) => res.periods.includes(x.period) && Object.keys(x.pl).length)) {
      const sum = (ls2: { period: string; amount: number }[]) => ls2.filter((l) => l.period === m.period).reduce((s2, l) => s2 + l.amount, 0);
      expect(Math.round(sum(ls.sales)), `${m.period} sales`).toBe(Math.round(m.pl.revenue ?? 0));
      expect(Math.round(sum(ls.expenses)), `${m.period} costs`).toBe(Math.round(COST.reduce((s2, k) => s2 + ((m.pl as Record<string, number>)[k] ?? 0), 0)));
    }
    expect(MAX_SYNC_LINES).toBeGreaterThan(10_000);
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

describe("Odoo network guard", () => {
  it("blocks every non-public range, including IPv6 forms that embed IPv4", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "198.19.255.1", "192.0.0.8", "192.0.2.1", "203.0.113.9", "240.0.0.1", "0.0.0.0",
      "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "64:ff9b::a9fe:a9fe", "2001:db8::1", "2002:7f00:1::", "ff02::1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("returns the checked address so the connection can be pinned to it", async () => {
    const pub = async () => [{ address: "93.184.216.34", family: 4 }];
    await expect(resolvePublicOdoo("https://acme.odoo.com/odoo/action-1", pub as never)).resolves.toEqual({ url: "https://acme.odoo.com", address: "93.184.216.34", family: 4 });
    const mixed = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }];
    await expect(resolvePublicOdoo("https://acme.odoo.com", mixed as never)).rejects.toThrow(/public internet/);
    await expect(resolvePublicOdoo("https://[::ffff:7f00:1]")).rejects.toThrow(/public internet/);
  });

  it("the pinned fetch refuses other hosts", async () => {
    const f = pinnedFetch({ url: "https://acme.odoo.com", address: "93.184.216.34", family: 4 });
    await expect(f("https://evil.example/jsonrpc", { method: "POST" })).rejects.toThrow(/outside the checked Odoo address/);
  });

  it("a redirect from Odoo is an error, never followed", async () => {
    const c = new OdooClient("https://x.odoo.com", "db", "me", "secret", (async () => new Response(null, { status: 302, headers: { location: "https://evil.example" } })) as typeof fetch);
    await expect(c.version()).rejects.toThrow(/redirected/);
  });

  it("too many stock lines skip only the stock detail: sales and expense lines still sync", async () => {
    const lines = [{ account_id: [1, "400000 Sales"], date: "2026-09-05", move_id: [9, "INV/2026/0001"], partner_id: [3, "Client A"], name: "Masks", balance: -500 }];
    const fake = {
      executeKw: async (_m: string, method: string, args: unknown[]) => {
        const ids = ((args[0] as unknown[][]).find((x) => x[0] === "account_id")![2]) as number[];
        if (method === "search_count") return ids.includes(2) ? MAX_SYNC_LINES + 1 : 1;
        return ids.includes(1) ? lines : [];
      },
    };
    const res = { periods: ["2026-09"], accounts: [
      { code: "400000", name: "Sales", cls: "revenue", odoo_id: 1 }, { code: "123000", name: "Trading Inventory", cls: "inventory", odoo_id: 2 },
    ] };
    const ls = await syncLedgerLines(fake as never, { companyId: 1, includeBranches: false } as never, res as never);
    expect(ls.sales.length).toBe(1);
    expect(ls.stock).toEqual([]);
    expect(ls.note).toMatch(/stock/i);
  });
});
