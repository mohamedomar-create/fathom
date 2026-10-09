import { addMonths, daysIn, type ClassKey } from "@/lib/engine";
import { isPL, toNatural } from "@/lib/company/build";
import { classFromOdooType, ODOO15_TYPE_MAP } from "@/lib/ingest/classify";
import { majorVersion, OdooClient, OdooError } from "./client";

export interface OdooCompany { id: number; name: string; currency: string | null }
export interface OdooProbe { version: string; major: number; uid: number; companies: OdooCompany[] }

export async function probe(client: OdooClient): Promise<OdooProbe> {
  const v = await client.version();
  const major = majorVersion(v.server_version_info, v.server_version);
  const uid = await client.authenticate();
  const rows = await client.executeKw<{ id: number; name: string; currency_id: [number, string] | false }[]>("res.company", "search_read", [[]], { fields: ["name", "currency_id"], order: "id" });
  return { version: v.server_version, major, uid, companies: rows.map((r) => ({ id: r.id, name: r.name, currency: r.currency_id ? r.currency_id[1] : null })) };
}

export interface SyncOptions {
  companyId: number;
  includeBranches: boolean;
  /** Months to show (an extra month before them is fetched as the opening balance). */
  months: number;
  /** Last month to include (YYYY-MM); defaults to the current month. */
  end?: string;
}

export interface SyncedAccount {
  code: string; name: string; cls: ClassKey; amounts: Record<string, number>;
  odoo_id: number | null; odoo_type: string | null; confidence: number; mapped_by: "auto" | "system";
}

export interface SyncResult {
  accounts: SyncedAccount[];
  periods: string[];
  notes: string[];
  diagnostics: { version: string; major: number; accounts: number; groups: number; method: "read_group" | "search_read"; trialBalanceCheck: number; unmapped: string[] };
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
  const v = await client.version();
  const major = majorVersion(v.server_version_info, v.server_version);
  await client.authenticate();
  const cid = opts.companyId;
  const ctx = { allowed_company_ids: [cid], active_test: false };

  // ---- chart of accounts
  const acctDomain = major >= 18 ? [["company_ids", "in", [cid]]] : [["company_id", "=", cid]];
  const typeField = major >= 16 ? "account_type" : "user_type_id";
  const accts = await client.executeKw<{ id: number; code: string | false; name: string; account_type?: string; user_type_id?: [number, string] | false }[]>(
    "account.account", "search_read", [acctDomain], { fields: ["code", "name", typeField], context: ctx },
  );
  if (!accts.length) throw new OdooError("No accounts found for that company. Check the company selection and the user's access rights.");
  let typeOf: (a: (typeof accts)[number]) => string;
  if (major >= 16) typeOf = (a) => a.account_type ?? "";
  else {
    const typeIds = [...new Set(accts.map((a) => (a.user_type_id ? a.user_type_id[0] : 0)).filter(Boolean))];
    const xml = await client.executeKw<{ res_id: number; name: string }[]>("ir.model.data", "search_read", [[["model", "=", "account.account.type"], ["res_id", "in", typeIds]]], { fields: ["res_id", "name"] });
    const byId = new Map(xml.map((x) => [x.res_id, ODOO15_TYPE_MAP[x.name] ?? ""]));
    typeOf = (a) => (a.user_type_id ? byId.get(a.user_type_id[0]) ?? "" : "");
  }

  // ---- periods
  const endP = opts.end ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const startP = addMonths(endP, -(opts.months - 1));
  const periods = Array.from({ length: opts.months }, (_, i) => addMonths(startP, i));
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
    const og = await client.executeKw<Group[]>("account.move.line", "read_group", [[...base, ["date", "<", startDate]], ["balance:sum"], ["account_id"]], { lazy: false, context: ctx });
    for (const g of og) if (g.account_id) opening.set(g.account_id[0], (opening.get(g.account_id[0]) ?? 0) + Number(g.balance || 0));
    const mg = await client.executeKw<Group[]>("account.move.line", "read_group", [[...base, ["date", ">=", startDate], ["date", "<=", endDate]], ["balance:sum"], ["account_id", "date:month"]], { lazy: false, context: ctx });
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
    if (e instanceof OdooError && /month of a grouped/.test(e.message) === false && !/read_group|not.*(allowed|exist)|deprecated/i.test(e.detail ?? e.message)) throw e;
    // Fallback (e.g. Odoo 19 without public read_group): page through move lines and aggregate here.
    method = "search_read";
    opening.clear(); moves.clear();
    const pageSize = 5000;
    for (let offset = 0; offset < 2_000_000; offset += pageSize) {
      const lines = await client.executeKw<{ account_id: [number, string] | false; date: string; balance: number }[]>(
        "account.move.line", "search_read", [[...base, ["date", "<=", endDate]]], { fields: ["account_id", "date", "balance"], limit: pageSize, offset, order: "id", context: ctx },
      );
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
  const out: SyncedAccount[] = [];
  const unmapped: string[] = [];
  let plRun = 0;
  const plMoves: Record<string, number> = {};
  let tb = 0;
  for (const a of accts) {
    const type = typeOf(a);
    const c = classFromOdooType(type, a.name);
    const op = opening.get(a.id) ?? 0;
    const mv = moves.get(a.id) ?? {};
    const hasData = op !== 0 || Object.values(mv).some((x) => x !== 0);
    tb += op + Object.values(mv).reduce((s, x) => s + x, 0);
    if (!c.cls) { if (hasData && type !== "off_balance") unmapped.push(`${a.code || ""} ${a.name}`.trim()); continue; }
    if (!hasData) continue;
    const amounts: Record<string, number> = {};
    if (isPL(c.cls)) {
      plRun += op;
      for (const p of periods) { const x = mv[p] ?? 0; if (x) { amounts[p] = toNatural(c.cls, x); plMoves[p] = (plMoves[p] ?? 0) + x; } }
    } else {
      let run = op;
      for (const p of periods) { run += mv[p] ?? 0; if (Math.abs(run) > 0.004) amounts[p] = toNatural(c.cls, run); }
    }
    out.push({ code: a.code || "", name: a.name, cls: c.cls, amounts, odoo_id: a.id, odoo_type: type || null, confidence: c.conf, mapped_by: "auto" });
  }
  // Odoo never closes P&L accounts: carry all earnings to date into retained earnings.
  const re: Record<string, number> = {};
  for (const p of periods) { plRun += plMoves[p] ?? 0; if (Math.abs(plRun) > 0.004) re[p] = -plRun; }
  out.push({ code: "", name: "Earnings to date (computed from P&L accounts)", cls: "retained_earnings", amounts: re, odoo_id: null, odoo_type: null, confidence: 1, mapped_by: "system" });

  const notes = [
    `Synced from Odoo ${v.server_version}: posted entries only, ${opts.includeBranches ? "including branches" : "this company only"}.`,
    "Retained earnings include profit to date computed from the P&L accounts (Odoo does not close P&L accounts into equity).",
  ];
  if (unmapped.length) notes.push(`${unmapped.length} account(s) with balances had no recognised type and were left out: ${unmapped.slice(0, 5).join(", ")}${unmapped.length > 5 ? "…" : ""}.`);
  return { accounts: out, periods, notes, diagnostics: { version: v.server_version, major, accounts: accts.length, groups, method, trialBalanceCheck: Math.round(tb * 100) / 100, unmapped } };
}
