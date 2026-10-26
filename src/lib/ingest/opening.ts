// Opening balances as their own upload: the balance sheet the day before a company's books start. A sheet of accounts
// with debit and credit (or a signed balance) and no dates or months is read as the balances at the day the person gives.
import type { Grid, RawLine } from "./extract";
import { arRx, cleanNum, normAr, splitCode, type Cell } from "./parse";

const CODE = arRx(/^(code|account code|acc(ount)? no\.?|الكود|كود|كود الحساب|رقم الحساب)$/i);
const NAME = arRx(/^(account|account name|name|الحساب|اسم الحساب|البيان)$/i);
const DEBIT = arRx(/^(debit|مدين)$/i);
const CREDIT = arRx(/^(credit|دائن)$/i);
const BALANCE = arRx(/^(balance|ending balance|الرصيد)$/i);
const TOTAL = arRx(/^(total|الإجمالي|اجمالي|إجمالي|المجموع)(?=\s|$|[:\-–.])/i);
const head = (v: Cell) => normAr(String(v ?? "").trim());

/** Accounts with their (debit − credit) balance, from a sheet laid out as Code | Account | Debit | Credit (or Balance). */
export function readOpeningSheet(g: Grid): RawLine[] {
  for (let r = 0; r < Math.min(g.rows.length, 30); r++) {
    const row = g.rows[r].map(head);
    const cCode = row.findIndex((v) => CODE.test(v)), cName = row.findIndex((v) => NAME.test(v));
    const cDeb = row.findIndex((v) => DEBIT.test(v)), cCred = row.findIndex((v) => CREDIT.test(v)), cBal = row.findIndex((v) => BALANCE.test(v));
    if ((cCode < 0 && cName < 0) || ((cDeb < 0 || cCred < 0) && cBal < 0)) continue;
    const out: RawLine[] = [];
    for (let i = r + 1; i < g.rows.length; i++) {
      const cells = g.rows[i];
      let code = cCode >= 0 ? String(cells[cCode] ?? "").trim() : "";
      let name = cName >= 0 ? String(cells[cName] ?? "").trim() : "";
      if (!code && name) ({ code, name } = splitCode(name));
      if ((!code && !name) || TOTAL.test(normAr(name || code))) continue;
      const amt = cDeb >= 0 && cCred >= 0 ? (cleanNum(cells[cDeb]) ?? 0) - (cleanNum(cells[cCred]) ?? 0) : cleanNum(cells[cBal]) ?? 0;
      if (Math.abs(amt) < 0.005) continue;
      out.push({ key: `${g.name}|ob|${i + 1}|${code}`, sheet: g.name, row: i + 1, label: `${code} ${name}`.trim(), code, name: name || code, section: "", stmt: null, kind: "movement", values: {}, opening: amt, closing: amt });
    }
    return out;
  }
  return [];
}
