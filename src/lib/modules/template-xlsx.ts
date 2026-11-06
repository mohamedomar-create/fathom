// A module's template as an .xlsx: a Data sheet with the module's headings (the row iReport reads), and a Read me that
// says what each column holds, which ones are required, and how to fill it from Odoo, SAP, Dynamics or by hand. The Read
// me is words only, so the upload never takes it for a table. Built for any module: built-in, catalog or the company's own.
import ExcelJS from "exceljs";
import type { ModuleDef } from "./types";
import type { Row } from "./template";
import { GUIDE_SYSTEMS, moduleGuide } from "./guide";

const TEAL = "FF0B6E70", MUTE = "FF76766F", INPUT = "FFFFFBEA";
const TYPE: Record<string, [string, string]> = {
  date: ["a date (e.g. 31/10/2026)", "تاريخ (مثل 31/10/2026)"], month: ["a month (e.g. 2026-10)", "شهر (مثل 2026-10)"],
  money: ["an amount in money", "مبلغ مالي"], qty: ["a quantity", "كمية"], percent: ["a percentage", "نسبة مئوية"],
  text: ["text", "نص"], code: ["a code or reference", "رمز أو مرجع"],
};
const SYS: Record<string, [string, string]> = { odoo: ["From Odoo", "من Odoo"], sap: ["From SAP", "من SAP"], dynamics: ["From Microsoft Dynamics", "من Microsoft Dynamics"], excel: ["By hand or from any other system", "يدويًا أو من أي نظام آخر"] };

export interface ModuleTemplateOptions { lang?: "en" | "ar"; /** Rows to fill in (the demo and the tests); the download is blank. */ rows?: Row[] }

export async function buildModuleTemplate(m: ModuleDef, o: ModuleTemplateOptions = {}): Promise<Buffer> {
  const ar = o.lang === "ar";
  const wb = new ExcelJS.Workbook();
  wb.creator = "iReport";
  const required = new Set(m.required.flat());

  const ws = wb.addWorksheet("Data", { views: [{ state: "frozen", ySplit: 1, rightToLeft: ar }] });
  ws.addRow(m.fields.map((f) => f.heading));
  const head = ws.getRow(1);
  head.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } }; c.alignment = { vertical: "middle", wrapText: true }; });
  head.height = 28;
  m.fields.forEach((f, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.max(14, Math.min(34, f.heading.length + 6));
    if (f.type === "money") col.numFmt = "#,##0.00;[Red]-#,##0.00";
    if (f.type === "date") col.numFmt = "dd/mm/yyyy";
    // A note on each heading: what goes in it, in the language asked for.
    head.getCell(i + 1).note = `${ar ? f.label.ar : f.label.en}: ${TYPE[f.type][ar ? 1 : 0]}${required.has(f.key) ? (ar ? " (مطلوب)" : " (required)") : ""}`;
  });
  for (const r of o.rows ?? []) ws.addRow(m.fields.map((f) => r[f.key] ?? null));
  if (!o.rows?.length) for (let i = 2; i <= 6; i++) ws.getRow(i).eachCell({ includeEmpty: true }, (c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: INPUT } }; });

  // The Read me: words only (so the upload treats it as notes, never as data).
  const rm = wb.addWorksheet(ar ? "Read me - اقرأني" : "Read me", { views: [{ rightToLeft: ar }] });
  rm.getColumn(1).width = 110;
  const line = (t: string, style: "h" | "b" | "p" = "p") => {
    const c = rm.addRow([t]).getCell(1);
    c.alignment = { wrapText: true, vertical: "top" };
    if (style === "h") c.font = { size: 15, bold: true, color: { argb: TEAL } };
    if (style === "b") c.font = { bold: true };
  };
  line(`${ar ? m.name.ar : m.name.en}: ${ar ? "قالب iReport" : "iReport template"}`, "h");
  line(ar ? m.owns.ar : m.owns.en);
  if (m.nature === "snapshot") line(ar ? "هذه قائمة في يوم واحد: سيطلب iReport تاريخ الحصر عند الرفع." : "This is a list held at one day: iReport asks for its as-of day when you upload it.");
  line("");
  line(ar ? "الأعمدة" : "The columns", "b");
  for (const f of m.fields) line(`${f.heading} - ${ar ? f.label.ar : f.label.en}: ${TYPE[f.type][ar ? 1 : 0]}${required.has(f.key) ? (ar ? ". مطلوب." : ". Required.") : (ar ? ". اختياري." : ". Optional.")}`);
  line(ar ? "يكفي أحد الأعمدة في كل مجموعة مطلوبة. الصفوف التي ينقصها عمود مطلوب تُعرض مع السبب ولا تُحفظ." : "One field of each required group is enough. A row missing a required field is listed with the reason and not saved.");
  for (const sys of GUIDE_SYSTEMS) {
    const g = moduleGuide(m, sys);
    line("");
    line(SYS[sys][ar ? 1 : 0], "b");
    g.steps.forEach((s, i) => line(`${i + 1}. ${ar ? s.ar : s.en}`));
    if (sys === "excel" && g.tip) line(ar ? g.tip.ar : g.tip.en);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
