import { cleanNum, parsePeriod, splitCode, stmtFromText, type Cell } from "./parse";

export interface Grid { name: string; rows: Cell[][] }

export interface RawLine {
  key: string;
  sheet: string;
  row: number;
  label: string;
  code: string;
  name: string;
  section: string;
  stmt: "PL" | "BS" | null;
  /** natural: values as presented (P&L month or YTD, BS closing). movement: debit − credit per month. */
  kind: "natural" | "movement";
  values: Record<string, number>;
  /** Raw (debit − credit) opening balance before the first period, movement lines only. */
  opening: number;
}

export interface ExtractIssues { skippedCols: string[]; warnings: string[] }

const BUDGET_WORDS = /budget|forecast|\bplan\b|\btarget|variance|\bvar\b|%|\bprior|last year|\b(py|ly)\b|\bdiff|موازنة|تقديري|مخطط/i;
const isText = (v: Cell) => typeof v === "string" && v.trim() !== "";
const str = (v: Cell) => (v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v)).trim();

function trimGrid(rows: Cell[][]): Cell[][] {
  const nonEmpty = rows.filter((r) => r && r.some((c) => str(c) !== ""));
  const width = Math.max(0, ...nonEmpty.map((r) => r.length));
  const keepCols = Array.from({ length: width }, (_, c) => nonEmpty.some((r) => str(r[c]) !== ""));
  return nonEmpty.map((r) => keepCols.map((k, c) => (k ? r[c] : undefined)).filter((_, c) => keepCols[c]));
}

function findHeader(rows: Cell[][]): { row: number; cols: Map<number, string> } | null {
  let best: { row: number; cols: Map<number, string> } | null = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cols = new Map<number, string>();
    rows[r].forEach((v, c) => { const p = parsePeriod(v); if (p) cols.set(c, p); });
    if (cols.size >= 2 && (!best || cols.size > best.cols.size)) best = { row: r, cols };
  }
  // A single period column is only accepted when nothing better exists (e.g. a one-month export)
  if (!best) for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const cols = new Map<number, string>();
    rows[r].forEach((v, c) => { const p = parsePeriod(v); if (p) cols.set(c, p); });
    if (cols.size === 1 && rows.slice(r + 1, r + 6).some((rr) => rr.some((x) => cleanNum(x) !== null && typeof x !== "string"))) { best = { row: r, cols }; break; }
  }
  return best;
}

function labelColumn(rows: Cell[][], from: number, before: number): { label: number; code: number | null } {
  const counts = new Map<number, number>();
  const codeLike = new Map<number, number>();
  for (let c = 0; c < before; c++) {
    let t = 0, k = 0;
    for (let r = from; r < rows.length; r++) {
      const v = rows[r][c];
      if (isText(v) && !/^\s*[\d.\-]+\s*$/.test(String(v))) t++;
      if ((typeof v === "number" && Number.isInteger(v) && v >= 100) || (typeof v === "string" && /^\s*\d{3,}[\d.\-]*\s*$/.test(v))) k++;
    }
    counts.set(c, t); codeLike.set(c, k);
  }
  let label = 0, best = -1;
  for (const [c, n] of counts) if (n > best) { best = n; label = c; }
  let code: number | null = null, bestK = 2;
  for (const [c, n] of codeLike) if (c !== label && n > bestK) { bestK = n; code = c; }
  return { label, code };
}

function headingDepth(label: string) {
  const t = label.trim();
  return /^(assets?|liabilit\w*|equity|income|revenue|expenses?)(\s|$)/i.test(t) || /^(الأصول|الاصول|الخصوم|الالتزامات|حقوق|الإيرادات|الايرادات|المصروفات|المصاريف)/.test(t) ? 0 : 1;
}

