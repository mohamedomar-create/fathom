"use client";
import { CheckCircle2, ExternalLink, Loader2, PlugZap, RefreshCw, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveOdoo, syncOdooNow, testOdoo } from "@/app/company/[id]/settings/odoo-actions";
import type { OdooProbe } from "@/lib/odoo/sync";
import { cn } from "@/lib/cn";

export interface OdooConn {
  url: string; db: string; login: string; odoo_company_id: number | null; odoo_company_name: string | null; include_branches: boolean;
  months_history: number; version: string | null; status: string; last_error: string | null; last_sync_at: string | null;
}

export function OdooPanel({ companyId, connection, hasData }: { companyId: string; connection: OdooConn | null; hasData: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState(connection?.url ?? "");
  const [db, setDb] = useState(connection?.db ?? "");
  const [login, setLogin] = useState(connection?.login ?? "");
  const [apiKey, setApiKey] = useState("");
  const [probe, setProbe] = useState<OdooProbe | null>(null);
  const [company, setCompany] = useState<number | null>(connection?.odoo_company_id ?? null);
  const [branches, setBranches] = useState(connection?.include_branches ?? false);
  const [months, setMonths] = useState(connection?.months_history ?? 25);
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
    setMsg({ tone: "ok", text: `Connected to Odoo ${r.data.version} as user #${r.data.uid}. Choose the company to analyse, then save.` });
  });
  const save = () => run("save", async () => {
    const name = probe?.companies.find((c) => c.id === company)?.name ?? connection?.odoo_company_name ?? "";
    const r = await saveOdoo({ companyId, url, db, login, apiKey, odooCompanyId: company!, odooCompanyName: name, includeBranches: branches, months, version: probe?.version });
    if (!r.ok) { setMsg({ tone: "bad", text: r.error }); return; }
    setMsg({ tone: "ok", text: "Connection saved. Run a sync to load the data." });
    setApiKey("");
    router.refresh();
  });
  const sync = () => {
    if (hasData && !confirm("Syncing replaces the company's current financial data with the data from Odoo. Continue?")) return;
    run("sync", async () => {
      const r = await syncOdooNow(companyId);
      if (!r.ok) { setMsg({ tone: "bad", text: r.error }); router.refresh(); return; }
      const d = r.data;
      setMsg({ tone: "ok", text: `Synced ${d.months} months and ${d.accounts} accounts from Odoo ${d.version}.`, detail: [`Method: ${d.method}`, `Trial balance check: ${d.tb === 0 ? "balanced" : d.tb}`, ...(d.unmapped.length ? [`Not mapped: ${d.unmapped.slice(0, 6).join(", ")}`] : [])] });
      router.refresh();
    });
  };

  const field = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand";
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div>
        {saved && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md bg-band px-4 py-3 text-sm">
            <PlugZap className="h-5 w-5 text-brand-d" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{connection!.odoo_company_name} · {connection!.url.replace("https://", "")}</div>
              <div className="text-xs text-mute">{connection!.last_sync_at ? `Last synced ${new Date(connection!.last_sync_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : "Not synced yet"} · {connection!.months_history} months{connection!.version ? ` · Odoo ${connection!.version}` : ""}</div>
            </div>
            <button onClick={sync} disabled={pending} className="flex items-center gap-1.5 rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-60" data-testid="odoo-sync">
              {step === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{step === "sync" ? "Syncing…" : "Sync now"}
            </button>
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
        {(probe || saved) && (
          <div className="mt-6 grid gap-4 rounded-md border border-line p-4 sm:grid-cols-3">
            <label className="sm:col-span-3"><span className="label mb-1 block">Odoo company</span>
              <select className={field} value={company ?? ""} onChange={(e) => setCompany(Number(e.target.value))}>
                {(probe?.companies ?? (connection?.odoo_company_id ? [{ id: connection.odoo_company_id, name: connection.odoo_company_name ?? "" }] : [])).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label><span className="label mb-1 block">History</span>
              <select className={field} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {[13, 25, 37, 49].map((m) => <option key={m} value={m}>{m - 1} months + current</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm sm:col-span-2"><input type="checkbox" checked={branches} onChange={(e) => setBranches(e.target.checked)} /> Include branches (child companies)</label>
            <div className="sm:col-span-3">
              <button onClick={save} disabled={pending || !company} className="rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50">{step === "save" ? "Saving…" : "Save connection"}</button>
            </div>
          </div>
        )}
        {msg && (
          <div className={cn("mt-5 flex gap-2 rounded px-3 py-2.5 text-sm", msg.tone === "ok" ? "bg-green-bg text-green-d" : "bg-red-bg text-red")} role="status">
            {msg.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>{msg.text}{msg.detail && <ul className="mt-1 text-xs text-ink/70">{msg.detail.map((d) => <li key={d}>{d}</li>)}</ul>}</div>
          </div>
        )}
      </div>
      <aside className="rounded-lg bg-band p-4 text-[13px]">
        <div className="label mb-2">How to connect</div>
        <ol className="list-decimal space-y-2 pl-4">
          <li>In Odoo, open your user: <b>Settings → Users → (you) → Account Security → New API Key</b>. Copy the key.</li>
          <li>The database name is shown on the Odoo login page or under <b>Settings → Developer tools → About</b>.</li>
          <li>Use a user with accounting read access. Only posted entries are read; nothing is written to Odoo.</li>
        </ol>
        <p className="mt-3 text-mute">Odoo Online (SaaS) allows the external API on the <b>Custom</b> plan; Odoo.sh and self-hosted Odoo 13–18 work out of the box. The server must be reachable on the internet.</p>
        <a className="mt-3 inline-flex items-center gap-1 text-brand-d hover:underline" href="https://www.odoo.com/documentation/18.0/developer/reference/external_api.html" target="_blank" rel="noreferrer">Odoo external API docs <ExternalLink className="h-3 w-3" /></a>
        <p className="mt-3 text-xs text-mute">The API key is encrypted (AES-256) before it is stored and is only decrypted on the server during a sync.</p>
      </aside>
    </div>
  );
}
