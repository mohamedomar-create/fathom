import { fmtDay } from "@/lib/ingest/odoo";
import { addMonths, daysIn, type ClassKey } from "@/lib/engine";
import { isPL, toNatural } from "@/lib/company/build";
import { classFromOdooType, ODOO15_TYPE_MAP } from "@/lib/ingest/classify";
import { CLASS_LABEL } from "@/lib/ingest/classes";
import { normLabel } from "@/lib/ingest/parse";
import { GUARDED_MODELS, majorVersion, OdooClient, OdooError } from "./client";
import { AccountRows, OpeningRows, BalanceLines, CompanyRows, Count, DetailLines, GroupRows, trust, UserRows, Version, XmlRows } from "./schema";
import type { LedgerEntry } from "@/lib/ingest/extract";
import { salesFromLedger, type SalesLine } from "@/lib/ingest/sales";
import { EXPENSE_CLASSES, expensesFromLedger, type ExpenseLine } from "@/lib/ingest/expenses";
import { stockFromLedger, type StockLedgerLine } from "@/lib/ingest/inventory";

export interface OdooCompany { id: number; name: string; currency: string | null }
export interface OdooProbe {
  version: string; major: number; uid: number; companies: OdooCompany[];
  /** The connected Odoo user: its name and the companies it may see. */
  user: { name: string; companies: number[] };
  /** "read": Odoo confirms it can't create, change or delete accounting records; "write": it can; "unknown": Odoo didn't say. */
  rights: "read" | "write" | "unknown";
  /** The accounting models this user may change (create, write or delete). */
  canChange: string[];
}

/**
 * May this Odoo user create, change or delete accounting records? Asked with Odoo's own access check, which changes
 * nothing: check_access_rights on Odoo 13–17, has_access from 18. An unanswered question is "unknown", never "safe".
 */
async function accessRights(client: OdooClient): Promise<{ rights: OdooProbe["rights"]; canChange: string[] }> {
  const canChange: string[] = [];
  for (const model of GUARDED_MODELS) {
    // Every user may edit their own preferences, so for users only "create" tells a Settings admin apart.
    for (const op of model === "res.users" ? ["create"] as const : ["create", "write", "unlink"] as const) {
      let yes: unknown;
      try { yes = await client.executeKw<unknown>(model, "check_access_rights", [op], { raise_exception: false }); }
      catch (e) {
        if (!(e instanceof OdooError) || /rejected the login|switched off|took too long/.test(e.message)) throw e;
        try { yes = await client.executeKw<unknown>(model, "has_access", [[], op]); }
        catch (e2) { if (!(e2 instanceof OdooError) || /rejected the login|switched off|took too long/.test(e2.message)) throw e2; return { rights: "unknown", canChange }; }
      }
      if (typeof yes !== "boolean") return { rights: "unknown", canChange };
      if (yes) { canChange.push(model); break; }
    }
  }
  return { rights: canChange.length ? "write" : "read", canChange };
}

export async function probe(client: OdooClient): Promise<OdooProbe> {
  const v = trust(Version, await client.version(), "version");
  const major = majorVersion(v.server_version_info, v.server_version);
  const uid = await client.authenticate();
  const rows = trust(CompanyRows, await client.executeKw("res.company", "search_read", [[]], { fields: ["name", "currency_id"], order: "id" }), "companies");
  const [me] = trust(UserRows, await client.executeKw("res.users", "read", [[uid]], { fields: ["name", "company_ids"] }), "user");
  const access = await accessRights(client);
  return {
    version: v.server_version, major, uid, companies: rows.map((r) => ({ id: r.id, name: r.name, currency: r.currency_id ? r.currency_id[1] : null })),
    user: { name: me.name, companies: me.company_ids }, ...access,
  };
}

