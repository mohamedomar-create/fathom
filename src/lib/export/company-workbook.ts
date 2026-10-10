/**
 * Everything stored for one company, as plain sheets (arrays of rows) and then an .xlsx file.
 * Secrets never enter: the caller passes no Odoo API key and no share tokens, and the builder has no field for them.
 */

type Cell = string | number | boolean | null;
export interface Sheet { name: string; rows: Cell[][] }

export interface CompanyExport {
  exportedAt: string;
  orgName: string;
  company: { name: string; currency: string; fy_start_month: number; tax_rate: number; industry: string | null; source: string; data_version: number; last_synced_at: string | null; ai_context: unknown; kpi_config: unknown; notes: unknown };
  accounts: { code: string; name: string; statement: string; class: string; amounts: Record<string, number> }[];
  imports: { created_at: string; action: string; kind: string; filename: string | null; status: string; data_version: number | null }[];
  commentary: { period_key: string; section: string; source: string; updated_at: string; body: string }[];
  reports: { title: string; period_type: string; period_end: string; status: string; shared: boolean; expires_at: string | null; published_at: string | null; created_at: string }[];
  odoo: { url: string; db: string; login: string; odoo_company_name: string | null; months_history: number; status: string; last_sync_at: string | null } | null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const cell = (v: unknown): Cell => (v === undefined ? null : typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null ? v : JSON.stringify(v));

export function companySheets(d: CompanyExport): Sheet[] {
  const c = d.company;
  const company: Cell[][] = [
    ["Company", c.name], ["Organisation", d.orgName], ["Currency", c.currency], ["Financial year starts", MONTHS[c.fy_start_month - 1] ?? c.fy_start_month],
    ["Corporate tax rate", c.tax_rate], ["Industry", c.industry], ["Source", c.source], ["Data version", c.data_version],
    ["Last updated", day(c.last_synced_at)], ["Exported", d.exportedAt],
  ];
  const kpis = Object.entries(obj(c.kpi_config));
  if (kpis.length) {
    company.push([], ["KPI", "Active", "Importance", "Target", "Alert on", "Alert threshold"]);
    for (const [k, v] of kpis) { const o = obj(v); company.push([k, cell(o.active), cell(o.importance), cell(o.target), cell(o.alert_active), cell(o.alert_threshold)]); }
  }
  const ctx = Object.entries(obj(c.ai_context)).filter(([, v]) => v !== "" && v != null);
  if (ctx.length) { company.push([], ["AI business context"]); for (const [k, v] of ctx) company.push([k, cell(v)]); }
  const notes = Object.entries(obj(c.notes));
  if (notes.length) { company.push([], ["Notes"]); for (const [k, v] of notes) company.push([k, cell(v)]); }

  const periods = [...new Set(d.accounts.flatMap((a) => Object.keys(a.amounts)))].sort();
  const accounts: Cell[][] = [["Code", "Account", "Statement", "Class", ...periods], ...d.accounts.map((a) => [a.code, a.name, a.statement, a.class, ...periods.map((p) => a.amounts[p] ?? null)])];

  const sheets: Sheet[] = [
    { name: "Company", rows: company },
    { name: "Accounts", rows: accounts },
    { name: "Imports", rows: [["Date", "Action", "Kind", "File", "Status", "Data version"], ...d.imports.map((i) => [i.created_at, i.action, i.kind, i.filename, i.status, i.data_version])] },
    { name: "Commentary", rows: [["Period", "Section", "Written by", "Updated", "Text"], ...d.commentary.map((m) => [m.period_key, m.section, m.source === "ai" ? "AI" : "User", m.updated_at, m.body])] },
    { name: "Reports", rows: [["Title", "Period type", "Period end", "Status", "Shared link", "Link expires", "Published", "Created"], ...d.reports.map((r) => [r.title, r.period_type, r.period_end, r.status, r.shared ? "yes" : "no", day(r.expires_at), day(r.published_at), day(r.created_at)])] },
  ];
  if (d.odoo) {
    const o = d.odoo;
    sheets.push({ name: "Odoo connection", rows: [["Address", o.url], ["Database", o.db], ["Login", o.login], ["Odoo company", o.odoo_company_name], ["Months of history", o.months_history], ["Status", o.status], ["Last sync", o.last_sync_at], ["API key", "not exported"]] });
  }
  return sheets;
}

export async function toXlsx(sheets: Sheet[]): Promise<Uint8Array> {
  const XLSX = await import("@e965/xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows); // strings stay text cells; nothing is written as a formula
    ws["!cols"] = (s.rows[0] ?? []).map((_, i) => ({ wch: i < 2 ? 28 : 14 }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  }
  return XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as Uint8Array;
}

/** "Nile Trading & Co." → "nile-trading-co" for a download file name (Arabic letters are kept). */
export function slug(name: string) {
  return name.normalize("NFKC").replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 60) || "company";
}

/** A Content-Disposition value that survives non-ASCII names. */
export function attachment(filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
