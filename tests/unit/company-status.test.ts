// One status model (Phase 3a): every screen that says how far a company's setup is, and whether its figures pass the
// checks, reads companyStatus. The same company state gives the same answer on the Data steps, the health banner and
// the "next" action.
import { describe, expect, it } from "vitest";
import { companyStatus, openChecks, type CompanyStatusInput } from "@/lib/company/status";

const base: CompanyStatusInput = {
  basePath: "/company/x", booksStart: null, opening: null, booksFromZero: false, openingInLedger: false,
  books: null, checks: { blocking: 0, warnings: 0 }, tb: null, sales: null, stock: null, ageing: [],
};
const ids = (s: CompanyStatusInput) => companyStatus(s).steps.map((x) => `${x.id}:${x.status}`);
const step = (s: CompanyStatusInput, id: string) => companyStatus(s).steps.find((x) => x.id === id)!;

describe("open checks: one count", () => {
  const checks = [
    { id: "bs_balance", period: "2026-09", statement: "BS", severity: "block" },
    { id: "bs_balance", period: "2026-08", statement: "BS", severity: "block" },
    { id: "gap", severity: "warn" },
    { id: "multi_month", severity: "info" },
  ] as const;
  it("blocking checks not accepted, with warnings counted apart and information never counted", () => {
    expect(openChecks([...checks], [])).toEqual({ blocking: 2, warnings: 1 });
  });
  it("an accepted check no longer counts", () => {
    expect(openChecks([...checks], ["bs_balance:BS:2026-09"])).toEqual({ blocking: 1, warnings: 1 });
  });
});

