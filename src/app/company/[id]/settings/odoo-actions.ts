"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { decrypt, encrypt, reencrypt, usesOldKey } from "@/lib/crypto";
import { loadAccountMap } from "@/lib/company/account-map";
import { saveCompanyData } from "@/lib/company/persist";
import { runChecks } from "@/lib/company/checks";
import { majorVersion, OdooClient, odooDisabled } from "@/lib/odoo/client";
import { countLedger, countPart, firstStockDay, layersPage, ledgerPage, movesPage, onHand, PAGE, readLocations, salesPage } from "@/lib/odoo/detail";
import type { ClassKey } from "@/lib/engine";
import { trust, Version } from "@/lib/odoo/schema";
import { mergeLocationTypes, type LocationTypes } from "@/lib/ingest/inventory";
import { INVENTORY_KEY } from "@/lib/company/config-keys";
import { atLeast, connectionVerdict, continuesChain, STALE_MS, unbalancedSync, type Role } from "@/lib/odoo/policy";
import { assertPublicOdooUrl, pinnedFetch, resolvePublicOdoo } from "@/lib/odoo/net";
import { limited } from "@/lib/rate-limit";
import { DbError, safeError } from "@/lib/action-error";
import { booksStartOf, withProfile } from "@/lib/company/time-zone";
import { probe, syncOdoo, type OdooProbe } from "@/lib/odoo/sync";
import { sinceOf } from "@/lib/odoo/since";
import { clearLedger } from "@/lib/company/ledger-lines";
import { stageAdd, stageBegin, stageFinish, type StageKind } from "@/lib/company/line-stage";
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
const STAGE_UPDATE = "The detail sync needs the latest database update (migration 0035). Ask the site owner to run it.";
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


/** Releases a claim left by a sync that was cut off, and says so in the log. */
async function takeOverStale(supabase: Supa, companyId: string) {
  const { data } = await supabase.from("odoo_connections").select("status, sync_started_at").eq("company_id", companyId).maybeSingle();
  if (data?.status !== "syncing" || (data.sync_started_at && Date.now() - Date.parse(data.sync_started_at) < STALE_MS)) return;
  await supabase.from("odoo_connections").update({ status: "error", sync_started_at: null, last_error: "The last sync was cut off before it finished." }).eq("company_id", companyId);
  await audit(supabase, companyId, "sync", false, "the last sync was cut off before it finished; its lock was released");
}

/** Stops a running sync at once: its lock is released (what it already saved stays). */
export async function stopOdooSync(companyId: string): Promise<Result<true>> {
  try {
    z.string().uuid().parse(companyId);
    const { supabase } = await guard(companyId, "editor");
    await supabase.from("odoo_connections").update({ status: "error", sync_started_at: null, last_error: "Sync stopped." }).eq("company_id", companyId);
    await audit(supabase, companyId, "sync", false, "sync stopped by hand");
    revalidatePath(`/company/${companyId}/data/odoo`);
    return { ok: true, data: true };
  } catch (e) { return fail(e); }
}

/** Both limits: the person's (20 an hour across test, save and sync) and the company's for this action. Fail closed. */
async function overLimit(supabase: Supa, userId: string, companyId: string, scope: "odoo_test_company" | "odoo_sync_company" | null): Promise<string | null> {
  if (await limited(supabase, "odoo", userId, true)) return "You have reached the Odoo limit for one person (20 tests, saves and syncs an hour). Try again later this hour; nothing already synced is lost.";
  if (scope && await limited(supabase, scope, companyId, true)) return scope === "odoo_sync_company" ? "This company's sync limit (6 syncs an hour) is used up. Try again later this hour; what is already synced stays." : "This company's test limit (10 an hour) is used up. Try again later this hour.";
  return null;
}

export async function testOdoo(input: z.input<typeof ConnSchema>): Promise<Result<OdooProbe>> {
  const v0 = ConnSchema.safeParse(input);
  if (!v0.success) return fail(v0.error);
  const v = v0.data;
  try {
    const { supabase, user } = await guard(v.companyId, "editor");
    { const over = await overLimit(supabase, user.id, v.companyId, "odoo_test_company"); if (over) throw new Error(over); }
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
    { const over = await overLimit(supabase, user.id, v.companyId, "odoo_test_company"); if (over) throw new Error(over); }
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
    revalidatePath(`/company/${v.companyId}/data/odoo`);
    return { ok: true, data: true };
  } catch (e) { return fail(e); }
}