export interface SyncOptions {
  companyId: number;
  includeBranches: boolean;
  /** Months to show (an extra month before them is fetched as the opening balance). */
  months: number;
  /** Last month to include (YYYY-MM); defaults to the current month. */
  end?: string;
  /** The company's account map ("#code" or normalised name → class): a person's choice beats Odoo's account type. */
  classes?: Record<string, ClassKey | "">;
  /** The last import: when it ran (ISO time) and the last day it covered. Entries entered after it but dated on or before that day are counted. */
  since?: { at: string; through: string };
  /** The day the company's books start ("2021-07-01"): months before it are never read as months, only as the opening balance. */
  booksStart?: string | null;
}

export interface SyncedAccount {
  code: string; name: string; cls: ClassKey; amounts: Record<string, number>;
  odoo_id: number | null; odoo_type: string | null; confidence: number; mapped_by: "auto" | "user" | "system";
}

export interface SyncResult {
  /** Proposed from Odoo's opening entry when the company has no books start: the entry's day and the day after it. */
  booksStart?: { day: string; suggested: string };
  accounts: SyncedAccount[];
  periods: string[];
  notes: string[];
  diagnostics: { version: string; major: number; accounts: number; groups: number; method: "read_group" | "search_read"; trialBalanceCheck: number; unmapped: string[]; offBalance?: string[]; latePostings?: number };
}

/** Names of petty-cash and custody accounts (English and Arabic). */
const PETTY = /petty|custody|imprest|عهد[ةه]|نثري|سلف[ةه]?/i;

/** The class most accounts sharing the longest code prefix (3+ digits) with this one have, if they agree. */
function neighbourClass(code: string, all: { code: string; c: { cls: ClassKey | null } }[]): { cls: ClassKey; prefix: string } | null {
  if (!/^\d{4,}$/.test(code)) return null;
  for (let n = code.length - 1; n >= 3; n--) {
    const prefix = code.slice(0, n);
    const counts = new Map<ClassKey, number>();
    for (const o of all) if (o.code !== code && o.c.cls && o.code.startsWith(prefix)) counts.set(o.c.cls, (counts.get(o.c.cls) ?? 0) + 1);
    if (!counts.size) continue;
    const [best, n1] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
    const total = [...counts.values()].reduce((x, y) => x + y, 0);
    return n1 / total >= 0.6 ? { cls: best, prefix } : null;
  }
  return null;
}

type Group = { account_id: [number, string] | false; balance: number; __range?: Record<string, { from: string; to: string }>; __domain?: unknown[]; [k: string]: unknown };

function monthOfGroup(g: Group): string | null {
  const r = g.__range?.["date:month"] ?? (g.__range ? Object.values(g.__range)[0] : undefined);
  if (r?.from) return r.from.slice(0, 7);
  // Odoo ≤15: read the lower bound from the group's domain, e.g. ['&', ('date','>=','2026-01-01'), ('date','<','2026-02-01')]
  const walk = (d: unknown): string | null => {
    if (Array.isArray(d)) {
      if (d.length === 3 && d[0] === "date" && d[1] === ">=" && typeof d[2] === "string") return d[2].slice(0, 7);
      for (const x of d) { const r2 = walk(x); if (r2) return r2; }
    }
    return null;
  };
  return walk(g.__domain);
}

