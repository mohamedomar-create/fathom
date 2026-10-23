import { describe, expect, it } from "vitest";
import { acceptChecks, stillAccepted, type AcceptedItem } from "@/lib/company/accept";
import type { Check } from "@/lib/company/checks";

const tb = (diff: number): Check => ({ id: "tb_zero", severity: "block", title: "Debits do not equal credits", detail: "", diff });
const bs = (period: string, diff: number): Check => ({ id: "bs_balance", severity: "block", statement: "BS", period, title: "Balance sheet does not balance", detail: "", diff });
const prev = (key: string, diff: number | undefined): AcceptedItem => ({ key, title: "x", reason: "checked with the auditor", by: "a@x", at: "2026-10-01", ...(diff === undefined ? {} : { diff }) });
const editor = { by: "e@x", isAdmin: false }, admin = { by: "a@x", isAdmin: true };

describe("D13: an acceptance holds only for the same difference", () => {
  it("a 1,000 difference accepted earlier does not accept a 2,000,000 one", () => {
    expect(stillAccepted([tb(2_000_000)], [prev("tb_zero::", 1000)])).toEqual([]);
  });
  it("the same difference (to 1 EGP) is still accepted", () => {
    expect(stillAccepted([tb(1000.4)], [prev("tb_zero::", 1000)]).map((a) => a.key)).toEqual(["tb_zero::"]);
  });
  it("an acceptance saved before differences were kept does not carry into a new upload", () => {
    expect(stillAccepted([tb(1000)], [prev("tb_zero::", undefined)])).toEqual([]);
  });
  it("a new acceptance records the difference it was given for", () => {
    const r = acceptChecks([bs("2026-09", 120)], [], { keys: ["bs_balance:BS:2026-09"], reason: "rounding in Odoo" }, admin, "2026-10-23");
    expect(r.blocking).toEqual([]);
    expect(r.accepted).toEqual([{ key: "bs_balance:BS:2026-09", title: "Balance sheet does not balance", period: "2026-09", reason: "rounding in Odoo", by: "a@x", at: "2026-10-23", diff: 120 }]);
  });
});

describe("D12: serious file checks need an admin to accept", () => {
  it("an editor cannot accept debits not equal to credits", () => {
    const r = acceptChecks([tb(500)], [], { keys: ["tb_zero::"], reason: "fine by me really" }, editor, "now");
    expect(r.refused).toMatch(/admin/i);
    expect(r.blocking.map((c) => c.id)).toEqual(["tb_zero"]);
  });
  it("an admin can", () => {
    expect(acceptChecks([tb(500)], [], { keys: ["tb_zero::"], reason: "opening entry not posted" }, admin, "now").blocking).toEqual([]);
  });
  it("an editor can still accept other blocking checks, such as a balance sheet difference", () => {
    const r = acceptChecks([bs("2026-09", 3)], [], { keys: ["bs_balance:BS:2026-09"], reason: "rounding in Odoo" }, editor, "now");
    expect(r.refused).toBeUndefined();
    expect(r.blocking).toEqual([]);
  });
  it("nothing accepted leaves every blocking check blocking, and checks in untouched months never block", () => {
    const r = acceptChecks([tb(500), { ...bs("2025-01", 9), existing: true }], [], undefined, admin, "now");
    expect(r.blocking.map((c) => c.id)).toEqual(["tb_zero"]);
  });
});
