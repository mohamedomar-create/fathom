import * as XLSX from "@e965/xlsx";

/**
 * Made-up messy workbooks, shaped like the hand-kept files small businesses send (never real data: this repository is
 * public). Cells are written one by one so formulas, cached results and spreadsheet errors are exactly as Excel saves them.
 */
type V = string | number | Date | null | { f: string; v: number } | { err: string };
const at = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });

export function sheetOf(cells: Record<string, V>): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxR = 0, maxC = 0;
  for (const [ref, v] of Object.entries(cells)) {
    if (v === null) continue;
    const a = XLSX.utils.decode_cell(ref);
    maxR = Math.max(maxR, a.r); maxC = Math.max(maxC, a.c);
    if (v instanceof Date) ws[ref] = { t: "d", v };
    else if (typeof v === "number") ws[ref] = { t: "n", v };
    else if (typeof v === "string") ws[ref] = { t: "s", v };
    else if ("err" in v) ws[ref] = { t: "e", v: 0x17, w: v.err };
    else ws[ref] = { t: "n", v: v.v, f: v.f };
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  return ws;
}

export function bookOf(sheets: Record<string, Record<string, V>>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, cells] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, sheetOf(cells), name);
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", cellDates: true }) as ArrayBuffer;
  return out;
}

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

/**
 * A quarter's cash book: money out by kind of cost on the left, money in by store on the right, month headings,
 * the owner's SUM totals, a total that leaves out the first month's sales, a summary under the totals, and one row
 * pasted far across the sheet.
 */
export function cashBookCells(): Record<string, V> {
  const c: Record<string, V> = {
    A1: "Cash OUT", I1: "Cash IN",
    B2: "Fixed Cost", C2: "Variable cost", D2: "Production Cost", E2: "Salaries", F2: "Bank", G2: "Date",
    I2: "Store", J2: "Status", K2: "EGP", L2: "VAT", M2: "Date",
    A3: "JANUARY", I3: "DECEMBER 2025 sales",
    A4: "Workshop rent", B4: 5000, F4: "cib", G4: d(2026, 1, 3), I4: "Lotus Store", J4: "yes", K4: 10000, L4: 1400, M4: d(2026, 1, 10),
    A5: "Wood and finishing", D5: 12000, F5: "cib", G5: d(2026, 1, 8), I5: "Online order", J5: "yes", K5: 2500, M5: d(2026, 1, 12),
    A6: "Delivery", C6: 450, G6: d(2026, 1, 12),
    A7: "Packaging",
    A8: "Gift boxes", C8: 1200, G8: d(2026, 1, 20),
    A9: "Staff", E9: 6000, G9: d(2026, 1, 28),
    A10: "FEBRUARY", I10: "JAN 2026 sales",
    A11: "Workshop rent", B11: 5000, G11: d(2026, 2, 3), I11: "Lotus Store", J11: "yes", K11: 8000, L11: 1120, M11: d(2026, 2, 9),
    A12: "Inlay work", D12: 7500, G12: d(2026, 2, 10), I12: "Gallery shop", J12: "yes", K12: 4000, L12: 560,
    A13: "Staff", E13: 6000, G13: d(2026, 2, 26), I13: "Mona's order", J13: "yes", K13: 1500,
    // The owner's totals: costs over every row; sales only from the second month (rows 11-13).
    B15: { f: "SUM(B4:B13)", v: 10000 }, C15: { f: "SUM(C4:C13)", v: 1650 }, D15: { f: "SUM(D4:D13)", v: 19500 }, E15: { f: "SUM(E4:E13)", v: 12000 },
    F15: { f: "SUM(B15:E15)", v: 43150 },
    K15: { f: "SUM(K11:K13)", v: 13500 }, L15: { f: "SUM(L4:L13)", v: 3080 },
    E16: "Profit", F16: { f: "K15-F15", v: -29650 },
    // Their summary below the totals.
    A18: "Q1 sales", B18: 26000, D18: "Q1 expenses", E18: 43150,
  };
  // One row pasted across the sheet, far to the right.
  for (let k = 0; k < 40; k++) c[at(5, 40 + k * 5)] = k % 2 ? "cib" : 450;
  return c;
}

/** A bank statement, oldest first, opening balance, debit / credit / balance. */
export function bankCells(breakAt?: number): Record<string, V> {
  const c: Record<string, V> = {
    A1: "National Bank — account statement", A3: "Date", B3: "Description", C3: "Debit", D3: "Credit", E3: "Balance",
    B4: "Opening balance", E4: 50000,
  };
  const lines: [Date, string, number, number][] = [
    [d(2026, 3, 2), "Transfer from Lotus Store", 0, 12000],
    [d(2026, 3, 5), "Rent March", 8000, 0],
    [d(2026, 3, 9), "POS purchase packaging", 1250.5, 0],
    [d(2026, 3, 15), "Card sales settlement", 0, 6400],
    [d(2026, 3, 28), "Salaries", 15000, 0],
  ];
  let bal = 50000;
  lines.forEach(([dt, desc, dr, cr], i) => {
    bal = Math.round((bal - dr + cr) * 100) / 100;
    const r = 5 + i;
    c[`A${r}`] = dt; c[`B${r}`] = desc; if (dr) c[`C${r}`] = dr; if (cr) c[`D${r}`] = cr;
    c[`E${r}`] = breakAt === i ? bal + 100 : bal;
  });
  return c;
}

