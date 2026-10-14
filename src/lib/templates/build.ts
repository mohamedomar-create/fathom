import ExcelJS from "exceljs";
import { BS_KEYS, mlabel, PL_KEYS, type ClassKey } from "@/lib/engine";
import { BS_ROWS, CLASS_HELP, classChoice, FIN_HEAD, MARK, PL_ROWS, SALES_COLS, templateMonths, type TemplateKind } from "./spec";
import type { FinancialsFill, FillRow } from "./fill";

const TEAL = "FF0B6E70", BAND = "FFF5F5F3", INPUT = "FFFFFBEA", MUTE = "FF76766F";
const NUM = '#,##0.00;[Red]-#,##0.00';

/** fill: the template comes back filled with figures already read and sorted by iReport (financials only). */
export interface TemplateOptions { year: number; fyStart: number; currency: string; company?: string; fill?: FinancialsFill }

/** The workbook for one kind of template, as an .xlsx buffer. */
export async function buildTemplate(kind: TemplateKind, o: TemplateOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "iReport";
  if (kind === "financials") financials(wb, o);
  else sales(wb, o);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function title(ws: ExcelJS.Worksheet, mark: string, text: string, sub: string) {
  ws.getCell("A1").value = mark;
  ws.getCell("A1").font = { size: 8, color: { argb: MUTE } };
  ws.getCell("A2").value = text;
  ws.getCell("A2").font = { size: 14, bold: true, color: { argb: TEAL } };
  ws.getCell("A3").value = sub;
  ws.getCell("A3").font = { size: 10, color: { argb: MUTE } };
}

function header(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 30;
}

function readMe(wb: ExcelJS.Workbook, heading: string, lines: [string, string][]) {
  const ws = wb.addWorksheet("Read me", { properties: { tabColor: { argb: TEAL } } });
  ws.getColumn(1).width = 4; ws.getColumn(2).width = 95; ws.getColumn(3).width = 70;
  ws.getCell("B1").value = heading;
  ws.getCell("B1").font = { size: 16, bold: true, color: { argb: TEAL } };
  lines.forEach(([en, ar], i) => {
    const r = ws.getRow(i + 3);
    r.getCell(2).value = en; r.getCell(3).value = ar;
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    r.getCell(3).alignment = { wrapText: true, vertical: "top", horizontal: "right", readingOrder: "rtl" };
    if (/^\d\./.test(en) || /^[A-Z ]+$/.test(en)) r.getCell(2).font = { bold: true };
  });
  return ws;
}

function financials(wb: ExcelJS.Workbook, o: TemplateOptions) {
  const { opening, months } = templateMonths(o.year, o.fyStart);
  const fy = `${mlabel(months[0])} – ${mlabel(months[11])}`;
  readMe(wb, `iReport · Monthly financials template${o.company ? ` · ${o.company}` : ""}`, [
    ["Fill in one column per month, upload the file, and iReport reads every figure exactly as you entered it.", "املأ عمودًا لكل شهر، ثم ارفع الملف، وسيقرأ iReport كل رقم كما أدخلته تمامًا."],
    ["HOW TO FILL IT", "طريقة الملء"],
    [`1. Sheet "P&L": for each account, enter the month's total for every month (${fy}). Not year-to-date: just that month.`, "١. ورقة P&L: أدخل إجمالي كل شهر لكل حساب (وليس الرصيد التراكمي)."],
    [`2. Sheet "Balance Sheet": enter each account's balance at the END of every month. The first column (${mlabel(opening)}) is the opening balance, the balance just before the year starts.`, "٢. ورقة الميزانية: أدخل رصيد كل حساب في نهاية كل شهر. العمود الأول هو الرصيد الافتتاحي."],
    ["3. Every row needs an iReport class: pick it from the drop-down list. The Classes sheet explains each one.", "٣. اختر تصنيف iReport لكل صف من القائمة المنسدلة. ورقة Classes تشرح كل تصنيف."],
    ["4. Rename, add or delete rows to match your own chart of accounts. Leave rows you do not use empty.", "٤. عدّل أو أضف أو احذف الصفوف لتطابق دليل حساباتك. اترك الصفوف غير المستخدمة فارغة."],
    ["5. Upload the file in iReport (Settings → Data setup or Source data). Any mistake is listed with its sheet, row and how to fix it.", "٥. ارفع الملف في iReport. أي خطأ يظهر برقم الورقة والصف وطريقة تصحيحه."],
    ["RULES", "القواعد"],
    [`Amounts in ${o.currency}, as plain numbers (no text). Costs and expenses as positive numbers. Returns, discounts and accumulated depreciation as negative numbers.`, "المبالغ أرقام فقط. المصروفات والتكاليف بالموجب. المرتجعات والخصومات ومجمع الإهلاك بالسالب."],
    ["Revenue, liabilities and equity are entered as positive numbers (not with a credit minus sign).", "الإيرادات والالتزامات وحقوق الملكية بالموجب."],
    ["Do not add total or subtotal rows: iReport calculates every total itself.", "لا تضف صفوف إجماليات؛ يحسبها iReport تلقائيًا."],
    ["Do not change the headings in row 5 or the first cell (A1) of each sheet: they tell iReport which template this is.", "لا تغيّر عناوين الصف الخامس ولا الخلية A1 في كل ورقة."],
    ["Month headings are written as YYYY-MM (for example 2026-01). You may change them to other months, one month per column.", "عناوين الأشهر بصيغة YYYY-MM مثل 2026-01."],
    ["Retained earnings on the balance sheet include this year's profit to date, so total assets equal liabilities plus equity every month.", "الأرباح المرحلة تشمل ربح العام حتى تاريخه حتى تتوازن الميزانية كل شهر."],
  ]);
  const classes = wb.addWorksheet("Classes");
  classes.columns = [{ header: "iReport class", width: 38 }, { header: "Statement", width: 14 }, { header: "What goes here", width: 80 }, { header: "بالعربية", width: 60 }];
  header(classes.getRow(1));
  [...PL_KEYS, ...BS_KEYS].forEach((k) => classes.addRow([classChoice(k), PL_KEYS.includes(k as never) ? "P&L" : "Balance sheet", CLASS_HELP[k][0], CLASS_HELP[k][1]]));
  const plRange = `Classes!$A$2:$A$${1 + PL_KEYS.length}`, bsRange = `Classes!$A$${2 + PL_KEYS.length}:$A$${1 + PL_KEYS.length + BS_KEYS.length}`;
  const f = o.fill;
  if (f) {
    if (f.pl) sheet(wb, "P&L", MARK.pl, "Profit and loss: the month's total for each account", `Filled by iReport from your upload. Amounts in ${o.currency}. Costs positive.`, f.pl.months, f.pl.rows, plRange);
    if (f.bs) sheet(wb, "Balance Sheet", MARK.bs, "Balance sheet: each account's balance at the end of the month", `Filled by iReport from your upload. Amounts in ${o.currency}.`, f.bs.months, f.bs.rows, bsRange);
    return;
  }
  sheet(wb, "P&L", MARK.pl, "Profit and loss: the month's total for each account", `One column per month. Amounts in ${o.currency}. Costs positive.`, months, PL_ROWS, plRange);
  sheet(wb, "Balance Sheet", MARK.bs, "Balance sheet: each account's balance at the end of the month", `The first month column is the opening balance (end of ${mlabel(opening)}). Amounts in ${o.currency}.`, [opening, ...months], BS_ROWS, bsRange);
}

function sheet(wb: ExcelJS.Workbook, name: string, mark: string, text: string, sub: string, months: string[], rows: [string, ClassKey][] | FillRow[], range: string) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 3, ySplit: 5 }] });
  title(ws, mark, text, sub);
  ws.getColumn(1).width = 12; ws.getColumn(2).width = 40; ws.getColumn(3).width = 34;
  months.forEach((_, i) => { ws.getColumn(4 + i).width = 14; });
  const h = ws.getRow(5);
  [...FIN_HEAD, ...months].forEach((v, i) => { h.getCell(i + 1).value = v; });
  header(h);
  const total = rows.length + 40;
  for (let i = 0; i < total; i++) {
    const r = ws.getRow(6 + i);
    const row = rows[i];
    if (Array.isArray(row)) { r.getCell(2).value = row[0]; r.getCell(3).value = classChoice(row[1]); }
    else if (row) {
      if (row.code) r.getCell(1).value = row.code;
      r.getCell(2).value = row.name; r.getCell(3).value = classChoice(row.cls);
      months.forEach((p, c) => { const v = row.values[p]; if (v) r.getCell(4 + c).value = Math.round(v * 100) / 100; });
    }
    r.getCell(3).dataValidation = { type: "list", allowBlank: true, formulae: [range], showErrorMessage: true, errorTitle: "Choose a class", error: "Pick the iReport class from the list (see the Classes sheet)." };
    for (let c = 0; c < months.length; c++) {
      const cell = r.getCell(4 + c);
      cell.numFmt = NUM;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } };
      cell.dataValidation = { type: "decimal", operator: "between", allowBlank: true, formulae: [-1e15, 1e15], showErrorMessage: true, errorTitle: "Numbers only", error: "Enter the amount as a number, without text or currency signs." };
    }
    if (i % 2) for (const c of [1, 2, 3]) r.getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: BAND } };
  }
}

