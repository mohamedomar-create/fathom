// The nightly Odoo sync (3c): the same steps as a person's Sync now (balances, then journal lines, sales lines, stock
// moves, valuation and on hand), run on the server. Everything it saves goes through odoo_cron_rpc (0046), which acts as
// the editor who turned nightly sync on and only allows the save functions used here. No database access of its own:
// what it needs to read comes with the job (NightlyCtx).
import { timingSafeEqual } from "node:crypto";
import { addMonths, type ClassKey } from "@/lib/engine";
import { runChecks } from "@/lib/company/checks";
import { withClosedMonths } from "@/lib/company/import-plan";
import { closedRangeFor, openLines } from "@/lib/company/close";
import { versionFrom, versionPayload } from "@/lib/company/version-payload";
import { booksStartOf } from "@/lib/company/time-zone";
import { INVENTORY_KEY, PROFILE_KEY } from "@/lib/company/config-keys";
import { mergeLocationTypes, type LocationTypes } from "@/lib/ingest/inventory";
import { majorVersion, type OdooClient } from "./client";
import { trust, Version } from "./schema";
import { syncOdoo } from "./sync";
import { sinceOf } from "./since";
import { unbalancedSync } from "./policy";
import { countLedger, countPart, firstStockDay, layersPage, ledgerPage, movesPage, onHand, PAGE, readLocations, salesPage, type DetailCtx, type LedgerAccount } from "./detail";

/** Calls one allowlisted save function for the job's company and returns its result; throws on a refusal. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/** What odoo_cron_next hands out with a job. */
export interface NightlyCtx {
  company_id: string;
  /** The run this job belongs to (0047): every call names it. */
  run: string;
  connection: { url: string; db: string; login: string; api_key_enc: string; odoo_company_id: number; odoo_company_name: string | null; include_branches: boolean; months_history: number };
  company: { kpi_config: unknown; closed_through: string | null; data_version: number };
  last_import: { created_at: string; report: unknown } | null;
  account_map: { key: string; cls: string }[];
  accounts: { id: string; code: string; name: string; class: string; odoo_id: number | null; odoo_type: string | null; confidence: number | null; mapped_by: string | null; refs: unknown }[];
}

type Batches = { sales: string | null; expenses: string | null; stock: string | null };
type Part = "ledger" | "sales" | "moves" | "valuation" | "onhand";
export type NightStep =
  | { part: "balances" }
  | { part: Part; offset: number; total?: number; batch?: string | null; batches?: Batches; accts?: LedgerAccount[] };

const NEXT_PART: Record<Part, Part | null> = { ledger: "sales", sales: "moves", moves: "valuation", valuation: "onhand", onhand: null };
const LABEL: Record<NightStep["part"], string> = { balances: "Balances", ledger: "Journal lines", sales: "Sales lines", moves: "Stock moves", valuation: "Stock valuation", onhand: "Stock on hand" };

/** True only for `Bearer <secret>` with the exact secret (32+ characters), compared in constant time. */
export function cronAuthorized(header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!secret || secret.length < 32 || !header) return false;
  const want = Buffer.from(`Bearer ${secret}`), got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to && out.length < 1200; m = addMonths(m, 1)) out.push(m);
  return out;
}

async function major(client: OdooClient): Promise<number> {
  const v = trust(Version, await client.version(), "version");
  return majorVersion(v.server_version_info, v.server_version);
}