/** True when the saved API key is still under an older server key (after ENCRYPTION_KEYS gained a new first key). Admins only. */
export async function odooKeyIsOld(companyId: string): Promise<boolean> {
  try {
    z.string().uuid().parse(companyId);
    const { supabase } = await guard(companyId, "admin");
    const enc = await storedKey(supabase, companyId);
    return !!enc && usesOldKey(enc);
  } catch { return false; }
}

/** Key rotation: the same API key re-encrypted under the server's current key, so the old key can be taken off the server. */
export async function rekeyOdoo(companyId: string): Promise<Result<true>> {
  try {
    z.string().uuid().parse(companyId);
    const { supabase } = await guard(companyId, "admin");
    const { data: conn } = await supabase.from("odoo_connections").select("url, db, login").eq("company_id", companyId).maybeSingle();
    const enc = conn ? await storedKey(supabase, companyId) : null;
    if (!conn || !enc) throw new Error("There is no saved API key to re-encrypt.");
    let next: string;
    try { next = reencrypt(enc, bindingOf(companyId, conn.url, conn.db, conn.login)); }
    catch (e) { throw new Error(/again|no longer on the server/.test((e as Error).message) ? (e as Error).message : "Enter the API key again: the saved key doesn't belong to this connection."); }
    const { error } = await supabase.rpc("odoo_rekey", { p_company: companyId, p_key_enc: next });
    if (error) { if (missingFn(error)) throw new Error(DB_UPDATE); throw new DbError(error); }
    await audit(supabase, companyId, "test", true, "the saved API key was re-encrypted under the server's current key");
    revalidatePath(`/company/${companyId}/data/odoo`);
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
    revalidatePath(`/company/${companyId}/data/odoo`);
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
    { const over = await overLimit(supabase, user.id, companyId, "odoo_sync_company"); if (over) throw new Error(over); }
    // The key is cleared whenever the address, database or login changes (migration 0016).
    if (!conn.has_key) throw new Error("Enter the API key again in the Odoo connection, then save it.");
    // One sync at a time: two at once could mix their ledger lines.
    await takeOverStale(supabase, companyId);
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
    // Journal lines (sales, expense and stock postings) follow in the step-by-step stage (syncOdooDetail), so this
    // request stays well inside the time limit.
    const detail: string | null = null;
    // The lock passes straight to the detail stage the browser starts next (one Sync now counts once); if it never starts,
    // the lock is taken over after 2 minutes.
    const done = await supabase.from("odoo_connections").update({ status: "syncing", last_error: detail, last_sync_at: new Date().toISOString(), version: res.diagnostics.version.slice(0, 40), sync_started_at: new Date().toISOString() }).eq("company_id", companyId);
    if (done.error) throw new DbError(done.error);
    claimed = false;
    // A books start proposed from Odoo's opening date is kept for the next syncs and uploads (the company had none).
    await supabase.from("companies").update({ source: "odoo", ...(res.booksStart && !booksStartOf(co?.kpi_config) ? { kpi_config: withProfile(co?.kpi_config, { booksStart: res.booksStart.suggested, openingAsAt: res.booksStart.day }) as Json } : {}) }).eq("id", companyId);
    await audit(supabase, companyId, "sync", true, `${res.periods[0]}–${res.periods[res.periods.length - 1]} · ${res.accounts.length} accounts · trial balance ${res.diagnostics.trialBalanceCheck}${detail ? ` · ${detail}` : ""}`, res.diagnostics.groups);
    revalidatePath(`/company/${companyId}`, "layout");
    return { ok: true, data: { months: res.periods.length, accounts: res.accounts.length, method: res.diagnostics.method, tb: res.diagnostics.trialBalanceCheck, unmapped: res.diagnostics.unmapped, offBalance: res.diagnostics.offBalance ?? [], version: res.diagnostics.version, detail } };
  } catch (e) {
    const why = safeError(e, "syncOdoo").slice(0, 500);
    if (claimed) await supabase.from("odoo_connections").update({ status: "error", last_error: why, sync_started_at: null }).eq("company_id", companyId);
    await audit(supabase, companyId, "sync", false, why);
    return fail(e);
  }
}

