import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Database, FileDown, Gauge, LineChart, ShieldCheck, Sparkles, Telescope, Waves } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { SiteFooter } from "@/components/shell/site-footer";
import { AccountDeletedNotice } from "./account-deleted-notice";
import { LandingPreview } from "./landing-preview";

const FEATURES = [
  { icon: Gauge, title: "KPIs against targets", text: "25 standard KPIs scored on/off track, with alerts and a one-glance KPI Explorer." },
  { icon: LineChart, title: "Breakeven & margin of safety", text: "See how far revenue can fall before losses, and what each cost really does to profit." },
  { icon: Waves, title: "Where the cash went", text: "A cash-flow waterfall that reconciles to the bank: profit, working capital, capex, financing." },
  { icon: Telescope, title: "Goalseek", text: "The single lever — price, volume, costs — that reaches your profit target with the smallest change." },
  { icon: Sparkles, title: "Commentary that cites the numbers", text: "Rule-based analyst notes always on; Claude drafts board-ready commentary from your figures only." },
  { icon: FileDown, title: "Branded reports in one click", text: "A4 PDF with your logo and disclaimer, or a private link for the client or board." },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Suspense><AccountDeletedNotice /></Suspense>
      <header className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-5">
        <span className="text-lg font-semibold">{APP_NAME}</span>
        <nav className="ml-auto flex items-center gap-2 text-sm">
          <Link href="/demo/summary" className="rounded px-3 py-2 hover:bg-band">Demo</Link>
          <Link href="/login" className="rounded px-3 py-2 hover:bg-band">Sign in</Link>
          <Link href="/login?mode=signup" className="rounded bg-green-d px-4 py-2 font-medium text-white hover:brightness-110">Get started</Link>
        </nav>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-8 lg:grid-cols-[1fr_1.1fr]">
        <div className="fade-up">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-green-bg px-3 py-1 text-xs font-medium text-green-d"><Database className="h-3.5 w-3.5" />Built for Odoo · English &amp; Arabic</div>
          <h1 className="text-[44px] font-light leading-[1.08] tracking-tight sm:text-[56px]">Your Odoo numbers,<br /><span className="font-medium text-green-d">explained.</span></h1>
          <p className="mt-5 max-w-lg text-lg text-mute">Upload an export or connect Odoo, and get advisory-grade analysis in minutes: KPIs against targets, breakeven, cash flow, growth and goalseek — with a branded report your board will actually read.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo/summary" className="inline-flex items-center gap-2 rounded bg-green-d px-5 py-3 font-medium text-white hover:brightness-110" data-testid="cta-demo">Explore the demo company <ArrowRight className="h-4 w-4" /></Link>
            <Link href="/demo/settings/source-data" className="inline-flex items-center gap-2 rounded border border-line px-5 py-3 font-medium hover:bg-band">Try it with your own file</Link>
          </div>
          <p className="mt-3 text-xs text-mute">The file test runs in your browser — nothing is uploaded.</p>
        </div>
        <LandingPreview />
      </section>
      <section className="bg-band">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="mb-2 text-3xl font-light">Everything a monthly review needs</h2>
          <p className="mb-10 max-w-2xl text-mute">One engine, checked line by line against a reference model: the balance sheet must balance and net cash flow must equal the change in cash less debt, every month.</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-lg bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
                <f.icon className="mb-3 h-6 w-6 text-green-d" strokeWidth={1.6} />
                <div className="font-medium">{f.title}</div>
                <p className="mt-1 text-sm text-mute">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-3">
        <div><div className="label mb-2">1 · Bring in data</div><h3 className="mb-2 text-xl font-light">Upload or connect</h3><p className="text-sm text-mute">Trial Balance, P&amp;L / Balance Sheet or Journal Items exports — or a live, read-only Odoo API connection (v15–18+).</p></div>
        <div><div className="label mb-2">2 · Check the mapping</div><h3 className="mb-2 text-xl font-light">Every account, classified</h3><p className="text-sm text-mute">Odoo account types and English/Arabic names map to 30 standard classes. Low-confidence lines are flagged for review.</p></div>
        <div><div className="label mb-2">3 · Review &amp; report</div><h3 className="mb-2 text-xl font-light">Month, quarter or year</h3><p className="text-sm text-mute">Nine analysis views, a portfolio dashboard for many clients, and one-click PDF reports.</p></div>
      </section>
      <section className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-6 py-10 text-sm text-mute">
          <ShieldCheck className="h-5 w-5 text-green-d" />
          <span>Row-level security on every table · Odoo API keys encrypted with AES-256 · read-only access to your ledger.</span>
          <Link href="/login?mode=signup" className="ml-auto rounded bg-ink px-4 py-2 font-medium text-white">Create your account</Link>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