describe("company status", () => {
  it("a new company: the next action is setting up, and health is fine (nothing to fail yet)", () => {
    const st = companyStatus(base);
    expect(st.next?.id).toBe("setup");
    expect(st.health).toBe("ok");
    expect(ids(base).slice(3)).toEqual(["tb:locked", "sales:locked", "stock:locked", "ageing:locked", "review:locked"]);
  });

  it("ledger books with blocking checks: the ledger step, the review and the health banner all say the same number", () => {
    const s: CompanyStatusInput = { ...base, booksStart: "2021-07-01", openingInLedger: true, books: { from: "2021-07", to: "2026-10", basis: "ledger" }, checks: { blocking: 2, warnings: 3 } };
    const st = companyStatus(s);
    expect(st.health).toBe("failing");
    expect(st.open).toEqual({ blocking: 2, warnings: 3 });
    expect(step(s, "ledger")).toMatchObject({ status: "issues", detail: expect.stringMatching(/2 checks to look at/) });
    expect(step(s, "review")).toMatchObject({ status: "issues", detail: expect.stringMatching(/2 checks.*3 warnings/) });
    expect(st.next?.id).toBe("ledger");
  });

  it("warnings alone never fail the books: the review is verified and says the warnings are there", () => {
    const s: CompanyStatusInput = { ...base, booksStart: "2021-07-01", openingInLedger: true, books: { from: "2021-07", to: "2026-10", basis: "ledger" }, checks: { blocking: 0, warnings: 2 }, tb: { at: "x", file: "tb", months: ["2026-09"], diffs: 0 } };
    expect(companyStatus(s).health).toBe("ok");
    expect(step(s, "review")).toMatchObject({ status: "verified", detail: expect.stringMatching(/2 warnings/) });
  });

  it("checks that could not be read (O10): health is unknown, never failing, and the review can't be checked", () => {
    const s: CompanyStatusInput = { ...base, books: { from: "2026-01", to: "2026-10", basis: "ledger" }, checks: null };
    const st = companyStatus(s);
    expect(st.health).toBe("unknown");
    expect(st.open).toBeNull();
    expect(step(s, "review").status).toBe("unchecked");
  });

  it("stock still being added up (O11) is pending; one that couldn't be read is unchecked; neither asks for an upload", () => {
    const s: CompanyStatusInput = { ...base, books: { from: "2026-01", to: "2026-10", basis: "ledger" }, modules: { stock: "pending", ageing: "failed" } };
    expect(step(s, "stock")).toMatchObject({ status: "pending", action: null, detail: expect.stringMatching(/still adding up/i) });
    expect(step(s, "ageing")).toMatchObject({ status: "unchecked", action: null });
  });

  it("statement books (P&L and balance sheet, no General Ledger): step 3 is done, steps 4–7 open, and Review can be verified on a statement basis", () => {
    const s: CompanyStatusInput = { ...base, booksStart: "2025-01-01", booksFromZero: true, books: { from: "2025-01", to: "2025-12", basis: "statements" } };
    const st = companyStatus(s);
    expect(step(s, "ledger")).toMatchObject({ status: "done", title: "Statements (no General Ledger)" });
    expect(ids(s).slice(3)).toEqual(["tb:todo", "sales:todo", "stock:todo", "ageing:todo", "review:verified"]);
    expect(step(s, "review").detail).toMatch(/statement basis/i);
    expect(st.basis).toBe("statements");
    // Nothing on the way asks for a General Ledger.
    expect(st.steps.filter((x) => x.status !== "done" && x.status !== "verified").some((x) => /after the general ledger/i.test(x.detail))).toBe(false);
    expect(st.next).toBeNull();
  });

  it("cash-basis books from a cash book: step 3 says so, and Review is verified on a cash basis", () => {
    const s: CompanyStatusInput = { ...base, booksStart: "2026-01-01", booksFromZero: true, books: { from: "2026-01", to: "2026-10", basis: "cash" } };
    expect(step(s, "ledger")).toMatchObject({ status: "done", title: "Cash book (cash basis)" });
    expect(step(s, "review")).toMatchObject({ status: "verified", detail: expect.stringMatching(/cash basis/i) });
  });

  it("ledger books still ask for the Trial Balance before the review is done (unchanged)", () => {
    const s: CompanyStatusInput = { ...base, booksStart: "2021-07-01", openingInLedger: true, books: { from: "2021-07", to: "2026-10", basis: "odoo" } };
    expect(step(s, "review").status).toBe("todo");
    expect(step(s, "ledger").detail).toMatch(/Odoo live/);
    expect(companyStatus(s).next?.id).toBe("tb");
  });
});

describe("module states for the status model (O11)", () => {
  it("any inventory error counts as couldn't be read, never missing; a build in progress with no figures is pending", async () => {
    const { moduleStates } = await import("@/lib/company/status");
    const ok = { status: "ready" as const, empty: false };
    const inv = (error: string | null, pending = false, wire: unknown = null) => ({ error, pending, wire });
    expect(moduleStates({ sales: ok, expenses: ok, payments: ok, inventory: inv("UPDATE_NEEDED") })).toEqual({ unread: ["stock"], pending: [] });
    expect(moduleStates({ sales: ok, expenses: ok, payments: ok, inventory: inv("BUILD_FAILED") })).toEqual({ unread: ["stock"], pending: [] });
    expect(moduleStates({ sales: ok, expenses: ok, payments: ok, inventory: inv("LOAD_FAILED") })).toEqual({ unread: ["stock"], pending: [] });
    expect(moduleStates({ sales: ok, expenses: ok, payments: ok, inventory: inv(null, true) })).toEqual({ unread: [], pending: ["stock"] });
    // A rebuild with a previous copy still shows that copy: nothing is unknown.
    expect(moduleStates({ sales: ok, expenses: ok, payments: ok, inventory: inv(null, true, {}) })).toEqual({ unread: [], pending: [] });
    expect(moduleStates({ sales: { status: "pending", empty: true }, expenses: { status: "failed", empty: true }, payments: { status: "failed", empty: true }, inventory: inv(null) }))
      .toEqual({ unread: ["stock", "ageing"], pending: ["sales"] });
  });
});