function sales(wb: ExcelJS.Workbook, o: TemplateOptions) {
  readMe(wb, `iReport · Sales template${o.company ? ` · ${o.company}` : ""}`, [
    ["One row per invoice line. iReport adds them up by month, customer, product and category.", "صف لكل بند فاتورة. يجمعها iReport حسب الشهر والعميل والمنتج والفئة."],
    ["HOW TO FILL IT", "طريقة الملء"],
    ['1. Sheet "Sales": fill one row per invoice line, starting in row 5. Required columns are marked *.', "١. ورقة Sales: صف لكل بند فاتورة بدءًا من الصف الخامس. الأعمدة المطلوبة عليها *."],
    ["2. Credit notes and returns: the same columns with a negative quantity and amount.", "٢. المرتجعات وإشعارات الخصم: بكمية ومبلغ بالسالب."],
    ["3. Upload the file in iReport. Only the sales are saved; the financial figures are not changed.", "٣. ارفع الملف. تُحفظ المبيعات فقط ولا تتغير القوائم المالية."],
    ["RULES", "القواعد"],
    [`Amounts in ${o.currency}, before VAT, as plain numbers. Dates as date cells or written day first (15/01/2026).`, "المبالغ بدون ضريبة القيمة المضافة. التاريخ بصيغة يوم/شهر/سنة."],
    ["Write each customer, product and category the same way every time, so they add up correctly.", "اكتب اسم العميل والمنتج والفئة بنفس الطريقة دائمًا."],
    ["Monthly totals should equal the revenue in your P&L; iReport shows any difference month by month.", "يجب أن يساوي إجمالي كل شهر إيرادات قائمة الدخل."],
    ["Do not change the headings in row 4 or the first cell (A1).", "لا تغيّر عناوين الصف الرابع ولا الخلية A1."],
    ["COLUMNS", "الأعمدة"],
    ...SALES_COLS.map((c) => [`${c.head}${c.required ? " *" : ""}: ${c.help}`, ""] as [string, string]),
  ]);
  const ws = wb.addWorksheet("Sales", { views: [{ state: "frozen", ySplit: 4 }] });
  title(ws, MARK.sales, "Sales: one row per invoice line", `Amounts in ${o.currency}, before VAT. * = required.`);
  const h = ws.getRow(4);
  SALES_COLS.forEach((c, i) => { h.getCell(i + 1).value = `${c.head}${c.required ? " *" : ""}`; ws.getColumn(i + 1).width = c.key === "product" || c.key === "customer" ? 32 : c.key === "amount" ? 22 : 16; });
  header(h);
  for (let i = 0; i < 3000; i++) {
    const r = ws.getRow(5 + i);
    SALES_COLS.forEach((c, j) => {
      const cell = r.getCell(j + 1);
      if (c.key === "date") { cell.numFmt = "dd/mm/yyyy"; cell.dataValidation = { type: "date", operator: "between", allowBlank: true, formulae: [new Date(2000, 0, 1), new Date(2100, 0, 1)], showErrorMessage: true, error: "Enter a date, e.g. 15/01/2026." }; }
      if (c.key === "qty" || c.key === "amount" || c.key === "cost") { cell.numFmt = NUM; cell.dataValidation = { type: "decimal", operator: "between", allowBlank: true, formulae: [-1e15, 1e15], showErrorMessage: true, error: "Numbers only." }; }
    });
  }
}
