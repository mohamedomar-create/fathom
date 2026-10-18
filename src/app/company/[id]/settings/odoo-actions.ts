"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decrypt, encrypt } from "@/lib/crypto";
import { loadAccountMap } from "@/lib/company/account-map";
import { saveCompanyData } from "@/lib/company/persist";
import { runChecks } from "@/lib/company/checks";
import { OdooClient, OdooError, odooDisabled } from "@/lib/odoo/client";
import { atLeast, connectionVerdict, unbalancedSync, type Role } from "@/lib/odoo/policy";
import { assertPublicOdooUrl, pinnedFetch, resolvePublicOdoo } from "@/lib/odoo/net";
import { limited, TOO_MANY } from "@/lib/rate-limit";
import { DbError, safeError } from "@/lib/action-error";
import { booksStartOf, withProfile } from "@/lib/company/time-zone";
import { probe, syncLedgerLines, syncOdoo, type OdooProbe } from "@/lib/odoo/sync";
import { sinceOf } from "@/lib/odoo/since";
import { clearLedger, saveLedgerLines } from "@/lib/company/ledger-lines";
import { getUser } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: safeError(e, "odoo") });

const ConnSchema = z.object({
  companyId: z.string().uuid(),
  url: z.string().min(8).max(300),
  db: z.string().trim().min(1).max(120),
  login: z.string().trim().min(1).max(200),
  apiKey: z.string().max(300).optional().default(""),
});

type Supa = Awaited<ReturnType<typeof getUser>>["supabase"];

/** A sync stops sending requests after this long, so it ends cleanly inside the page's 60-second limit. */
const SYNC_BUDGET_MS = 50_000;
const DB_UPDATE = "The database security update for Odoo (migration 0025) is not applied yet. Ask the site owner to run it before connecting Odoo.";
const missingFn = (e: { code?: string; message?: string }) => e.code === "PGRST202" || e.code === "42883" || e.code === "42703";

/** The caller's role in the company's organisation (null: not a member). Checked here as well as by the database. */
async function roleIn(supabase: Supa, userId: string, companyId: string): Promise<Role | null> {
  const { data: co } = await supabase.from("companies").select("org_id").eq("id", companyId).maybeSingle();
  if (!co) return null;
  const { data: m } = await supabase.from("memberships").select("role").eq("org_id", co.org_id).eq("user_id", userId).maybeSingle();
  return (m?.role as Role | undefined) ?? null;
}

/** Everyone who acts on the connection: signed in, a member with at least this role, Odoo not switched off. */
async function guard(companyId: string, min: Role) {
  const { supabase, user } = await getUser();
  if (!user) throw new Error("Please sign in again.");
  if (odooDisabled()) throw new Error("The Odoo connection is switched off on this server.");
  const role = await roleIn(supabase, user.id, companyId);
  if (!atLeast(role, min)) {
    if (role) await audit(supabase, companyId, "refused", false, `${min} action refused for a ${role}`);
    throw new Error(min === "admin" ? "Only an admin of this company can change the Odoo connection." : "Only an editor or admin of this company can do that.");
  }
  return { supabase, user, role: role! };
}

/** One line in the company's Odoo log (append-only in the database). Never blocks the action it records. */
async function audit(supabase: Supa, companyId: string, action: "test" | "sync" | "refused", ok: boolean, detail?: string | null, rows?: number) {
  const { error } = await supabase.rpc("odoo_audit_log", { p_company: companyId, p_action: action, p_ok: ok, p_detail: detail ? detail.slice(0, 500) : null, p_rows: rows ?? null });
  if (error) console.error(JSON.stringify({ level: "error", context: "odoo_audit", code: error.code, message: error.message }));
}

/** What a key is bound to when encrypted: a copy moved to another company, server, database or login can't be decrypted. */
const bindingOf = (companyId: string, url: string, db: string, login: string) => `odoo\n${companyId}\n${url}\n${db}\n${login}`;

/** The stored (encrypted) key, read through the database function that checks the caller edits this company. */
async function storedKey(supabase: Supa, companyId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("odoo_secret", { p_company: companyId });
  if (error) { if (missingFn(error)) throw new Error(DB_UPDATE); throw new DbError(error); }
  return (data as string | null) || null;
}

/**
 * The saved API key, only for the same Odoo it was saved for: if the address, database or login changed, the key must be
 * typed again, so nobody can send a stored key to a server of their choosing.
 */