/** One step. Returns the next one (null when the run is complete). */
export async function nightlyStep(rpc: Rpc, ctx: NightlyCtx, client: OdooClient, step: NightStep, now = new Date()): Promise<{ next: NightStep | null; label: string; rows: number; detail?: string; version?: string }> {
  const co = ctx.company_id, conn = ctx.connection, closedThrough = ctx.company.closed_through;
  const kpi = ctx.company.kpi_config;
  const today = now.toISOString().slice(0, 10), end = today.slice(0, 7);
  const name = `${conn.odoo_company_name ?? "Odoo"} (nightly sync)`;

  if (step.part === "balances") {
    const classes = Object.fromEntries(ctx.account_map.map((m) => [m.key, m.cls as ClassKey | ""]));
    const since = ctx.last_import ? sinceOf(ctx.last_import.created_at, ctx.last_import.report) : undefined;
    const res = await syncOdoo(client, { companyId: conn.odoo_company_id, includeBranches: conn.include_branches, months: conn.months_history, classes, since, booksStart: booksStartOf(kpi) }, now);
    if (res.periods.length < 1 || res.accounts.length < 2) throw new Error("Odoo returned no posted entries for that company and period.");
    if (Math.abs(res.diagnostics.trialBalanceCheck) > 1) throw new Error(`Odoo's entries don't balance (difference ${res.diagnostics.trialBalanceCheck.toLocaleString("en-GB")}). Nothing was saved.`);
    const unbalanced = unbalancedSync(res.accounts);
    if (unbalanced) throw new Error(unbalanced);
    let accounts = res.accounts as Parameters<typeof versionPayload>[0];
    if (closedThrough) {
      const raw = (await rpc("company_balances", { p_company: co, p_version: ctx.company.data_version })) as [string, string, number | string, string | null][] | null;
      const bal = (raw ?? []).map(([account_id, period, amount, import_id]) => ({ account_id, period, amount: Number(amount), import_id }));
      accounts = withClosedMonths(res.accounts, versionFrom(ctx.accounts, bal), closedThrough);
    }
    const late = res.diagnostics.latePostings ? [{ id: "continuity", severity: "warn", title: `${res.diagnostics.latePostings} posted line${res.diagnostics.latePostings > 1 ? "s" : ""} entered after the last import`, detail: res.notes[res.notes.length - 1] }] : [];
    await rpc("save_company_version", {
      p_company: co, p_accounts: versionPayload(accounts),
      p_import: { kind: "odoo", filename: `${conn.odoo_company_name ?? "Odoo"} (${res.diagnostics.version}, nightly)`, report: { kind: "odoo", mode: "replace", periods: res.periods, slices: { PL: res.periods, BS: res.periods }, warnings: res.diagnostics.unmapped.length ? [`${res.diagnostics.unmapped.length} unmapped account(s)`] : [], notes: res.notes, diagnostics: res.diagnostics, checks: [...late, ...runChecks({ accounts: res.accounts }).filter((c) => c.severity !== "info")].slice(0, 300) } },
      p_notes: res.notes,
    });
    if (res.booksStart && !booksStartOf(kpi)) {
      await rpc("update_company_settings", { p_company: co, p_patch: { [PROFILE_KEY]: { booksStart: res.booksStart.suggested, openingAsAt: res.booksStart.day } } });
    }
    const accts = accounts.filter((a) => a.odoo_id != null).map((a) => ({ odoo_id: a.odoo_id as number, code: a.code ?? "", name: a.name, cls: a.cls }));
    return { next: { part: "ledger", offset: 0, accts }, label: LABEL.balances, rows: res.diagnostics.groups,
      detail: `${res.periods[0]}–${res.periods[res.periods.length - 1]} · ${res.accounts.length} accounts · trial balance ${res.diagnostics.trialBalanceCheck}`, version: res.diagnostics.version };
  }

  const d: DetailCtx = { client, companyId: conn.odoo_company_id, major: await major(client), includeBranches: conn.include_branches };
  const start = booksStartOf(kpi)?.slice(0, 7) ?? monthsBetween("2000-01", end).slice(-conn.months_history)[0];
  const range = { from: `${start}-01`, to: `${end}-${String(new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}` };
  const inv = ((kpi ?? {}) as Record<string, { rentalLocation?: string | null; locationTypes?: LocationTypes } | undefined>)[INVENTORY_KEY] ?? {};
  const rental = inv.rentalLocation ?? null;
  const stage = async (kind: "sales" | "expenses", source: "ledger" | "file", periods: string[]) =>
    (await rpc("stage_lines_begin", { p_company: co, p_kind: kind, p_source: source, p_periods: periods, p_filename: name, p_report: { kind: "odoo" }, p_all: false })) as string;
  const addLines = async (stageId: string, lines: unknown[]) => { for (let i = 0; i < lines.length; i += 5000) await rpc("stage_lines_add", { p_stage: stageId, p_lines: lines.slice(i, i + 5000) }); };
  let total = step.total ?? 0, batch = step.batch ?? null, done = step.offset;
  let batches = step.batches;
  const accts = step.accts ?? [];

  if (step.part === "ledger") {
    if (step.offset === 0 && accts.length) {
      total = await countLedger(d, accts, range);
      // Begin replaces the stock postings of these months; closed months are left as they are.
      const periods = closedRangeFor(closedThrough, monthsBetween(start, end).slice(-240), false, end).periods;
      const st = periods.length ? (await rpc("begin_stock_ledger_batch", { p_company: co, p_periods: periods, p_filename: name })) as string : null;
      batches = { sales: periods.length ? await stage("sales", "ledger", periods) : null, expenses: periods.length ? await stage("expenses", "ledger", periods) : null, stock: st };
    }
    if (total && batches) {
      const p = await ledgerPage(d, accts, range, step.offset);
      const strip = <T extends { src?: unknown }>(ls: T[]) => ls.map(({ src, ...l }) => { void src; return l; });
      // Closed months keep their lines: only lines in the months the save replaces are sent.
      if (batches.sales) await addLines(batches.sales, openLines(strip(p.sales), closedThrough).kept);
      if (batches.expenses) await addLines(batches.expenses, openLines(strip(p.expenses), closedThrough).kept);
      const stock = openLines(p.stock, closedThrough).kept;
      if (batches.stock && stock.length) await rpc("add_stock_ledger_lines", { p_batch: batches.stock, p_lines: stock });
    }
    done = Math.min(total, step.offset + PAGE.sales);
    if (done >= total && batches) for (const b of [batches.sales, batches.expenses]) if (b) await rpc("stage_lines_finish", { p_stage: b });
  } else if (step.part === "sales") {
    if (step.offset === 0) {
      const periods = closedRangeFor(closedThrough, monthsBetween(start, end).slice(-240), false, end).periods;
      total = periods.length ? await countPart(d, "sales", range) : 0;
      batch = periods.length ? await stage("sales", "file", periods) : null;
    }
    if (total && batch) await addLines(batch, openLines(await salesPage(d, range, step.offset), closedThrough).kept);
    done = Math.min(total, step.offset + PAGE.sales);
    if (done >= total && batch) await rpc("stage_lines_finish", { p_stage: batch });
  } else if (step.part === "moves" || step.part === "valuation") {
    const loc = await readLocations(d);
    if (step.offset === 0) {
      total = await countPart(d, step.part, range);
      const first = (await firstStockDay(d)) ?? today;
      const cr = closedRangeFor(closedThrough, monthsBetween(first.slice(0, 7), end).slice(-240), true, end);
      batch = (await rpc("begin_inventory_batch", { p_company: co, p_kind: step.part, p_periods: cr.periods, p_filename: name, p_mode: cr.all ? "all" : "replace", p_report: { kind: "odoo" } })) as string;
      // Odoo's own location usage fills the company's location types (a person's choice is kept).
      await rpc("update_company_settings", { p_company: co, p_patch: { [INVENTORY_KEY]: { locationTypes: mergeLocationTypes(inv.locationTypes ?? {}, loc.types, "export") } } });
    }
    const read = total ? (step.part === "moves" ? await movesPage(d, range.to, step.offset, loc, rental) : await layersPage(d, range.to, step.offset, loc, rental)) : [];
    const rows = openLines(read as { period: string }[], closedThrough).kept;
    if (rows.length) await rpc(step.part === "moves" ? "add_stock_moves" : "add_stock_layers", { p_batch: batch, p_rows: rows });
    done = Math.min(total, step.offset + PAGE.stock);
    if (done >= total && batch) await rpc("finish_inventory_batch", { p_batch: batch });
  } else {
    const loc = await readLocations(d);
    const rows = await onHand(d, loc);
    total = rows.length;
    if (rows.length) {
      const b = (await rpc("begin_inventory_batch", { p_company: co, p_kind: "onhand", p_periods: [end], p_filename: name, p_mode: "replace", p_report: { kind: "odoo" } })) as string;
      for (let i = 0; i < rows.length; i += 20_000) await rpc("set_stock_onhand", { p_batch: b, p_as_of: today, p_rows: rows.slice(i, i + 20_000) });
    }
    done = total;
  }

  const finished = done >= total;
  const nextPart = finished ? NEXT_PART[step.part] : step.part;
  const next: NightStep | null = nextPart
    ? (finished ? { part: nextPart, offset: 0 } : { part: step.part, offset: done, total, batch, ...(batches ? { batches } : {}), ...(step.part === "ledger" ? { accts } : {}) })
    : null;
  return { next, label: LABEL[step.part], rows: done - step.offset };
}

/**
 * Steps until the run is complete or the deadline passes (then `next` says where to carry on). A failure ends the run
 * with `ok: false` and the reason; what earlier steps saved stays, as with a person's sync.
 */
export async function runNightly(rpc: Rpc, ctx: NightlyCtx, client: OdooClient, step: NightStep | null, deadline: number, now = new Date()): Promise<{ ok: boolean; next: NightStep | null; rows: number; detail?: string; version?: string; error?: string }> {
  let rows = 0, detail: string | undefined, version: string | undefined;
  let cur = step;
  try {
    while (cur && Date.now() < deadline) {
      const r = await nightlyStep(rpc, ctx, client, cur, now);
      rows += r.rows;
      if (r.detail) detail = r.detail;
      if (r.version) version = r.version;
      cur = r.next;
    }
    return { ok: true, next: cur, rows, detail, version };
  } catch (e) {
    const why = (e instanceof Error ? e.message : String(e)).slice(0, 400);
    return { ok: false, next: null, rows, detail, version, error: `${cur ? LABEL[cur.part] : "Sync"}: ${why}` };
  }
}
