// The doctor page's data: built from what the company's pages already load. A check accepted at upload stays accepted,
// and a part that couldn't be read is said, never shown as "nothing wrong".
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { doctorData } = await import("@/lib/doctor/load");
const { demoCompany } = await import("@/lib/company/demo");
const { demoExpenses } = await import("@/lib/company/demo-expenses");

describe("the doctor's data", () => {
  it("ranks the demo company's findings and scores it, with the expense flags included", () => {
    const d = doctorData(demoCompany(), { flags: demoExpenses().flags, decisions: [] });
    expect(d.findings.length).toBeGreaterThan(0);
    expect(d.score.score).toBeLessThanOrEqual(100);
    expect(d.expensesUnread).toBe(false);
    expect(d.decisionsUnavailable).toBe(false);
  });

  it("says when expense lines or decisions could not be read", () => {
    const d = doctorData(demoCompany(), { flags: null, decisions: null });
    expect(d.expensesUnread).toBe(true);
    expect(d.decisionsUnavailable).toBe(true);
  });

  it("keeps a check accepted at upload accepted, with its reason", async () => {
    const { buildMonths } = await import("@/lib/company/build");
    const c = demoCompany();
    const last = c.months.at(-1)!.period;
    const accounts = [...c.accounts, { id: "odd", code: "1999", name: "Unexplained cash", cls: "cash" as const, amounts: { [last]: 12_500 } }];
    const broken = { ...c, accounts, months: buildMonths(accounts) };
    const first = doctorData(broken, { flags: [], decisions: [] }).findings.find((f) => !f.key.startsWith("flag|"))!;
    expect(first).toBeTruthy();
    const [, period, title] = first.key.split("|");
    const d = doctorData({ ...broken, accepted: [{ title, period: period || undefined, reason: "Known timing" }] }, { flags: [], decisions: [] });
    expect(d.findings.find((f) => f.key === first.key)?.accepted?.reason).toBe("Known timing");
  });
});