export async function syncOdoo(client: OdooClient, opts: SyncOptions, now = new Date()): Promise<SyncResult> {
  const v = trust(Version, await client.version(), "version");
  const major = majorVersion(v.server_version_info, v.server_version);
  await client.authenticate();
  const cid = opts.companyId;
  const ctx = { allowed_company_ids: [cid], lang: "en_US", active_test: false };

  // ---- chart of accounts
  const acctDomain = major >= 18 ? [["company_ids", "in", [cid]]] : [["company_id", "=", cid]];
  const typeField = major >= 16 ? "account_type" : "user_type_id";
  const accts = trust(AccountRows, await client.executeKw("account.account", "search_read", [acctDomain], { fields: ["code", "name", typeField], context: ctx }), "accounts");
  if (!accts.length) throw new OdooError("No accounts found for that company. Check the company selection and the user's access rights.");
  let typeOf: (a: (typeof accts)[number]) => string;
  if (major >= 16) typeOf = (a) => a.account_type ?? "";
  else {
    const typeIds = [...new Set(accts.map((a) => (a.user_type_id ? a.user_type_id[0] : 0)).filter(Boolean))];
    const xml = trust(XmlRows, await client.executeKw("ir.model.data", "search_read", [[["model", "=", "account.account.type"], ["res_id", "in", typeIds]]], { fields: ["res_id", "name"], context: ctx }), "account types");
    const byId = new Map(xml.map((x) => [x.res_id, ODOO15_TYPE_MAP[x.name] ?? ""]));
    typeOf = (a) => (a.user_type_id ? byId.get(a.user_type_id[0]) ?? "" : "");
  }

  // ---- books start: the company's, else Odoo's opening date (res.company.account_opening_date: Odoo dates the opening
  // entry the day before it)
  let proposed: SyncResult["booksStart"];
  let booksStart = opts.booksStart ?? null;
  if (!booksStart) {
    try {
      const [co] = trust(OpeningRows, await client.executeKw("res.company", "read", [[cid]], { fields: ["account_opening_date"], context: ctx }), "opening date");
      const start = co?.account_opening_date;
      if (start && start.endsWith("-01")) {
        proposed = { day: new Date(Date.parse(`${start}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10), suggested: start };
        booksStart = start;
      }
    } catch (e) { if (!(e instanceof OdooError) || /can't trust|switched off|too long/.test(e.message)) throw e; }
  }

  // ---- periods
  const endP = opts.end ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const asked = addMonths(endP, -(opts.months - 1));
  const startP = booksStart && booksStart.slice(0, 7) > asked && booksStart.slice(0, 7) <= endP ? booksStart.slice(0, 7) : asked;
  const periods: string[] = [];
  for (let p = startP; p <= endP; p = addMonths(p, 1)) periods.push(p);
  const startDate = `${startP}-01`;
  const endDate = `${endP}-${String(daysIn(endP)).padStart(2, "0")}`;
  const companyLeaf = opts.includeBranches ? ["company_id", "child_of", cid] : ["company_id", "=", cid];
  const base = [["parent_state", "=", "posted"], companyLeaf];

  // ---- balances: opening (all history before start) + monthly movements
  const opening = new Map<number, number>();
  const moves = new Map<number, Record<string, number>>();
  let method: "read_group" | "search_read" = "read_group";
  let groups = 0;
  try {
    const og = trust(GroupRows, await client.executeKw("account.move.line", "read_group", [[...base, ["date", "<", startDate]], ["balance:sum"], ["account_id"]], { lazy: false, context: ctx }), "opening balances") as Group[];
    for (const g of og) if (g.account_id) opening.set(g.account_id[0], (opening.get(g.account_id[0]) ?? 0) + Number(g.balance || 0));
    const mg = trust(GroupRows, await client.executeKw("account.move.line", "read_group", [[...base, ["date", ">=", startDate], ["date", "<=", endDate]], ["balance:sum"], ["account_id", "date:month"]], { lazy: false, context: ctx }), "monthly balances") as Group[];
    groups = og.length + mg.length;
    for (const g of mg) {
      if (!g.account_id) continue;
      const p = monthOfGroup(g);
      if (!p) throw new OdooError("Could not read the month of a grouped result");
      const rec = moves.get(g.account_id[0]) ?? {};
      rec[p] = (rec[p] ?? 0) + Number(g.balance || 0);
      moves.set(g.account_id[0], rec);
    }
  } catch (e) {
    // Only Odoo saying read_group isn't available switches to reading lines; anything else (a bad answer, a bug) stops here.
    if (!(e instanceof OdooError) || (/month of a grouped/.test(e.message) === false && !/read_group|not.*(allowed|exist)|deprecated/i.test(e.detail ?? e.message)) || /can't trust/.test(e.message)) throw e;
    // Fallback (e.g. Odoo 19 without public read_group): page through move lines and aggregate here.
    method = "search_read";
    opening.clear(); moves.clear();
    const pageSize = 5000;
    for (let offset = 0; offset < 2_000_000; offset += pageSize) {
      const lines = trust(BalanceLines, await client.executeKw("account.move.line", "search_read", [[...base, ["date", "<=", endDate]]], { fields: ["account_id", "date", "balance"], limit: pageSize, offset, order: "id", context: ctx }), "journal items");
      for (const l of lines) {
        if (!l.account_id) continue;
        const id = l.account_id[0];
        if (l.date < startDate) opening.set(id, (opening.get(id) ?? 0) + l.balance);
        else { const rec = moves.get(id) ?? {}; const p = l.date.slice(0, 7); rec[p] = (rec[p] ?? 0) + l.balance; moves.set(id, rec); }
      }
      groups += lines.length;
      if (lines.length < pageSize) break;
    }
  }

  // Drop trailing months with no postings at all (e.g. the current month before anything is booked).
  const active = new Set<string>();
  for (const rec of moves.values()) for (const [p, x] of Object.entries(rec)) if (x) active.add(p);
  while (periods.length > 1 && !active.has(periods[periods.length - 1])) periods.pop();

  // ---- build natural-sign accounts
  const openingP = addMonths(startP, -1);
  const out: SyncedAccount[] = [];
  const unmapped: string[] = [];
  const offBalance: string[] = [];
  let plRun = 0;
  const plMoves: Record<string, number> = {};
  let tb = 0;
  // Every account's class: a person's choice, else Odoo's account type.
  const classed = accts.map((a) => {
    const type = typeOf(a);
    const code = typeof a.code === "string" ? a.code.trim() : "";
    const chosen = opts.classes?.[code ? `#${code}` : normLabel(a.name)];
    return { a, type, code, chosen: Boolean(chosen), c: chosen ? { cls: chosen as ClassKey, conf: 1 } : classFromOdooType(type, a.name) };
  });
  const kept: string[] = [];
  for (const k of classed) {
    if (k.c.cls) continue;
    const op = opening.get(k.a.id) ?? 0;
    if (op === 0 && !Object.values(moves.get(k.a.id) ?? {}).some((x) => x !== 0)) continue;
    // A balance is never dropped: debits equal credits only with every account in. An account Odoo can't place (typed
    // off-balance, or no type) takes the class of its neighbours in the chart, else what its name says, else a suspense
    // line on the side its balance is on; each one is named for the accountant to confirm.
    const near = neighbourClass(k.code, classed);
    const byName = classFromOdooType("", k.a.name).cls;
    const total = op + Object.values(moves.get(k.a.id) ?? {}).reduce((x, y) => x + y, 0);
    const cls: ClassKey = (k.type === "off_balance" && PETTY.test(k.a.name) ? "cash" : null) ?? near?.cls ?? (byName && !isPL(byName) ? byName : null) ?? (total >= 0 ? "other_ca" : "other_cl");
    k.c = { cls, conf: 0.5 };
    kept.push(`${`${k.code} ${k.a.name}`.trim()} kept as ${CLASS_LABEL[cls]}${near && !(k.type === "off_balance" && PETTY.test(k.a.name)) ? ` (like the accounts ${near.prefix}… next to it in the chart)` : ""}`);
  }
  for (const { a, type, chosen, c } of classed) {
    const op = opening.get(a.id) ?? 0;
    const mv = moves.get(a.id) ?? {};
    const hasData = op !== 0 || Object.values(mv).some((x) => x !== 0);
    tb += op + Object.values(mv).reduce((s, x) => s + x, 0);
    if (hasData && (type === "off_balance" || !type) && c.conf === 0.5) (type === "off_balance" ? offBalance : unmapped).push(`${a.code || ""} ${a.name}`.trim());
    if (!hasData || !c.cls) continue;
    const cls = c.cls;
    const amounts: Record<string, number> = {};
    if (isPL(cls)) {
      plRun += op;
      for (const p of periods) { const x = mv[p] ?? 0; if (x) { amounts[p] = toNatural(cls, x); plMoves[p] = (plMoves[p] ?? 0) + x; } }
    } else {
      let run = op;
      // The balance before the first month is stored as the month before it, so the first month has a cash flow.
      if (Math.abs(run) > 0.004) amounts[openingP] = toNatural(cls, run);
      for (const p of periods) { run += mv[p] ?? 0; if (Math.abs(run) > 0.004) amounts[p] = toNatural(cls, run); }
    }
    out.push({ code: a.code || "", name: a.name, cls, amounts, odoo_id: a.id, odoo_type: type || null, confidence: c.conf, mapped_by: chosen ? "user" : "auto" });
  }
  // Odoo never closes P&L accounts: carry all earnings to date into retained earnings.
  const re: Record<string, number> = {};
  if (Math.abs(plRun) > 0.004) re[openingP] = -plRun;
  for (const p of periods) { plRun += plMoves[p] ?? 0; if (Math.abs(plRun) > 0.004) re[p] = -plRun; }
  out.push({ code: "", name: "Earnings to date (computed from P&L accounts)", cls: "retained_earnings", amounts: re, odoo_id: null, odoo_type: null, confidence: 1, mapped_by: "system" });

  const notes = [
    `Synced from Odoo ${v.server_version}: posted entries only, ${opts.includeBranches ? "including branches" : "this company only"}.`,
    ...(proposed ? [`The books start on ${fmtDay(proposed.suggested)}: the day after Odoo's opening entry (${fmtDay(proposed.day)}). Everything before it is the opening balance; change it in Company profile if it is wrong.`] : []),
    "Retained earnings include profit to date computed from the P&L accounts (Odoo does not close P&L accounts into equity).",
  ];
  // An account Odoo types off-balance (or not at all) that holds posted entries is a real one (petty cash custody kept
  // "off the books"): kept, so the balance sheet balances, and named for the accountant to confirm in Chart of accounts.
  if (kept.length) notes.push(`${kept.join("; ")}. ${kept.length > 1 ? "These accounts are" : "This account is"} typed off-balance or have no type in Odoo but hold posted entries; confirm the class in Chart of accounts.`);
  // Back-dated postings: entered after the last import into days it had already covered, so the reports made from it missed them.
  let latePostings: number | undefined;
  if (opts.since) {
    const at = new Date(opts.since.at).toISOString().slice(0, 19).replace("T", " ");
    latePostings = trust(Count, await client.executeKw("account.move.line", "search_count", [[...base, ["date", "<=", opts.since.through], ["create_date", ">", at]]], { context: ctx }), "late postings");
    if (latePostings) notes.push(`${latePostings} posted line${latePostings > 1 ? "s" : ""} dated up to ${fmtDay(opts.since.through)} ${latePostings > 1 ? "were" : "was"} entered in Odoo after the last import (${fmtDay(at.slice(0, 10))}). They are in this sync; reports made from the last import missed them. Set a lock date in Odoo once a period is closed.`);
  }
  return { ...(proposed ? { booksStart: proposed } : {}), accounts: out, periods, notes, diagnostics: { version: v.server_version, major, accounts: accts.length, groups, method, trialBalanceCheck: Math.round(tb * 100) / 100, unmapped, offBalance, ...(latePostings !== undefined ? { latePostings } : {}) } };
}

export interface SyncedLines { sales: SalesLine[]; expenses: ExpenseLine[]; stock: StockLedgerLine[]; lines: number; note: string | null }
/** Most move lines a sync reads for sales and expenses (beyond it, the General Ledger upload gives the detail). */
export const MAX_SYNC_LINES = 100_000;

/**
 * The move lines behind the revenue and cost accounts of a sync, as sales and expense lines (the same mapping as a General
 * Ledger upload): date, entry, partner and label of every posted line in the months synced. Skipped, with a note, when there
 * are more lines than a sync can read in time; the balances are synced either way.
 */
export async function syncLedgerLines(client: OdooClient, opts: SyncOptions, res: SyncResult, budgetMs = 30_000): Promise<SyncedLines> {
  const started = Date.now();
  const core = res.accounts.filter((a) => a.odoo_id !== null && (a.cls === "revenue" || EXPENSE_CLASSES.has(a.cls)));
  const stockAccts = res.accounts.filter((a) => a.odoo_id !== null && a.cls === "inventory");
  if ((!core.length && !stockAccts.length) || !res.periods.length) return { sales: [], expenses: [], stock: [], lines: 0, note: null };
  const cid = opts.companyId;
  const ctx = { allowed_company_ids: [cid], lang: "en_US", active_test: false };
  const first = res.periods[0], last = res.periods[res.periods.length - 1];
  type Line = { account_id: [number, string] | false; date: string; move_id: [number, string] | false; partner_id: [number, string] | false; name: string | false; balance: number };
  // One group of accounts at a time, each with its own limit: stock postings never crowd out sales and expense detail.
  const fetch = async (accts: typeof core): Promise<{ lines: { code: string; name: string; cls: (typeof core)[number]["cls"]; excluded: boolean; entries: LedgerEntry[] }[]; count: number } | "too_many" | "too_slow"> => {
    const domain = [["parent_state", "=", "posted"], opts.includeBranches ? ["company_id", "child_of", cid] : ["company_id", "=", cid],
      ["date", ">=", `${first}-01`], ["date", "<=", `${last}-${String(daysIn(last)).padStart(2, "0")}`], ["account_id", "in", accts.map((a) => a.odoo_id!)]];
    const count = trust(Count, await client.executeKw("account.move.line", "search_count", [domain], { context: ctx }), "line count");
    if (count > MAX_SYNC_LINES) return "too_many";
    const entries = new Map<number, LedgerEntry[]>();
    const pageSize = 5000;
    for (let offset = 0; offset < count; offset += pageSize) {
      if (Date.now() - started > budgetMs) return "too_slow";
      const page: Line[] = trust(DetailLines, await client.executeKw("account.move.line", "search_read", [domain], { fields: ["account_id", "date", "move_id", "partner_id", "name", "balance"], limit: pageSize, offset, order: "date, id", context: ctx }), "journal items");
      for (const l of page) {
        if (!l.account_id || !l.balance) continue;
        const list = entries.get(l.account_id[0]) ?? [];
        list.push({ day: l.date.slice(0, 10), period: l.date.slice(0, 7), ref: l.move_id ? l.move_id[1] : "", label: (l.name || "").trim(), partner: l.partner_id ? l.partner_id[1] : "", amount: l.balance });
        entries.set(l.account_id[0], list);
      }
      if (page.length < pageSize) break;
    }
    return { lines: accts.map((a) => ({ code: a.code, name: a.name, cls: a.cls, excluded: false, entries: entries.get(a.odoo_id!) ?? [] })), count };
  };
  const notes: string[] = [];
  const out: SyncedLines = { sales: [], expenses: [], stock: [], lines: 0, note: null };
  if (core.length) {
    const r = await fetch(core);
    if (r === "too_many") notes.push("Sales and expense detail were not synced: there are more lines than a sync reads. Upload the General Ledger for customers and suppliers.");
    else if (r === "too_slow") notes.push("Sales and expense detail were not synced: Odoo took too long to send the lines. Upload the General Ledger for customers and suppliers.");
    else { out.sales = salesFromLedger(r.lines); out.expenses = expensesFromLedger(r.lines); out.lines += r.count; }
  }
  if (stockAccts.length) {
    const r = await fetch(stockAccts);
    if (r === "too_many" || r === "too_slow") notes.push("Stock postings were not synced, so the Inventory checks against the accounts need the General Ledger upload.");
    else { out.stock = stockFromLedger(r.lines); out.lines += r.count; }
  }
  out.note = notes.length ? notes.join(" ") : null;
  return out;
}