const DetailStep = z.object({
  part: z.enum(["ledger", "sales", "moves", "valuation", "onhand"]),
  offset: z.number().int().min(0).max(50_000_000),
  total: z.number().int().min(0).max(50_000_000).optional(),
  batch: z.string().uuid().nullable().optional(),
  /** The first step right after the balances: it continues their lock instead of counting a new sync. */
  chained: z.boolean().optional(),
  /** The journal-lines step keeps three batches open: sales, expenses and stock postings. */
  batches: z.object({ sales: z.string().uuid().nullable(), expenses: z.string().uuid().nullable(), stock: z.string().uuid().nullable() }).optional(),
});
export type DetailStepInput = z.infer<typeof DetailStep>;
const NEXT_PART = { ledger: "sales", sales: "moves", moves: "valuation", valuation: "onhand", onhand: null } as const;
const PART_LABEL = { ledger: "Journal lines", sales: "Sales lines", moves: "Stock moves", valuation: "Stock valuation", onhand: "Stock on hand" } as const;
/** Each step stops sending requests after this long, well inside the page's 60-second limit. */
const STEP_BUDGET_MS = 40_000;

/** Every month from one to another (YYYY-MM), at most the last 240. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let [y, m] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))]; `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? (y++, m = 1) : m++) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out.slice(-240);
}

/**
 * The detail behind the balances, in steps the browser calls one after another: journal lines, sales lines by product,
 * stock moves, stock valuation and stock on hand, each saved through the same functions as the uploads (journal and sales
 * lines replace the synced months only, in one step when their last page is in; stock replaces all stock records), so a
 * synced company reads like an uploaded one. One step reads one page;
 * the first step takes the company's sync lock and the last releases it.
 */
