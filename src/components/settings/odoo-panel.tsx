"use client";
import { CheckCircle2, ExternalLink, Loader2, PlugZap, RefreshCw, ShieldCheck, ShieldAlert, Unplug, XCircle } from "lucide-react";
import { DownloadAll } from "@/components/ui/download-all";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { disconnectOdoo, rekeyOdoo, saveOdoo, setOdooNightly, stopOdooSync, syncOdooDetail, syncOdooNow, testOdoo, type DetailStepInput } from "@/app/company/[id]/settings/odoo-actions";
import { copyCompanySettings } from "@/app/company/[id]/settings/actions";
import type { OdooProbe } from "@/lib/odoo/sync";
import { cn } from "@/lib/cn";
import { mlabel } from "@/lib/engine";
import { useT } from "@/lib/i18n/use-t";
import type { Lang } from "@/lib/i18n";

/** History "everything since the books start": the sync never reads months before it. */
const ALL_MONTHS = 240;

export interface OdooConn {
  url: string; db: string; login: string; odoo_company_id: number | null; odoo_company_name: string | null; include_branches: boolean;
  months_history: number; version: string | null; status: string; last_error: string | null; last_sync_at: string | null;
  has_key?: boolean; key_expires_on?: string | null;
}
export interface OdooNightly { nightly: boolean; last_run_at: string | null; last_ok: boolean | null; last_error: string | null; next_run_at: string | null }
export interface OdooLogRow { id: number; action: string; ok: boolean; detail: string | null; rows_read: number | null; at: string; who: string }

const locale = (lang: Lang) => (lang === "ar" ? "ar-EG-u-nu-latn" : "en-GB");
const fmtTime = (iso: string, lang: Lang = "en") => new Date(iso).toLocaleString(locale(lang), { dateStyle: "medium", timeStyle: "short" });
const daysTo = (day: string) => Math.ceil((Date.parse(`${day}T00:00:00Z`) - Date.now()) / 86_400_000);