export const priceListCells = (): Record<string, V> => ({
  A1: "Price list 2026", A2: "Collection", B2: "Product name", C2: "Code", D2: "Cost", E2: "Retail price",
  A3: "Lotus", B3: "Coaster", C3: "CO-01", D3: 120, E3: 380,
  B4: "Tray", C4: "TR-01", D4: 700, E4: 1900,
  B5: "Box", C5: "BO-01", D5: 400, E5: { err: "#REF!" },
});

export const summaryCells = (): Record<string, V> => ({
  A1: "Valuation 2025", B2: "Capital", C2: 100000, B3: "Sales", C3: 806000, B4: "Profit", C4: 186000,
});

/** A journal list with Date / Account / Debit / Credit: the accounting reader's, never a cash book. */
export const journalCells = (): Record<string, V> => ({
  A1: "Date", B1: "Account", C1: "Description", D1: "Debit", E1: "Credit",
  A2: d(2026, 1, 5), B2: "6100 Rent", C2: "January rent", D2: 5000,
  A3: d(2026, 1, 5), B3: "1010 Bank", C3: "January rent", E3: 5000,
  A4: d(2026, 1, 9), B4: "4000 Sales", C4: "Invoice 1", E4: 9000,
  A5: d(2026, 1, 9), B5: "1100 Customers", C5: "Invoice 1", D5: 9000,
});

const MONTH = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
/**
 * One quarter of a cash book as owners keep them: month headings, a VAT column beside sales, the owner's totals, and
 * their own "net sales = EGP − VAT" formula. Quarter 1 has a payment dated 30 December under JANUARY.
 * Money out 40,950 a quarter; sales 28,400 with 3,220 VAT, so 25,180 net.
 */
export function quarterCells(q: 1 | 2 | 3 | 4, year = 2026): Record<string, V> {
  const m = [1, 2, 3].map((i) => (q - 1) * 3 + i);
  return {
    A1: "Cash OUT", I1: "Cash IN",
    B2: "Fixed Cost", C2: "Variable cost", D2: "Production Cost", E2: "Salaries", G2: "Date", I2: "Store", J2: "Status", K2: "EGP", L2: "VAT", M2: "Date",
    A3: MONTH[m[0] - 1], I3: `${MONTH[m[0] - 1]} ${year} sales`,
    A4: "Workshop rent", B4: 5000, G4: d(year, m[0], 3), I4: "Lotus Store", J4: "yes", K4: 11400, L4: 1400,
    A5: "Wood and finishing", D5: 12000, G5: q === 1 ? d(year - 1, 12, 30) : d(year, m[0], 8),
    A6: "Delivery", C6: 450, G6: d(year, m[0], 12), I6: "Online order", J6: "yes", K6: 2500,
    A7: MONTH[m[1] - 1], I7: `${MONTH[m[1] - 1]} ${year} sales`,
    A8: "Workshop rent", B8: 5000, G8: d(year, m[1], 3), I8: "Lotus Store", J8: "yes", K8: 9000, L8: 1260,
    A9: "Staff", E9: 6000, G9: d(year, m[1], 26), I9: "Gallery shop", J9: "yes", K9: 4000, L9: 560,
    A10: MONTH[m[2] - 1], I10: `${MONTH[m[2] - 1]} ${year} sales`,
    A11: "Workshop rent", B11: 5000, G11: d(year, m[2], 3), I11: "Mona's order", J11: "yes", K11: 1500,
    A12: "Inlay work", D12: 7500, G12: d(year, m[2], 10),
    B14: { f: "SUM(B4:B12)", v: 15000 }, C14: { f: "SUM(C4:C12)", v: 450 }, D14: { f: "SUM(D4:D12)", v: 19500 }, E14: { f: "SUM(E4:E12)", v: 6000 },
    F14: { f: "SUM(B14:E14)", v: 40950 }, K14: { f: "SUM(K4:K12)", v: 28400 }, L14: { f: "SUM(L4:L12)", v: 3220 },
    J15: "Net sales", K15: { f: "K14-L14", v: 25180 },
  };
}

/** The owner's yearly summary on a tab of its own: quarter sales and expenses, the year, profit, and a target. */
export function yearSummaryCells(q2Sales = 25180): Record<string, V> {
  return {
    A1: "Summary",
    A3: "Q1 sales", B3: 25180, D3: "Q1 expenses", E3: 40950,
    A4: "Q2 sales", B4: q2Sales, D4: "Q2 expenses", E4: 40950,
    A6: "Total sales 2026", B6: 50360, D6: "Total expenses 2026", E6: 81900,
    A7: "Profit 2026", B7: -31540,
    A10: "Q3 Revenue", B10: 60000,
  };
}