async function reusableKey(supabase: Supa, companyId: string, url: string, db: string, login: string): Promise<string | null> {
  const { data } = await supabase.from("odoo_connections").select("url, db, login").eq("company_id", companyId).maybeSingle();
  if (!data) return null;
  const enc = await storedKey(supabase, companyId);
  if (!enc) return null;
  if (data.url !== url || data.db !== db || data.login !== login) throw new Error("Enter the API key again: the Odoo address, database or login changed.");
  return enc;
}

/** The saved key in plain text, only for the company, address, database and login it was saved for. */
const openKey = (enc: string, companyId: string, url: string, db: string, login: string) => {
  try { return decrypt(enc, bindingOf(companyId, url, db, login)); }
  catch (e) { throw new Error(/again/.test((e as Error).message) ? (e as Error).message : "Enter the API key again: the saved key doesn't belong to this connection."); }
};

/** A client that talks only to the address that passed the public-internet check. */
async function connect(rawUrl: string, db: string, login: string, key: string, deadline = Infinity) {
  const target = await resolvePublicOdoo(rawUrl);
  return { url: target.url, client: new OdooClient(target.url, db, login, key, pinnedFetch(target), 25_000, deadline) };
}

/** Both limits: the person's (20 an hour across test, save and sync) and the company's for this action. Fail closed. */
async function overLimit(supabase: Supa, userId: string, companyId: string, scope: "odoo_test_company" | "odoo_sync_company" | null) {
  if (await limited(supabase, "odoo", userId, true)) return true;
  return scope ? limited(supabase, scope, companyId, true) : false;
}

export async function testOdoo(input: z.input<typeof ConnSchema>): Promise<Result<OdooProbe>> {
  const v0 = ConnSchema.safeParse(input);
  if (!v0.success) return fail(v0.error);
  const v = v0.data;
  try {
    const { supabase, user } = await guard(v.companyId, "editor");
    if (await overLimit(supabase, user.id, v.companyId, "odoo_test_company")) throw new Error(TOO_MANY);
    const url = await assertPublicOdooUrl(v.url);
    const enc = v.apiKey ? null : await reusableKey(supabase, v.companyId, url, v.db, v.login);
    const key = v.apiKey || (enc ? openKey(enc, v.companyId, url, v.db, v.login) : "");
    if (!key) throw new Error("Enter the API key.");
    try {
      const p = await probe((await connect(url, v.db, v.login, key)).client);
      await audit(supabase, v.companyId, "test", true, `Odoo ${p.version} · ${url} · user "${p.user.name}" · rights ${p.rights}${p.canChange.length ? ` (can change ${p.canChange.join(", ")})` : ""}`);
      return { ok: true, data: p };
    } catch (e) {
      await audit(supabase, v.companyId, "test", false, `${url} · ${safeError(e, "odoo:test")}`);
      throw e;
    }
  } catch (e) { return fail(e); }
}

