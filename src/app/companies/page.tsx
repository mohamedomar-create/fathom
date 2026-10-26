import { SchemaGate } from "@/components/shell/schema-gate";
import Link from "next/link";
import { BarChart3, Database, FileText, Settings, Upload, Wallet } from "lucide-react";
import { modeOf } from "@/lib/company/mode";
import { money, pct } from "@/lib/engine";
import { loadPortfolio } from "@/lib/company/portfolio";
import { AppBar } from "@/components/shell/app-bar";
import { Sparkline } from "@/components/charts/spark";
import { AddCompany } from "./add-company";
import { PendingInvites } from "./pending-invites";
import { MfaBanner } from "@/components/auth/mfa-banner";
import { getDict, getLang } from "@/lib/i18n/server";
import { periodLabel, type Dict } from "@/lib/i18n";

export async function generateMetadata() { return { title: (await getDict()).shell.companies }; }

function ago(iso: string | null, t: Dict["home"]) {
  if (!iso) return t.never;
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1 / 24) return t.justNow;
  if (d < 1) return t.hoursAgo(Math.round(d * 24));
  return t.daysAgo(Math.round(d));
}

export default async function CompaniesPage() {
  return <SchemaGate><CompaniesPageInner /></SchemaGate>;
}

async function CompaniesPageInner() {
  const { items, orgs, email, invites } = await loadPortfolio();
  const org = orgs[0];
  const dict = await getDict();
  const t = dict.home;
  const cashT = dict.cash;
  const lang = await getLang();
  return (
    <>
      <AppBar email={email} orgName={org?.name} isAdmin={orgs.some((o) => o.role === "admin")} active="companies" />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-8">
        <MfaBanner />
        <PendingInvites invites={invites} />
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label">{org?.name ?? t.yourOrg}</div>
            <h1 className="text-3xl font-light">{t.companies(items.length)}</h1>
          </div>
          {orgs.some((o) => o.role !== "viewer") && <AddCompany orgs={orgs.filter((o) => o.role !== "viewer")} />}
        </div>
        {!items.length && (
          <div className="rounded-lg border border-dashed border-line px-6 py-16 text-center">
            <h2 className="text-xl font-light">{t.addFirst}</h2>
            <p className="mx-auto mt-2 max-w-md text-mute">{t.addFirstText}</p>
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2" data-testid="company-cards">
          {items.map(({ company: c, months, analysis: a }) => {
            const rev = months.slice(-12).map((m) => (m.pl.revenue ?? 0));
            const score = a && a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : null;
            const risks = a?.findings.filter((f) => f.kind === "risk").length ?? 0;
            // A small business on the cash book: its own pages, nothing from the full system.
            if (modeOf(c.kpi_config) === "simple") return (
              <div key={c.id} className="fade-up rounded-lg border border-line bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:shadow-md" data-testid="cash-card">
                <Link href={`/cash/${c.id}`} className="block truncate text-lg font-medium hover:underline">{c.name}</Link>
                <div className="text-xs text-mute">{cashT.tag}</div>
                <div className="mt-4 flex gap-2 border-t border-line pt-3 text-sm">
                  <Link href={`/cash/${c.id}`} className="flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-band"><Wallet className="h-4 w-4 text-brand-d" />{cashT.nav[""]}</Link>
                  <Link href={`/cash/${c.id}/upload`} className="flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-band"><Upload className="h-4 w-4 text-brand-d" />{cashT.nav.upload}</Link>
                  <Link href={`/cash/${c.id}/settings`} className="ms-auto flex items-center gap-1.5 rounded px-2.5 py-1 text-mute hover:bg-band"><Settings className="h-4 w-4" />{cashT.nav.settings}</Link>
                </div>
              </div>
            );
            return (
              <div key={c.id} className="fade-up rounded-lg border border-line bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/company/${c.id}/summary`} className="block truncate text-lg font-medium hover:underline">{c.name}</Link>
                    <div className="text-xs text-mute">{t.updated(ago(c.last_synced_at, t))} · {t.source[c.source] ?? c.source}</div>
                  </div>
                  {score !== null && (
                    <div className="text-end">
                      <div className={`text-2xl font-light ${score >= 60 ? "text-green-d" : "text-red"}`}>{Math.round(score)}%</div>
                      <div className="text-[10px] uppercase tracking-wider text-mute">{t.onTrack}</div>
                    </div>
                  )}
                </div>
                {a ? (
                  <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-4">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div><div className="label">{t.revenue}</div><div className="num">{money(a.view.P.revenue, c.currency, true)}</div></div>
                      <div><div className="label">{t.ebit}</div><div className={`num ${a.view.P.ebit < 0 ? "text-red" : ""}`}>{money(a.view.P.ebit, c.currency, true)}</div></div>
                      <div><div className="label">{t.cash}</div><div className="num">{money(a.view.B.cash, c.currency, true)}</div></div>
                      <div className="col-span-3 text-xs text-mute">{periodLabel(a.view.window.label, lang)} · {t.gpm} {pct(a.K.gpm, 1)} · {risks ? <span className="text-red">{t.attention(risks)}</span> : t.nothingUrgent}</div>
                    </div>
                    <Sparkline values={rev} w={120} h={40} />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-mute">{t.noData}</p>
                )}
                <div className="mt-4 flex gap-2 border-t border-line pt-3 text-sm">
                  <Link href={`/company/${c.id}/summary`} className="flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-band"><BarChart3 className="h-4 w-4 text-brand-d" />{t.analysis}</Link>
                  <Link href={`/company/${c.id}/reports`} className="flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-band"><FileText className="h-4 w-4 text-brand-d" />{t.reports}</Link>
                  {/* The same destinations as inside the company: Data ▸ Steps, and Settings ▸ Company profile. */}
                  <Link href={`/company/${c.id}/data`} className="ms-auto flex items-center gap-1.5 rounded px-2.5 py-1 text-mute hover:bg-band" data-testid="card-data"><Database className="h-4 w-4" />{t.data}</Link>
                  <Link href={`/company/${c.id}/settings/profile`} className="flex items-center gap-1.5 rounded px-2.5 py-1 text-mute hover:bg-band" data-testid="card-settings"><Settings className="h-4 w-4" />{t.settings}</Link>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-10 flex flex-wrap gap-6 text-sm text-mute">
          <Link href="/demo/summary" className="hover:text-ink">{t.viewDemo}</Link>
          <Link href="/dashboard" className="hover:text-ink">{t.insights}</Link>
        </div>
      </main>
    </>
  );
}
