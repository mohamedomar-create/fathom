import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/ingest/extract";
import type { Cell } from "@/lib/ingest/parse";
import { ingest, toAccountInputs, type IngestOptions } from "@/lib/ingest/pipeline";
import { compareLayout, fingerprintAccounts } from "@/lib/ingest/layout-profile";
import { generalLedger } from "../fixtures/odoo-exports";

/**
 * Two companies on Odoo export the same General Ledger with different columns: renamed, translated, extra custom fields,
 * an optional column removed, dates written day first. Each variant must read to exactly the same accounts and months,
 * and the layout check must name what differs from the company's usual export.
 */
const OPTS: IngestOptions = { fyStart: 1, ytd: "auto", closeEarnings: "auto", plugEquity: false, mapping: {}, today: "2026-10-10" };
const HEAD = 2;
type Edit = (rows: Cell[][]) => Cell[][];
const variant = (edit: Edit): Grid[] => generalLedger().map((g, i) => (i === 0 ? { ...g, rows: edit(g.rows.map((r) => [...r])) } : g));
const rename = (map: Record<string, string>): Edit => (rows) => rows.map((r, i) => (i === HEAD ? r.map((c) => (typeof c === "string" && map[c] ? map[c] : c)) : r));
const insertCol = (at: number, head: string, value: (r: Cell[], i: number) => Cell): Edit => (rows) => rows.map((r, i) => [...r.slice(0, at), i === HEAD ? head : i > HEAD ? value(r, i) : null, ...r.slice(at)]);
const dropCol = (name: string): Edit => (rows) => { const c = rows[HEAD].indexOf(name); return rows.map((r) => r.filter((_, j) => j !== c)); };
const dayFirst: Edit = (rows) => rows.map((r, i) => (i > HEAD && typeof r[2] === "string" && /^\d{2}\/\d{2}\/\d{4}$/.test(r[2]) ? [...r.slice(0, 2), `${r[2].slice(3, 5)}/${r[2].slice(0, 2)}/${r[2].slice(6)}`, ...r.slice(3)] : r));
const read = (gs: Grid[]) => { const res = ingest(gs, OPTS); return { res, accounts: toAccountInputs(res).map((a) => ({ code: a.code, name: a.name, cls: a.cls, amounts: a.amounts })).sort((a, b) => `${a.code}${a.name}`.localeCompare(`${b.code}${b.name}`)) }; };
const base = read(generalLedger());
const baseFp = fingerprintAccounts(base.res.layouts.find((l) => l.kind === "ledger")!);

const VARIANTS: [string, Grid[], { added: string[]; removed: string[] } | "same"][] = [
  ["Odoo 17 'Label' instead of 'Communication'", variant(rename({ Communication: "Label" })), { added: ["Label"], removed: ["communication"] }],
  ["Arabic headings", variant(rename({ Code: "الكود", "Account Name": "اسم الحساب", Date: "التاريخ", Communication: "البيان", Partner: "الشريك", Currency: "العملة", Debit: "مدين", Credit: "دائن", Balance: "الرصيد" })),
    { added: ["الكود", "اسم الحساب", "التاريخ", "البيان", "الشريك", "العملة", "مدين", "دائن", "الرصيد"], removed: ["code", "account name", "date", "communication", "partner", "currency", "debit", "credit", "balance"] }],
  ["an extra custom column (Analytic Account)", variant(insertCol(5, "Analytic Account", (r) => (r[2] ? "Cairo branch" : null))), { added: ["Analytic Account"], removed: [] }],
  ["the optional Currency column removed", variant(dropCol("Currency")), { added: [], removed: ["currency"] }],
  ["dates written day first", variant(dayFirst), "same"],
  ["Odoo's required-field stars on headings", variant(rename({ Debit: "Debit *", Credit: "Credit *" })), "same"],
];

describe("the same General Ledger from differently set up Odoo databases", () => {
  it("the base export reads", () => {
    expect(base.accounts.length).toBeGreaterThan(10);
  });
  for (const [name, gs, layout] of VARIANTS) {
    it(`${name}: same accounts, classes and every month to the cent`, () => {
      const v = read(gs);
      expect(v.accounts.map((a) => [a.code || a.name, a.cls])).toEqual(base.accounts.map((a) => [a.code || a.name, a.cls]));
      for (let i = 0; i < base.accounts.length; i++) expect(v.accounts[i].amounts, base.accounts[i].code || base.accounts[i].name).toEqual(base.accounts[i].amounts);
    });
    it(`${name}: the layout check reports exactly what changed`, () => {
      const fp = fingerprintAccounts(read(gs).res.layouts.find((l) => l.kind === "ledger")!);
      const c = compareLayout(fp, baseFp.headings);
      if (layout === "same") expect(c.status).toBe("same");
      else expect(c).toEqual({ status: "changed", ...layout });
    });
  }
});