export async function syncOdooDetail(companyId: string, input?: DetailStepInput): Promise<Result<{ next: DetailStepInput | null; label: string; done: number; total: number }>> {
  if (!z.string().uuid().safeParse(companyId).success) return { ok: false, error: "That value isn't valid." };
  const parsed = input === undefined ? null : DetailStep.safeParse(input);
  if (parsed && !parsed.success) return { ok: false, error: "That value isn't valid." };
  let ctx: Awaited<ReturnType<typeof guard>>;
  try { ctx = await guard(companyId, "editor"); } catch (e) { return fail(e); }
  const { supabase, user } = ctx;
  const step: DetailStepInput = parsed?.data ?? { part: "ledger", offset: 0 };
  const release = async (status: "ok" | "error", why: string | null) => {
    await supabase.from("odoo_connections").update({ status, sync_started_at: null, ...(status === "error" ? { last_error: why } : {}) }).eq("company_id", companyId);
  };
  try {
    const { data: conn, error: ce } = await supabase.from("odoo_connections").select("url, db, login, odoo_company_id, odoo_company_name, include_branches, months_history, has_key, status, sync_started_at").eq("company_id", companyId).maybeSingle();
    if (ce) { if (missingFn(ce)) throw new Error(DB_UPDATE); throw new DbError(ce); }
    if (!conn?.odoo_company_id || !conn.has_key) throw new Error("Save the Odoo connection first.");
    if (parsed?.data.chained) {
      if (!continuesChain(conn.status, conn.sync_started_at)) throw new Error("The balances finished too long ago to continue. Press Sync detail only.");
    } else if (!parsed) {
      { const over = await overLimit(supabase, user.id, companyId, "odoo_sync_company"); if (over) throw new Error(over); }
      await takeOverStale(supabase, companyId);
      const claim = await supabase.rpc("odoo_claim_sync", { p_company: companyId });
      if (claim.error) throw new DbError(claim.error);
      if (claim.data !== true) throw new Error("A sync is already running for this company. Wait for it to finish (at most 15 minutes), then try again.");
    } else if (conn.status !== "syncing") throw new Error("The detail sync was interrupted. Start it again.");
    // Every step keeps the claim fresh: one left without a step for 2 minutes was cut off and may be taken over.
    await supabase.from("odoo_connections").update({ sync_started_at: new Date().toISOString() }).eq("company_id", companyId);
    const enc = await storedKey(supabase, companyId);
    if (!enc) throw new Error("Enter the API key again in the Odoo connection, then save it.");
    const { client } = await connect(conn.url, conn.db, conn.login, openKey(enc, companyId, conn.url, conn.db, conn.login), Date.now() + STEP_BUDGET_MS);
    const v = await probeVersion(client);
    const d = { client, companyId: conn.odoo_company_id, major: v, includeBranches: conn.include_branches };
    const { data: co } = await supabase.from("companies").select("kpi_config").eq("id", companyId).maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    const end = today.slice(0, 7);
    const start = booksStartOf(co?.kpi_config)?.slice(0, 7) ?? monthsBetween("2000-01", end).slice(-conn.months_history)[0];
    const range = { from: `${start}-01`, to: `${end}-${String(new Date(Date.UTC(+end.slice(0, 4), +end.slice(5, 7), 0)).getUTCDate()).padStart(2, "0")}` };
    const name = `${conn.odoo_company_name ?? "Odoo"} (live sync)`;
    const inv = ((co?.kpi_config ?? {}) as Record<string, { rentalLocation?: string | null; locationTypes?: LocationTypes } | undefined>)[INVENTORY_KEY] ?? {};
    const rental = inv.rentalLocation ?? null;
    let total = step.total ?? 0, batch = step.batch ?? null, done = step.offset;
    let batches = step.batches;

    if (step.part === "ledger") {
      const { data: comp } = await supabase.from("companies").select("data_version").eq("id", companyId).maybeSingle();
      const { data: accRows, error: ae } = await supabase.from("source_accounts").select("code, name, class, odoo_id").eq("company_id", companyId).eq("version", comp?.data_version ?? 0).not("odoo_id", "is", null);
      if (ae) throw new DbError(ae);
      const accts = (accRows ?? []).map((a) => ({ odoo_id: a.odoo_id as number, code: a.code ?? "", name: a.name, cls: a.class as ClassKey }));
      // The books loaded now are not Odoo's (an upload since the last sync): no journal lines are read and none are
      // removed, so lines from that upload stay.
      if (step.offset === 0 && accts.length) {
        total = await countLedger(d, accts, range);
        // The synced months' journal lines replace those months only, when the last page is in: sales and expense lines
        // as staged saves, stock postings in a fresh batch for those months.
        const periods = monthsBetween(start, end);
        await clearLedger(supabase, companyId, periods, ["stock"]);
        const open = async (kind: StageKind) => {
          const r = await stageBegin(supabase, kind, { companyId, source: "ledger", periods, filename: name, report: { kind: "odoo" } });
          if (!r.ok) throw new Error(r.missing ? STAGE_UPDATE : r.error);
          return r.stage;
        };
        const st = await supabase.rpc("begin_stock_ledger_batch", { p_company: companyId, p_periods: periods, p_filename: name });
        batches = { sales: await open("sales"), expenses: await open("expenses"), stock: st.error ? null : (st.data as string) };
      }
      if (total && batches) {
        const p = await ledgerPage(d, accts, range, step.offset);
        const strip = <T extends { src?: unknown }>(ls: T[]) => ls.map(({ src, ...l }) => { void src; return l; });
        for (const [b, ls] of [[batches.sales, strip(p.sales)], [batches.expenses, strip(p.expenses)]] as const) {
          if (!b || !ls.length) continue;
          for (let i = 0; i < ls.length; i += 5000) { const r = await stageAdd(supabase, b, ls.slice(i, i + 5000)); if (!r.ok) throw new Error(r.error); }
        }
        if (batches.stock && p.stock.length) {
          const r = await supabase.rpc("add_stock_ledger_lines", { p_batch: batches.stock, p_lines: p.stock as unknown as Json });
          if (r.error) throw new DbError(r.error);
        }
      }
      done = Math.min(total, step.offset + PAGE.sales);
      if (done >= total && batches) {
        for (const b of [batches.sales, batches.expenses]) { if (!b) continue; const f = await stageFinish(supabase, b); if (!f.ok) throw new Error(f.error); }
      }
    } else if (step.part === "sales") {
      // Sales lines by product replace the uploaded sales files of the synced months only, when the last page is in.
      if (step.offset === 0) {
        total = await countPart(d, "sales", range);
        const r = await stageBegin(supabase, "sales", { companyId, source: "file", periods: monthsBetween(start, end), filename: name, report: { kind: "odoo" } });
        if (!r.ok) throw new Error(r.missing ? STAGE_UPDATE : r.error);
        batch = r.stage;
      }
      const lines = total ? await salesPage(d, range, step.offset) : [];
      for (let i = 0; i < lines.length; i += 5000) { const r = await stageAdd(supabase, batch!, lines.slice(i, i + 5000)); if (!r.ok) throw new Error(r.error); }
      done = Math.min(total, step.offset + PAGE.sales);
      if (done >= total && batch) { const f = await stageFinish(supabase, batch); if (!f.ok) throw new Error(f.error); }
    } else if (step.part === "moves" || step.part === "valuation") {
      const loc = await readLocations(d);
      if (step.offset === 0) {
        total = await countPart(d, step.part, range);
        const first = (await firstStockDay(d)) ?? today;
        const b = await supabase.rpc("begin_inventory_batch", { p_company: companyId, p_kind: step.part, p_periods: monthsBetween(first.slice(0, 7), end), p_filename: name, p_mode: "all", p_report: { kind: "odoo" } as Json });
        if (b.error) throw new DbError(b.error);
        batch = b.data as string;
      }
      const rows = total ? (step.part === "moves" ? await movesPage(d, range.to, step.offset, loc, rental) : await layersPage(d, range.to, step.offset, loc, rental)) : [];
      if (rows.length) {
        const r = await supabase.rpc(step.part === "moves" ? "add_stock_moves" : "add_stock_layers", { p_batch: batch!, p_rows: rows as unknown as Json });
        if (r.error) throw new DbError(r.error);
      }
      done = Math.min(total, step.offset + PAGE.stock);
      if (done >= total && batch) {
        const f = await supabase.rpc("finish_inventory_batch", { p_batch: batch });
        if (f.error) throw new DbError(f.error);
      }
      // Odoo's own location usage fills the company's location types (a person's choice is kept).
      if (step.offset === 0) await supabase.from("companies").update({ kpi_config: { ...((co?.kpi_config ?? {}) as Record<string, unknown>), [INVENTORY_KEY]: { ...inv, locationTypes: mergeLocationTypes(inv.locationTypes ?? {}, loc.types, "export") } } as Json }).eq("id", companyId);
    } else {
      const loc = await readLocations(d);
      const rows = await onHand(d, loc);
      total = rows.length;
      if (rows.length) {
        const b = await supabase.rpc("begin_inventory_batch", { p_company: companyId, p_kind: "onhand", p_periods: [end], p_filename: name, p_mode: "replace", p_report: { kind: "odoo" } as Json });
        if (b.error) throw new DbError(b.error);
        for (let i = 0; i < rows.length; i += 20_000) {
          const r = await supabase.rpc("set_stock_onhand", { p_batch: b.data as string, p_as_of: today, p_rows: rows.slice(i, i + 20_000) as unknown as Json });
          if (r.error) throw new DbError(r.error);
        }
      }
      done = total;
    }

    const label = PART_LABEL[step.part];
    const finished = done >= total;
    const nextPart = finished ? NEXT_PART[step.part] : step.part;
    const next: DetailStepInput | null = nextPart ? (finished ? { part: nextPart, offset: 0 } : { part: step.part, offset: done, total, batch, ...(batches ? { batches } : {}) }) : null;
    if (!next) {
      await release("ok", null);
      await audit(supabase, companyId, "sync", true, "sales lines, stock moves, stock valuation and stock on hand synced", total);
      revalidatePath(`/company/${companyId}`, "layout");
    }
    return { ok: true, data: { next, label, done, total } };
  } catch (e) {
    const why = safeError(e, "syncOdooDetail").slice(0, 500);
    await release("error", `Detail sync (${PART_LABEL[step.part]}): ${why}`);
    await audit(supabase, companyId, "sync", false, `detail (${PART_LABEL[step.part]}): ${why}`);
    return fail(e);
  }
}

/** Odoo's major version, checked. */
async function probeVersion(client: OdooClient): Promise<number> {
  const v = trust(Version, await client.version(), "version");
  return majorVersion(v.server_version_info, v.server_version);
}
