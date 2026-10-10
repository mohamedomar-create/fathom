import { detectDateOrder, parseDay, parsePeriod, type Cell, type DateOrder } from "./parse";
import { controlMetric, headerPeriod, str, type ExtractIssues, type RawLine, type SheetLayout, type SheetOverride } from "./extract";

/**
 * Odoo's own XLSX exports (Accounting → Reporting), read exactly rather than guessed:
 * - General Ledger: Code | Account Name | Date | Communication | Partner | Currency | Debit | Credit | Balance,
 *   one heading row per account (its closing totals), an "Initial Balance" row, then dated move lines.
 * - Trial Balance: Code | Account Name | Debit | Credit … under "Initial Balance" / period / "End Balance" groups,
 *   with group rows ("1 Assets", "121 Cash") in the name column and a final "Total" row.
 * - Profit and Loss / Balance Sheet: Code | Account Name | Balance (or one column per period), section rows without a code.
 */

type Num = (v: Cell) => number | null;
const CODE_HDR = /^(code|الكود|الرمز|رمز الحساب|كود الحساب|code compte)$/i;
const NAME_HDR = /^(account( name)?|name|اسم الحساب|الحساب|البيان|compte|libellé)$/i;
const DEBIT = /^(debit|مدين|débit)$/i;
const CREDIT = /^(credit|دائن|crédit)$/i;
const INITIAL = /^(initial balance|opening balance|balance forward|solde (initial|d'ouverture)|رصيد افتتاحي|الرصيد الافتتاحي|رصيد أول المدة|رصيد اول المدة)$/i;
const INITIAL_GROUP = /initial|opening|افتتاحي|أول المدة|اول المدة|solde initial/i;
const END_GROUP = /^(end(ing)? balance|closing balance|balance|رصيد آخر المدة|رصيد اخر المدة|الرصيد الختامي|رصيد ختامي|solde final)$/i;
const GRAND_TOTAL = /^(total|grand total|الإجمالي|الاجمالي|المجموع|إجمالي)$/i;
const TOTAL_PREFIX = /^(total|الإجمالي|الاجمالي|إجمالي|اجمالي|مجموع)\b/i;
const NO_GROUP = /^\(no group\)$|^\(بدون مجموعة\)$/i;

interface Ctx { g: { name: string }; rows: Cell[][]; num: Num; ov: SheetOverride; layout: SheetLayout; issues: ExtractIssues; today: string }

export function extractOdoo(g: { name: string; rows: Cell[][] }, rows: Cell[][], num: Num, ov: SheetOverride, layout: SheetLayout, issues: ExtractIssues, today: string): RawLine[] | null {
  for (let r = 0; r < Math.min(rows.length, 12); r++) {
    const cells = rows[r].map((v) => str(v));
    const cCode = cells.findIndex((x) => CODE_HDR.test(x));
    const cName = cells.findIndex((x, i) => i > cCode && NAME_HDR.test(x));
    if (cCode < 0 || cName !== cCode + 1) continue;
    const ctx: Ctx = { g, rows, num, ov, layout, issues, today };
    const dat = cells.findIndex((x) => /^(date|التاريخ|تاريخ)$/i.test(x));
    const debits = cells.map((x, i) => (DEBIT.test(x) ? i : -1)).filter((i) => i >= 0);
    if (dat > cName && debits.length === 1) return ledger(ctx, r, cCode, cName, dat, debits[0], cells.findIndex((x) => CREDIT.test(x)));
    if (debits.length >= 2) return trialBalance(ctx, r, cCode, cName);
    const vals = cells.map((x, i) => (i > cName && x ? i : -1)).filter((i) => i >= 0);
    if (vals.length) return statement(ctx, r, cCode, cName, vals);
  }
  return null;
}

/** Title rows above the headings: the report's period ("From 01/01/2026 to 10/10/2026", "2026", "As of 10/10/2026"). */
function titlePeriod(rows: Cell[][], before: number) {
  for (let t = 0; t < before; t++) for (const v of rows[t]) { const h = headerPeriod(v); if (h) return h; }
  return null;
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDay = (d: string) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const monthEnd = (day: string) => { const [y, m] = day.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
/** "2026-10-10" when the figures stop before the month ends; undefined for a full month. */
export const partialDay = (day?: string | null) => (day && Number(day.slice(8)) < monthEnd(day) ? day : undefined);

function ledger({ g, rows, num, ov, layout, issues, today }: Ctx, r: number, cCode: number, cName: number, cDate: number, cDeb: number, cCred: number): RawLine[] | null {
  if (cCred < 0) return null;
  const found = detectDateOrder(rows.slice(r + 1).map((row) => row[cDate]));
  const order: DateOrder = ov.dateOrder ?? found.order ?? "dmy";
  layout.dates = { order, sample: ov.dateOrder ? null : found.sample };
  layout.source = "Odoo General Ledger";
  layout.headerRow = r;
  const title = titlePeriod(rows, r);
  layout.asOf = partialDay(title?.endDay);
  // Entries dated after the report's end (or after today) are left out, as Odoo's own reports for the period do; they are listed below.
  const cutoff = title?.endDay ?? today;
  const late: { acc: string; ref: string; day: string; amt: number }[] = [];
  type Acc = RawLine & { initial: boolean; moves: number };
  const accounts: Acc[] = [];
  let cur: Acc | null = null;
  const dc = (row: Cell[]) => (num(row[cDeb]) ?? 0) - (num(row[cCred]) ?? 0);
  for (let i = r + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = str(row[cCode]), name = str(row[cName]);
    const date = row[cDate];
    const noDate = date === null || date === undefined || str(date) === "";
    // Odoo 17+ accounts can lack a code in a company (shared charts): a dated-less heading with amounts is still an account.
    const codeless = !code && noDate && name && !INITIAL.test(name) && !TOTAL_PREFIX.test(name) && !GRAND_TOTAL.test(name) && (num(row[cDeb]) !== null || num(row[cCred]) !== null);
    if ((code && noDate) || codeless) {
      cur = { key: `${g.name}|gl|${code || "-"}|${name}`, sheet: g.name, row: i + 1, label: `${code} ${name}`.trim(), code, name: name || code, section: "", stmt: null, kind: "movement", values: {}, opening: 0, closing: dc(row), initial: false, moves: 0 };
      accounts.push(cur);
      continue;
    }
    if (!cur) continue;
    if (!code && INITIAL.test(name)) { cur.opening += dc(row); cur.initial = true; continue; }
    const p = parsePeriod(date, order);
    if (p) {
      const day = parseDay(date, order);
      if (day && day > cutoff) { late.push({ acc: cur.label, ref: name, day, amt: dc(row) }); cur.closing = (cur.closing ?? 0) - dc(row); continue; }
      cur.values[p] = (cur.values[p] ?? 0) + dc(row); cur.moves++; continue;
    }
    if (!code && (GRAND_TOTAL.test(name) || TOTAL_PREFIX.test(name))) { if (GRAND_TOTAL.test(name)) cur = null; continue; }
  }
  // An account without an "Initial Balance" row still has one when its heading balance differs from its movements (e.g. undistributed profits).
  for (const a of accounts) if (!a.initial) a.opening = (a.closing ?? 0) - Object.values(a.values).reduce((s, v) => s + v, 0);
  if (late.length) {
    const days = [...new Set(late.map((l) => l.day))].sort();
    (issues.checks ??= []).push({ id: "future_dated", severity: "warn", title: `${late.length} entr${late.length > 1 ? "ies are" : "y is"} dated after ${fmtDay(cutoff)}`, detail: `Left out, as Odoo's reports for the period do: ${late.slice(0, 4).map((l) => `${l.ref} on ${fmtDay(l.day)} (${l.acc}, ${Math.abs(l.amt).toLocaleString("en-GB", { maximumFractionDigits: 2 })})`).join("; ")}${late.length > 4 ? "…" : ""}. ${days[0] > today ? "They are in the future, so the date is probably a typing error: correct it in Odoo and export again." : "Export a later period to include them."}` });
  }
  const out: RawLine[] = accounts.filter((a) => Math.abs(a.opening) > 0.004 || Object.keys(a.values).length).map((a) => { const { initial, moves, ...line } = a; void initial; void moves; return line; });
  return out.length ? out : null;
}

function trialBalance({ g, rows, num, ov, layout, issues }: Ctx, r: number, cCode: number, cName: number): RawLine[] | null {
  const head = rows[r].map((v) => str(v));
  // Group labels sit in the nearest non-empty row above the Debit/Credit headings, at or left of each Debit column.
  const above = r > 0 ? rows[r - 1].map((v) => str(v)) : [];
  const groupAt = (c: number) => { for (let k = c; k > cName; k--) if (above[k]) return { label: above[k], col: k }; return null; };
  type Grp = { kind: "initial" | "end" | "period"; deb: number; cred: number; col: number; label: string; p?: string; months?: number; endDay?: string };
  const groups: Grp[] = [];
  for (let c = cName + 1; c < head.length; c++) {
    if (!DEBIT.test(head[c])) continue;
    const cred = head.findIndex((x, i) => i > c && CREDIT.test(x));
    if (cred < 0) continue;
    const gp = groupAt(c);
    const label = gp?.label ?? "";
    if (INITIAL_GROUP.test(label)) groups.push({ kind: "initial", deb: c, cred, col: c, label });
    else if (END_GROUP.test(label)) groups.push({ kind: "end", deb: c, cred, col: c, label });
    else {
      const h = headerPeriod(label) ?? titlePeriod(rows, r);
      if (h) groups.push({ kind: "period", deb: c, cred, col: c, label, p: h.p, months: h.months, endDay: h.endDay });
    }
  }
  const periods = groups.filter((x) => x.kind === "period");
  if (!periods.length) return null;
  layout.source = "Odoo Trial Balance";
  layout.headerRow = r;
  for (const gp of periods) {
    const o = ov.periods?.[gp.col];
    if (o === null) { layout.columns.push({ col: gp.col, header: gp.label.slice(0, 80), period: gp.p!, months: gp.months!, used: false, reason: "left out by you" }); continue; }
    if (o && /^\d{4}-(0[1-9]|1[0-2])$/.test(o)) { gp.p = o; gp.months = 1; gp.endDay = undefined; }
    if (layout.columns.some((x) => x.used && x.period === gp.p)) { layout.columns.push({ col: gp.col, header: gp.label.slice(0, 80), period: gp.p!, months: gp.months!, used: false, reason: "same month as an earlier column" }); continue; }
    layout.columns.push({ col: gp.col, header: gp.label.slice(0, 80), period: gp.p!, months: gp.months!, used: true });
  }
  const used = periods.filter((gp) => layout.columns.some((x) => x.col === gp.col && x.used));
  const last = used[used.length - 1];
  layout.asOf = last ? partialDay(last.endDay) : undefined;
  const initial = groups.find((x) => x.kind === "initial"), end = groups.find((x) => x.kind === "end");
  const dc = (row: Cell[], gp?: Grp) => (gp ? (num(row[gp.deb]) ?? 0) - (num(row[gp.cred]) ?? 0) : 0);
  const stack: { code: string; label: string }[] = [];
  const out: RawLine[] = [];
  const total = (row: Cell[]) => groups.reduce((a, gp) => a + Math.abs(num(row[gp.deb]) ?? 0) + Math.abs(num(row[gp.cred]) ?? 0), 0);
  // A heading's amounts are the sum of the accounts under it; a code-less row whose following accounts don't add up to it is an account itself.
  const isGroup = (at: number, gcode: string) => {
    const sums = groups.map(() => 0);
    let kids = 0;
    for (let k = at + 1; k < rows.length; k++) {
      const c = str(rows[k][cCode]), n = str(rows[k][cName]);
      if (!c) { const sub = n.match(/^([\dA-Za-z][\d.\-]*)\s+/)?.[1]; if (sub && sub.startsWith(gcode) && sub !== gcode) continue; break; }
      if (!c.startsWith(gcode)) break;
      kids++;
      groups.forEach((gp, j) => { sums[j] += (num(rows[k][gp.deb]) ?? 0) - (num(rows[k][gp.cred]) ?? 0); });
    }
    if (!kids) return false;
    const own = groups.map((gp) => (num(rows[at][gp.deb]) ?? 0) - (num(rows[at][gp.cred]) ?? 0));
    return own.every((v, j) => Math.abs(v - sums[j]) <= Math.max(1, total(rows[at]) * 1e-6));
  };
  const leaf = (row: Cell[], i: number, code: string, name: string): RawLine | null => {
    const opening = dc(row, initial);
    const values: Record<string, number> = {};
    const spans: Record<string, number> = {};
    for (const gp of used) {
      const d = num(row[gp.deb]), c = num(row[gp.cred]);
      if (d === null && c === null) continue;
      values[gp.p!] = (d ?? 0) - (c ?? 0);
      if ((gp.months ?? 1) > 1) spans[gp.p!] = gp.months!;
    }
    const closing = end ? dc(row, end) : undefined;
    if (!Object.keys(values).length && Math.abs(opening) < 0.005 && !closing) return null;
    const section = stack.filter((s) => s.code === "(none)" || (code && code.startsWith(s.code))).map((s) => s.label).join(" / ");
    // A single period column: the closing balance proves opening + movement; with several, only the last month can be checked.
    return { key: `${g.name}|${i + 1}|${code || "-"}`, sheet: g.name, row: i + 1, label: `${code} ${name}`.trim(), code, name: name || code, section, stmt: null, kind: "movement", values, opening, ...(Object.keys(spans).length ? { spans } : {}), ...(closing !== undefined && used.length === periods.length ? { closing } : {}) };
  };
  for (let i = r + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = str(row[cCode]), name = str(row[cName]);
    if (!code && !name) continue;
    if (!code) {
      if (GRAND_TOTAL.test(name)) {
        // Odoo prints debits and credits side by side: each group must be equal.
        for (const gp of groups) {
          const d = num(row[gp.deb]) ?? 0, c = num(row[gp.cred]) ?? 0;
          if (Math.abs(d - c) > Math.max(1, Math.abs(d) * 1e-6)) issues.warnings.push(`${g.name}: the Total row's debits and credits differ in '${gp.label || "a column"}' (${Math.round(d).toLocaleString("en-GB")} vs ${Math.round(c).toLocaleString("en-GB")}).`);
        }
        break;
      }
      // Group row: "121 Cash & Cash Equivalent" or "(No Group)". Pop groups that are not its parents.
      const gcode = NO_GROUP.test(name) ? "(none)" : (name.match(/^([\dA-Za-z][\d.\-]*)\s+/)?.[1] ?? name);
      if (gcode !== "(none)" && !isGroup(i, gcode)) {
        // A code-less account (Odoo 17+ shared charts), not a heading: its amounts are its own.
        const line = leaf(row, i, "", name);
        if (line) out.push(line);
        continue;
      }
      while (stack.length && (gcode === "(none)" || !gcode.startsWith(stack[stack.length - 1].code))) stack.pop();
      stack.push({ code: gcode, label: name });
      continue;
    }
    const line = leaf(row, i, code, name);
    if (line) out.push(line);
  }
  return out.length ? out : null;
}

function statement({ g, rows, num, ov, layout, issues }: Ctx, r: number, cCode: number, cName: number, valCols: number[]): RawLine[] | null {
  const head = rows[r].map((v) => str(v));
  const title = titlePeriod(rows, r);
  const cols: { c: number; p: string; months: number; endDay?: string }[] = [];
  for (const c of valCols) {
    const h = headerPeriod(head[c]) ?? (/^(balance|الرصيد|solde|amount|المبلغ)$/i.test(head[c]) ? title : null);
    if (!h) continue;
    const o = ov.periods?.[c];
    if (o === null) { layout.columns.push({ col: c, header: head[c].slice(0, 80), period: h.p, months: h.months, used: false, reason: "left out by you" }); continue; }
    const forced = o && /^\d{4}-(0[1-9]|1[0-2])$/.test(o);
    const col = forced ? { c, p: o!, months: 1 } : { c, p: h.p, months: h.months, endDay: h.endDay };
    if (cols.some((x) => x.p === col.p)) { layout.columns.push({ col: c, header: head[c].slice(0, 80), period: col.p, months: col.months, used: false, reason: "same month as an earlier column" }); continue; }
    cols.push(col);
    layout.columns.push({ col: c, header: head[c].slice(0, 80), period: col.p, months: col.months, used: true });
  }
  if (!cols.length) return null;
  const stmt = /balance sheet|الميزانية|المركز المالي|bilan/i.test(g.name) ? "BS" : /profit|loss|income statement|الأرباح|الارباح|قائمة الدخل|compte de résultat/i.test(g.name) ? "PL" : null;
  layout.source = stmt === "BS" ? "Odoo Balance Sheet" : stmt === "PL" ? "Odoo Profit and Loss" : "Odoo report";
  layout.headerRow = r;
  layout.asOf = partialDay(cols[cols.length - 1].endDay);
  const out: RawLine[] = [];
  const heads: string[] = [];
  for (let i = r + 1; i < rows.length; i++) {
    const row = rows[i];
    const code = str(row[cCode]), name = str(row[cName]);
    if (!name && !code) continue;
    const values: Record<string, number> = {};
    for (const col of cols) { const v = num(row[col.c]); if (v !== null) values[col.p] = v; }
    if (!code) {
      const metric = controlMetric(name);
      if (metric) for (const col of cols) if (col.p in values) (issues.controls ??= []).push({ metric, period: col.p, value: values[col.p], months: col.months, source: `${g.name} row ${i + 1} '${name.slice(0, 60)}'`, sheet: g.name });
      // Section rows ("Revenue", "Less Costs of Revenue") open a section; their "Total …" rows close it.
      if (TOTAL_PREFIX.test(name) || metric) heads.length = 0;
      else { heads.length = 0; heads.push(name); }
      continue;
    }
    if (!Object.keys(values).length) continue;
    const spans = Object.fromEntries(cols.filter((c) => c.months > 1 && c.p in values).map((c) => [c.p, c.months]));
    out.push({ key: `${g.name}|${i + 1}|${code}`, sheet: g.name, row: i + 1, label: `${code} ${name}`.trim(), code, name: name || code, section: heads.join(" / "), stmt, kind: "natural", values, opening: 0, ...(Object.keys(spans).length ? { spans } : {}) });
  }
  return out.length ? out : null;
}