export function extractWide(g: Grid, rowsIn: Cell[][], hdr: { row: number; cols: Map<number, string> }, issues: ExtractIssues): RawLine[] {
  const rows = rowsIn;
  const hint = stmtFromText(g.name);
  const sub = rows[hdr.row + 1] ?? [];
  const isDC = (v: Cell) => /^(debit|credit|مدين|دائن|débit|crédit)$/i.test(str(v));
  const dcMode = sub.filter(isDC).length >= 2;
  const periodCols = [...hdr.cols.entries()].sort((a, b) => a[0] - b[0]);
  type Col = { p: string; deb?: number; cred?: number; val?: number };
  const cols: Col[] = [];
  let openDeb: number | undefined, openCred: number | undefined;
  if (dcMode) {
    const headerRow = rows[hdr.row];
    // Opening balance group ("Initial Balance" / "Opening")
    const openIdx = headerRow.findIndex((v) => /initial|opening|افتتاحي|أول المدة/i.test(str(v)));
    const groups = [...periodCols.map(([c, p]) => ({ c, p })), ...(openIdx >= 0 ? [{ c: openIdx, p: "__open" }] : [])].sort((a, b) => a.c - b.c);
    groups.forEach((gp, i) => {
      const end = groups[i + 1]?.c ?? headerRow.length + 2;
      let deb: number | undefined, cred: number | undefined;
      for (let c = gp.c; c < end; c++) {
        const s = str(sub[c]).toLowerCase();
        if (deb === undefined && /debit|مدين|débit/.test(s)) deb = c;
        else if (cred === undefined && /credit|دائن|crédit/.test(s)) cred = c;
      }
      if (gp.p === "__open") { openDeb = deb; openCred = cred; }
      else if (deb !== undefined && cred !== undefined) {
        if (cols.some((x) => x.p === gp.p)) issues.skippedCols.push(`${g.name}: duplicate columns for ${gp.p} ignored`);
        else cols.push({ p: gp.p, deb, cred });
      }
    });
  } else {
    for (const [c, p] of periodCols) {
      const ctx = [hdr.row - 2, hdr.row - 1].filter((r) => r >= 0).map((r) => rows[r][c]).filter((v) => str(v) && parsePeriod(v) === null).map(str).join(" ");
      if (BUDGET_WORDS.test(ctx) || BUDGET_WORDS.test(str(rows[hdr.row][c]).replace(/\d{4}/, ""))) { issues.skippedCols.push(`${g.name}: column ${c + 1} (${p}) looks like budget/variance${ctx ? `: '${ctx}'` : ""}`); continue; }
      const sub2 = str(rows[hdr.row + 1]?.[c]);
      if (BUDGET_WORDS.test(sub2) && !/actual|فعلي/i.test(sub2)) { issues.skippedCols.push(`${g.name}: column ${c + 1} (${p}) is '${sub2}'`); continue; }
      if (cols.some((x) => x.p === p)) { issues.skippedCols.push(`${g.name}: duplicate column for ${p} ignored (first one kept)`); continue; }
      cols.push({ p, val: c });
    }
  }
  if (!cols.length) return [];
  const firstCol = Math.min(...cols.map((c) => c.val ?? c.deb ?? 0), openDeb ?? Infinity);
  const start = hdr.row + (dcMode ? 2 : 1);
  const { label: lc, code: cc } = labelColumn(rows, start, firstCol);
  const out: RawLine[] = [];
  const heads: string[] = [];
  for (let r = start; r < rows.length; r++) {
    const raw = rows[r][lc];
    let lab = str(raw);
    if (!lab || /^[\d.\-\s]+$/.test(lab)) continue;
    const codeCell = cc !== null ? str(rows[r][cc]) : "";
    if (codeCell && !lab.startsWith(codeCell)) lab = `${codeCell} ${lab}`;
    const values: Record<string, number> = {};
    let any = false;
    for (const col of cols) {
      let v: number | null;
      if (dcMode) {
        const d = cleanNum(rows[r][col.deb!]), c2 = cleanNum(rows[r][col.cred!]);
        v = d === null && c2 === null ? null : (d ?? 0) - (c2 ?? 0);
      } else v = cleanNum(rows[r][col.val!]);
      if (v !== null) { values[col.p] = v; any = true; }
    }
    if (!any) {
      // heading row: keep a two-level section path
      if (headingDepth(lab) === 0) heads.length = 0;
      heads.splice(1);
      heads.push(lab);
      continue;
    }
    const opening = dcMode && openDeb !== undefined ? (cleanNum(rows[r][openDeb]) ?? 0) - (openCred !== undefined ? cleanNum(rows[r][openCred]) ?? 0 : 0) : 0;
    const { code, name } = splitCode(lab);
    out.push({ key: `${g.name}|${r + 1}|${lab}`, sheet: g.name, row: r + 1, label: lab, code, name, section: heads.join(" / "), stmt: hint, kind: dcMode ? "movement" : "natural", values, opening });
  }
  return out;
}

