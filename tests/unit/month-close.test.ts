import { describe, expect, it } from "vitest";
import type { ClassKey } from "@/lib/engine";
import { closeCandidates, isClosed, openLines, openPeriods } from "@/lib/company/close";
import { planImport, type IncomingAccount, type VersionAccount } from "@/lib/company/import-plan";
import { dbError } from "@/lib/action-error";

const acct = (code: string, name: string, cls: ClassKey, amounts: Record<string, number>): VersionAccount => ({ code, name, cls, amounts, sources: Object.fromEntries(Object.keys(amounts).map((p) => [p, "imp-1"])) });
const inc = (code: string, name: string, cls: ClassKey, amounts: Record<string, number>): IncomingAccount => ({ code, name, cls, amounts });

describe("closed months", () => {
  it("a month up to and including the closed one is closed", () => {
    expect(isClosed("2026-08", "2026-08")).toBe(true);
    expect(isClosed("2026-07", "2026-08")).toBe(true);
    expect(isClosed("2026-09", "2026-08")).toBe(false);
    expect(isClosed("2026-09", null)).toBe(false);
  });

  it("lines in closed months are left out and counted by month", () => {
    const r = openLines([{ period: "2026-07", a: 1 }, { period: "2026-09", a: 2 }, { period: "2026-08", a: 3 }], "2026-08");
    expect(r.kept).toEqual([{ period: "2026-09", a: 2 }]);
    expect(r.skipped).toEqual({ "2026-07": 1, "2026-08": 1 });
    expect(openLines([{ period: "2026-07" }], null).kept).toHaveLength(1);
  });

  it("months to replace never include a closed one", () => {
    expect(openPeriods(["2026-07", "2026-08", "2026-09"], "2026-08")).toEqual(["2026-09"]);
  });

  it("offers the full months after the closed one, oldest first, never the part month", () => {
    expect(closeCandidates(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"], "2026-07", "2026-10-15")).toEqual(["2026-08", "2026-09"]);
    expect(closeCandidates(["2026-08", "2026-09"], null, null)).toEqual(["2026-08", "2026-09"]);
  });
});

describe("an upload into a company with closed months", () => {
  const stored = [
    acct("4000", "Sales", "revenue", { "2026-07": 100, "2026-08": 100 }),
    acct("1000", "Bank", "cash", { "2026-07": 100, "2026-08": 200 }),
    acct("3000", "Retained", "retained_earnings", { "2026-07": 100, "2026-08": 200 }),
  ];
  const file = [
    inc("4000", "Sales", "revenue", { "2026-08": 999, "2026-09": 100 }),
    inc("1000", "Bank", "cash", { "2026-08": 999, "2026-09": 300 }),
    inc("3000", "Retained", "retained_earnings", { "2026-08": 999, "2026-09": 300 }),
  ];
  for (const mode of ["merge", "replace"] as const) {
    it(`keeps the closed months exactly as stored (${mode})`, () => {
      const p = planImport(stored, file, { mode, slices: { PL: ["2026-08", "2026-09"], BS: ["2026-08", "2026-09"] }, closedThrough: "2026-08" });
      const sales = p.accounts.find((a) => a.name === "Sales")!;
      expect(sales.amounts).toEqual({ "2026-07": 100, "2026-08": 100, "2026-09": 100 });
      expect(p.accounts.find((a) => a.name === "Bank")!.amounts["2026-08"]).toBe(200);
      expect(p.closedSkipped).toEqual(["2026-08"]);
      expect(p.timeline.find((c) => c.period === "2026-08")).toEqual({ period: "2026-08", PL: "keep", BS: "keep" });
      expect(p.timeline.find((c) => c.period === "2026-09")?.PL).toBe("new");
    });
  }
});

describe("database messages for closing", () => {
  it("asks for the password again rather than saying permission", () => {
    expect(dbError({ code: "42501", message: "Please confirm your password and try again.", hint: "reauth_required" }, "t")).toBe("Please confirm your password and try again.");
  });
  it("names the closed month", () => {
    expect(dbError({ code: "P0001", message: "2026-08 is a closed month. Reopen it in Settings, Month close, to change it.", hint: "month_closed" }, "t"))
      .toBe("2026-08 is a closed month. Reopen it in Settings, Month close, to change it.");
  });
});

describe("a live sync into a company with closed months", () => {
  it("keeps every stored figure of a closed month, whatever Odoo now says, and takes Odoo's open months", async () => {
    const { withClosedMonths } = await import("@/lib/company/import-plan");
    const stored = [acct("4000", "Sales", "revenue", { "2026-08": 100, "2026-09": 100 }), acct("5000", "Old cost", "exp_fixed", { "2026-08": 40 })];
    const synced = [inc("4000", "Sales", "revenue", { "2026-08": 120, "2026-09": 130 }), inc("6000", "New", "exp_variable", { "2026-08": 5, "2026-09": 5 })];
    const out = withClosedMonths(synced, stored, "2026-08");
    expect(out.find((a) => a.code === "4000")!.amounts).toEqual({ "2026-08": 100, "2026-09": 130 });
    expect(out.find((a) => a.code === "6000")!.amounts).toEqual({ "2026-09": 5 });
    expect(out.find((a) => a.code === "5000")!.amounts).toEqual({ "2026-08": 40 });
    expect(withClosedMonths(synced, stored, null)).toBe(synced);
  });
});

describe("a live sync that reclassifies an account with closed months", () => {
  it("keeps the class the months were closed under", async () => {
    const { withClosedMonths } = await import("@/lib/company/import-plan");
    const out = withClosedMonths([inc("4000", "Sales", "other_income", { "2026-09": 130 })], [acct("4000", "Sales", "revenue", { "2026-08": 100 })], "2026-08");
    expect(out[0].cls).toBe("revenue");
    expect(out[0].amounts).toEqual({ "2026-08": 100, "2026-09": 130 });
  });
});

describe("the close checklist", () => {
  it("lists the unaccepted blocking problems in the months being closed, and only those", async () => {
    const { problemsToClose } = await import("@/lib/company/close");
    const checks = [
      { id: "bs_balance", severity: "block", period: "2026-08", title: "Aug does not balance" },
      { id: "bs_balance", severity: "block", period: "2026-07", title: "Jul (already closed)" },
      { id: "bs_balance", severity: "block", period: "2026-10", title: "Oct (after)" },
      { id: "cash_flow", severity: "warn", period: "2026-09", title: "a warning" },
      { id: "control_total", severity: "block", period: "2026-09", title: "accepted one", accepted: true },
    ] as { id: string; severity: string; period: string; title: string; accepted?: boolean }[];
    expect(problemsToClose(checks, "2026-07", "2026-09").map((c) => c.title)).toEqual(["Aug does not balance"]);
  });
});
