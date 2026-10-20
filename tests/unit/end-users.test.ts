// Who really bought: for sales billed to a buying agency (Egypt's Unified Procurement Authority bills on behalf of each
// hospital), the end user comes only from an exact link (the invoice's own sales order, its addressed contact, its delivery
// address, or the company's order register). A line with no link is Unmapped and is never spread across hospitals; every
// figure adds back to the agency's sales, month by month, to the pound.
import { describe, expect, it } from "vitest";
import { endUserAnalysis, hospitalKey, cleanHospital, detectAgencies, type EndUserRow } from "@/lib/engine";
import { mapsOf, parseEndUsers, parseRegister } from "@/lib/company/end-users-parse";

const UPA = "الهيئة المصرية للشراء الموحد";
const row = (p: string, u: string, m: EndUserRow["m"], a: number, extra: Partial<EndUserRow> = {}): EndUserRow => ({ p, c: UPA, u, m, g: "Consumables", o: "", a, q: 1, n: 1, ...extra });

describe("hospital names", () => {
  it("one hospital whatever the agency suffix or Arabic spelling", () => {
    expect(hospitalKey("مستشفى النور التخصصي-الشراء الموحد")).toBe(hospitalKey("مستشفي النور التخصصى"));
    expect(hospitalKey("مستشفي الربيع المركزي(الشراء الموحد)")).toBe(hospitalKey("مستشفى الوادى المركزى"));
    expect(cleanHospital("مستشفى النور التخصصي-الشراء الموحد")).toBe("مستشفى النور التخصصي");
  });
  it("an invoice addressed to the agency's own child contact names the hospital in brackets", () => {
    expect(cleanHospital(`${UPA} (جامعه الوادي)`, UPA)).toBe("جامعه الوادي");
  });
});

describe("which customers are agencies", () => {
  it("a customer whose linked lines go to three or more other end users is an agency; a hospital buying for itself is not", () => {
    const rows = [row("2026-09", "مستشفى أ", "order", 10), row("2026-09", "مستشفى ب", "order", 10), row("2026-09", "مستشفى ج", "order", 10),
      { ...row("2026-09", "Northside Hospital", "order", 50), c: "Northside Hospital" }];
    expect(detectAgencies(rows)).toEqual([UPA]);
  });
  it("the company's own list wins (add or remove an agency)", () => {
    expect(detectAgencies([row("2026-09", "مستشفى أ", "order", 10)], { add: [UPA], remove: [] })).toEqual([UPA]);
    const three = [row("2026-09", "أ", "order", 1), row("2026-09", "ب", "order", 1), row("2026-09", "ج", "order", 1)];
    expect(detectAgencies(three, { add: [], remove: [UPA] })).toEqual([]);
  });
});

describe("end users of agency sales", () => {
  const rows: EndUserRow[] = [
    row("2026-09", "مستشفي النور التخصصى", "order", 100),
    row("2026-09", "مستشفى النور التخصصي-الشراء الموحد", "order", 400),
    row("2026-09", "مستشفى الشفاء العام", "contact", 200),
    row("2026-09", "", "", 300, { o: "( PRO 501 / 22 ) - [Device] Airtech AE-8" }),
    row("2026-09", "", "", 50, { o: "Maintenance Contract" }),
    row("2026-08", "مستشفى الشفاء العام", "shipping", 70),
    { ...row("2026-09", "", "", 999), c: "Northside Hospital" },
  ];
  const a = endUserAnalysis(rows, { agencies: [UPA], aliases: {}, register: { "PRO 501/22": "مستشفى الرحمة" } });

  it("each line's method, in order of trust; the register places an order-numbered line; the rest is Unmapped", () => {
    const sep = a.months.find((m) => m.period === "2026-09")!;
    expect(sep).toMatchObject({ total: 1050, order: 500, contact: 200, shipping: 0, register: 300, unmapped: 50 });
    expect(sep.order + sep.contact + sep.shipping + sep.register + sep.unmapped).toBe(sep.total);
  });

  it("spellings merge into one hospital, named as its largest spelling; a hospital's sales add up across months", () => {
    expect(a.hospitals.map((h) => [h.name, h.amount])).toEqual([["مستشفى النور التخصصي", 500], ["مستشفى الرحمة", 300], ["مستشفى الشفاء العام", 270]]);
    expect(a.total).toBe(1120);
    expect(a.unmapped).toEqual([{ text: "Maintenance Contract", amount: 50, lines: 1, months: ["2026-09"] }]);
  });

  it("an alias set by a person merges two names the rules can't tell apart", () => {
    const b = endUserAnalysis(rows, { agencies: [UPA], aliases: { [hospitalKey("مستشفى الشفاء العام")]: "مستشفى النور التخصصي" }, register: {} });
    expect(b.hospitals[0]).toMatchObject({ name: "مستشفى النور التخصصي", amount: 770 });
  });

  it("sales to customers who are not agencies are left out (they are their own end user)", () => {
    expect(a.total).toBe(rows.filter((r) => r.c === UPA).reduce((s, r) => s + r.a, 0));
  });

  it("coverage: the share of agency sales placed on a hospital by an exact link", () => {
    expect(a.coverage).toBeCloseTo(1070 / 1120, 6);
  });

  it("an empty set reads as nothing to show, not as 0% mapped", () => {
    const e = endUserAnalysis([], { agencies: [], aliases: {}, register: {} });
    expect(e).toMatchObject({ total: 0, coverage: null, hospitals: [], months: [] });
  });
});


describe("the database summary and the company's choices", () => {
  it("amounts as text read as numbers; unknown methods as no link; bad months dropped", () => {
    const d = parseEndUsers({ rows: [{ p: "2026-09", c: UPA, u: "X", m: "order", g: "", o: "", a: "250000.00", q: "5", n: 1 }, { p: "2026-09", c: UPA, u: "", m: "guess", a: 3 }, { p: "bad", c: UPA, a: 1 }], map: [{ k: "order", key: "PRO 501/22", h: "Rahma" }, { k: "hack", key: "x", h: "y" }] });
    expect(d.rows.map((r) => [r.a, r.m])).toEqual([[250000, "order"], [3, ""]]);
    expect(d.choices).toEqual([{ kind: "order", key: "PRO 501/22", hospital: "Rahma" }]);
    expect(parseEndUsers(null)).toEqual({ rows: [], choices: [], statement: [], statementFile: null });
  });
  it("choices become aliases, register and the agency list", () => {
    const d = parseEndUsers({ rows: [], map: [{ k: "agency", key: UPA, h: "" }, { k: "not_agency", key: "B", h: "" }, { k: "alias", key: "k", h: "H" }] });
    const m = mapsOf(d, (own) => detectAgencies([], own));
    expect(m).toEqual({ agencies: [UPA], aliases: { k: "H" }, register: {} });
  });
  it("register lines pasted as 'number = hospital', or from Excel with a tab", () => {
    expect(parseRegister("PRO 501/22 = مستشفى الرحمة\nPRO 502/22\tمستشفى السلام\n\njunk")).toEqual([{ key: "PRO 501/22", hospital: "مستشفى الرحمة" }, { key: "PRO 502/22", hospital: "مستشفى السلام" }]);
  });
});