export function extractLong(g: Grid, rows: Cell[][]): RawLine[] | null {
  const hint = stmtFromText(g.name);
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map((x) => str(x).toLowerCase());
    const pick = (rx: RegExp, prefer?: RegExp) => {
      const all = cells.map((x, i) => (rx.test(x) ? i : -1)).filter((i) => i >= 0);
      return (prefer && all.find((i) => prefer.test(cells[i]))) ?? all[0];
    };
    const acc = pick(/account|description|name|اسم|بيان|حساب|compte/, /^(account|الحساب|حساب|compte)$/);
    const dat = pick(/date|period|month|تاريخ|شهر|فترة/, /^(date|التاريخ|period|month)$/);
    const deb = pick(/^(debit|مدين|débit)$/);
    const cre = pick(/^(credit|دائن|crédit)$/);
    const amt = pick(/amount|balance|value|net|مبلغ|رصيد|قيمة/);
    if (acc === undefined || dat === undefined || (amt === undefined && (deb === undefined || cre === undefined))) continue;
    const typ = pick(/^(type|class|category|statement|نوع|تصنيف)$/);
    const movement = (deb !== undefined && cre !== undefined) || cells.some((x) => /journal|move|entry|قيد/.test(x));
    const agg = new Map<string, RawLine>();
    for (let rr = r + 1; rr < rows.length; rr++) {
      const lab = str(rows[rr][acc]);
      const per = parsePeriod(rows[rr][dat]);
      if (!lab || !per) continue;
      const v = deb !== undefined && cre !== undefined ? (cleanNum(rows[rr][deb]) ?? 0) - (cleanNum(rows[rr][cre]) ?? 0) : cleanNum(rows[rr][amt!]);
      if (v === null) continue;
      const sec = typ !== undefined ? str(rows[rr][typ]) : "";
      const k = `${lab}|${sec}`;
      let line = agg.get(k);
      if (!line) {
        const { code, name } = splitCode(lab);
        line = { key: `${g.name}|${k}`, sheet: g.name, row: 0, label: lab, code, name, section: sec, stmt: hint, kind: movement ? "movement" : "natural", values: {}, opening: 0 };
        agg.set(k, line);
      }
      line.values[per] = (line.values[per] ?? 0) + v;
    }
    return [...agg.values()];
  }
  return null;
}

export function extractGrid(g: Grid, issues: ExtractIssues): RawLine[] {
  const rows = trimGrid(g.rows);
  if (!rows.length) return [];
  const hdr = findHeader(rows);
  const got = hdr ? extractWide(g, rows, hdr, issues) : extractLong(g, rows);
  if (!got || !got.length) {
    const long = hdr ? extractLong(g, rows) : null;
    if (long?.length) return long;
    issues.warnings.push(`Sheet '${g.name}': no month columns or Account/Date/Amount header found; skipped.`);
    return [];
  }
  return got;
}
