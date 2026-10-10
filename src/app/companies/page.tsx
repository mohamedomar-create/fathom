import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, FileText, Settings } from "lucide-react";
import { money, pct } from "@/lib/engine";
import { loadPortfolio } from "@/lib/company/portfolio";
import { AppBar } from "@/components/shell/app-bar";
import { Sparkline } from "@/components/charts/spark";
import { AddCompany } from "./add-company";

export const metadata: Metadata = { title: "Companies" };

const SOURCE_LABEL: Record<string, string> = { odoo: "Odoo (live)", upload: "Odoo export", demo: "Demo data" };

function ago(iso: string | null) {
  if (!iso) return "never";
  const d = (Date.now() - new Date(iso).getTime()) / 86400000;
  if (d < 1 / 24) return "just now";
  if (d < 1) return `${Math.round(d * 24)} hours ago`;
  return `${Math.round(d)} days ago`;
}

export default async function CompaniesPage() {
  const { items, orgs, email } = await loadPortfolio();
  const org = orgs[0];
  return (
    <>
      <AppBar email={email} orgName={org?.name} isAdmin={orgs.some((o) => o.role === "admin")} active="companies" />
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8 sm:px-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label">{org?.name ?? "Your organisation"}</div>
            <h1 className="text-3xl font-light">{items.length} {items.length === 1 ? "company" : "companies"}</h1>
          </div>
          {orgs.some((o) => o.role !== "viewer") && <AddCompany orgs={orgs.filter((o) => o.role !== "viewer")} />}
        </div>
        {!items.length && (
          <div className="rounded-lg border border-dashed border-line px-6 py-16 text-center">
            <h2 className="text-xl font-light">Add your first company</h2>
            <p className="mx-auto mt-2 max-w-md text-mute">Upload an Odoo export (P&amp;L, Balance Sheet or Journal Items) or connect your Odoo database. Or start with a demo company to look around.</p>
          </div>
        )}
        <div className="grid gap-5 md:grid-cols-2" data-testid="company-cards">
          {items.map(({ company: c, months, analysis: a }) => {
            const rev = months.slice(-12).map((m) => (m.pl.revenue ?? 0));
            const score = a && a.onTrack + a.offTrack ? (a.onTrack / (a.onTrack + a.offTrack)) * 100 : null;
            const risks = a?.findings.filter((f) => f.kind === "risk").length ?? 0;
            return (
              <div key={c.id} className="fade-up rounded-lg border border-line bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/company/${c.id}/summary`} className="block truncate text-lg font-medium hover:underline">{c.name}</Link>
                    <div className="text-xs text-mute">Last updated {ago(c.last_synced_at)} · {SOURCE_LABEL[c.source] ?? c.source}</div>
                  </div>
                  {score !== null && (
                    <div className="text-right">
                      <div className={`text-2xl font-light ${score >= 60 ? "text-green-d" : "text-red"}`}>{Math.round(score)}%</div>
                      <div className="text-[10px] uppercase tracking-wider text-mute">on track</div>
                    </div>
                  )}
                </div>
                {a ? (
                  <div className="mt-4 grid grid-cols-[1fr_auto] items-end gap-4">
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div><div className="label">Revenue</div><div className="num">{money(a.view.P.revenue, c.currency, true)}</div></div>
                      <div><div className="label">EBIT</div><div className={`num ${a.view.P.ebit < 0 ? "text-red" : ""}`}>{money(a.view.P.ebit, c.currency, true)}</div></div>
                      <div><div className="label">Cash</div><div className="num">{money(a.view.B.cash, c.currency, true)}</div></div>
                      <div className="col-span-3 text-xs text-mute">{a.view.window.label} · GPM {pct(a.K.gpm, 1)} · {risks ? <span className="text-red">{risks} item{risks > 1 ? "s" : ""} need attention</span> : "nothing urgent"}</div>
                    </div>
                    <Sparkline values={rev} w={120} h={40} />
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-mute">No financial data yet.</p>
                )}
                <div className="mt-4 flex gap-2 border-t border-line pt-3 text-sm">
                  <Link href={`/company/${c.id}/summary`} className="flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-band"><BarChart3 className="h-4 w-4 text-brand-d" />Analysis</Link>
                  <Link href={`/company/${c.id}/reports`} className="flex items-center gap-1.5 rounded px-2.5 py-1 hover:bg-band"><FileText className="h-4 w-4 text-brand-d" />Reports</Link>
                  <Link href={`/company/${c.id}/settings/source-data`} className="ml-auto flex items-center gap-1.5 rounded px-2.5 py-1 text-mute hover:bg-band"><Settings className="h-4 w-4" />Settings</Link>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-10 flex flex-wrap gap-6 text-sm text-mute">
          <Link href="/demo/summary" className="hover:text-ink">View a demo company</Link>
          <Link href="/dashboard" className="hover:text-ink">Insights Dashboard</Link>
        </div>
      </main>
    </>
  );
}
