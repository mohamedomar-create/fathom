import { describe, expect, it } from "vitest";
import { compareLayout, fingerprintAccounts, fingerprintList, layoutIssues, type SheetFingerprint } from "@/lib/ingest/layout-profile";
import type { SheetLayout } from "@/lib/ingest/extract";

const gl = (heads: [string, boolean, string | null][]): SheetLayout => ({
  sheet: "GL", kind: "ledger", headerRow: 0, scale: 1, scaleFrom: null, decimal: ".", lines: 10, source: "Odoo General Ledger",
  columns: heads.map(([header, used, period], col) => ({ col, header, used, period, months: period ? 1 : 0 })),
});
const BASE: [string, boolean, string | null][] = [["Date", true, null], ["Account", true, null], ["Label", true, null], ["Debit", true, null], ["Credit", true, null], ["Analytic", false, null]];

describe("each company's export layout", () => {
  it("a fingerprint keeps the export's headings, which were read and which were ignored", () => {
    const fp = fingerprintAccounts(gl(BASE));
    expect(fp.kind).toBe("accounts:Odoo General Ledger");
    expect(fp.headings).toEqual(["date", "account", "label", "debit", "credit", "analytic"]);
    expect(fp.ignored).toEqual(["Analytic"]);
  });

  it("month columns are not part of the layout (they change every month)", () => {
    const fp = fingerprintAccounts({ ...gl([["Account", true, null], ["Jan 2026", true, "2026-01"], ["Feb 2026", true, "2026-02"]]), kind: "columns", source: undefined });
    expect(fp.headings).toEqual(["account"]);
    expect(fp.kind).toBe("accounts:columns");
  });

  it("Arabic letter forms and Odoo's required star do not count as a change", () => {
    const a = fingerprintList("sales:list", "S", ["العميل", "Untaxed Total *"], [0, 1]);
    const b = fingerprintList("sales:list", "S", ["العميل", "Untaxed Total"], [0, 1]);
    expect(compareLayout(b, a.headings).status).toBe("same");
  });

  it("first time, same, and changed (with what was added and what is gone)", () => {
    const fp = fingerprintAccounts(gl(BASE));
    expect(compareLayout(fp, undefined).status).toBe("new");
    expect(compareLayout(fp, fp.headings).status).toBe("same");
    const changed = fingerprintAccounts(gl([...BASE.filter(([h]) => h !== "Credit"), ["Amount EGP", true, null]]));
    expect(compareLayout(changed, fp.headings)).toEqual({ status: "changed", added: ["Amount EGP"], removed: ["credit"] });
  });

  it("a changed layout stops the upload until the person confirms the columns; a new one lists the columns it would leave out", () => {
    const before = fingerprintAccounts(gl(BASE));
    const now: SheetFingerprint = fingerprintAccounts(gl([...BASE.filter(([h]) => h !== "Credit"), ["Amount EGP", true, null]]));
    const issues = layoutIssues([now], { [now.kind]: before.headings }, new Set());
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "error", fix: "layout", key: now.kind });
    expect(issues[0].message).toMatch(/new column "Amount EGP".*"credit" is gone/);
    expect(layoutIssues([now], { [now.kind]: before.headings }, new Set([now.kind]))[0].severity).toBe("check");
    const first = layoutIssues([before], {}, new Set());
    expect(first[0]).toMatchObject({ severity: "check", fix: "layout" });
    expect(first[0].message).toMatch(/first .* for this company.*ignored: Analytic/i);
    expect(layoutIssues([before], { [before.kind]: before.headings }, new Set())).toEqual([]);
    const clean = fingerprintAccounts(gl(BASE.filter(([h]) => h !== "Analytic")));
    expect(layoutIssues([clean], {}, new Set())).toEqual([]);
  });
});
