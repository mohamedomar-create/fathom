import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, Database, FileDown, Gauge, Landmark, LineChart, Scale, ShieldCheck, Sparkles, Telescope, Waves } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { SiteFooter } from "@/components/shell/site-footer";
import { AccountDeletedNotice } from "./account-deleted-notice";
import { LandingPreview } from "./landing-preview";
import { LangSwitch } from "@/components/shell/lang-switch";
import { getDict } from "@/lib/i18n/server";

const ICONS = [Gauge, LineChart, Waves, Telescope, Sparkles, Landmark, Scale, FileDown];

export default async function Home() {
  const d = (await getDict()).home;
  return (
    <div className="min-h-screen bg-white">
      <Suspense><AccountDeletedNotice /></Suspense>
      <header className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-5">
        <span className="text-lg"><Logo size={28} /></span>
        <nav className="ms-auto flex items-center gap-2 text-sm">
          <LangSwitch compact className="px-2 py-2 hover:bg-band" />
          <Link href="/demo/summary" className="rounded px-3 py-2 hover:bg-band">{d.demo}</Link>
          <Link href="/login" className="rounded px-3 py-2 hover:bg-band">{d.signin}</Link>
          <Link href="/login?mode=signup" className="rounded bg-brand-d px-4 py-2 font-medium text-white hover:brightness-110">{d.getStarted}</Link>
        </nav>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-6 pb-16 pt-8 lg:grid-cols-[1fr_1.1fr]">
        <div className="fade-up">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-brand-bg px-3 py-1 text-xs font-medium text-brand-d"><Database className="h-3.5 w-3.5" />{d.badge}</div>
          <h1 className="text-[44px] font-light leading-[1.08] tracking-tight sm:text-[56px]">{d.heroA}<br /><span className="font-medium text-brand-d">{d.heroB}</span></h1>
          <p className="mt-5 max-w-lg text-lg text-mute">{d.heroText}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo/summary" className="inline-flex items-center gap-2 rounded bg-brand-d px-5 py-3 font-medium text-white hover:brightness-110" data-testid="cta-demo">{d.exploreDemo} <ArrowRight className="flip-rtl h-4 w-4" /></Link>
            <Link href="/demo/data" className="inline-flex items-center gap-2 rounded border border-line px-5 py-3 font-medium hover:bg-band">{d.tryFile}</Link>
          </div>
          <p className="mt-3 text-xs text-mute">{d.tryNote}</p>
        </div>
        <LandingPreview />
      </section>
      <section className="bg-band">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="mb-2 text-3xl font-light">{d.everything}</h2>
          <p className="mb-10 max-w-2xl text-mute">{d.everythingText}</p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {d.features.map(([title, text], i) => {
              const Icon = ICONS[i];
              return (
                <div key={title} className="rounded-lg bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,.04)]">
                  <Icon className="mb-3 h-6 w-6 text-brand-d" strokeWidth={1.6} />
                  <div className="font-medium">{title}</div>
                  <p className="mt-1 text-sm text-mute">{text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-3">
        {d.steps.map(([step, title, text]) => <div key={step}><div className="label mb-2">{step}</div><h3 className="mb-2 text-xl font-light">{title}</h3><p className="text-sm text-mute">{text}</p></div>)}
      </section>
      <section className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-6 px-6 py-10 text-sm text-mute">
          <ShieldCheck className="h-5 w-5 text-brand-d" />
          <span>{d.security}</span>
          <Link href="/login?mode=signup" className="ms-auto rounded bg-ink px-4 py-2 font-medium text-white">{d.createAccount}</Link>
        </div>
      </section>
      <SiteFooter />
    </div>
  );
}
