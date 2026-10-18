"use client";
import { CheckCircle2, ExternalLink, Loader2, PlugZap, RefreshCw, ShieldCheck, ShieldAlert, Unplug, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { disconnectOdoo, saveOdoo, syncOdooNow, testOdoo } from "@/app/company/[id]/settings/odoo-actions";
import type { OdooProbe } from "@/lib/odoo/sync";
import { cn } from "@/lib/cn";
import { mlabel } from "@/lib/engine";

/** History "everything since the books start": the sync never reads months before it. */
const ALL_MONTHS = 240;
const monthLabel = (day: string) => mlabel(day.slice(0, 7));

export interface OdooConn {
  url: string; db: string; login: string; odoo_company_id: number | null; odoo_company_name: string | null; include_branches: boolean;
  months_history: number; version: string | null; status: string; last_error: string | null; last_sync_at: string | null;
  has_key?: boolean; key_expires_on?: string | null;
}
export interface OdooLogRow { id: number; action: string; ok: boolean; detail: string | null; rows_read: number | null; at: string; who: string }

const ACTION: Record<string, string> = { test: "Test", save: "Saved", key_changed: "Key changed", key_cleared: "Key cleared", sync: "Sync", disconnect: "Disconnected", refused: "Refused" };
const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
const daysTo = (day: string) => Math.ceil((Date.parse(`${day}T00:00:00Z`) - Date.now()) / 86_400_000);

export function OdooPanel({ companyId, connection, hasData, booksStart = null, role = "editor", log = [], ready = true }: { companyId: string; connection: OdooConn | null; hasData: boolean; booksStart?: string | null; role?: "admin" | "editor"; log?: OdooLogRow[]; ready?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(connection?.url ?? "");
  const [db, setDb] = useState(connection?.db ?? "");
  const [login, setLogin] = useState(connection?.login ?? "");
  const [apiKey, setApiKey] = useState("");
  const [probe, setProbe] = useState<OdooProbe | null>(null);
  const [company, setCompany] = useState<number | null>(connection?.odoo_company_id ?? null);
  const [branches, setBranches] = useState(connection?.include_branches ?? false);
  const [months, setMonths] = useState(connection?.months_history ?? (booksStart ? ALL_MONTHS : 25));
  const [expires, setExpires] = useState(connection?.key_expires_on ?? "");
  const admin = role === "admin";
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string; detail?: string[] } | null>(connection?.status === "error" && connection.last_error ? { tone: "bad", text: connection.last_error } : null);
  const [pending, start] = useTransition();
  const [step, setStep] = useState<"idle" | "test" | "save" | "sync">("idle");
  const saved = Boolean(connection?.odoo_company_id);

  const run = (s: typeof step, f: () => Promise<void>) => { setStep(s); setMsg(null); start(async () => { await f(); setStep("idle"); }); };
  const test = () => run("test", async () => {
    const r = await testOdoo({ companyId, url, db, login, apiKey });
    if (!r.ok) { setMsg({ tone: "bad", text: r.error }); return; }
    setProbe(r.data);
    if (!company || !r.data.companies.some((c) => c.id === company)) setCompany(r.data.companies[0]?.id ?? null);
    const p = r.data;
    const safe = p.rights === "read" && p.user.companies.length === 1;
    setMsg({ tone: "ok", text: `Connected to Odoo ${p.version} as "${p.user.name}". ${safe ? "Read-only ✓ · one company ✓. " : ""}${admin ? "Choose the company, then save." : "An admin saves the connection."}` });
  });
  const save = () => run("save", async () => {
    const name = probe?.companies.find((c) => c.id === company)?.name ?? connection?.odoo_company_name ?? "";
    const r = await saveOdoo({ companyId, url, db, login, apiKey, odooCompanyId: company!, odooCompanyName: name, includeBranches: branches, months, version: probe?.version, keyExpiresOn: expires || null });
    if (!r.ok) { setMsg({ tone: "bad", text: r.error }); return; }
    setMsg({ tone: "ok", text: "Connection saved. Run a sync to load the data." });
    setApiKey("");
    router.refresh();
  });
  const disconnect = () => {
    if (!confirm("Remove the Odoo connection and its stored key? Synced data stays; syncing stops until the connection is saved again.")) return;
    run("save", async () => {
      const r = await disconnectOdoo(companyId);
      setMsg(r.ok ? { tone: "ok", text: "Disconnected. The stored key was deleted. Also delete the API key in Odoo (Account Security) if it is no longer needed." } : { tone: "bad", text: r.error });
      router.refresh();
    });
  };
  const sync = () => {
    if (hasData && !confirm("Syncing replaces the company's current financial data with the data from Odoo. Continue?")) return;
    run("sync", async () => {
      const r = await syncOdooNow(companyId);
      if (!r.ok) { setMsg({ tone: "bad", text: r.error }); router.refresh(); return; }
      const d = r.data;
      setMsg({ tone: "ok", text: `Synced ${d.months} months and ${d.accounts} accounts from Odoo ${d.version}.`, detail: [`Method: ${d.method}`, `Trial balance check: ${d.tb === 0 ? "balanced" : d.tb}`, ...(d.unmapped.length ? [`Not mapped: ${d.unmapped.slice(0, 6).join(", ")}`] : []), ...(d.offBalance?.length ? [`Off-balance but with entries (left out; map to Cash if real): ${d.offBalance.slice(0, 6).join(", ")}`] : []), d.detail ?? "Sales and Expenses were filled from the same entries."] });
      router.refresh();
    });
  };

  const field = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand";
  const left = connection?.key_expires_on ? daysTo(connection.key_expires_on) : null;
  if (!ready) return <p className="rounded bg-amber/15 px-4 py-3 text-sm" data-testid="odoo-not-ready">The Odoo connection is closed until the site owner applies the database security update for it (migration 0025).</p>;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div>
        {left !== null && left <= 14 && (
          <div className="mb-4 rounded bg-amber/15 px-4 py-2.5 text-sm" data-testid="odoo-key-expiry">{left < 0 ? "The Odoo API key has expired." : `The Odoo API key expires in ${left} day${left === 1 ? "" : "s"}.`} Make a new one in Odoo and {admin ? "save it here" : "ask an admin to save it"}.</div>
        )}
        {saved && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md bg-band px-4 py-3 text-sm">
            <PlugZap className="h-5 w-5 text-brand-d" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{connection!.odoo_company_name} · {connection!.url.replace("https://", "")}</div>
              <div className="text-xs text-mute">{connection!.last_sync_at ? `Last synced ${new Date(connection!.last_sync_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : "Not synced yet"} · {connection!.months_history === ALL_MONTHS ? "since the books start" : `${connection!.months_history} months`}{connection!.version ? ` · Odoo ${connection!.version}` : ""}</div>
            </div>
            <button onClick={sync} disabled={pending} className="flex items-center gap-1.5 rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-60" data-testid="odoo-sync">
              {step === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{step === "sync" ? "Syncing…" : "Sync now"}
            </button>
            {admin && <button onClick={disconnect} disabled={pending} className="flex items-center gap-1.5 rounded border border-line px-3 py-2 text-mute hover:text-red disabled:opacity-60" data-testid="odoo-disconnect"><Unplug className="h-4 w-4" />Disconnect</button>}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="label mb-1 block">Odoo URL</span><input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://yourcompany.odoo.com" /></label>
          <label><span className="label mb-1 block">Database</span><input className={field} value={db} onChange={(e) => setDb(e.target.value)} placeholder="yourcompany" /></label>
          <label><span className="label mb-1 block">Login (email)</span><input className={field} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" /></label>
          <label className="sm:col-span-2"><span className="label mb-1 block">API key</span><input className={field} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={saved ? "•••••••• (saved — leave blank to keep)" : "Paste the API key"} autoComplete="new-password" /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={test} disabled={pending || !url || !db || !login} className="flex items-center gap-1.5 rounded border border-brand-d px-4 py-2 font-medium text-brand-d disabled:opacity-50">
            {step === "test" && <Loader2 className="h-4 w-4 animate-spin" />}Test connection
          </button>
        </div>
        {probe && (
          <div className={cn("mt-5 flex gap-2 rounded px-3 py-2.5 text-sm", probe.rights === "read" ? "bg-green-bg text-green-d" : "bg-amber/15")} data-testid="odoo-rights">
            {probe.rights === "read" ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>Odoo user <b>{probe.user.name}</b> · {probe.rights === "read" ? "cannot create, change or delete accounting records" : probe.rights === "write" ? `can change ${probe.canChange.join(", ")} (allowed; iReport only reads, keep the key private)` : "rights not confirmed by Odoo (allowed; iReport only reads)"} · sees {probe.user.companies.length} compan{probe.user.companies.length === 1 ? "y" : "ies"}</div>
          </div>
        )}
        {admin && (probe || saved) && (
          <div className="mt-6 grid gap-4 rounded-md border border-line p-4 sm:grid-cols-3">
            <label className="sm:col-span-3"><span className="label mb-1 block">Odoo company</span>
              <select className={field} value={company ?? ""} onChange={(e) => setCompany(Number(e.target.value))}>
                {(probe?.companies ?? (connection?.odoo_company_id ? [{ id: connection.odoo_company_id, name: connection.odoo_company_name ?? "" }] : [])).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label><span className="label mb-1 block">History</span>
              <select className={field} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {booksStart && <option value={ALL_MONTHS}>Everything since the books start ({monthLabel(booksStart)})</option>}
                {[13, 25, 37, 49].map((m) => <option key={m} value={m}>{m - 1} months + current</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={branches} onChange={(e) => setBranches(e.target.checked)} /> Include branches (child companies)</label>
            <label><span className="label mb-1 block">API key expires on (optional)</span><input type="date" className={field} value={expires} onChange={(e) => setExpires(e.target.value)} data-testid="odoo-expires" /></label>
            <div className="sm:col-span-3">
              <button onClick={save} disabled={pending || !company} data-testid="odoo-save" className="rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50">{step === "save" ? "Saving…" : "Save connection"}</button>
            </div>
          </div>
        )}
        {msg && (
          <div className={cn("mt-5 flex gap-2 rounded px-3 py-2.5 text-sm", msg.tone === "ok" ? "bg-green-bg text-green-d" : "bg-red-bg text-red")} role="status">
            {msg.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>{msg.text}{msg.detail && <ul className="mt-1 text-xs text-ink/70">{msg.detail.map((d) => <li key={d}>{d}</li>)}</ul>}</div>
          </div>
        )}
        {log.length > 0 && (
          <div className="mt-8" data-testid="odoo-log">
            <div className="label mb-2">Odoo connection log (last {log.length}, cannot be edited)</div>
            <table className="w-full text-xs">
              <tbody>{log.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap py-1.5 pe-3 text-mute">{fmtTime(l.at)}</td>
                  <td className={cn("whitespace-nowrap py-1.5 pe-3 font-medium", l.ok ? "" : "text-red")}>{ACTION[l.action] ?? l.action}{l.ok ? "" : " ✗"}</td>
                  <td className="py-1.5 pe-3">{l.who}</td>
                  <td className="py-1.5 text-mute">{l.detail}{l.rows_read ? ` · ${l.rows_read.toLocaleString("en-GB")} rows` : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <aside className="rounded-lg bg-band p-4 text-[13px]">
        <div className="label mb-2">How to connect</div>
        <ol className="list-decimal space-y-2 ps-4">
          <li>Any Odoo user with API access works. Safest: a separate user, e.g. <b>iReport Reader</b>, with Accounting <b>Read-only</b> access and only your company in <b>Allowed companies</b>.</li>
          <li>Sign in as that user: <b>avatar → My Profile → Account Security → New API Key</b>. Give it an end date (e.g. 90 days). Copy the key.</li>
          <li>The database name is shown on the Odoo login page or under <b>Settings → Developer tools → About</b>.</li>
          <li>Test: iReport shows what the user may do in Odoo. Any user with API access can connect; iReport only ever reads. A read-only user is still the safest choice.</li>
        </ol>
        <p className="mt-3 text-mute">Odoo Online (SaaS) allows the external API on the <b>Custom</b> plan; Odoo.sh and self-hosted Odoo 13–18 work out of the box. The server must be reachable on the internet.</p>
        <a className="mt-3 inline-flex items-center gap-1 text-brand-d hover:underline" href="https://www.odoo.com/documentation/18.0/developer/reference/external_api.html" target="_blank" rel="noreferrer">Odoo external API docs <ExternalLink className="h-3 w-3" /></a>
        <p className="mt-3 text-xs text-mute">Only reading requests are ever sent, for accounting records only. The API key is encrypted (AES-256), can&apos;t be read back by anyone, and is only decrypted on the server during a test or sync. Only an admin can save or remove the connection; every action is logged. To stop access at once, delete the key in Odoo or press Disconnect.</p>
      </aside>
    </div>
  );
}