const SaveSchema = ConnSchema.extend({
  odooCompanyId: z.number().int().positive(),
  odooCompanyName: z.string().max(200),
  includeBranches: z.boolean(),
  // 240: everything since the company's books start (the sync never reads months before it).
  months: z.number().int().min(2).max(240),
  version: z.string().max(40).optional(),
  /** The day the Odoo API key expires (set in Odoo), for a reminder before it stops working. */
  keyExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function saveOdoo(input: z.input<typeof SaveSchema>): Promise<Result<true>> {
  try {
    const v = SaveSchema.parse(input);
    const { supabase, user } = await guard(v.companyId, "admin");
    if (await overLimit(supabase, user.id, v.companyId, "odoo_test_company")) throw new Error(TOO_MANY);
    const url = await assertPublicOdooUrl(v.url);
    const saved = v.apiKey ? null : await reusableKey(supabase, v.companyId, url, v.db, v.login);
    const key = v.apiKey || (saved ? openKey(saved, v.companyId, url, v.db, v.login) : "");
    if (!key) throw new Error("Enter the API key.");
    // Tested again here, on the server: what the browser showed is never trusted for the save.
    const p = await probe((await connect(url, v.db, v.login, key)).client);
    const verdict = connectionVerdict(p, v.odooCompanyId, v.includeBranches);
    if (!verdict.ok) { await audit(supabase, v.companyId, "refused", false, `save refused: ${verdict.reason} ${verdict.note}`); throw new Error(verdict.reason!); }
    const odooCompanyName = p.companies.find((c) => c.id === v.odooCompanyId)?.name ?? v.odooCompanyName;
    // A new key is encrypted bound to this company and connection; no key keeps the saved one (the database clears it if
    // the address, database or login changed).
    const { error } = await supabase.rpc("odoo_save", {
      p_company: v.companyId, p_url: url, p_db: v.db, p_login: v.login, p_key_enc: v.apiKey ? encrypt(v.apiKey, bindingOf(v.companyId, url, v.db, v.login)) : null,
      p_odoo_company_id: v.odooCompanyId, p_odoo_company_name: odooCompanyName, p_include_branches: v.includeBranches, p_months: v.months, p_version: p.version, p_key_expires_on: v.keyExpiresOn ?? null,
    });
    if (error) { if (missingFn(error)) throw new Error(DB_UPDATE); throw new DbError(error); }
    if (verdict.warnings.length) await audit(supabase, v.companyId, "test", true, `saved with warnings: ${verdict.warnings.join(" ")} ${verdict.note}`);
    revalidatePath(`/company/${v.companyId}/settings/source-data`);
    return { ok: true, data: true };
  } catch (e) { return fail(e); }
}

/** Remove the connection and its key (an admin's kill switch for one company). The log keeps the record. */
export async function disconnectOdoo(companyId: string): Promise<Result<true>> {
  try {
    z.string().uuid().parse(companyId);
    const { supabase } = await guard(companyId, "admin");
    const { error } = await supabase.from("odoo_connections").delete().eq("company_id", companyId);
    if (error) throw new DbError(error);
    revalidatePath(`/company/${companyId}/settings/source-data`);
    return { ok: true, data: true };
  } catch (e) { return fail(e); }
}

export async function syncOdooNow(companyId: string): Promise<Result<{ months: number; accounts: number; method: string; tb: number; unmapped: string[]; offBalance: string[]; version: string; detail: string | null }>> {
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "That value isn't valid." };
  let ctx: Awaited<ReturnType<typeof guard>>;
  try { ctx = await guard(companyId, "editor"); } catch (e) { return fail(e); }
  const { supabase, user } = ctx;
  let claimed = false;
  try {
    const { data: conn, error: ce } = await supabase.from("odoo_connections").select("url, db, login, odoo_company_id, odoo_company_name, include_branches, months_history, has_key").eq("company_id", companyId).maybeSingle();
    if (ce) { if (missingFn(ce)) throw new Error(DB_UPDATE); throw new DbError(ce); }
    if (!conn || !conn.odoo_company_id) throw new Error("Save the Odoo connection first.");
    if (await overLimit(supabase, user.id, companyId, "odoo_sync_company")) throw new Error(TOO_MANY);
    // The key is cleared whenever the address, database or login changes (migration 0016).
    if (!conn.has_key) throw new Error("Enter the API key again in the Odoo connection, then save it.");
    // One sync at a time: two at once could mix their ledger lines.
    const claim = await supabase.rpc("odoo_claim_sync", { p_company: companyId });
    if (claim.error) { if (missingFn(claim.error)) throw new Error(DB_UPDATE); throw new DbError(claim.error); }
    if (claim.data !== true) throw new Error("A sync is already running for this company. Wait for it to finish (at most 15 minutes), then try again.");
    claimed = true;
    const enc = await storedKey(supabase, companyId);
    if (!enc) throw new Error("Enter the API key again in the Odoo connection, then save it.");
    const { client } = await connect(conn.url, conn.db, conn.login, openKey(enc, companyId, conn.url, conn.db, conn.login), Date.now() + SYNC_BUDGET_MS);
    // The company's account map: classes a person chose win over Odoo's account types.
    // The last import, so entries entered after it into days it covered (back-dated postings) are counted.
    const { data: last } = await supabase.from("imports").select("created_at, report").eq("company_id", companyId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    const since = last ? sinceOf(last.created_at, last.report) : undefined;
    // Months before the company's books start are its opening balance, never months.
    const { data: co } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
    const res = await syncOdoo(client, { companyId: conn.odoo_company_id, includeBranches: conn.include_branches, months: conn.months_history, classes: await loadAccountMap(supabase, companyId), since, booksStart: booksStartOf(co?.kpi_config) });
    const late = res.diagnostics.latePostings ? [{ id: "continuity" as const, severity: "warn" as const, title: `${res.diagnostics.latePostings} posted line${res.diagnostics.latePostings > 1 ? "s" : ""} entered after the last import`, detail: res.notes[res.notes.length - 1] }] : [];
    if (res.periods.length < 1 || res.accounts.length < 2) throw new Error("Odoo returned no posted entries for that company and period.");
    // Debits must equal credits across everything read: an unbalanced answer is not saved.
    if (Math.abs(res.diagnostics.trialBalanceCheck) > 1) throw new Error(`Odoo's entries don't balance (difference ${res.diagnostics.trialBalanceCheck.toLocaleString("en-GB")}). Nothing was saved; check the company selection and the user's access.`);
    const unbalanced = unbalancedSync(res.accounts);
    if (unbalanced) throw new Error(unbalanced);
    await saveCompanyData(supabase, companyId, res.accounts, {
      kind: "odoo", filename: `${conn.odoo_company_name ?? "Odoo"} (${res.diagnostics.version})`,
      // Live sync is authoritative and replaces everything; its checks are recorded and shown, never blocking.
      report: { kind: "odoo", mode: "replace", periods: res.periods, slices: { PL: res.periods, BS: res.periods }, warnings: res.diagnostics.unmapped.length ? [`${res.diagnostics.unmapped.length} unmapped account(s)`] : [], notes: res.notes, diagnostics: res.diagnostics, checks: [...late, ...runChecks({ accounts: res.accounts }).filter((c) => c.severity !== "info")].slice(0, 300) } as unknown as Json,
    }, res.notes);
    // The same posted lines feed Sales and Expenses: a sync replaces everything, so earlier ledger lines go first.
    let detail: string | null = null;
    let lines = 0;
    try {
      const ls = await syncLedgerLines(client, { companyId: conn.odoo_company_id, includeBranches: conn.include_branches, months: conn.months_history }, res, Math.max(0, SYNC_BUDGET_MS - 20_000));
      await clearLedger(supabase, companyId, "all");
      const name = `${conn.odoo_company_name ?? "Odoo"} (sync)`;
      await saveLedgerLines(supabase, companyId, user.id, "sales", ls.sales, name);
      await saveLedgerLines(supabase, companyId, user.id, "expenses", ls.expenses, name);
      await saveLedgerLines(supabase, companyId, user.id, "stock", ls.stock, name);
      detail = ls.note;
      lines = ls.lines;
    } catch (e) { detail = `Sales and expense detail could not be synced (${e instanceof OdooError ? e.message : safeError(new DbError({ message: String((e as Error)?.message ?? e) }), "syncOdoo:lines")}). The figures were synced.`; }
    const done = await supabase.from("odoo_connections").update({ status: "ok", last_error: detail, last_sync_at: new Date().toISOString(), version: res.diagnostics.version.slice(0, 40), sync_started_at: null }).eq("company_id", companyId);
    if (done.error) throw new DbError(done.error);
    claimed = false;
    // A books start proposed from Odoo's opening date is kept for the next syncs and uploads (the company had none).
    await supabase.from("companies").update({ source: "odoo", ...(res.booksStart && !booksStartOf(co?.kpi_config) ? { kpi_config: withProfile(co?.kpi_config, { booksStart: res.booksStart.suggested, openingAsAt: res.booksStart.day }) as Json } : {}) }).eq("id", companyId);
    await audit(supabase, companyId, "sync", true, `${res.periods[0]}–${res.periods[res.periods.length - 1]} · ${res.accounts.length} accounts · trial balance ${res.diagnostics.trialBalanceCheck}${detail ? ` · ${detail}` : ""}`, res.diagnostics.groups + lines);
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, data: { months: res.periods.length, accounts: res.accounts.length, method: res.diagnostics.method, tb: res.diagnostics.trialBalanceCheck, unmapped: res.diagnostics.unmapped, offBalance: res.diagnostics.offBalance ?? [], version: res.diagnostics.version, detail } };
  } catch (e) {
    const why = safeError(e, "syncOdoo").slice(0, 500);
    if (claimed) await supabase.from("odoo_connections").update({ status: "error", last_error: why, sync_started_at: null }).eq("company_id", companyId);
    await audit(supabase, companyId, "sync", false, why);
    return fail(e);
  }
}
