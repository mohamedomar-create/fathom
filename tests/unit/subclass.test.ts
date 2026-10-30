import { describe, expect, it } from "vitest";
import { inferSubClass, SUB_PARENTS } from "@/lib/ingest/subclass";
import { buildMonths } from "@/lib/company/build";
import type { AccountLine } from "@/lib/company/types";

describe("account sub-classes (English and Arabic names)", () => {
  const cases: [string, string, string | null][] = [
    ["Interest payable", "other_cl", "interest_payable"],
    ["Accrued interest on loans", "other_cl", "interest_payable"],
    ["فوائد مستحقة", "other_cl", "interest_payable"],
    ["Dividends payable", "other_cl", "dividends_payable"],
    ["توزيعات أرباح مستحقة", "other_cl", "dividends_payable"],
    ["Income tax payable", "tax_liab", "income_tax_payable"],
    ["Corporate tax payable", "other_cl", "income_tax_payable"],
    ["ضريبة الدخل المستحقة", "tax_liab", "income_tax_payable"],
    ["VAT payable", "tax_liab", null],
    ["Payroll tax payable", "tax_liab", null],
    ["Provision for doubtful debts", "other_cl", "provisions"],
    ["مخصص قضايا", "other_ncl", "provisions"],
    ["End of service benefits", "other_ncl", "end_of_service"],
    ["مكافأة نهاية الخدمة", "other_ncl", "end_of_service"],
    ["Deferred tax liability", "other_ncl", "deferred_tax"],
    ["ضريبة مؤجلة", "other_ncl", "deferred_tax"],
    ["Lease liability", "other_ncl", "lease_liability"],
    ["التزامات عقود الإيجار", "other_ncl", "lease_liability"],
    ["Right-of-use assets", "fixed_assets", "rou_asset"],
    ["أصول حق الانتفاع", "fixed_assets", "rou_asset"],
    ["Depreciation - right of use", "exp_depreciation", "rou_depreciation"],
    ["Gain on sale of fixed assets", "other_income", "disposal_gain"],
    ["Loss on disposal of assets", "other_expenses", "disposal_gain"],
    ["أرباح بيع أصول ثابتة", "other_income", "disposal_gain"],
    ["Unrealised exchange gain", "other_income", "fx_unrealised"],
    ["فروق تقييم عملة", "other_expenses", "fx_unrealised"],
    ["Rent expense", "exp_fixed", null],
    // A sub-class never crosses its parent: "interest payable" filed as revenue stays plain.
    ["Interest payable", "revenue", null],
  ];
  for (const [name, cls, want] of cases) it(`${name} (${cls}) → ${want}`, () => expect(inferSubClass(name, cls as never)).toBe(want));
  it("every sub-class names the classes it may sit under", () => {
    for (const parents of Object.values(SUB_PARENTS)) expect(parents.length).toBeGreaterThan(0);
  });
});

describe("months carry their sub-class amounts", () => {
  const acc = (name: string, cls: string, amounts: Record<string, number>, sub?: string): AccountLine => ({ id: name, code: "", name, cls: cls as never, amounts, ...(sub ? { sub: sub as never } : {}) });
  it("sums each sub-class and what each class holds in sub-classes; a disposal loss counts against the gain", () => {
    const m = buildMonths([
      acc("Accruals", "other_cl", { "2026-09": 500 }),
      acc("Interest payable", "other_cl", { "2026-09": 200 }, "interest_payable"),
      acc("Gain on sale", "other_income", { "2026-09": 300 }, "disposal_gain"),
      acc("Loss on sale", "other_expenses", { "2026-09": 100 }, "disposal_gain"),
    ])[0];
    expect(m.bs.other_cl).toBe(700);
    expect(m.sub).toEqual({ interest_payable: 200, disposal_gain: 200 });
    expect(m.subOf).toEqual({ other_cl: 200, other_income: 300, other_expenses: 100 });
  });
  it("months without sub-classed accounts carry none", () => {
    const m = buildMonths([acc("Cash", "cash", { "2026-09": 1 })])[0];
    expect(m.sub).toBeUndefined();
  });
});

describe("an account's sub-class: the company's choice, else the name rules", () => {
  it("applies the map first (by #code, then by name), drops a choice that does not fit the class, else infers", async () => {
    const { withSubClasses } = await import("@/lib/ingest/subclass");
    const out = withSubClasses([
      { id: "1", code: "2150", name: "Sundry accruals", cls: "other_cl", amounts: {} },
      { id: "2", code: "", name: "Bank interest due", cls: "other_cl", amounts: {} },
      { id: "3", code: "2160", name: "Interest payable", cls: "other_cl", amounts: {} },
      { id: "4", code: "2170", name: "Lease liability", cls: "other_ncl", amounts: {} },
    ] as never, { "#2150": "interest_payable", "Bank interest due": "dividends_payable", "#2160": "", "#2170": "rou_asset" });
    expect(out.map((a) => a.sub)).toEqual(["interest_payable", "dividends_payable", null, "lease_liability"]);
  });
});

describe("saving a person's sub-class choices", () => {
  it("keys them as the account map does (#code, else the cleaned name), refuses ones that do not fit, keeps '' as none", async () => {
    const { subClassEntries } = await import("@/lib/ingest/subclass");
    const accounts = [
      { id: "a", code: "2160", name: "Interest payable", cls: "other_cl" },
      { id: "b", code: "", name: "  Accrued Dividends ", cls: "other_cl" },
      { id: "c", code: "1200", name: "Equipment", cls: "fixed_assets" },
    ] as never;
    const r = subClassEntries(accounts, { a: "interest_payable", b: "", c: "lease_liability" });
    expect(r.entries).toEqual([
      { key: "#2160", cls: "other_cl", name: "Interest payable", sub_class: "interest_payable" },
      { key: "accrued dividends", cls: "other_cl", name: "  Accrued Dividends ", sub_class: "" },
    ]);
    expect(r.refused).toEqual(["Equipment"]);
  });
  it("a saved choice is found again by the cleaned name", async () => {
    const { withSubClasses } = await import("@/lib/ingest/subclass");
    const [a] = withSubClasses([{ id: "b", code: "", name: "  Accrued Dividends ", cls: "other_cl", amounts: {} }] as never, { "accrued dividends": "dividends_payable" });
    expect(a.sub).toBe("dividends_payable");
  });
});