export function OdooPanel({ companyId, connection, hasData, booksStart = null, role = "editor", log = [], ready = true, others = [], mapCount = 0, keyOld = false, nightly = null }: { nightly?: OdooNightly | null; companyId: string; connection: OdooConn | null; hasData: boolean; booksStart?: string | null; role?: "admin" | "editor"; log?: OdooLogRow[]; ready?: boolean; others?: { id: string; name: string }[]; mapCount?: number; keyOld?: boolean }) {
  const router = useRouter();
  const T = useT();
  const t = T.d.dat.odoo;
  const monthLabel = (day: string) => (T.lang === "ar" ? T.ml(day.slice(0, 7)) : mlabel(day.slice(0, 7)));
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
  const [from, setFrom] = useState(others[0]?.id ?? "");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string; detail?: string[]; accounts?: { unmapped: string[]; offBalance: string[] } } | null>(connection?.status === "error" && connection.last_error ? { tone: "bad", text: connection.last_error } : null);
  const [pending, start] = useTransition();
  const [step, setStep] = useState<"idle" | "test" | "save" | "sync">("idle");
  const [progress, setProgress] = useState<string | null>(null);
  const saved = Boolean(connection?.odoo_company_id);

  const run = (s: typeof step, f: () => Promise<void>) => { setStep(s); setMsg(null); start(async () => { await f(); setStep("idle"); }); };
  const rekey = () => run("save", async () => {
    const r = await rekeyOdoo(companyId);
    setMsg(r.ok ? { tone: "ok", text: t.rekeyed } : { tone: "bad", text: r.error });
    if (r.ok) router.refresh();
  });
  const test = () => run("test", async () => {
    const r = await testOdoo({ companyId, url, db, login, apiKey });
    if (!r.ok) { setMsg({ tone: "bad", text: r.error }); return; }
    setProbe(r.data);
    if (!company || !r.data.companies.some((c) => c.id === company)) setCompany(r.data.companies[0]?.id ?? null);
    const p = r.data;
    const safe = p.rights === "read" && p.user.companies.length === 1;
    setMsg({ tone: "ok", text: t.connected(p.version, p.user.name, safe, admin) });
  });
  const save = () => run("save", async () => {
    const name = probe?.companies.find((c) => c.id === company)?.name ?? connection?.odoo_company_name ?? "";
    const r = await saveOdoo({ companyId, url, db, login, apiKey, odooCompanyId: company!, odooCompanyName: name, includeBranches: branches, months, version: probe?.version, keyExpiresOn: expires || null });
    if (!r.ok) { setMsg({ tone: "bad", text: r.error }); return; }
    setMsg({ tone: "ok", text: t.saved });
    setApiKey("");
    router.refresh();
  });
  const copy = () => {
    const name = others.find((o) => o.id === from)?.name ?? "";
    if (!confirm(t.copyQ(name))) return;
    run("save", async () => {
      const r = await copyCompanySettings(companyId, from);
      setMsg(r.ok ? { tone: "ok", text: t.copied(r.classes, !!r.profile, name) } : { tone: "bad", text: r.error });
      router.refresh();
    });
  };
  const disconnect = () => {
    if (!confirm(t.disconnectQ)) return;
    run("save", async () => {
      const r = await disconnectOdoo(companyId);
      setMsg(r.ok ? { tone: "ok", text: t.disconnected } : { tone: "bad", text: r.error });
      router.refresh();
    });
  };
  /** Sales lines by product and the stock records, step by step (each step one page from Odoo). */
  const detail = async (chained = false): Promise<string | null> => {
    // Right after the balances, the first step continues their lock (one Sync now counts once).
    let at: DetailStepInput | undefined = chained ? { part: "ledger", offset: 0, chained: true } : undefined;
    for (let i = 0; i < 2000; i++) {
      const r = await syncOdooDetail(companyId, at);
      if (!r.ok) return r.error;
      setProgress(t.progress(r.data.label, r.data.done.toLocaleString("en-GB"), r.data.total.toLocaleString("en-GB")));
      if (!r.data.next) return null;
      at = r.data.next;
    }
    return t.tooMany;
  };
  const stop = () => run("save", async () => {
    const r = await stopOdooSync(companyId);
    setMsg(r.ok ? { tone: "ok", text: t.stopped } : { tone: "bad", text: r.error });
    router.refresh();
  });
  const syncDetail = () => run("sync", async () => {
    const err = await detail();
    setProgress(null);
    setMsg(err ? { tone: "bad", text: err } : { tone: "ok", text: t.detailDone });
    router.refresh();
  });
  const sync = () => {
    if (hasData && !confirm(t.replaceQ)) return;
    run("sync", async () => {
      setProgress(t.balances);
      const r = await syncOdooNow(companyId);
      if (!r.ok) { setProgress(null); setMsg({ tone: "bad", text: r.error }); router.refresh(); return; }
      const d = r.data;
      const err = await detail(true);
      setProgress(null);
      setMsg({ tone: err ? "bad" : "ok", text: t.synced(d.months, d.accounts, d.version, err), detail: [t.method(d.method), t.tbCheck(d.tb), ...(d.unmapped.length ? [t.notMapped(d.unmapped.slice(0, 6).join(", "))] : []), ...(d.offBalance?.length ? [t.offBalance(d.offBalance.slice(0, 6).join(", "))] : []), ...(d.detail ? [d.detail] : [])], ...(d.unmapped.length > 6 || (d.offBalance?.length ?? 0) > 6 ? { accounts: { unmapped: d.unmapped, offBalance: d.offBalance ?? [] } } : {}) });
      router.refresh();
    });
  };

  const field = "w-full rounded border border-line px-3 py-2 outline-none focus:border-brand";
  const left = connection?.key_expires_on ? daysTo(connection.key_expires_on) : null;
  if (!ready) return <p className="rounded bg-amber/15 px-4 py-3 text-sm" data-testid="odoo-not-ready">{t.notReady}</p>;
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <div>
        {left !== null && left <= 14 && (
          <div className="mb-4 rounded bg-amber/15 px-4 py-2.5 text-sm" data-testid="odoo-key-expiry">{left < 0 ? t.expired : t.expiresIn(left)}{t.makeNew(admin)}</div>
        )}
        {keyOld && admin && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded bg-amber/15 px-4 py-2.5 text-sm" data-testid="odoo-key-old">
            <span className="min-w-0 flex-1">{t.keyOld}</span>
            <button onClick={rekey} disabled={pending} className="rounded border border-brand-d px-3 py-1.5 text-brand-d disabled:opacity-60" data-testid="odoo-rekey">{t.rekey}</button>
          </div>
        )}
        {saved && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-md bg-band px-4 py-3 text-sm">
            <PlugZap className="h-5 w-5 text-brand-d" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{connection!.odoo_company_name} · {connection!.url.replace("https://", "")}</div>
              <div className="text-xs text-mute">{connection!.last_sync_at ? t.lastSynced(new Date(connection!.last_sync_at).toLocaleString(locale(T.lang), { dateStyle: "medium", timeStyle: "short" })) : t.notSynced} · {connection!.months_history === ALL_MONTHS ? t.sinceStart : t.months(connection!.months_history)}{connection!.version ? ` · Odoo ${connection!.version}` : ""}</div>
            </div>
            <button onClick={sync} disabled={pending} className="flex items-center gap-1.5 rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-60" data-testid="odoo-sync">
              {step === "sync" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{step === "sync" ? (progress ?? t.syncing) : t.syncNow}
            </button>
            {connection?.status === "syncing" && !pending && <button onClick={stop} className="rounded border border-red px-3 py-2 text-sm text-red" data-testid="odoo-stop">{t.stop}</button>}
            <button onClick={syncDetail} disabled={pending} className="rounded border border-brand-d px-3 py-2 text-sm text-brand-d disabled:opacity-60" data-testid="odoo-sync-detail">{t.detailOnly}</button>
            {admin && <button onClick={disconnect} disabled={pending} className="flex items-center gap-1.5 rounded border border-line px-3 py-2 text-mute hover:text-red disabled:opacity-60" data-testid="odoo-disconnect"><Unplug className="h-4 w-4" />{t.disconnect}</button>}
          </div>
        )}
        {saved && <NightlyToggle companyId={companyId} job={nightly} />}
        {others.length > 0 && (
          <div className={cn("mb-5 rounded-md border px-4 py-3 text-sm", mapCount === 0 ? "border-amber bg-amber/10" : "border-line")} data-testid="odoo-copy-settings">
            <div className="font-medium">{t.copyTitle}</div>
            <p className="mt-0.5 text-xs text-mute">{mapCount === 0 ? t.noClasses : ""}{t.copyText}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <select aria-label={t.copyFrom} className="rounded border border-line px-2 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="odoo-copy-from">
                {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <button onClick={copy} disabled={pending || !from} className="rounded border border-brand-d px-3 py-1.5 font-medium text-brand-d disabled:opacity-50" data-testid="odoo-copy">{t.copyBtn}</button>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="label mb-1 block">{t.url}</span><input className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t.urlPh} /></label>
          <label><span className="label mb-1 block">{t.db}</span><input className={field} value={db} onChange={(e) => setDb(e.target.value)} placeholder={t.dbPh} /></label>
          <label><span className="label mb-1 block">{t.login}</span><input className={field} value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="off" /></label>
          <label className="sm:col-span-2"><span className="label mb-1 block">{t.key}</span><input className={field} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={saved ? t.keySaved : t.keyPaste} autoComplete="new-password" /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={test} disabled={pending || !url || !db || !login} className="flex items-center gap-1.5 rounded border border-brand-d px-4 py-2 font-medium text-brand-d disabled:opacity-50">
            {step === "test" && <Loader2 className="h-4 w-4 animate-spin" />}{t.test}
          </button>
        </div>
        {probe && (
          <div className={cn("mt-5 flex gap-2 rounded px-3 py-2.5 text-sm", probe.rights === "read" ? "bg-green-bg text-green-d" : "bg-amber/15")} data-testid="odoo-rights">
            {probe.rights === "read" ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>{t.user} <b>{probe.user.name}</b> · {probe.rights === "read" ? t.readOnly : probe.rights === "write" ? t.canChange(probe.canChange.join(", ")) : t.notConfirmed} · {t.sees(probe.user.companies.length)}</div>
          </div>
        )}
        {admin && (probe || saved) && (
          <div className="mt-6 grid gap-4 rounded-md border border-line p-4 sm:grid-cols-3">
            <label className="sm:col-span-3"><span className="label mb-1 block">{t.company}</span>
              <select className={field} value={company ?? ""} onChange={(e) => setCompany(Number(e.target.value))}>
                {(probe?.companies ?? (connection?.odoo_company_id ? [{ id: connection.odoo_company_id, name: connection.odoo_company_name ?? "" }] : [])).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label><span className="label mb-1 block">{t.history}</span>
              <select className={field} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {booksStart && <option value={ALL_MONTHS}>{t.everything(monthLabel(booksStart))}</option>}
                {[13, 25, 37, 49].map((m) => <option key={m} value={m}>{t.monthsPlus(m - 1)}</option>)}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={branches} onChange={(e) => setBranches(e.target.checked)} /> {t.branches}</label>
            <label><span className="label mb-1 block">{t.expires}</span><input type="date" className={field} value={expires} onChange={(e) => setExpires(e.target.value)} data-testid="odoo-expires" /></label>
            <div className="sm:col-span-3">
              <button onClick={save} disabled={pending || !company} data-testid="odoo-save" className="rounded bg-brand-d px-4 py-2 font-medium text-white disabled:opacity-50">{step === "save" ? t.saving : t.save}</button>
            </div>
          </div>
        )}
        {msg && (
          <div className={cn("mt-5 flex gap-2 rounded px-3 py-2.5 text-sm", msg.tone === "ok" ? "bg-green-bg text-green-d" : "bg-red-bg text-red")} role="status">
            {msg.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <div>{msg.text}{msg.detail && <ul className="mt-1 text-xs text-ink/70">{msg.detail.map((d) => <li key={d}>{d}</li>)}</ul>}
              {msg.accounts && <div className="mt-2"><DownloadAll name="odoo accounts to look at" total={msg.accounts.unmapped.length + msg.accounts.offBalance.length} testId="odoo-accounts-download"
                sheets={() => [{ name: "Accounts", rows: [["Account", "Why"], ...msg.accounts!.unmapped.map((a) => [a, "Not mapped to a class"]), ...msg.accounts!.offBalance.map((a) => [a, "Off-balance account with entries"])] }]} /></div>}</div>
          </div>
        )}
        {log.length > 0 && (
          <div className="mt-8" data-testid="odoo-log">
            <div className="label mb-2">{t.log(log.length)}</div>
            <table className="w-full text-xs">
              <tbody>{log.map((l) => (
                <tr key={l.id} className="border-t border-line align-top">
                  <td className="whitespace-nowrap py-1.5 pe-3 text-mute">{fmtTime(l.at, T.lang)}</td>
                  <td className={cn("whitespace-nowrap py-1.5 pe-3 font-medium", l.ok ? "" : "text-red")}>{t.action[l.action] ?? l.action}{l.ok ? "" : " ✗"}</td>
                  <td className="py-1.5 pe-3">{l.who}</td>
                  <td className="py-1.5 text-mute">{l.detail}{l.rows_read ? t.rows(l.rows_read.toLocaleString("en-GB")) : ""}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
      <aside className="rounded-lg bg-band p-4 text-[13px]">
        <div className="label mb-2">{t.howTitle}</div>
        <ol className="list-decimal space-y-2 ps-4">
          <li>{t.how1[0]}<b>iReport Reader</b>{t.how1[1]}<b>{t.how1[2]}</b>{t.how1[3]}<b>{t.how1[4]}</b>{t.how1[5]}</li>
          <li>{t.how2[0]}<b>{t.how2[1]}</b>{t.how2[2]}</li>
          <li>{t.how3[0]}<b>{t.how3[1]}</b>{t.how3[2]}</li>
          <li>{t.how4}</li>
        </ol>
        <p className="mt-3 text-mute">{t.saas[0]}<b>Custom</b>{t.saas[1]}</p>
        <p className="mt-2 rounded border border-line bg-band px-3 py-2 text-mute" data-testid="odoo-no-custom">{t.noCustom}</p>
        <a className="mt-3 inline-flex items-center gap-1 text-brand-d hover:underline" href="https://www.odoo.com/documentation/18.0/developer/reference/external_api.html" target="_blank" rel="noreferrer">{t.docs} <ExternalLink className="h-3 w-3" /></a>
        <p className="mt-3 text-xs text-mute">{t.security}</p>
      </aside>
    </div>
  );
}

/** Nightly sync on the server (0046): runs as the editor who turns it on; shows the last run and any reason it stopped. */
function NightlyToggle({ companyId, job }: { companyId: string; job: OdooNightly | null }) {
  const router = useRouter();
  const T = useT();
  const t = T.d.dat.odoo;
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const on = !!job?.nightly;
  const toggle = () => start(async () => {
    setErr(null);
    const r = await setOdooNightly(companyId, !on);
    if (!r.ok) setErr(r.error); else router.refresh();
  });
  return (
    <div className="mb-5 rounded-md border border-line px-4 py-3 text-sm" data-testid="odoo-nightly">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={on} onChange={toggle} disabled={pending} data-testid="odoo-nightly-toggle" />
        {t.nightly}
      </label>
      <p className="mt-0.5 text-xs text-mute">{t.nightlySub}</p>
      {job?.last_run_at && (
        <p className={cn("mt-1 text-xs", job.last_ok ? "text-green-d" : "text-red")} data-testid="odoo-nightly-last">
          {t.lastNight(fmtTime(job.last_run_at, T.lang), !!job.last_ok, job.last_error)}
        </p>
      )}
      {!on && !job?.last_run_at && job?.last_error && <p className="mt-1 text-xs text-red" data-testid="odoo-nightly-last">{job.last_error}</p>}
      {err && <p className="mt-1 text-xs text-red" role="alert">{err}</p>}
    </div>
  );
}
